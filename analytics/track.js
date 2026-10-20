/* devIndi website analytics tracker.
 *
 * Include on every public page, after config.js:
 *   <script src="analytics/config.js"></script>
 *   <script src="analytics/track.js" defer></script>
 * Post-login admin pages use data-mode="admin": they only log that an admin
 * page was opened (no clicks, no recording).
 *
 * Records pageviews, sources, device info, clicks (for heatmaps), time on page,
 * scroll depth, form submits, JS errors, admin logins and session recordings,
 * and sends them to the Supabase tables made by supabase-setup.sql.
 */
(function () {
  'use strict';

  function noop() { return Promise.resolve(); }
  var api = window.devindiAnalytics = {
    track: noop, adminLogin: noop, adminLoginFailed: noop, enabled: false
  };

  var cfg = window.DEVINDI_ANALYTICS || {};
  var script = document.currentScript;
  var mode = (script && script.getAttribute('data-mode')) || 'site';
  var baseUrl = script ? script.src.replace(/[^/]*$/, '') : 'analytics/';

  if (!cfg.supabaseUrl || !cfg.anonKey || /YOUR-/.test(cfg.supabaseUrl + cfg.anonKey)) return;
  if (window.self !== window.top) return;              // heatmap preview frames
  if (/[?&]noanalytics\b/.test(location.search)) return;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var ua = navigator.userAgent || '';
  var forced = lsGet('dvi_force') === '1';
  // Do Not Track / GPC switches off visitor tracking, but admin sign-ins,
  // failed attempts and admin page views are always logged (on /admin/ only).
  var dntSkip = false;
  if (!forced) {
    if (navigator.webdriver || /bot|crawl|spider|slurp|headless|lighthouse|facebookexternalhit|bingpreview|embedly|whatsapp|telegrambot/i.test(ua)) return;
    var dnt = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1';
    dntSkip = dnt && cfg.respectDoNotTrack !== false;
    if (dntSkip && !/^\/admin\//.test(location.pathname)) return;
  }

  var endpoint = cfg.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/';
  var headers = { 'Content-Type': 'application/json', 'apikey': cfg.anonKey, 'Prefer': 'return=minimal' };
  if (/^eyJ/.test(cfg.anonKey)) headers.Authorization = 'Bearer ' + cfg.anonKey;

  function rid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  function cut(s, n) { return s == null ? null : String(s).slice(0, n); }

  // ---- identity: visitor (this browser) and session (30 min of inactivity ends it)
  var visitorId = lsGet('dvi_vid');
  var newVisitor = !visitorId;
  if (!visitorId) { visitorId = rid(); lsSet('dvi_vid', visitorId); }

  var SESSION_GAP = 30 * 60 * 1000;
  var sess = null;
  try { sess = JSON.parse(lsGet('dvi_sess') || 'null'); } catch (e) {}
  var now = Date.now();
  var newSession = !sess || !sess.id || now - sess.last > SESSION_GAP;
  if (newSession) {
    sess = { id: rid(), last: now, rec: Math.random() < (cfg.recordSampleRate == null ? 1 : cfg.recordSampleRate) };
  }
  function touchSession() { sess.last = Date.now(); lsSet('dvi_sess', JSON.stringify(sess)); }
  touchSession();

  var isAdmin = lsGet('dvi_admin') === '1';
  var pageId = rid();

  // ---- page and device facts
  function cleanPath(p) {
    p = p.replace(/index\.html$/, '');
    return p || '/';
  }
  var path = cleanPath(location.pathname);

  function device() {
    if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ||
        (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'tablet';
    if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'mobile';
    return 'desktop';
  }
  function browser() {
    if (/Edg\//.test(ua)) return 'Edge';
    if (/OPR\/|Opera/.test(ua)) return 'Opera';
    if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
    if (/Firefox|FxiOS/.test(ua)) return 'Firefox';
    if (/CriOS|Chrome/.test(ua)) return 'Chrome';
    if (/Safari/.test(ua)) return 'Safari';
    return 'Other';
  }
  function os() {
    if (/Windows/.test(ua)) return 'Windows';
    if (/Android/.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iOS';
    if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
    if (/CrOS/.test(ua)) return 'ChromeOS';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Other';
  }
  var tz = null;
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) {}

  var facts = {
    visitor_id: visitorId, session_id: sess.id, page_id: pageId, path: cut(path, 300),
    title: cut(document.title, 300), device: device(), browser: browser(), os: os(),
    screen_w: screen.width || null, screen_h: screen.height || null,
    viewport_w: window.innerWidth || null, lang: cut(navigator.language, 20), tz: cut(tz, 60)
  };

  // Every row carries every column so Supabase accepts them in one batch.
  function row(type, extra) {
    var r = {
      visitor_id: null, session_id: null, page_id: null, type: type, name: null, path: null,
      title: null, referrer: null, utm_source: null, utm_medium: null, utm_campaign: null,
      device: null, browser: null, os: null, screen_w: null, screen_h: null, viewport_w: null,
      lang: null, tz: null, is_admin: isAdmin, duration_ms: null, scroll_pct: null,
      x: null, y: null, doc_h: null, target: null, href: null, props: {}
    };
    var k;
    for (k in facts) r[k] = facts[k];
    if (extra) for (k in extra) if (extra[k] !== undefined) r[k] = extra[k];
    return r;
  }

  // ---- sending
  function post(table, rows, keepalive) {
    var body = JSON.stringify(rows);
    try {
      return fetch(endpoint + table, {
        method: 'POST', headers: headers, body: body,
        keepalive: !!keepalive && body.length < 60000
      }).catch(function () {});
    } catch (e) { return Promise.resolve(); }
  }

  var queue = [];
  var flushTimer = null;
  function push(r, now) {
    queue.push(r);
    touchSession();
    if (now) return flush(false);
    if (!flushTimer) flushTimer = setTimeout(function () { flush(false); }, 3000);
    return Promise.resolve();
  }
  function flush(keepalive) {
    clearTimeout(flushTimer); flushTimer = null;
    if (!queue.length) return Promise.resolve();
    var rows = queue; queue = [];
    return post('analytics_events', rows, keepalive);
  }

  api.enabled = true;
  api.track = function (name, props) {
    return push(row('custom', { name: cut(name, 120), props: props || {} }), true);
  };
  api.adminLogin = function () {
    isAdmin = true;
    lsSet('dvi_admin', '1');
    return push(row('admin_login'), true);
  };
  api.adminLoginFailed = function () {
    return push(row('admin_login_failed'), true);
  };

  // Admin pages behind the login: note the visit, nothing else.
  if (mode === 'admin') {
    push(row('admin_view'), true);
    return;
  }

  // On the sign-in screen, a Do Not Track browser gets only the sign-in log above.
  if (dntSkip) return;

  // ---- pageview
  var params = new URLSearchParams(location.search);
  var ref = document.referrer || '';
  var refUrl = null;
  try { refUrl = ref ? new URL(ref) : null; } catch (e) {}
  var query = location.search.replace(/[?&]?(utm_[a-z]+|fbclid|gclid)=[^&]*/g, '').replace(/^&/, '?');
  push(row('pageview', {
    referrer: refUrl ? cut(refUrl.origin + refUrl.pathname, 500) : null,
    utm_source: cut(params.get('utm_source') || params.get('ref'), 120),
    utm_medium: cut(params.get('utm_medium'), 120),
    utm_campaign: cut(params.get('utm_campaign'), 120),
    props: { new_session: newSession, new_visitor: newVisitor || undefined, query: query && query !== '?' ? cut(query, 200) : undefined }
  }), true);

  // ---- engagement: visible time and deepest scroll, sent whenever the page is hidden
  var visibleSince = document.visibilityState === 'visible' ? Date.now() : null;
  var maxScroll = 0;
  function docHeight() {
    var d = document.documentElement, b = document.body;
    return Math.max(d.scrollHeight, b ? b.scrollHeight : 0, d.clientHeight);
  }
  function measureScroll() {
    var h = docHeight();
    var seen = (window.scrollY || window.pageYOffset || 0) + window.innerHeight;
    var pct = h > 0 ? Math.min(100, Math.round(seen / h * 100)) : 100;
    if (pct > maxScroll) maxScroll = pct;
  }
  var scrollTick = null;
  window.addEventListener('scroll', function () {
    if (scrollTick) return;
    scrollTick = setTimeout(function () { scrollTick = null; measureScroll(); }, 250);
  }, { passive: true });
  window.addEventListener('load', measureScroll);
  measureScroll();

  var engageSent = false;
  function sendEngage() {
    measureScroll();
    var ms = visibleSince ? Math.min(Date.now() - visibleSince, 30 * 60 * 1000) : 0;
    visibleSince = null;
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    var props = {};
    if (!engageSent && nav && nav.loadEventEnd > 0) props.load_ms = Math.round(nav.loadEventEnd);
    engageSent = true;
    queue.push(row('engage', { duration_ms: ms, scroll_pct: maxScroll, doc_h: docHeight(), props: props }));
    flush(true);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { if (visibleSince) sendEngage(); flushRecording(true); }
    else { visibleSince = Date.now(); touchSession(); }
  });
  window.addEventListener('pagehide', function () {
    if (visibleSince) sendEngage();
    flushRecording(true);
  });

  // ---- clicks (heatmap, top clicks, downloads, outbound links, rage and dead clicks)
  var INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role=button],[data-track],[onclick]';
  function describe(el) {
    if (!el || !el.tagName) return null;
    var tag = el.tagName.toLowerCase();
    var text = '';
    if (!/^(input|select|textarea)$/.test(tag)) {
      text = (el.getAttribute('aria-label') || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    } else {
      text = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || el.id || '';
    }
    var id = el.id ? '#' + el.id : '';
    return cut(tag + id + (text ? ' "' + text.slice(0, 60) + '"' : ''), 300);
  }
  var recentClicks = [];
  document.addEventListener('click', function (e) {
    var raw = e.target;
    if (!raw || !raw.closest) return;
    var el = raw.closest(INTERACTIVE);
    var a = raw.closest('a[href]');
    var href = a ? a.href : null;
    var name = null;
    var tagged = raw.closest('[data-track]');
    if (tagged) name = tagged.getAttribute('data-track');
    else if (href) {
      if (/^mailto:/i.test(href)) name = 'email_link';
      else if (a.hasAttribute('download') || /releases\/download|\.(exe|msi|zip|apk|dmg|pdf)(\?|$)/i.test(href)) name = 'download';
      else if (/^https?:/i.test(href) && a.host !== location.host) name = 'outbound';
    }

    var t = Date.now();
    recentClicks = recentClicks.filter(function (c) { return t - c.t < 800; });
    recentClicks.push({ t: t, x: e.clientX, y: e.clientY });
    var near = recentClicks.filter(function (c) { return Math.abs(c.x - e.clientX) < 30 && Math.abs(c.y - e.clientY) < 30; });

    var width = document.documentElement.clientWidth || window.innerWidth;
    var props = {};
    if (near.length >= 3) props.rage = true;
    if (!el) props.dead = true;
    push(row('click', {
      name: cut(name, 120),
      x: width ? Math.round(e.pageX / width * 10000) / 10000 : null,
      y: Math.round(e.pageY),
      doc_h: docHeight(),
      viewport_w: window.innerWidth,
      target: describe(el || raw),
      href: href && !/^javascript:/i.test(href) ? cut(href, 500) : null,
      props: props
    }));
  }, true);

  // ---- form submits (which form only; never the values)
  document.addEventListener('submit', function (e) {
    var f = e.target;
    push(row('form_submit', { name: cut(f.id || f.name || 'form', 120) }), true);
  }, true);

  // ---- JS errors (first five per page)
  var errorCount = 0;
  window.addEventListener('error', function (e) {
    if (++errorCount > 5) return;
    push(row('js_error', {
      target: cut(e.message || 'Script error', 300),
      href: e.filename ? cut(e.filename + ':' + e.lineno, 500) : null
    }));
  });

  // ---- session recordings (rrweb), never on admin pages or for the admin
  var recBuf = [];
  var recSeq = 0;
  var recBytes = 0;
  var recording = false;
  function flushRecording(keepalive) {
    if (!recording || !recBuf.length) return;
    var events = recBuf; recBuf = []; recBytes = 0;
    post('analytics_recordings', [{
      visitor_id: visitorId, session_id: sess.id, page_id: pageId, path: cut(path, 300),
      seq: recSeq++, events: events
    }], keepalive);
  }
  var wantRecording = cfg.recordSessions && sess.rec && !isAdmin && !/^\/admin\//.test(path) &&
    !(window.MutationObserver === undefined);
  if (wantRecording) {
    var s = document.createElement('script');
    s.src = baseUrl + 'vendor/rrweb-record.min.js';
    s.async = true;
    s.onload = function () {
      if (typeof window.rrwebRecord !== 'function') return;
      recording = true;
      var started = Date.now();
      var stop = window.rrwebRecord({
        emit: function (ev) {
          recBuf.push(ev);
          recBytes += 200;
          if (ev.type === 2 || recBytes > 40000) flushRecording(false); // 2 = full snapshot
        },
        maskAllInputs: true,
        blockClass: 'dvi-no-record',
        inlineStylesheet: true,
        sampling: { mousemove: 100, scroll: 150, input: 'last' }
      });
      var timer = setInterval(function () {
        flushRecording(false);
        if (Date.now() - started > 30 * 60 * 1000) { clearInterval(timer); if (stop) stop(); recording = false; }
      }, 5000);
    };
    document.head.appendChild(s);
  }
})();
