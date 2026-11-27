/* Gaana Tambola ticket generator. Plain code, no AI: a seeded random generator, so the same
   set code always rebuilds exactly the same tickets on any device.

   Format (same as the original 50 tickets):
   - 3 rows x 9 columns, 5 songs in every row, 15 songs per ticket, 12 blank cells.
   - Column c holds songs 11c+1 .. 11c+11 (1-11, 12-22, ... 89-99), sorted top to bottom.
   - Every column has 1 to 3 songs.
   Across a set, every song is used as evenly as possible, and no two tickets are the same.

   Set code = the ticket file's name: "<count>-<4 letters>", e.g. "75-K7QM".
   Each ticket is named "<file> / <number>", e.g. "75-K7QM / 07". */
(() => {
  'use strict';
  const ROWS = 3, COLS = 9, PER_ROW = 5, PER_COL = 11;
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
  const MIN = 1, MAX = 300;

  // mulberry32, seeded from a string hash (xmur3).
  function rng(seedStr) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    let a = (h ^= h >>> 16) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function parseCode(code) {
    const m = String(code || '').trim().toUpperCase().match(/^(\d{1,3})-([A-Z2-9]{4})$/);
    if (!m) return null;
    const count = +m[1];
    if (count < MIN || count > MAX) return null;
    return { count, key: m[2], code: `${count}-${m[2]}` };
  }

  function newCode(count) {
    const r = new Uint32Array(4); crypto.getRandomValues(r);
    return `${count}-${Array.from(r, (x) => ALPHA[x % ALPHA.length]).join('')}`;
  }

  // Order items by a key (ascending), random among ties.
  function byLeast(items, key, rnd) {
    return items.map((x) => [key(x), rnd(), x]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((t) => t[2]);
  }

  // Which rows each column fills, given how many songs each column has (sum 15, each 1..3).
  // Fill the columns with the most songs first, into the rows with the most room left.
  function layout(counts, rnd) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const room = [PER_ROW, PER_ROW, PER_ROW];
      const rows = new Array(COLS);
      const order = byLeast([...Array(COLS).keys()], (c) => -counts[c], rnd);
      let ok = true;
      for (const c of order) {
        const pick = byLeast([0, 1, 2], (r) => -room[r], rnd).slice(0, counts[c]);
        if (pick.some((r) => room[r] <= 0)) { ok = false; break; }
        pick.forEach((r) => room[r]--);
        rows[c] = pick.sort((a, b) => a - b);
      }
      if (ok && room.every((x) => x === 0)) return rows;
    }
    return null;
  }

  // Returns { code, count, tickets }, tickets[i] = 3x9 grid of song numbers (0 = blank).
  function generate(code) {
    const p = parseCode(code);
    if (!p) throw new Error('Bad set code');
    const rnd = rng('gaana-tambola:' + p.code);
    const used = new Array(PER_COL * COLS + 1).fill(0); // times each song is on a ticket so far
    const colUsed = new Array(COLS).fill(0);
    const seen = new Set();
    const tickets = [];
    let guard = 0;
    while (tickets.length < p.count) {
      if (++guard > p.count * 200) throw new Error('Could not build unique tickets');
      // 1. Songs per column: one each, then 6 more to the columns used least so far.
      const counts = new Array(COLS).fill(1);
      const tmp = colUsed.slice();
      for (let k = 0; k < PER_ROW * ROWS - COLS; k++) {
        const c = byLeast([...Array(COLS).keys()].filter((c) => counts[c] < ROWS), (c) => tmp[c] + counts[c] * 0.5, rnd)[0];
        counts[c]++;
      }
      // 2. Rows for each column.
      const rows = layout(counts, rnd);
      if (!rows) continue;
      // 3. Songs: the least-used ones in each column, sorted top to bottom.
      const grid = [...Array(ROWS)].map(() => new Array(COLS).fill(0));
      for (let c = 0; c < COLS; c++) {
        const pool = Array.from({ length: PER_COL }, (_, i) => c * PER_COL + i + 1);
        const songs = byLeast(pool, (n) => used[n], rnd).slice(0, counts[c]).sort((a, b) => a - b);
        rows[c].forEach((r, i) => { grid[r][c] = songs[i]; });
      }
      const sig = grid.flat().filter(Boolean).join(',');
      if (seen.has(sig)) continue;
      seen.add(sig);
      grid.flat().forEach((n) => { if (n) used[n]++; });
      counts.forEach((k, c) => { colUsed[c] += k; });
      tickets.push(grid);
    }
    return { code: p.code, count: p.count, tickets };
  }

  // Ticket files made on this device (newest first), and the one the ticket check is set to.
  // "original" = the 50 printed tickets in data.js.
  const FILES_KEY = 'gt_ticketfiles', ACTIVE_KEY = 'gt_ticketset';
  const store = {
    files() { try { return JSON.parse(localStorage.getItem(FILES_KEY) || '[]'); } catch { return []; } },
    // Record a file (or move it to the top). Newly made files become the one the ticket check uses.
    add(code) {
      try {
        const old = store.files().find((f) => f.code === code);
        const files = [{ code, at: old ? old.at : Date.now() }, ...store.files().filter((f) => f.code !== code)].slice(0, 30);
        localStorage.setItem(FILES_KEY, JSON.stringify(files));
        localStorage.setItem(ACTIVE_KEY, code);
      } catch {}
    },
    active() {
      try {
        const a = localStorage.getItem(ACTIVE_KEY);
        if (a === 'original' || store.files().some((f) => f.code === a)) return a;
        const f = store.files()[0];
        return f ? f.code : 'original';
      } catch { return 'original'; }
    },
    use(code) { try { localStorage.setItem(ACTIVE_KEY, code); } catch {} },
  };
  // "75-K7QM / 07": file name, then the ticket's number in it.
  const label = (code, no) => `${code} / ${String(no).padStart(2, '0')}`;
  const when = (t) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  // Tickets for a set code, or the original 50.
  const cache = {};
  function tickets(code) {
    if (!code || code === 'original') return window.GT_DATA.tickets;
    if (!cache[code]) cache[code] = generate(code).tickets;
    return cache[code];
  }

  window.GT_TICKETS = { generate, parseCode, newCode, tickets, store, label, when, MIN, MAX };
})();
