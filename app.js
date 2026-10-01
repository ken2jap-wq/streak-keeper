(() => {
  'use strict';

  const STORAGE_KEY = 'streak-keeper:v1';
  const MIN_SANCTIONS = 2;

  // ---------- date helpers (always local time) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (k, n) => {
    const d = fromKey(k);
    d.setDate(d.getDate() + n);
    return toKey(d);
  };
  const todayKey = () => toKey(new Date());
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const fmtDate = (k) => {
    const d = fromKey(k);
    return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`;
  };

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  // Unbiased random float in [0, 1) using the crypto API when available.
  const random = () => {
    if (window.crypto && crypto.getRandomValues) {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return a[0] / 2 ** 32;
    }
    return Math.random();
  };

  // ---------- state ----------
  const defaultState = () => ({
    version: 1,
    setupDone: false,
    name: '',
    startDate: todayKey(),
    routines: [],
    reports: {}, // { 'YYYY-MM-DD': { status: 'done' | 'failed' | 'missed', done?: [routine names] } }
    penalties: [], // { id, date, reason, sanction, spunAt, doneAt }
    sanctions: window.DEFAULT_SANCTIONS.map((s) => ({ id: uid(), ...s })),
    wheelRotation: 0,
    syncUrl: '',
    outbox: [], // events waiting to be sent to the spreadsheet
  });

  const load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const saved = JSON.parse(raw);
      // Data saved before the setup screen existed is already set up.
      if (saved.setupDone === undefined) saved.setupDone = true;
      return { ...defaultState(), ...saved };
    } catch {
      return defaultState();
    }
  };

  let state = load();
  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full or blocked: keep running in memory */
    }
  };

  // Any past day (since the app was started) without a report counts as a
  // failure: it breaks the streak and owes one roulette spin.
  const reconcile = () => {
    if (!state.setupDone) return;
    const today = todayKey();
    let changed = false;
    for (let d = state.startDate; d < today; d = addDays(d, 1)) {
      if (!state.reports[d]) {
        state.reports[d] = { status: 'missed', done: [] };
        addPenalty(d, 'missed');
        queueSync(reportEvent(d));
        changed = true;
      }
    }
    if (changed) save();
  };

  // ---------- spreadsheet sync ----------
  // Events go to an outbox first and are sent to a Google Apps Script web app
  // (see gas/Code.gs). Anything that fails to send is retried on the next launch.
  const reportEvent = (date) => {
    const r = state.reports[date];
    const done = new Set(r.done || []);
    return {
      type: 'report',
      name: state.name,
      date,
      status: r.status,
      items: state.routines.map((x) => ({ routine: x.name, done: done.has(x.name) })),
      streak: currentStreak(),
    };
  };

  // Snapshot of everything needed to rebuild the app on another device.
  const settingsEvent = () => ({
    type: 'settings',
    name: state.name,
    startDate: state.startDate,
    routines: state.routines.map((r) => r.name),
    sanctions: state.sanctions.map(({ title, detail, color, weight }) => ({ title, detail, color, weight })),
  });

  const penaltyEvent = (p, event) => ({
    type: 'penalty',
    name: state.name,
    date: p.date,
    reason: p.reason,
    event, // 'assigned' | 'done'
    sanction: p.sanction ? p.sanction.title : '',
  });

  const queueSync = (payload) => {
    state.outbox.push({ id: uid(), at: new Date().toISOString(), ...payload });
  };

  const saveSettings = () => {
    if (state.setupDone) queueSync(settingsEvent());
    save();
    flushSync();
  };

  let flushing = false;
  const flushSync = async () => {
    if (flushing || !state.syncUrl || !state.outbox.length) return renderSyncStatus();
    flushing = true;
    try {
      while (state.outbox.length) {
        const item = state.outbox[0];
        // text/plain avoids a CORS preflight, which Apps Script does not answer.
        await fetch(state.syncUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(item),
        });
        state.outbox.shift();
        save();
      }
    } catch {
      /* offline or blocked: keep the rest for the next try */
    } finally {
      flushing = false;
      renderSyncStatus();
    }
  };

  const renderSyncStatus = () => {
    const s = $('sync-status');
    if (!s) return;
    if (!state.syncUrl) s.textContent = '未設定（記録はこの端末の中だけに保存されます）';
    else if (state.outbox.length) s.textContent = `未送信の記録が${state.outbox.length}件あります。通信できるときに自動で再送します。`;
    else s.textContent = 'すべての記録を送信済みです。';
  };

  const addPenalty = (date, reason) => {
    if (state.penalties.some((p) => p.date === date)) return;
    state.penalties.push({ id: uid(), date, reason, sanction: null, spunAt: null, doneAt: null });
  };

  const currentStreak = () => {
    const today = todayKey();
    let n = 0;
    let d = today;
    // Today still open (not yet reported) does not break the streak.
    if (!state.reports[today]) d = addDays(today, -1);
    while (d >= state.startDate && state.reports[d]?.status === 'done') {
      n++;
      d = addDays(d, -1);
    }
    return n;
  };

  const bestStreak = () => {
    let best = 0;
    let run = 0;
    const today = todayKey();
    for (let d = state.startDate; d <= today; d = addDays(d, 1)) {
      if (state.reports[d]?.status === 'done') {
        run++;
        best = Math.max(best, run);
      } else if (state.reports[d]) {
        run = 0;
      }
    }
    return best;
  };

  const unspun = () => state.penalties.filter((p) => !p.sanction);
  const unexecuted = () => state.penalties.filter((p) => p.sanction && !p.doneAt);

  // ---------- DOM helpers ----------
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'onclick') node.addEventListener('click', v);
      else if (k === 'style') node.style.cssText = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  };

  // ---------- modal ----------
  const closeModal = () => $('modal').classList.add('hidden');
  const showModal = ({ kicker = '', title, body = '', actions = [{ label: 'OK' }] }) => {
    $('modal-kicker').textContent = kicker;
    $('modal-title').textContent = title;
    $('modal-body').textContent = body;
    const box = $('modal-actions');
    box.replaceChildren(
      ...actions.map((a) =>
        el('button', {
          class: `btn ${a.cls || ''}`,
          onclick: () => {
            closeModal();
            a.onClick && a.onClick();
          },
        }, a.label)
      )
    );
    $('modal').classList.remove('hidden');
  };

  // ---------- navigation ----------
  const go = (name) => {
    for (const v of document.querySelectorAll('.view')) v.classList.add('hidden');
    $(`view-${name}`).classList.remove('hidden');
    for (const b of document.querySelectorAll('.tabbar button')) {
      b.classList.toggle('active', b.dataset.goto === name);
    }
    $('tabbar').classList.toggle('hidden', name === 'setup');
    window.scrollTo(0, 0);
    if (name === 'roulette') drawWheel();
  };
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-goto]');
    if (t) go(t.dataset.goto);
  });

  // ---------- home ----------
  let checked = new Set();

  const renderHome = () => {
    const today = todayKey();
    const streak = currentStreak();
    $('streak-num').textContent = streak;
    $('streak-num').classList.toggle('zero', streak === 0);
    $('best-num').textContent = bestStreak();
    $('today-date').textContent = fmtDate(today);

    const report = state.reports[today];
    const list = $('checklist');
    list.replaceChildren();
    if (!state.routines.length) {
      list.append(el('li', { class: 'empty' }, '設定タブで毎日のルーティンを追加してください。'));
    }
    for (const r of state.routines) {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = report
        ? report.status === 'done' || (report.done || []).includes(r.name)
        : checked.has(r.id);
      cb.disabled = !!report;
      cb.addEventListener('change', () => {
        cb.checked ? checked.add(r.id) : checked.delete(r.id);
        updateReportButtons();
      });
      list.append(el('li', {}, el('label', {}, cb, el('span', {}, r.name))));
    }

    const notStarted = today < state.startDate;
    $('report-actions').classList.toggle('hidden', !!report || notStarted);
    const reported = $('reported');
    reported.classList.toggle('hidden', !report);
    reported.className = `reported ${report ? report.status : ''} ${report ? '' : 'hidden'}`;
    if (report?.status === 'done') reported.textContent = '今日のルーティン完了！明日も続けよう 🔥';
    if (report?.status === 'failed') reported.textContent = '今日は未完了で報告済み。罰を執行して明日から再スタート。';

    const now = new Date();
    const left = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
    const h = Math.floor(left / 3.6e6);
    const m = Math.floor((left % 3.6e6) / 6e4);
    $('deadline').textContent = report
      ? ''
      : notStarted
        ? `${fmtDate(state.startDate)}からスタートします。それまでは報告できません。`
        : `報告の締め切りまで あと${h}時間${m}分（今日中に報告しないと連続記録がリセットされ、罰ルーレットが発生します）`;

    updateReportButtons();
    renderCalendar();
    renderPenaltyBanner();
    renderInstallTip();
    updateBadge(streak);
  };

  const updateReportButtons = () => {
    const allChecked = state.routines.length > 0 && state.routines.every((r) => checked.has(r.id));
    $('btn-done').disabled = !allChecked;
    $('btn-fail').disabled = state.routines.length === 0;
  };

  const renderCalendar = () => {
    const cal = $('calendar');
    cal.replaceChildren();
    const today = todayKey();
    for (let i = 13; i >= 0; i--) {
      const k = addDays(today, -i);
      const status = state.reports[k]?.status || '';
      const d = fromKey(k);
      cal.append(
        el('div', { class: `day ${status} ${k === today ? 'today' : ''}`, title: k },
          el('b', {}, String(d.getDate())), WEEK[d.getDay()])
      );
    }
  };

  const renderPenaltyBanner = () => {
    const a = unspun().length;
    const b = unexecuted().length;
    $('penalty-banner').classList.toggle('hidden', a + b === 0);
    const parts = [];
    if (a) parts.push(`ルーレット未回転 ${a}件`);
    if (b) parts.push(`罰の未執行 ${b}件`);
    $('penalty-banner-text').textContent = parts.join(' ／ ');
    $('tab-badge').classList.toggle('hidden', a + b === 0);
    $('tab-badge').textContent = a + b;
  };

  const report = (status) => {
    const today = todayKey();
    if (state.reports[today]) return;
    const done = state.routines.filter((r) => checked.has(r.id)).map((r) => r.name);
    state.reports[today] = { status, done };
    if (status === 'failed') addPenalty(today, 'failed');
    queueSync(reportEvent(today));
    save();
    flushSync();
    checked = new Set();
    renderAll();
    if (status === 'done') {
      showModal({
        kicker: 'NICE!',
        title: `${currentStreak()}日連続達成 🔥`,
        body: '今日も自分との約束を守れました。',
      });
    } else {
      showModal({
        kicker: 'STREAK RESET',
        title: '連続記録がリセットされました',
        body: '罰ゲームルーレットを回してください。出た罰は必ず実行すること。',
        actions: [{ label: 'ルーレットへ', cls: 'primary', onClick: () => go('roulette') }],
      });
    }
  };

  $('btn-done').addEventListener('click', () =>
    showModal({
      title: '完了を報告しますか？',
      body: 'すべてのルーティンを本当にやり切りましたか？\n報告は取り消せません。',
      actions: [
        { label: 'はい、完了しました', cls: 'primary', onClick: () => report('done') },
        { label: 'キャンセル', cls: 'ghost' },
      ],
    })
  );
  $('btn-fail').addEventListener('click', () =>
    showModal({
      title: '未完了を報告しますか？',
      body: '連続記録は0に戻り、罰ゲームルーレットが発生します。\n報告は取り消せません。',
      actions: [
        { label: '未完了を報告する', cls: 'primary', onClick: () => report('failed') },
        { label: 'キャンセル', cls: 'ghost' },
      ],
    })
  );

  // ---------- home-screen badge ----------
  // iOS 16.4+ shows this number on the home-screen icon when the app was added
  // to the home screen and notifications are allowed.
  const updateBadge = (streak) => {
    if (!('setAppBadge' in navigator)) return;
    const p = streak > 0 ? navigator.setAppBadge(streak) : navigator.clearAppBadge();
    p && p.catch && p.catch(() => {});
  };

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  const renderInstallTip = () => {
    const granted = 'Notification' in window && Notification.permission === 'granted';
    $('install-tip').classList.toggle('hidden', isStandalone() && granted);
    $('btn-badge').classList.toggle('hidden', !isStandalone() || !('Notification' in window));
  };

  $('btn-badge').addEventListener('click', async () => {
    try {
      const r = await Notification.requestPermission();
      if (r !== 'granted') {
        showModal({ title: '通知が許可されませんでした', body: 'iPhoneの設定 → 通知 から許可するとバッジが表示されます。' });
      }
    } catch {
      /* ignore */
    }
    renderHome();
  });

  // ---------- roulette ----------
  const wheel = $('wheel');
  const ctx = wheel.getContext('2d');
  let spinning = false;

  const slices = () => {
    const total = state.sanctions.reduce((s, x) => s + (x.weight || 1), 0);
    let acc = 0;
    return state.sanctions.map((s) => {
      const size = ((s.weight || 1) / total) * 360;
      const slice = { s, start: acc, end: acc + size };
      acc += size;
      return slice;
    });
  };

  const fallbackColors = ['#e0213f', '#ff7a18', '#f2b705', '#2b9348', '#1d7ed6', '#6a4c93', '#c9184a', '#3a86ff', '#8338ec', '#111827'];

  const drawWheel = () => {
    const W = wheel.width;
    const c = W / 2;
    const r = c - 8;
    ctx.clearRect(0, 0, W, W);
    const rad = (deg) => ((deg - 90) * Math.PI) / 180; // 0deg = top, clockwise
    slices().forEach(({ s, start, end }, i) => {
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, r, rad(start), rad(end));
      ctx.closePath();
      ctx.fillStyle = s.color || fallbackColors[i % fallbackColors.length];
      ctx.fill();
      ctx.strokeStyle = '#101014';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(rad((start + end) / 2));
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 21px -apple-system, "Hiragino Sans", sans-serif';
      const label = s.title.length > 12 ? s.title.slice(0, 11) + '…' : s.title;
      ctx.fillText(label, r - 18, 0);
      ctx.restore();
    });
    ctx.beginPath();
    ctx.arc(c, c, 34, 0, Math.PI * 2);
    ctx.fillStyle = '#101014';
    ctx.fill();
    ctx.font = '30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💀', c, c + 2);
    wheel.style.transition = 'none';
    wheel.style.transform = `rotate(${state.wheelRotation}deg)`;
  };

  const renderRoulette = () => {
    const pending = unspun();
    const btn = $('btn-spin');
    const enough = state.sanctions.length >= MIN_SANCTIONS;
    btn.disabled = spinning || !pending.length || !enough;
    if (!enough) {
      $('roulette-sub').textContent = `設定タブで罰を${MIN_SANCTIONS}つ以上登録してください。`;
    } else if (pending.length) {
      const p = pending[0];
      $('roulette-sub').textContent =
        `${fmtDate(p.date)} の${p.reason === 'missed' ? '未報告' : '未完了'}に対する罰を決めます（残り${pending.length}回）。`;
    } else {
      $('roulette-sub').textContent = 'ルーティンを守れなかった日はここで罰が決まります。今は回す必要はありません。';
    }
    btn.textContent = pending.length ? `ルーレットを回す（${pending.length}回）` : 'ルーレットを回す';
    renderPenaltyList();
  };

  const pickSlice = () => {
    const list = slices();
    const target = random() * 360;
    const hit = list.find((x) => target >= x.start && target < x.end) || list[list.length - 1];
    // Land somewhere inside the slice but away from its edges.
    const margin = (hit.end - hit.start) * 0.15;
    const angle = hit.start + margin + random() * (hit.end - hit.start - margin * 2);
    return { hit, angle };
  };

  $('btn-spin').addEventListener('click', () => {
    const penalty = unspun()[0];
    if (!penalty || spinning) return;
    spinning = true;
    $('btn-spin').disabled = true;

    const { hit, angle } = pickSlice();
    // The pointer sits at the top (0deg); rotate the wheel so `angle` ends up there.
    const base = state.wheelRotation - (state.wheelRotation % 360);
    const rotation = base + 360 * 6 + (360 - angle);

    // Commit the result before the animation so closing the app mid-spin
    // cannot be used to dodge the sanction.
    penalty.sanction = { title: hit.s.title, detail: hit.s.detail || '' };
    penalty.spunAt = new Date().toISOString();
    queueSync(penaltyEvent(penalty, 'assigned'));
    state.wheelRotation = rotation;
    save();
    flushSync();

    wheel.style.transition = '';
    void wheel.offsetWidth; // restart transition
    wheel.style.transform = `rotate(${rotation}deg)`;

    const finish = () => {
      wheel.removeEventListener('transitionend', finish);
      clearTimeout(timer);
      spinning = false;
      renderAll();
      showModal({
        kicker: `${fmtDate(penalty.date)} の罰`,
        title: hit.s.title,
        body: `${hit.s.detail || ''}\n\n実行したら「罰の履歴」から実行済みにしてください。`,
        actions: [{ label: '受け入れる', cls: 'primary' }],
      });
    };
    const timer = setTimeout(finish, 5600);
    wheel.addEventListener('transitionend', finish);
  });

  const renderPenaltyList = () => {
    const list = $('penalty-list');
    list.replaceChildren();
    const items = [...state.penalties].sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!items.length) {
      list.append(el('li', { class: 'empty' }, 'まだ罰はありません。この調子！'));
      return;
    }
    for (const p of items) {
      const tag = !p.sanction
        ? el('span', { class: 'tag unspun' }, '未回転')
        : p.doneAt
          ? el('span', { class: 'tag done' }, '実行済み')
          : el('span', { class: 'tag pending' }, '未執行');
      const action = p.sanction && !p.doneAt
        ? el('button', {
            class: 'btn small',
            onclick: () =>
              showModal({
                title: '罰を実行しましたか？',
                body: p.sanction.title,
                actions: [
                  {
                    label: '実行しました',
                    cls: 'primary',
                    onClick: () => {
                      p.doneAt = new Date().toISOString();
                      queueSync(penaltyEvent(p, 'done'));
                      save();
                      flushSync();
                      renderAll();
                    },
                  },
                  { label: 'まだ', cls: 'ghost' },
                ],
              }),
          }, '実行済みにする')
        : null;
      list.append(
        el('li', {},
          el('div', { class: 'meta' }, `${fmtDate(p.date)}・${p.reason === 'missed' ? '未報告' : '未完了'}`),
          el('div', { class: 'ptitle' }, p.sanction ? p.sanction.title : 'ルーレットを回して罰を決めてください'),
          p.sanction?.detail ? el('div', { class: 'pdetail' }, p.sanction.detail) : null,
          el('div', { class: 'row' }, tag, action)
        )
      );
    }
  };

  // ---------- settings ----------
  const renameInput = (r) => {
    const input = el('input', { class: 'rename grow', maxlength: '60', 'aria-label': 'ルーティン名' });
    input.value = r.name;
    input.addEventListener('change', () => {
      const name = input.value.trim();
      if (!name) {
        input.value = r.name;
        return;
      }
      r.name = name;
      saveSettings();
      renderHome();
    });
    return input;
  };

  const renderSettings = () => {
    $('profile-name').value = state.name;
    $('profile-start').value = state.startDate;
    $('sync-url').value = state.syncUrl;
    renderSyncStatus();

    const rl = $('routine-list');
    rl.replaceChildren();
    if (!state.routines.length) rl.append(el('li', { class: 'empty' }, 'ルーティンがまだありません。'));
    for (const r of state.routines) {
      rl.append(
        el('li', {},
          renameInput(r),
          el('button', {
            class: 'del',
            'aria-label': '削除',
            onclick: () => {
              state.routines = state.routines.filter((x) => x.id !== r.id);
              checked.delete(r.id);
              saveSettings();
              renderAll();
            },
          }, '×')
        )
      );
    }

    const sl = $('sanction-list');
    sl.replaceChildren();
    state.sanctions.forEach((s, i) => {
      sl.append(
        el('li', {},
          el('i', { class: 'swatch', style: `background:${s.color || fallbackColors[i % fallbackColors.length]}` }),
          el('div', { class: 'grow' }, s.title, s.detail ? el('small', {}, s.detail) : null),
          el('button', {
            class: 'del',
            'aria-label': '削除',
            onclick: () => {
              if (state.sanctions.length <= MIN_SANCTIONS) {
                showModal({ title: '削除できません', body: `罰は最低${MIN_SANCTIONS}つ必要です。` });
                return;
              }
              state.sanctions = state.sanctions.filter((x) => x.id !== s.id);
              saveSettings();
              renderAll();
            },
          }, '×')
        )
      );
    });
  };

  $('profile-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('profile-name').value.trim();
    const start = $('profile-start').value;
    if (!name || !start) return;
    const startChanged = start !== state.startDate;
    const apply = () => {
      state.name = name;
      state.startDate = start;
      saveSettings();
      reconcile();
      renderAll();
      showModal({ title: '保存しました' });
    };
    if (startChanged && start < state.startDate) {
      showModal({
        title: '開始日を早めますか？',
        body: `${fmtDate(start)}から報告していない日はすべて「未報告」になり、罰が発生します。`,
        actions: [
          { label: '早める', cls: 'primary', onClick: apply },
          { label: 'キャンセル', cls: 'ghost', onClick: renderSettings },
        ],
      });
    } else {
      apply();
    }
  });

  $('sync-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('sync-url').value.trim();
    if (url && !/^https:\/\/script\.google\.com\//.test(url)) {
      showModal({ title: 'URLを確認してください', body: 'Apps Script の「ウェブアプリ」のURL（https://script.google.com/… で始まるもの）を貼り付けてください。' });
      return;
    }
    state.syncUrl = url;
    saveSettings();
    flushSync();
    showModal({ title: url ? '連携URLを保存しました' : '連携を解除しました' });
  });

  $('btn-sync-test').addEventListener('click', () => {
    if (!state.syncUrl) {
      showModal({ title: '先に連携URLを保存してください' });
      return;
    }
    queueSync({ type: 'test', name: state.name, date: todayKey() });
    save();
    flushSync();
    showModal({ title: 'テスト送信しました', body: 'スプレッドシートの「記録」シートに test の行が追加されていれば連携できています。' });
  });

  $('routine-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('routine-input').value.trim();
    if (!name) return;
    state.routines.push({ id: uid(), name });
    $('routine-input').value = '';
    saveSettings();
    renderAll();
  });

  $('sanction-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('sanction-title').value.trim();
    if (!title) return;
    state.sanctions.push({
      id: uid(),
      title,
      detail: $('sanction-detail').value.trim(),
      color: fallbackColors[state.sanctions.length % fallbackColors.length],
      weight: 1,
    });
    $('sanction-title').value = '';
    $('sanction-detail').value = '';
    saveSettings();
    renderAll();
  });

  $('btn-reset-sanctions').addEventListener('click', () =>
    showModal({
      title: '罰をデフォルトに戻しますか？',
      body: '追加した罰は消えます（履歴は残ります）。',
      actions: [
        {
          label: '戻す',
          cls: 'primary',
          onClick: () => {
            state.sanctions = window.DEFAULT_SANCTIONS.map((s) => ({ id: uid(), ...s }));
            saveSettings();
            renderAll();
          },
        },
        { label: 'キャンセル', cls: 'ghost' },
      ],
    })
  );

  $('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `streak-keeper-${todayKey()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
  });

  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.startDate || !data.reports) throw new Error('invalid');
      state = { ...defaultState(), setupDone: true, ...data };
      save();
      reconcile();
      renderAll();
      showModal({ title: '読み込みました' });
    } catch {
      showModal({ title: '読み込みに失敗しました', body: 'Streak Keeperのバックアップファイルを選んでください。' });
    }
    e.target.value = '';
  });

  $('btn-wipe').addEventListener('click', () =>
    showModal({
      title: 'すべてリセットしますか？',
      body: '連続記録・履歴・設定がすべて消えます。',
      actions: [
        {
          label: 'リセットする',
          cls: 'primary',
          onClick: () => {
            state = defaultState();
            checked = new Set();
            save();
            renderAll();
            showSetup();
          },
        },
        { label: 'キャンセル', cls: 'ghost' },
      ],
    })
  );

  // ---------- boot ----------
  const renderAll = () => {
    renderHome();
    renderRoulette();
    renderSettings();
  };

  let lastDay = todayKey();
  const tick = () => {
    if (todayKey() !== lastDay) {
      lastDay = todayKey();
      checked = new Set();
      reconcile();
      renderAll();
    } else {
      renderHome();
    }
  };

  // ---------- first-launch setup ----------
  const presets = window.PRESETS || [];
  const applyPreset = (p) => {
    $('setup-start').value = p.startDate || todayKey();
    $('setup-routines').value = p.routines.join('\n');
    for (const b of document.querySelectorAll('#preset-buttons .btn')) {
      b.classList.toggle('selected', b.dataset.preset === p.id);
    }
  };

  const showSetup = () => {
    const box = $('preset-buttons');
    box.replaceChildren(
      ...presets.map((p) => {
        const b = el('button', { class: 'btn small', type: 'button', onclick: () => applyPreset(p) }, p.label);
        b.dataset.preset = p.id;
        return b;
      })
    );
    const fromHash = presets.find((p) => `#${p.id}` === location.hash);
    const fallback = presets.find((p) => p.id === (window.DEFAULT_PRESET || 'blank'));
    applyPreset(fromHash || fallback || { id: '', routines: [] });
    go('setup');
  };

  $('setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const routines = $('setup-routines').value
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
    if (!routines.length) {
      showModal({ title: 'チェックリストが空です', body: '毎日やることを1つ以上書いてください。' });
      return;
    }
    state.name = $('setup-name').value.trim();
    state.startDate = $('setup-start').value || todayKey();
    state.routines = routines.map((name) => ({ id: uid(), name }));
    state.setupDone = true;
    saveSettings();
    reconcile();
    renderAll();
    go('home');
  });

  // Rebuild the whole app state from what the spreadsheet recorded for this name.
  const restoreFrom = (url, data) => {
    const next = defaultState();
    next.setupDone = true;
    next.name = data.name;
    next.syncUrl = url;

    const routineNames = data.settings?.routines?.length
      ? data.settings.routines
      : [...new Set(data.reports.flatMap((r) => r.done))];
    next.routines = routineNames.map((name) => ({ id: uid(), name }));
    if (data.settings?.sanctions?.length >= MIN_SANCTIONS) {
      next.sanctions = data.settings.sanctions.map((x) => ({ id: uid(), ...x }));
    }

    for (const r of data.reports) next.reports[r.date] = { status: r.status, done: r.done };
    const dates = Object.keys(next.reports).sort();
    next.startDate = data.settings?.startDate || dates[0] || todayKey();

    for (const d of dates) {
      const { status } = next.reports[d];
      if (status !== 'done') next.penalties.push({ id: uid(), date: d, reason: status, sanction: null, spunAt: null, doneAt: null });
    }
    for (const p of data.penalties) {
      const target = next.penalties.find((x) => x.date === p.date);
      if (!target) continue;
      const known = next.sanctions.find((x) => x.title === p.sanction);
      if (p.event === 'assigned') {
        target.sanction = { title: p.sanction, detail: known?.detail || '' };
        target.spunAt = p.at;
      } else {
        target.sanction ||= { title: p.sanction, detail: known?.detail || '' };
        target.doneAt = p.at;
      }
    }
    return next;
  };

  $('restore-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('restore-url').value.trim();
    const name = $('restore-name').value.trim();
    if (!/^https:\/\/script\.google\.com\//.test(url)) {
      showModal({ title: 'URLを確認してください', body: 'https://script.google.com/… で始まるウェブアプリのURLを貼り付けてください。' });
      return;
    }
    const btn = e.submitter || $('restore-form').querySelector('button');
    btn.disabled = true;
    btn.textContent = '読み込み中…';
    try {
      const res = await fetch(`${url}?name=${encodeURIComponent(name)}`);
      const data = await res.json();
      if (!data.settings && !data.reports?.length) {
        showModal({ title: '記録が見つかりません', body: `「${name}」の記録はこのスプレッドシートにありません。名前の表記（全角・半角やスペース）を確認してください。` });
        return;
      }
      state = restoreFrom(url, data);
      checked = new Set();
      save();
      reconcile();
      renderAll();
      go('home');
      flushSync();
      showModal({
        title: '復元しました',
        body: `${Object.keys(state.reports).length}日分の記録と${state.routines.length}個のチェック項目を読み込みました。`,
      });
    } catch {
      showModal({ title: '読み込めませんでした', body: '通信状況と連携URLを確認してください。Apps Script を最新のコードで「新しいデプロイ」し直す必要がある場合もあります。' });
    } finally {
      btn.disabled = false;
      btn.textContent = '復元する';
    }
  });

  if (!state.setupDone) {
    showSetup();
  } else {
    reconcile();
    save();
    flushSync();
  }
  renderAll();
  if (state.setupDone && unspun().length) {
    showModal({
      kicker: 'PENALTY',
      title: 'ルーレットを回す義務があります',
      body: `ルーティンを守れなかった日が${unspun().length}日あります。罰を決めてください。`,
      actions: [{ label: 'ルーレットへ', cls: 'primary', onClick: () => go('roulette') }],
    });
  }

  setInterval(tick, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !spinning) tick();
  });

  // Ask the browser not to evict this app's data under storage pressure.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
