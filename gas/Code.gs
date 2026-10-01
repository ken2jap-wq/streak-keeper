/**
 * Streak Keeper → Google スプレッドシート連携
 *
 * アプリから送られてくる記録を、このスクリプトを紐づけたスプレッドシートに追記します。
 *   - 「記録」シート: 毎日の報告（完了 / 未完了 / 未報告）と各チェック項目の結果
 *   - 「罰」シート:   ルーレットで決まった罰と、実行済みにした日時
 *   - 「設定」シート: 名前ごとの開始日・チェックリスト・罰の一覧（変更のたびに1行）
 * 複数人で同じスプレッドシートを使っても「名前」列で区別できます。
 *
 * doGet は名前を指定すると、その人の記録をまとめて返します。
 * アプリの「スプレッドシートから復元」がこれを使って、機種変更やブラウザのデータ消去の後に
 * 記録を元に戻します。
 *
 * 設定方法は README の「スプレッドシート連携」を参照。
 */

const STATUS_LABEL = { done: '完了', failed: '未完了', missed: '未報告' };
const REASON_LABEL = { failed: '未完了', missed: '未報告' };

const REPORT_HEADER = ['受信日時', '名前', '日付', '結果', '連続日数', '達成数', '項目数', 'チェック内容'];
const PENALTY_HEADER = ['受信日時', '名前', '対象日', '理由', '内容', '状態'];
const SETTINGS_HEADER = ['受信日時', '名前', '開始日', 'チェックリスト', '罰の一覧'];

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const received = new Date();

  if (data.type === 'report' || data.type === 'test') {
    const sheet = sheetWithHeader(ss, '記録', REPORT_HEADER);
    const items = data.items || [];
    const doneCount = items.filter((i) => i.done).length;
    sheet.appendRow([
      received,
      data.name || '',
      // Leading apostrophe keeps Sheets from turning the date into a Date value.
      "'" + data.date,
      data.type === 'test' ? 'test' : STATUS_LABEL[data.status] || data.status,
      data.streak == null ? '' : data.streak,
      items.length ? doneCount : '',
      items.length || '',
      items.map((i) => (i.done ? '○ ' : '× ') + i.routine).join('\n'),
    ]);
  } else if (data.type === 'penalty') {
    const sheet = sheetWithHeader(ss, '罰', PENALTY_HEADER);
    sheet.appendRow([
      received,
      data.name || '',
      "'" + data.date,
      REASON_LABEL[data.reason] || data.reason,
      data.sanction,
      data.event === 'done' ? '実行済み' : '未執行（ルーレットで決定）',
    ]);
  } else if (data.type === 'settings') {
    const sheet = sheetWithHeader(ss, '設定', SETTINGS_HEADER);
    sheet.appendRow([
      received,
      data.name || '',
      "'" + data.startDate,
      JSON.stringify(data.routines || []),
      JSON.stringify(data.sanctions || []),
    ]);
  }

  return ContentService.createTextOutput('ok');
}

// GET ?name=たろう → { settings, reports, penalties } for that person, oldest first.
function doGet(e) {
  const name = String((e.parameter && e.parameter.name) || '').trim();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const result = { name: name, settings: null, reports: [], penalties: [] };

  if (name) {
    rowsFor(ss, '設定', name).forEach((r) => {
      result.settings = {
        startDate: asDateKey(r[2]),
        routines: parseJson(r[3], []),
        sanctions: parseJson(r[4], []),
      };
    });

    const statusFromLabel = invert(STATUS_LABEL);
    rowsFor(ss, '記録', name).forEach((r) => {
      const status = statusFromLabel[r[3]];
      if (!status) return; // skips test rows
      const done = String(r[7] || '')
        .split('\n')
        .filter((line) => line.indexOf('○ ') === 0)
        .map((line) => line.slice(2));
      result.reports.push({ date: asDateKey(r[2]), status: status, done: done });
    });

    const reasonFromLabel = invert(REASON_LABEL);
    rowsFor(ss, '罰', name).forEach((r) => {
      result.penalties.push({
        date: asDateKey(r[2]),
        reason: reasonFromLabel[r[3]] || 'failed',
        sanction: r[4],
        event: r[5] === '実行済み' ? 'done' : 'assigned',
        at: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
      });
    });
  }

  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function sheetWithHeader(ss, name, header) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(header);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
  }
  return sheet;
}

function rowsFor(ss, sheetName, name) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  return sheet
    .getDataRange()
    .getValues()
    .slice(1)
    .filter((r) => String(r[1]).trim() === name);
}

function asDateKey(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v).replace(/^'/, '');
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return fallback;
  }
}

function invert(map) {
  const out = {};
  Object.keys(map).forEach((k) => (out[map[k]] = k));
  return out;
}
