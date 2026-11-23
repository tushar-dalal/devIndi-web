/* Gaana Tambola facilitator.
   Audio never leaves the device: the anchor picks the MP3 folder once, the page cuts each
   song's hook window out of the MP3 (frame by frame, no re-encoding) and keeps it in IndexedDB.
   Game state lives in localStorage and is saved after every action. */
(() => {
  'use strict';

  const D = window.GT_DATA;
  const HOOK = 25;            // seconds per hook
  const FADE_IN = 0.4, FADE_OUT = 1.8, NEXT_FADE = 0.3;
  const PAD_BEFORE = 15, PAD_AFTER = 12; // seconds kept around the hook, so it can be nudged
  const STATE_KEY = 'gt_state_v1', HOOKS_KEY = 'gt_hooks_v1';

  const SONGS = {};
  for (const [n, title, movie, start, len, file, check] of D.songs) SONGS[n] = { n, title, movie, start, len, file, check };
  const ALL = D.songs.map((s) => s[0]);

  // ---------- storage helpers ----------
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  const fresh = () => ({ mode: null, played: [], skipped: [], current: null, pos: 0, hide: false, auto: false, gap: 4, vol: 90, updatedAt: Date.now() });
  let S = Object.assign(fresh(), ls.get(STATE_KEY, {}));
  let hooks = ls.get(HOOKS_KEY, {});
  const save = () => { S.updatedAt = Date.now(); ls.set(STATE_KEY, S); };
  const hookStart = (n) => (hooks[n] != null ? hooks[n] : SONGS[n].start);

  // ---------- IndexedDB clip store ----------
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('gaana-tambola', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('clips', { keyPath: 'n' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function idb(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction('clips', mode);
      const req = fn(tx.objectStore('clips'));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  }
  const getClip = (n) => idb('readonly', (s) => s.get(n));
  const putClip = (c) => idb('readwrite', (s) => s.put(c));
  const clipKeys = () => idb('readonly', (s) => s.getAllKeys());
  const clearClips = () => idb('readwrite', (s) => s.clear());

  // ---------- MP3 frame slicer ----------
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const SR = [44100, 48000, 32000];
  function frameAt(b, i) {
    if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
    const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3;
    const bri = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) return null; // Layer III only
    const v1 = ver === 3;
    const sr = SR[sri] / (v1 ? 1 : ver === 2 ? 2 : 4);
    const br = (v1 ? BR1 : BR2)[bri] * 1000;
    const len = Math.floor(((v1 ? 144 : 72) * br) / sr) + pad;
    return { len, sr, spf: v1 ? 1152 : 576 };
  }
  // Returns { bytes, start, end } covering [from, to] seconds of the track, or null if it can't parse.
  function sliceMp3(buf, from, to) {
    const b = new Uint8Array(buf);
    let i = 0;
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) { // ID3v2
      i = 10 + ((b[6] & 127) << 21 | (b[7] & 127) << 14 | (b[8] & 127) << 7 | (b[9] & 127)) + ((b[5] & 0x10) ? 10 : 0);
    }
    let t = 0, a = -1, aT = 0, z = -1, first = true, frames = 0;
    while (i < b.length) {
      const f = frameAt(b, i);
      if (!f || (first && !frameAt(b, i + f.len) && i + f.len < b.length)) { i++; continue; } // resync
      if (first) {
        first = false;
        // Skip a Xing/Info/VBRI header frame: it holds no audio and would claim the whole track's length.
        const head = String.fromCharCode(...b.subarray(i + 4, Math.min(i + 60, b.length)));
        if (/Xing|Info|VBRI/.test(head)) { i += f.len; continue; }
      }
      if (a < 0 && t + f.spf / f.sr > from) { a = i; aT = t; }
      t += f.spf / f.sr;
      i += f.len; frames++;
      if (a >= 0 && t >= to) { z = i; break; }
    }
    if (frames < 50 || a < 0) return null;
    if (z < 0) z = Math.min(i, b.length);
    return { bytes: buf.slice(a, z), start: aT, end: Math.min(t, to + 1) };
  }

  // ---------- file import ----------
  const norm = (s) => s.toLowerCase().replace(/\.mp3$/, '').replace(/[^a-z0-9]/g, '');
  const byFile = {}; for (const n of ALL) byFile[norm(SONGS[n].file)] = n;
  let haveClips = new Set();

  async function importFiles(list) {
    const files = [...list].filter((f) => /\.mp3$/i.test(f.name));
    const matched = [], unknown = [];
    for (const f of files) { const n = byFile[norm(f.name)]; if (n) matched.push([n, f]); else unknown.push(f.name); }
    const prog = $('importProg'); prog.hidden = false;
    let done = 0, failed = [];
    for (const [n, f] of matched) {
      $('importText').textContent = `Storing ${done + 1} of ${matched.length}: #${n} ${SONGS[n].title}`;
      try {
        const buf = await f.arrayBuffer();
        const hs = hookStart(n);
        const cut = sliceMp3(buf, Math.max(0, hs - PAD_BEFORE), hs + HOOK + PAD_AFTER);
        const rec = cut
          ? { n, blob: new Blob([cut.bytes], { type: 'audio/mpeg' }), clipStart: cut.start, clipEnd: cut.end, name: f.name, savedAt: Date.now() }
          : { n, blob: new Blob([buf], { type: f.type || 'audio/mpeg' }), clipStart: 0, clipEnd: SONGS[n].len, name: f.name, whole: true, savedAt: Date.now() };
        await putClip(rec);
        bufCache.delete(n);
        haveClips.add(n);
      } catch (e) { failed.push(n); }
      done++;
      $('importFill').style.width = (done / matched.length) * 100 + '%';
    }
    $('importText').textContent = `Stored ${done - failed.length} clip${done - failed.length === 1 ? '' : 's'}` +
      (failed.length ? ` · failed: ${failed.map((n) => '#' + n).join(', ')}` : '') +
      (unknown.length ? ` · ${unknown.length} file${unknown.length === 1 ? '' : 's'} not in the song list` : '');
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
    renderClips();
  }

  // ---------- audio engine ----------
  let ctx = null, master = null;
  function audio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = S.vol / 100;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  const bufCache = new Map(); // n -> Promise<{buffer, clip, level}>
  function loadBuffer(n) {
    if (bufCache.has(n)) return bufCache.get(n);
    const p = (async () => {
      const clip = await getClip(n);
      if (!clip) throw new Error('missing');
      const ab = await clip.blob.arrayBuffer();
      const buffer = await new Promise((res, rej) => audio().decodeAudioData(ab, res, rej));
      return { buffer, clip, level: levelFor(buffer, hookStart(n) - clip.clipStart) };
    })();
    bufCache.set(n, p);
    p.catch(() => bufCache.delete(n));
    while (bufCache.size > 6) bufCache.delete(bufCache.keys().next().value);
    return p;
  }
  // Rough level matching: bring each hook's RMS to the same target, within limits.
  function levelFor(buffer, off) {
    const sr = buffer.sampleRate, a = Math.max(0, Math.floor(off * sr)), z = Math.min(buffer.length, a + HOOK * sr);
    let sum = 0, cnt = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = a; i < z; i += 16) { sum += d[i] * d[i]; cnt++; }
    }
    const rms = Math.sqrt(sum / Math.max(cnt, 1));
    return rms > 0.001 ? Math.min(2.2, Math.max(0.45, 0.14 / rms)) : 1;
  }

  // What is sounding right now.
  const P = { n: null, src: null, gain: null, startedAt: 0, base: 0, playing: false, replay: false, token: 0 };
  const pos = () => (P.playing ? Math.min(HOOK, P.base + (ctx.currentTime - P.startedAt)) : P.base);

  function stopNode(fade) {
    if (!P.src) return;
    const { src, gain } = P;
    P.src = null; P.gain = null;
    const now = ctx.currentTime;
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + fade);
      src.stop(now + fade + 0.02);
    } catch {}
  }

  async function playSong(n, from = 0, opts = {}) {
    const token = ++P.token;
    audio();
    const { buffer, clip, level } = await loadBuffer(n);
    if (token !== P.token) return false;
    let off = hookStart(n) - clip.clipStart + from;
    const warn = off < 0 || hookStart(n) - clip.clipStart + HOOK > buffer.duration + 0.05;
    off = Math.max(0, Math.min(off, buffer.duration - 0.5));
    const dur = Math.max(0.3, Math.min(HOOK - from, buffer.duration - off));
    const now = ctx.currentTime + 0.02;
    const src = ctx.createBufferSource(); src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(level, now + (from > 0.1 ? 0.08 : FADE_IN));
    if (dur > FADE_OUT + 0.5) g.gain.setValueAtTime(level, now + dur - FADE_OUT);
    g.gain.linearRampToValueAtTime(0, now + dur);
    src.connect(g).connect(master);
    src.start(now, off, dur);
    Object.assign(P, { n, src, gain: g, startedAt: now, base: from, playing: true, replay: !!opts.replay, preview: !!opts.preview });
    src.onended = () => {
      if (P.src !== src) return;
      P.src = null; P.playing = false;
      if (!P.replay && !P.preview) { P.base = HOOK; S.pos = HOOK; save(); maybeAuto(); }
      else { P.n = S.current; P.replay = false; P.preview = false; P.base = S.pos; } // back to the current call
      render();
    };
    if (warn && opts.preview) $('hookNote').textContent = 'This start is outside the stored clip. Re-load the song file to move the hook this far.';
    return true;
  }

  function pause() {
    if (!P.playing) return;
    const p = pos();
    stopNode(0.08);
    P.playing = false; P.base = p;
    if (!P.replay && !P.preview) { S.pos = p; save(); }
    render();
  }

  // ---------- game actions ----------
  const unplayed = () => ALL.filter((n) => !S.played.includes(n) && !S.skipped.includes(n));
  function pickNext() {
    const left = unplayed();
    if (!left.length) return null;
    if (S.mode === 'calling') return D.order.find((n) => left.includes(n));
    const r = new Uint32Array(1); crypto.getRandomValues(r);
    return left[r[0] % left.length];
  }

  let lastNext = 0, pendingErr = null;
  async function next() {
    if (Date.now() - lastNext < 500) return;
    lastNext = Date.now();
    cancelAuto();
    if (!S.mode) { flashMode(); return; }
    const n = pickNext();
    if (n == null) { render(); return; }
    hideErr();
    try {
      audio();
      await loadBuffer(n); // fail here, before the playing hook is cut off
      if (P.playing) {
        if (!P.replay && !P.preview) { S.pos = pos(); save(); }
        stopNode(NEXT_FADE);
      }
      P.playing = false;
      const ok = await playSong(n, 0);
      if (!ok) return;
      S.played.push(n); S.current = n; S.pos = 0; save();
      preloadNext();
      keepAwake();
    } catch (e) {
      P.playing = false;
      showErr(n, e && e.message === 'missing'
        ? `Song #${n} (${SONGS[n].title}) isn't loaded on this device.`
        : `Song #${n} (${SONGS[n].title}) couldn't be played.`);
    }
    render();
  }

  function preloadNext() {
    if (S.mode !== 'calling') return;
    const n = pickNext();
    if (n != null) loadBuffer(n).catch(() => {});
  }

  async function togglePlay() {
    cancelAuto();
    if (P.playing) { pause(); return; }
    // Resume the replay/preview song if that was what paused, else the current call.
    const aux = P.n != null && (P.replay || P.preview) && P.base < HOOK;
    const n = aux ? P.n : S.current;
    if (n == null) { next(); return; }
    let from = aux ? P.base : S.pos;
    if (from >= HOOK - 0.3) from = 0;
    try { await playSong(n, from, { replay: aux && P.replay, preview: aux && P.preview }); }
    catch (e) { showErr(n, `Song #${n} couldn't be played.`); }
    render();
  }

  function undo() {
    if (!S.played.length) return;
    cancelAuto();
    if (P.playing) stopNode(0.15);
    P.playing = false;
    S.played.pop();
    S.current = S.played.length ? S.played[S.played.length - 1] : null;
    S.pos = HOOK;
    P.n = S.current; P.base = HOOK; P.replay = false; P.preview = false;
    save(); render();
  }

  function reset() {
    cancelAuto();
    if (P.playing) { stopNode(0.1); P.playing = false; }
    const n = S.played.length;
    render();
    if (n && !confirm(`Clear ${n} played song${n === 1 ? '' : 's'}?`)) return;
    const keep = { hide: S.hide, auto: S.auto, gap: S.gap, vol: S.vol };
    S = Object.assign(fresh(), keep);
    Object.assign(P, { n: null, base: 0, replay: false, preview: false });
    hideErr();
    save(); render();
  }

  async function replay(n) {
    cancelAuto();
    if (P.playing) stopNode(NEXT_FADE);
    P.playing = false;
    try { await playSong(n, 0, { replay: n !== S.current }); }
    catch { showErr(n, `Song #${n} isn't loaded on this device.`, true); }
    render();
  }

  function setMode(m) {
    if (S.played.length || S.skipped.length) { flashMode(); return; }
    S.mode = m; save(); render(); preloadNext();
  }

  function showErr(n, text, noSkip) {
    pendingErr = n;
    $('errText').textContent = text;
    $('skipBtn').hidden = !!noSkip;
    $('errBox').hidden = false;
  }
  function hideErr() { pendingErr = null; $('errBox').hidden = true; }

  // ---------- auto-advance ----------
  let autoTimer = null, autoAt = 0;
  function maybeAuto() {
    if (!S.auto || !unplayed().length) return;
    autoAt = Date.now() + S.gap * 1000;
    clearInterval(autoTimer);
    autoTimer = setInterval(() => {
      const left = Math.ceil((autoAt - Date.now()) / 1000);
      if (left <= 0) { cancelAuto(); lastNext = 0; next(); return; }
      $('countdown').textContent = `Next in ${left}s`;
    }, 200);
  }
  function cancelAuto() { clearInterval(autoTimer); autoTimer = null; $('countdown').textContent = ''; }

  // ---------- wake lock ----------
  let wake = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wake && document.visibilityState === 'visible') { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.played.length) keepAwake(); });

  // ---------- rendering ----------
  function $(id) { return document.getElementById(id); }
  const fmt = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ':' + String(Math.floor(s % 60)).padStart(2, '0'); };
  const fmt1 = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ':' + (s % 60).toFixed(1).padStart(4, '0'); };

  const cells = {};
  function buildBoard() {
    const b = $('board');
    for (const n of ALL) {
      const c = document.createElement('button');
      c.type = 'button'; c.className = 'cell'; c.textContent = n; c.tabIndex = -1;
      c.title = `#${n}`;
      cells[n] = c; b.appendChild(c);
    }
  }

  function render() {
    const played = S.played.length, total = ALL.length;
    // top bar
    for (const btn of $('modeSeg').querySelectorAll('button')) btn.setAttribute('aria-pressed', String(S.mode === btn.dataset.mode));
    $('modeSeg').classList.toggle('locked', !!(played || S.skipped.length));
    $('countStat').textContent = played;
    if (S.mode === 'calling') {
      const r = played <= D.rounds[0] ? 1 : played <= D.rounds[0] + D.rounds[1] ? 2 : 3;
      $('roundStat').innerHTML = `Round <b>${played ? r : 1}</b> of 3`;
    } else $('roundStat').innerHTML = S.mode === 'random' ? '<b>Live random</b>' : 'Pick a mode';

    // now playing
    const showN = P.n != null && (P.replay || P.preview) ? P.n : S.current;
    const s = showN != null ? SONGS[showN] : null;
    $('nowNum').textContent = s ? s.n : '—';
    $('nowNum').classList.toggle('idle', !s);
    $('nowTitle').textContent = s ? s.title : (S.mode ? 'Tap Next to call the first song.' : 'Choose an order mode, then tap Next.');
    $('nowMovie').textContent = s ? s.movie : ' ';
    $('nowCard').classList.toggle('masked', !!(S.hide && s));
    $('historyWrap').classList.toggle('masked-list', !!S.hide);
    $('hideToggle').checked = !!S.hide;
    $('nowLabel').textContent = P.preview ? 'Preview (not counted)' : P.replay && showN !== S.current ? 'Replay (not counted)'
      : s ? (P.playing ? 'Now playing' : 'Paused') + (S.mode === 'calling' ? ` · call ${S.played.indexOf(s.n) + 1}` : '') : 'Now playing';
    $('playLabel').textContent = P.playing ? 'Pause' : 'Play';
    const remaining = unplayed().length;
    $('nextBtn').disabled = !remaining;
    $('doneBanner').hidden = !!remaining || !played;
    $('undoBtn').disabled = !played;
    $('resetBtn').disabled = !played && !S.mode && !S.skipped.length;

    // board
    for (const n of ALL) {
      const c = cells[n];
      c.className = 'cell' + (S.played.includes(n) ? ' played' : '') + (S.skipped.includes(n) ? ' skipped' : '') + (n === S.current ? ' current' : '');
    }
    $('boardStat').textContent = `${played} of ${total} played` + (S.skipped.length ? ` · ${S.skipped.length} skipped` : '') + ` · ${remaining} left`;

    // history (newest first)
    const h = $('history'); h.innerHTML = '';
    S.played.slice().reverse().forEach((n, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<button type="button"><span class="c">${String(played - i).padStart(2, '0')}</span><span class="n">${n}</span><span class="t"></span><span class="r">Replay</span></button>`;
      li.querySelector('.t').innerHTML = `${esc(SONGS[n].title)}<small>${esc(SONGS[n].movie)}</small>`;
      li.firstChild.addEventListener('click', () => replay(n));
      h.appendChild(li);
    });
    $('historyEmpty').hidden = !!played;

    $('autoToggle').checked = !!S.auto;
    $('gapIn').value = S.gap;
    $('volume').value = S.vol;
    tick();
    if (currentTicket) renderTicket(currentTicket);
  }

  function tick() {
    const p = P.n != null && (P.replay || P.preview || P.playing) ? pos() : (S.current != null ? S.pos : 0);
    $('barFill').style.width = (Math.min(p, HOOK) / HOOK) * 100 + '%';
    $('barPos').textContent = fmt(p);
  }
  let lastSave = 0;
  (function loop() {
    if (P.playing) {
      tick();
      if (!P.replay && !P.preview && Date.now() - lastSave > 1000) { S.pos = pos(); save(); lastSave = Date.now(); }
    }
    requestAnimationFrame(loop);
  })();

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function flashMode() {
    const seg = $('modeSeg');
    seg.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 260 });
  }

  async function renderClips() {
    try { haveClips = new Set(await clipKeys()); } catch { haveClips = new Set(); }
    const k = haveClips.size;
    $('clipsText').textContent = `${k}/99 clips stored`;
    $('clipsPill').classList.toggle('solid', k === 99);
    $('clipsPill').classList.toggle('warn', k < 99);
    const miss = ALL.filter((n) => !haveClips.has(n));
    $('missing').innerHTML = !miss.length ? '<b>All 99 songs are stored on this device.</b>'
      : k === 0 ? 'No songs stored on this device yet.'
      : `<b>Missing ${miss.length}:</b> ` + miss.map((n) => `#${n} ${esc(SONGS[n].title)}`).join(' · ');
    renderHookEditor();
  }

  // ---------- ticket check ----------
  let currentTicket = null;
  function renderTicket(no) {
    currentTicket = no;
    const g = D.tickets[no - 1];
    const isP = (n) => S.played.includes(n);
    let html = '<div class="ticket">';
    for (const row of g) for (const n of row) {
      html += !n ? '<div class="blank"></div>'
        : `<div class="${isP(n) ? 'hit' : ''}"><b>${n}</b><span>${esc(SONGS[n].title)}</span></div>`;
    }
    html += '</div>';
    const nums = g.flat().filter(Boolean), got = nums.filter(isP).length;
    const line = (r) => { const ns = g[r].filter(Boolean); return [ns.filter(isP).length, ns.length]; };
    const pats = [['Early 5', got >= 5, `${Math.min(got, 5)}/5`]];
    ['Top line', 'Middle line', 'Bottom line'].forEach((name, r) => { const [a, b] = line(r); pats.push([name, a === b, `${a}/${b}`]); });
    pats.push(['Full House', got === 15, `${got}/15`]);
    html += '<div class="patterns">' + pats.map(([name, ok, c]) => `<span class="pill ${ok ? 'solid' : ''}">${ok ? '✓ ' : ''}${name} · ${c}</span>`).join('') + '</div>';
    html += `<p class="stat" style="margin-top:12px">Ticket <b>${String(no).padStart(2, '0')}</b> · ${got} of 15 songs played</p>`;
    $('tkOut').innerHTML = html;
  }

  // ---------- hook editor ----------
  let edN = 1, edStart = null;
  function renderHookEditor() {
    const sel = $('hookSel');
    if (!sel.options.length) {
      for (const n of ALL) { const o = document.createElement('option'); o.value = n; sel.appendChild(o); }
    }
    for (const o of sel.options) {
      const n = +o.value, s = SONGS[n];
      o.textContent = `#${n} ${s.title}${hooks[n] != null ? ' (edited)' : ''}${s.check ? ' · check' : ''}${haveClips.has(n) ? '' : ' · not loaded'}`;
    }
    sel.value = edN;
    if (edStart == null) edStart = hookStart(edN);
    const def = SONGS[edN].start;
    $('hookTime').innerHTML = `${fmt1(edStart)}<small>to ${fmt1(edStart + HOOK)} · default ${fmt(def)}${edStart !== hookStart(edN) ? ' · unsaved' : ''}</small>`;
    const chips = $('checkChips'); chips.innerHTML = '';
    for (const n of ALL.filter((n) => SONGS[n].check)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = (n === edN ? 'on' : '') + (hooks[n] != null ? ' edited' : '');
      b.textContent = `#${n} ${SONGS[n].title}`;
      b.title = SONGS[n].check;
      b.addEventListener('click', () => selectHook(n));
      chips.appendChild(b);
    }
  }
  function selectHook(n) {
    edN = n; edStart = hookStart(n);
    $('hookNote').textContent = SONGS[n].check ? `Flagged: hook ${SONGS[n].check}.` : '';
    renderHookEditor();
  }
  async function nudge(d) {
    const clip = await getClip(edN).catch(() => null);
    let v = Math.round((edStart + d) * 10) / 10;
    v = Math.max(0, Math.min(v, SONGS[edN].len - HOOK));
    if (clip && !clip.whole && (v < clip.clipStart - 0.05 || v + HOOK > clip.clipEnd + 0.05)) {
      $('hookNote').textContent = `The stored clip covers ${fmt(clip.clipStart)}–${fmt(clip.clipEnd)}. Save this, then load the song file again to move the hook further.`;
    } else $('hookNote').textContent = '';
    edStart = v; renderHookEditor();
  }
  async function preview() {
    cancelAuto();
    if (P.playing) stopNode(NEXT_FADE);
    P.playing = false;
    const saved = hooks[edN];
    hooks[edN] = edStart; // temporarily
    bufCache.delete(edN);
    try { await playSong(edN, 0, { preview: true }); }
    catch { $('hookNote').textContent = `#${edN} isn't loaded on this device yet.`; }
    if (saved == null) delete hooks[edN]; else hooks[edN] = saved;
    bufCache.delete(edN);
    render();
  }
  function saveHook() {
    if (edStart === SONGS[edN].start) delete hooks[edN]; else hooks[edN] = edStart;
    ls.set(HOOKS_KEY, hooks); bufCache.delete(edN);
    $('hookNote').textContent = `Saved #${edN}: hook starts at ${fmt1(edStart)}.`;
    renderHookEditor();
  }
  function revertHook() {
    delete hooks[edN]; ls.set(HOOKS_KEY, hooks); bufCache.delete(edN);
    edStart = SONGS[edN].start;
    $('hookNote').textContent = `#${edN} is back to its default start.`;
    renderHookEditor();
  }

  // ---------- wiring ----------
  buildBoard();
  $('nextBtn').addEventListener('click', next);
  $('playBtn').addEventListener('click', togglePlay);
  $('undoBtn').addEventListener('click', undo);
  $('resetBtn').addEventListener('click', reset);
  $('modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
  $('hideToggle').addEventListener('change', (e) => { S.hide = e.target.checked; save(); render(); });
  $('autoToggle').addEventListener('change', (e) => { S.auto = e.target.checked; if (!S.auto) cancelAuto(); save(); });
  $('gapIn').addEventListener('change', (e) => { S.gap = Math.max(1, Math.min(30, +e.target.value || 4)); save(); render(); });
  $('volume').addEventListener('input', (e) => { S.vol = +e.target.value; if (master) master.gain.setTargetAtTime(S.vol / 100, ctx.currentTime, 0.02); save(); });
  $('retryBtn').addEventListener('click', async () => {
    const n = pendingErr; if (n == null) return;
    hideErr();
    if (S.played.includes(n)) { replay(n); return; }
    try { if (await playSong(n, 0)) { S.played.push(n); S.current = n; S.pos = 0; save(); preloadNext(); } }
    catch { showErr(n, `Song #${n} still couldn't be played.`); }
    render();
  });
  $('skipBtn').addEventListener('click', () => {
    const n = pendingErr; if (n == null) return;
    S.skipped.push(n); save(); hideErr(); lastNext = 0; next();
  });
  $('tkForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const no = Math.round(+$('tkIn').value);
    if (no >= 1 && no <= 50) renderTicket(no);
    else $('tkOut').innerHTML = '<p class="empty">Tickets run from 1 to 50.</p>';
  });
  $('folderIn').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
  $('filesIn').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
  $('clearClipsBtn').addEventListener('click', async () => {
    if (!confirm('Remove all stored song clips from this browser? You will need to load the folder again.')) return;
    await clearClips(); bufCache.clear(); renderClips();
  });
  $('hookSel').addEventListener('change', (e) => selectHook(+e.target.value));
  document.querySelectorAll('[data-nudge]').forEach((b) => b.addEventListener('click', () => nudge(+b.dataset.nudge)));
  $('previewBtn').addEventListener('click', preview);
  $('saveHookBtn').addEventListener('click', saveHook);
  $('revertHookBtn').addEventListener('click', revertHook);

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'n' || e.key === 'N' || e.key === 'ArrowRight') { e.preventDefault(); next(); }
    else if (e.key === 'u' || e.key === 'U') { e.preventDefault(); undo(); }
  });
  // Save the exact spot if the tab is closed mid-hook.
  window.addEventListener('pagehide', () => { if (P.playing && !P.replay && !P.preview) { S.pos = pos(); save(); } });

  // Restore: paused on the current song at the saved position.
  if (S.current != null) { P.n = S.current; P.base = S.pos; }
  render();
  renderClips();
  selectHook(1);
  if (S.current != null) loadBuffer(S.current).catch(() => {});
  preloadNext();

  // Offline: cache the page shell.
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => {
      $('offlineNote').textContent = 'Page saved for offline use. Once all 99 clips are stored, the game runs with Wi-Fi off.';
    }).catch(() => {});
  }
})();
