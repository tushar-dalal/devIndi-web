/* Gaana Tambola facilitator.
   Audio is streamed from clips/NN-V.mp3 on the site: three pre-cut hook versions per song
   (see tools/cut-clips.js and hooks.json). Nothing audio is stored on the device: clips are held
   in memory only, and the next song is fetched and decoded before Next is tapped.
   Game state (played list, settings) lives in localStorage and is saved after every action. */
(() => {
  'use strict';

  const D = window.GT_DATA, CLIPS = window.GT_CLIPS;
  const CLIP_V = 2;           // bump when the clips are re-cut, so browsers fetch the new files
  const HOOK = 25;            // seconds per hook
  const VERSIONS = [1, 2, 3];
  const FADE_IN = 0.4, FADE_OUT = 1.8, NEXT_FADE = 0.3;
  const STATE_KEY = 'gt_state_v1', HOOKS_KEY = 'gt_hooks_v2';
  const RATES = [1, 1.5, 2];

  const SONGS = {};
  for (const [n, title, movie, start, len, file, check] of D.songs) SONGS[n] = { n, title, movie, start, len, file, check };
  const ALL = D.songs.map((s) => s[0]);

  // ---------- storage helpers ----------
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // ver = which hook version of the current song is loaded; vers = versions already played for it.
  const fresh = () => ({ rate: 1, mode: 'calling', played: [], skipped: [], current: null, ver: 1, vers: [], pos: 0, queued: null, hide: false, auto: false, gap: 4, vol: 90, updatedAt: Date.now() });
  let S = Object.assign(fresh(), ls.get(STATE_KEY, {}));
  let hooks = ls.get(HOOKS_KEY, {}); // "23.2" -> edited start of song 23, version 2
  const save = () => { S.updatedAt = Date.now(); ls.set(STATE_KEY, S); };
  const clipInfo = (n, v) => { const c = CLIPS[n][v - 1]; return { start: c[0], clipStart: c[1], clipEnd: c[2] }; };
  const hookStart = (n, v) => (hooks[n + '.' + v] != null ? hooks[n + '.' + v] : clipInfo(n, v).start);
  const clipUrl = (n, v) => `clips/${String(n).padStart(2, '0')}-${v}.mp3?v=${CLIP_V}`;

  // Clean up what earlier versions of this page kept in the browser: stored clips and the offline worker.
  try { indexedDB.deleteDatabase('gaana-tambola'); } catch {}
  try { localStorage.removeItem('gt_hooks_v1'); } catch {}
  if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  if (window.caches) caches.keys().then((ks) => ks.filter((k) => k.startsWith('gaana-tambola')).forEach((k) => caches.delete(k))).catch(() => {});

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

  // In-memory only: "n-v" -> Promise<{buffer, clip}>. Holds the current song and what comes next.
  const bufCache = new Map();
  function loadBuffer(n, v = 1) {
    const key = n + '-' + v;
    if (bufCache.has(key)) { const p = bufCache.get(key); bufCache.delete(key); bufCache.set(key, p); return p; }
    const p = (async () => {
      let res;
      try { res = await fetch(clipUrl(n, v)); } catch { throw new Error('network'); }
      if (!res.ok) throw new Error('http ' + res.status);
      const ab = await res.arrayBuffer();
      const buffer = await new Promise((ok, bad) => audio().decodeAudioData(ab, ok, bad));
      return { buffer, clip: clipInfo(n, v) };
    })();
    bufCache.set(key, p);
    p.then(() => { if (n === upNext && v === 1 && S.rate === 1) setReady(true); },
      () => { bufCache.delete(key); if (n === upNext && v === 1) setReady(false, true); });
    while (bufCache.size > 9) bufCache.delete(bufCache.keys().next().value);
    return p;
  }

  // Faster playback with the pitch kept: WSOLA time-stretch of the decoded clip, done in code.
  // Overlapping 46 ms windows are taken from the input at `rate` x the output step; each window
  // is nudged (within 12 ms) to where it best lines up with the audio before it, then overlap-added.
  function stretch(buf, rate) {
    const sr = buf.sampleRate, chs = buf.numberOfChannels, len = buf.length;
    const N = Math.round(sr * 0.046 / 2) * 2, Hs = N / 2, tol = Math.round(sr * 0.012), DEC = 4;
    const outLen = Math.max(1, Math.floor(len / rate));
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    const inp = [...Array(chs)].map((_, c) => buf.getChannelData(c));
    // Mono, 4x decimated (box-averaged) copy for the alignment search.
    const mLen = Math.floor(len / DEC), m = new Float32Array(mLen);
    for (let i = 0; i < mLen; i++) { let a = 0; for (let c = 0; c < chs; c++) for (let j = 0; j < DEC; j++) a += inp[c][i * DEC + j]; m[i] = a; }
    const out = [...Array(chs)].map(() => new Float32Array(outLen + N)), norm = new Float32Array(outLen + N);
    const maxPos = Math.max(0, len - N), L = Math.floor(Hs / DEC);
    let prev = 0;
    for (let o = 0; o < outLen; o += Hs) {
      let pos = Math.min(maxPos, Math.round(o * rate));
      if (o > 0) {
        const nat = Math.min(maxPos, prev + Hs) / DEC | 0;
        const lo = Math.max(0, pos - tol) / DEC | 0, hi = Math.min(maxPos, pos + tol) / DEC | 0;
        let best = -Infinity, bestP = pos / DEC | 0;
        for (let q = lo; q <= hi; q++) {
          let dot = 0, en = 1e-9;
          for (let i = 0; i < L; i++) { const x = m[q + i]; dot += x * m[nat + i]; en += x * x; }
          const sc = dot / Math.sqrt(en);
          if (sc > best) { best = sc; bestP = q; }
        }
        pos = Math.min(maxPos, bestP * DEC);
      }
      for (let c = 0; c < chs; c++) { const a = inp[c], b = out[c]; for (let i = 0; i < N && pos + i < len; i++) b[o + i] += a[pos + i] * win[i]; }
      for (let i = 0; i < N; i++) norm[o + i] += win[i];
      prev = pos;
    }
    const res = ctx.createBuffer(chs, outLen, sr);
    for (let c = 0; c < chs; c++) {
      const b = out[c];
      for (let i = 0; i < outLen; i++) b[i] = norm[i] > 0.05 ? b[i] / norm[i] : b[i];
      res.copyToChannel(b.subarray(0, outLen), c);
    }
    return res;
  }
  // Decoded clip at a speed: { buffer (original), clip, play (buffer to play) }.
  const fastCache = new Map();
  function getBuffer(n, v, rate) {
    if (rate === 1) return loadBuffer(n, v).then((b) => ({ ...b, play: b.buffer }));
    const key = n + '-' + v + '@' + rate;
    if (!fastCache.has(key)) {
      const p = loadBuffer(n, v).then((b) => ({ ...b, play: stretch(b.buffer, rate) }));
      fastCache.set(key, p);
      p.then(() => { if (n === upNext && v === 1 && rate === S.rate) setReady(true); },
        () => { fastCache.delete(key); if (n === upNext && v === 1) setReady(false, true); });
      while (fastCache.size > 6) fastCache.delete(fastCache.keys().next().value);
    }
    return fastCache.get(key);
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

  // What is sounding right now. aux = a replay of another song or an editor preview (not counted).
  const P = { rate: 1, n: null, v: 1, src: null, gain: null, startedAt: 0, base: 0, playing: false, replay: false, preview: false, token: 0 };
  // Position in seconds of the song's hook (at 2x, 25 s of song pass in 12.5 s).
  const pos = () => (P.playing ? Math.max(0, Math.min(HOOK, P.base + (ctx.currentTime - P.startedAt) * P.rate)) : P.base);
  const isAux = () => P.replay || P.preview;

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

  async function playSong(n, v, from = 0, opts = {}) {
    const token = ++P.token;
    audio();
    const rate = opts.preview ? 1 : S.rate; // editor previews always play at normal speed
    const { buffer, clip, play } = await getBuffer(n, v, rate);
    if (token !== P.token) return false;
    const start = opts.start != null ? opts.start : hookStart(n, v);
    let off = start - clip.clipStart + from;
    off = Math.max(0, Math.min(off, buffer.duration - 0.5));
    const dur = Math.max(0.3, Math.min(HOOK - from, buffer.duration - off));
    const level = levelFor(buffer, start - clip.clipStart);
    const now = ctx.currentTime + 0.02;
    const real = dur / rate; // seconds of real time
    const src = ctx.createBufferSource(); src.buffer = play;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(level, now + (from > 0.1 ? 0.08 : FADE_IN));
    if (real > FADE_OUT + 0.5) g.gain.setValueAtTime(level, now + real - FADE_OUT);
    g.gain.linearRampToValueAtTime(0, now + real);
    src.connect(g).connect(master);
    src.start(now, Math.min(off / rate, play.duration - 0.1), real);
    Object.assign(P, { rate, n, v, src, gain: g, startedAt: now, base: from, playing: true, replay: !!opts.replay, preview: !!opts.preview, previewStart: opts.start });
    src.onended = () => {
      if (P.src !== src) return;
      P.src = null; P.playing = false;
      if (!isAux()) { P.base = HOOK; S.pos = HOOK; save(); maybeAuto(); }
      else { P.n = S.current; P.v = S.ver; P.replay = false; P.preview = false; P.base = S.pos; } // back to the current call
      render();
    };
    return true;
  }

  function pause() {
    if (!P.playing) return;
    const p = pos();
    stopNode(0.08);
    P.playing = false; P.base = p;
    if (!isAux()) { S.pos = p; save(); }
    render();
  }

  // ---------- game actions ----------
  const unplayed = () => ALL.filter((n) => !S.played.includes(n) && !S.skipped.includes(n));
  function pickNext() {
    const left = unplayed();
    if (!left.length) return null;
    if (S.mode === 'calling') return D.order.find((n) => left.includes(n));
    // Live random: draw ahead of time so the song can be fetched before Next is tapped.
    if (S.queued != null && left.includes(S.queued)) return S.queued;
    const r = new Uint32Array(1); crypto.getRandomValues(r);
    S.queued = left[r[0] % left.length]; save();
    return S.queued;
  }

  // Fetch + decode what Next will play (and the one after, in calling order), plus the other two
  // versions of the current song, so every button responds at once.
  let upNext = null;
  function preload() {
    if (S.current != null) for (const v of VERSIONS) getBuffer(S.current, v, S.rate).catch(() => {});
    if (!S.mode) { upNext = null; setReady(null); return; }
    const n = pickNext();
    upNext = n;
    if (n == null) { setReady(null); return; }
    setReady(false);
    getBuffer(n, 1, S.rate).catch(() => {});
    if (S.mode === 'calling') {
      const after = D.order.find((m) => m !== n && !S.played.includes(m) && !S.skipped.includes(m));
      if (after != null) setTimeout(() => loadBuffer(after, 1).catch(() => {}), 1500);
    }
  }
  function setReady(ok, failed) {
    const pill = $('clipsPill');
    if (ok === null) { $('clipsText').textContent = navigator.onLine ? 'Streaming from devindi.in' : 'Offline'; pill.className = 'pill' + (navigator.onLine ? '' : ' warn'); return; }
    $('clipsText').textContent = ok ? 'Next song ready' : failed ? 'Next song didn’t load' : 'Loading next song…';
    pill.className = 'pill' + (ok ? ' solid' : failed ? ' warn' : '');
  }
  window.addEventListener('online', preload);
  window.addEventListener('offline', () => setReady(null));

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
      await getBuffer(n, 1, S.rate); // fail here, before the playing hook is cut off
      if (P.playing) {
        if (!isAux()) { S.pos = pos(); save(); }
        stopNode(NEXT_FADE);
      }
      P.playing = false;
      const ok = await playSong(n, 1, 0);
      if (!ok) return;
      S.played.push(n); S.current = n; S.ver = 1; S.vers = [1]; S.pos = 0; S.queued = null; save();
      preload();
      keepAwake();
    } catch (e) {
      showErr(n, e);
    }
    render();
  }

  // Play another version of the song on screen (the current call, or a song being replayed).
  async function playVersion(v) {
    cancelAuto();
    const auxSong = P.replay && P.n !== S.current ? P.n : null;
    const n = auxSong != null ? auxSong : S.current;
    if (n == null) return;
    if (P.playing) stopNode(NEXT_FADE);
    P.playing = false;
    hideErr();
    try {
      const ok = await playSong(n, v, 0, { replay: auxSong != null });
      if (ok && auxSong == null) {
        S.ver = v; S.pos = 0;
        if (!S.vers.includes(v)) S.vers.push(v);
        save();
      }
    } catch (e) { showErr(n, e, true); }
    render();
  }

  async function togglePlay() {
    cancelAuto();
    if (P.playing) { pause(); return; }
    // Resume the replay/preview if that was what paused, else the current call.
    const aux = P.n != null && isAux() && P.base < HOOK;
    const n = aux ? P.n : S.current;
    if (n == null) { next(); return; }
    const v = aux ? P.v : S.ver;
    let from = aux ? P.base : S.pos;
    if (from >= HOOK - 0.3) from = 0;
    try { await playSong(n, v, from, { replay: aux && P.replay, preview: aux && P.preview, start: aux && P.preview ? P.previewStart : undefined }); }
    catch (e) { showErr(n, e, true); }
    render();
  }

  function undo() {
    if (!S.played.length) return;
    cancelAuto();
    if (P.playing) stopNode(0.15);
    P.playing = false;
    const n = S.played.pop();
    S.queued = S.mode === 'random' ? n : null; // in random mode, the undone song is the next draw again
    S.current = S.played.length ? S.played[S.played.length - 1] : null;
    S.ver = 1; S.vers = S.current != null ? [1] : []; S.pos = HOOK;
    Object.assign(P, { n: S.current, v: 1, base: HOOK, replay: false, preview: false });
    save(); render(); preload();
  }

  function reset() {
    cancelAuto();
    if (P.playing) { stopNode(0.1); P.playing = false; }
    const n = S.played.length;
    render();
    if (n && !confirm(`Clear ${n} played song${n === 1 ? '' : 's'}?`)) return;
    const keep = { hide: S.hide, auto: S.auto, gap: S.gap, vol: S.vol, rate: S.rate };
    S = Object.assign(fresh(), keep);
    Object.assign(P, { n: null, v: 1, base: 0, replay: false, preview: false });
    hideErr();
    save(); render(); preload();
  }

  async function replay(n) {
    cancelAuto();
    if (P.playing) stopNode(NEXT_FADE);
    P.playing = false;
    hideErr();
    const cur = n === S.current;
    try {
      const ok = await playSong(n, cur ? S.ver : 1, 0, { replay: !cur });
      if (ok && cur) { S.pos = 0; save(); }
    } catch (e) { showErr(n, e, true); }
    for (const v of VERSIONS) loadBuffer(n, v).catch(() => {});
    render();
  }

  // Change speed; a hook that is playing carries on from the same spot at the new speed.
  async function setRate(r) {
    if (!RATES.includes(r) || r === S.rate) return;
    S.rate = r; save();
    const wasPlaying = P.playing && !P.preview;
    if (wasPlaying) {
      const p = pos(), n = P.n, v = P.v, rp = P.replay;
      stopNode(0.08); P.playing = false; P.base = p;
      if (!rp) { S.pos = p; save(); }
      render();
      try { await playSong(n, v, p >= HOOK - 0.3 ? 0 : p, { replay: rp }); } catch (e) { showErr(n, e, true); }
    }
    render(); preload();
  }

  function setMode(m) {
    if (S.played.length || S.skipped.length) { flashMode(); return; }
    S.mode = m; S.queued = null; save(); render(); preload();
  }

  // Say exactly what went wrong.
  function showErr(n, e, noSkip) {
    pendingErr = n;
    if (e) console.error('Gaana Tambola: song', n, e);
    const name = `Song #${n} (${SONGS[n].title})`;
    const net = !!(e && (e.message === 'network' || /^http/.test(e.message)));
    $('errText').textContent = net
      ? `${name} couldn't be fetched${navigator.onLine ? '' : ' (no internet)'}. Check the connection and retry, or skip it.`
      : `${name} couldn't be decoded${e && e.name ? ' (' + e.name + ')' : ''}. Retry, or skip it.`;
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
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const cells = {};
  function buildBoard() {
    const b = $('board');
    for (const n of ALL) {
      const c = document.createElement('button');
      c.type = 'button'; c.className = 'cell'; c.textContent = n; c.tabIndex = -1; c.title = `#${n}`;
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
    const auxShown = P.n != null && isAux();
    const showN = auxShown ? P.n : S.current;
    const showV = auxShown ? P.v : S.ver;
    const s = showN != null ? SONGS[showN] : null;
    $('nowNum').textContent = s ? s.n : '—';
    $('nowNum').classList.toggle('idle', !s);
    $('nowTitle').textContent = s ? s.title : (S.mode ? 'Tap Next to call the first song.' : 'Choose an order mode, then tap Next.');
    $('nowMovie').textContent = s ? s.movie : ' ';
    $('nowCard').classList.toggle('masked', !!(S.hide && s));
    $('historyWrap').classList.toggle('masked-list', !!S.hide);
    $('hideToggle').checked = !!S.hide;
    const vTag = s ? ` · version ${showV}` : '';
    $('nowLabel').textContent = P.preview ? `Preview (not counted)${vTag}`
      : P.replay && showN !== S.current ? `Replay (not counted)${vTag}`
      : s ? (P.playing ? 'Now playing' : 'Paused') + (S.mode === 'calling' ? ` · call ${S.played.indexOf(s.n) + 1}` : '') + vTag : 'Now playing';
    $('playLabel').textContent = P.playing ? 'Pause' : 'Play';
    for (const b of $('speedSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(+b.dataset.rate === S.rate));
    // version buttons
    for (const b of $('verSeg').querySelectorAll('button')) {
      const v = +b.dataset.v;
      b.disabled = !s || P.preview;
      b.setAttribute('aria-pressed', String(!!s && v === showV));
      b.classList.toggle('heard', !!s && !auxShown && S.vers.includes(v));
    }
    const remaining = unplayed().length;
    $('nextBtn').disabled = !remaining;
    $('doneBanner').hidden = !!remaining || !played;
    $('undoBtn').disabled = !played;
    $('resetBtn').disabled = !played && !S.mode && !S.skipped.length;

    // board
    for (const n of ALL) {
      cells[n].className = 'cell' + (S.played.includes(n) ? ' played' : '') + (S.skipped.includes(n) ? ' skipped' : '') + (n === S.current ? ' current' : '');
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
    const p = P.n != null && (isAux() || P.playing) ? pos() : (S.current != null ? S.pos : 0);
    $('barFill').style.width = (Math.min(p, HOOK) / HOOK) * 100 + '%';
    $('barPos').textContent = fmt(p);
  }
  let lastSave = 0;
  (function loop() {
    if (P.playing) {
      tick();
      if (!isAux() && Date.now() - lastSave > 1000) { S.pos = pos(); save(); lastSave = Date.now(); }
    }
    requestAnimationFrame(loop);
  })();

  function flashMode() {
    $('modeSeg').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 260 });
  }

  // ---------- ticket check ----------
  // Which ticket file to check against: files made in the ticket generator (newest first, newest
  // selected by default), plus the original 50 printed tickets.
  const TK = window.GT_TICKETS;
  let currentTicket = null, tkSet = TK.store.active();
  const tkList = () => TK.tickets(tkSet);
  function fillTkSets() {
    const sel = $('tkSet'); sel.innerHTML = '';
    for (const f of TK.store.files()) sel.add(new Option(`${f.code} · ${TK.parseCode(f.code).count} tickets · ${TK.when(f.at)}`, f.code));
    sel.add(new Option('Original 50 (printed)', 'original'));
    tkSet = TK.store.active(); sel.value = tkSet;
    const n = tkList().length;
    $('tkIn').max = n;
    $('tkRange').textContent = `Tickets 1–${n}`;
  }
  function renderTicket(no) {
    currentTicket = no;
    const g = tkList()[no - 1];
    const isP = (n) => S.played.includes(n);
    let html = '<div class="ticket">';
    for (const row of g) for (const n of row) {
      html += !n ? '<div class="blank"></div>'
        : `<div class="${isP(n) ? 'hit' : ''}"><b>${n}</b><span>${esc(SONGS[n].title)}</span></div>`;
    }
    html += '</div>';
    const got = g.flat().filter(Boolean).filter(isP).length;
    const line = (r) => { const ns = g[r].filter(Boolean); return [ns.filter(isP).length, ns.length]; };
    const pats = [['Early 5', got >= 5, `${Math.min(got, 5)}/5`]];
    ['Top line', 'Middle line', 'Bottom line'].forEach((name, r) => { const [a, b] = line(r); pats.push([name, a === b, `${a}/${b}`]); });
    pats.push(['Full House', got === 15, `${got}/15`]);
    html += '<div class="patterns">' + pats.map(([name, ok, c]) => `<span class="pill ${ok ? 'solid' : ''}">${ok ? '✓ ' : ''}${name} · ${c}</span>`).join('') + '</div>';
    const name = tkSet === 'original' ? `Original ${String(no).padStart(2, '0')}` : TK.label(tkSet, no);
    html += `<p class="stat" style="margin-top:12px">Ticket <b>${esc(name)}</b> · ${got} of 15 songs played</p>`;
    $('tkOut').innerHTML = html;
  }

  // ---------- hook editor ----------
  let edN = 1, edV = 1, edStart = null;
  function renderHookEditor() {
    const sel = $('hookSel');
    if (!sel.options.length) for (const n of ALL) { const o = document.createElement('option'); o.value = n; sel.appendChild(o); }
    for (const o of sel.options) {
      const n = +o.value, s = SONGS[n];
      const edited = VERSIONS.some((v) => hooks[n + '.' + v] != null);
      o.textContent = `#${n} ${s.title}${edited ? ' (edited)' : ''}${s.check ? ' · check' : ''}`;
    }
    sel.value = edN;
    for (const b of $('edVerSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(+b.dataset.v === edV));
    if (edStart == null) edStart = hookStart(edN, edV);
    const def = clipInfo(edN, edV).start;
    $('hookTime').innerHTML = `${fmt1(edStart)}<small>to ${fmt1(edStart + HOOK)} · default ${fmt1(def)}${edStart !== hookStart(edN, edV) ? ' · unsaved' : ''}</small>`;
    const chips = $('checkChips'); chips.innerHTML = '';
    for (const n of ALL.filter((n) => SONGS[n].check)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = (n === edN ? 'on' : '') + (hooks[n + '.1'] != null ? ' edited' : '');
      b.textContent = `#${n} ${SONGS[n].title}`;
      b.title = SONGS[n].check;
      b.addEventListener('click', () => selectHook(n, 1));
      chips.appendChild(b);
    }
  }
  function selectHook(n, v = edV) {
    edN = n; edV = v; edStart = hookStart(n, v);
    $('hookNote').textContent = SONGS[n].check && v === 1 ? `Flagged: version 1 ${SONGS[n].check}.` : '';
    renderHookEditor();
  }
  function nudge(d) {
    const clip = clipInfo(edN, edV);
    const want = Math.round((edStart + d) * 10) / 10;
    const v = Math.max(clip.clipStart, Math.min(want, Math.round((clip.clipEnd - HOOK) * 10) / 10));
    $('hookNote').textContent = v !== want
      ? `This version's clip covers ${fmt1(clip.clipStart)}–${fmt1(clip.clipEnd)}. To move further, change hooks.json and re-run tools/cut-clips.js.`
      : '';
    edStart = v; renderHookEditor();
  }
  async function preview() {
    cancelAuto();
    if (P.playing) stopNode(NEXT_FADE);
    P.playing = false;
    try { await playSong(edN, edV, 0, { preview: true, start: edStart }); }
    catch { $('hookNote').textContent = `#${edN} version ${edV} couldn't be fetched. Check the connection.`; }
    render();
  }
  function saveHook() {
    const k = edN + '.' + edV;
    if (edStart === clipInfo(edN, edV).start) delete hooks[k]; else hooks[k] = edStart;
    ls.set(HOOKS_KEY, hooks);
    $('hookNote').textContent = `Saved #${edN} version ${edV}: starts at ${fmt1(edStart)} (on this device).`;
    renderHookEditor();
  }
  function revertHook() {
    delete hooks[edN + '.' + edV]; ls.set(HOOKS_KEY, hooks);
    edStart = clipInfo(edN, edV).start;
    $('hookNote').textContent = `#${edN} version ${edV} is back to its default start.`;
    renderHookEditor();
  }

  // ---------- wiring ----------
  buildBoard();
  $('nextBtn').addEventListener('click', next);
  $('playBtn').addEventListener('click', togglePlay);
  $('undoBtn').addEventListener('click', undo);
  $('resetBtn').addEventListener('click', reset);
  $('modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
  $('speedSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setRate(+b.dataset.rate); });
  $('verSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && !b.disabled) playVersion(+b.dataset.v); });
  $('edVerSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) selectHook(edN, +b.dataset.v); });
  $('hideToggle').addEventListener('change', (e) => { S.hide = e.target.checked; save(); render(); });
  $('autoToggle').addEventListener('change', (e) => { S.auto = e.target.checked; if (!S.auto) cancelAuto(); save(); });
  $('gapIn').addEventListener('change', (e) => { S.gap = Math.max(1, Math.min(30, +e.target.value || 4)); save(); render(); });
  $('volume').addEventListener('input', (e) => { S.vol = +e.target.value; if (master) master.gain.setTargetAtTime(S.vol / 100, ctx.currentTime, 0.02); save(); });
  $('retryBtn').addEventListener('click', async () => {
    const n = pendingErr; if (n == null) return;
    hideErr();
    for (const v of VERSIONS) bufCache.delete(n + '-' + v);
    if (S.played.includes(n)) { replay(n); return; }
    lastNext = 0; next();
  });
  $('skipBtn').addEventListener('click', () => {
    const n = pendingErr; if (n == null) return;
    S.skipped.push(n); if (S.queued === n) S.queued = null; save(); hideErr(); lastNext = 0; next();
  });
  $('tkForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const no = Math.round(+$('tkIn').value);
    const max = tkList().length;
    if (no >= 1 && no <= max) renderTicket(no);
    else $('tkOut').innerHTML = `<p class="empty">This file's tickets run from 1 to ${max}.</p>`;
  });
  $('tkSet').addEventListener('change', (e) => {
    tkSet = e.target.value; TK.store.use(tkSet); fillTkSets();
    currentTicket = null;
    $('tkOut').innerHTML = '<p class="empty">Enter a ticket number to see its 15 songs and which patterns are complete.</p>';
  });
  // A file made in another tab shows up here when you come back.
  window.addEventListener('storage', (e) => { if (e.key === 'gt_ticketfiles' || e.key === 'gt_ticketset') fillTkSets(); });
  window.addEventListener('pageshow', fillTkSets);
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
    else if (e.key === '1' || e.key === '2' || e.key === '3') { e.preventDefault(); playVersion(+e.key); }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); setRate(RATES[(RATES.indexOf(S.rate) + 1) % RATES.length]); }
  });
  // Save the exact spot if the tab is closed mid-hook.
  window.addEventListener('pagehide', () => { if (P.playing && !isAux()) { S.pos = pos(); save(); } });

  // Restore: paused on the current song and version, at the saved position.
  if (!Array.isArray(S.vers)) S.vers = S.current != null ? [1] : [];
  if (!S.ver) S.ver = 1;
  if (!RATES.includes(S.rate)) S.rate = 1;
  if (!S.mode) { S.mode = 'calling'; save(); } // never leave Next waiting on a mode choice
  if (S.current != null) { P.n = S.current; P.v = S.ver; P.base = S.pos; }
  fillTkSets();
  render();
  selectHook(1, 1);
  preload();
})();
