// Japanese public holidays, computed from the rules in the 国民の祝日に関する法律
// (fixed dates, "Happy Monday" holidays, the equinoxes, 振替休日 and 国民の休日).
// Valid for 2000–2099; one-off holidays declared by special law are not included.
window.JP_HOLIDAYS = (() => {
  const pad = (n) => String(n).padStart(2, '0');
  const key = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const fromKey = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (k, n) => {
    const d = fromKey(k);
    d.setDate(d.getDate() + n);
    return key(d.getFullYear(), d.getMonth() + 1, d.getDate());
  };
  const nthMonday = (y, m, n) => {
    const first = new Date(y, m - 1, 1).getDay();
    return 1 + ((8 - first) % 7) + (n - 1) * 7;
  };
  // Standard approximation of the equinox dates for 2000–2099.
  const equinox = (y, base) => Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));

  const cache = {};
  const forYear = (y) => {
    if (cache[y]) return cache[y];
    const h = new Map();
    const add = (m, d, name) => h.set(key(y, m, d), name);
    add(1, 1, '元日');
    add(1, nthMonday(y, 1, 2), '成人の日');
    add(2, 11, '建国記念の日');
    add(2, 23, '天皇誕生日');
    add(3, equinox(y, 20.8431), '春分の日');
    add(4, 29, '昭和の日');
    add(5, 3, '憲法記念日');
    add(5, 4, 'みどりの日');
    add(5, 5, 'こどもの日');
    add(7, nthMonday(y, 7, 3), '海の日');
    add(8, 11, '山の日');
    add(9, nthMonday(y, 9, 3), '敬老の日');
    add(9, equinox(y, 23.2488), '秋分の日');
    add(10, nthMonday(y, 10, 2), 'スポーツの日');
    add(11, 3, '文化の日');
    add(11, 23, '勤労感謝の日');

    // 振替休日: a holiday on a Sunday moves to the next day that is not a holiday.
    for (const k of [...h.keys()]) {
      if (fromKey(k).getDay() !== 0) continue;
      let n = addDays(k, 1);
      while (h.has(n)) n = addDays(n, 1);
      h.set(n, '振替休日');
    }
    // 国民の休日: a weekday squeezed between two holidays becomes one.
    for (const k of [...h.keys()]) {
      const mid = addDays(k, 1);
      const dow = fromKey(mid).getDay();
      if (!h.has(mid) && h.has(addDays(k, 2)) && dow !== 0 && dow !== 6) h.set(mid, '国民の休日');
    }
    cache[y] = h;
    return h;
  };

  return {
    // Holiday name for a 'YYYY-MM-DD' key, or null on an ordinary day.
    name: (k) => forYear(Number(k.slice(0, 4))).get(k) || null,
  };
})();
