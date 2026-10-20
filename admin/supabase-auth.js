// Supabase sign-in for the admin pages. The admin login in index.html is only
// a browser-side check; this is the real lock on the analytics data: Supabase
// only returns rows to the admin user named in analytics/supabase-setup.sql.
// Needs analytics/config.js loaded first.
window.devindiAuth = (function () {
  var cfg = window.DEVINDI_ANALYTICS || {};
  var KEY = 'devindi_sb_session';
  var base = (cfg.supabaseUrl || '').replace(/\/+$/, '');

  function configured() {
    return !!(cfg.supabaseUrl && cfg.anonKey && !/YOUR-/.test(cfg.supabaseUrl + cfg.anonKey));
  }
  function load() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function save(d) {
    var s = {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
      email: d.user && d.user.email
    };
    try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    return s;
  }
  function clear() { try { sessionStorage.removeItem(KEY); } catch (e) {} }

  async function tokenRequest(grant, body) {
    var res = await fetch(base + '/auth/v1/token?grant_type=' + grant, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': cfg.anonKey },
      body: JSON.stringify(body)
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error_description || data.msg || data.message || 'Sign-in failed (' + res.status + ')');
    return save(data);
  }

  async function signIn(email, password) {
    if (!configured()) throw new Error('Supabase is not set up yet (analytics/config.js).');
    return tokenRequest('password', { email: email, password: password });
  }

  async function token() {
    var s = load();
    if (!s) return null;
    if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
    try { return (await tokenRequest('refresh_token', { refresh_token: s.refresh_token })).access_token; }
    catch (e) { clear(); return null; }
  }

  function signOut() {
    var s = load();
    clear();
    if (s && configured()) {
      fetch(base + '/auth/v1/logout', {
        method: 'POST', keepalive: true,
        headers: { 'apikey': cfg.anonKey, 'Authorization': 'Bearer ' + s.access_token }
      }).catch(function () {});
    }
  }

  return { configured: configured, signIn: signIn, token: token, signOut: signOut, session: load };
})();
