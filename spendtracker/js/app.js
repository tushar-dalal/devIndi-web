// UI controller: view routing, sync orchestration, dashboard rendering,
// subscriptions + verdicts, connections, team pooling and settings. All
// state is in-memory + IndexedDB (js/db.js) — there is no server.

const WINDOW_DAYS = 30;
const MAX_SYNC_ATTEMPTS = 3;
const CLAUDE_CODE_ID = "claudecode";

const S = {
  settings: null,
  connections: [],
  usage: [],
  subs: [],
  member: "all",
  metric: "cost",   // daily chart + breakdowns: "cost" | "tokens"
  includeCache: false,
  syncing: false
};

const SUB_PRESETS = [
  // Suggested list prices at time of writing — always check your actual bill.
  { name: "Claude Pro", price: 20, currency: "USD", linkedProvider: "claudecode" },
  { name: "Claude Max (5×)", price: 100, currency: "USD", linkedProvider: "claudecode" },
  { name: "Claude Max (20×)", price: 200, currency: "USD", linkedProvider: "claudecode" },
  { name: "ChatGPT Plus", price: 20, currency: "USD", linkedProvider: "" },
  { name: "ChatGPT Pro", price: 200, currency: "USD", linkedProvider: "" },
  { name: "Cursor Pro", price: 20, currency: "USD", linkedProvider: "" },
  { name: "GitHub Copilot Pro", price: 10, currency: "USD", linkedProvider: "" }
];

// ---------- Small utilities ----------

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function today() {
  return localDay(new Date());
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localDay(d);
}

function money(usd, { compact = false } = {}) {
  const inr = S.settings.currency === "INR";
  const v = inr ? usd * S.settings.fxRate : usd;
  const sym = inr ? "₹" : "$";
  if (compact && Math.abs(v) >= 1000) {
    return sym + (v / 1000).toLocaleString(inr ? "en-IN" : "en-US", { maximumFractionDigits: 1 }) + "k";
  }
  const d = Math.abs(v) >= 100 ? 0 : 2;
  return sym + v.toLocaleString(inr ? "en-IN" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtTokens(n) {
  if (!n) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

function timeAgo(iso) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function providerName(id) {
  return PROVIDERS[id] ? PROVIDERS[id].name : id;
}

// Claude Code rows are API-equivalent value, not money actually charged —
// the subscription price is the real spend. Keep them out of spend totals.
function isBilled(row) {
  return row.provider !== CLAUDE_CODE_ID;
}

function subMonthlyUsd(sub) {
  return toUsd(monthlyPrice(sub), sub.currency, S.settings.fxRate);
}

// Roll a stored renewal date forward by whole billing cycles until it's today or later.
function nextRenewal(sub, todayStr) {
  if (!sub.renewalDate) return null;
  const d = new Date(sub.renewalDate + "T00:00:00");
  const t = new Date(todayStr + "T00:00:00");
  let guard = 0;
  while (d < t && guard++ < 500) {
    if (sub.cycle === "yearly") d.setFullYear(d.getFullYear() + 1);
    else d.setMonth(d.getMonth() + 1);
  }
  return localDay(d);
}

// ---------- Data loading ----------

async function loadAll() {
  const [settings, connections, usage, subs] = await Promise.all([
    SettingsDB.getAll(), ConnectionsDB.all(), UsageDB.all(), SubsDB.all()
  ]);
  S.settings = settings;
  S.connections = connections;
  S.usage = usage;
  S.subs = subs;
}

function members() {
  const set = new Set([S.settings.memberName]);
  for (const r of S.usage) set.add(r.member);
  for (const s of S.subs) if (s.member) set.add(s.member);
  return [...set];
}

function filteredUsage() {
  return S.member === "all" ? S.usage : S.usage.filter((r) => r.member === S.member);
}

function filteredSubs() {
  return S.member === "all" ? S.subs : S.subs.filter((s) => (s.member || S.settings.memberName) === S.member);
}

// ---------- View routing ----------

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $(`view-${name}`).classList.add("active");
  document.querySelectorAll(".navitem").forEach((n) => n.classList.toggle("active", n.dataset.view === name));
  renderView(name);
  window.scrollTo(0, 0);
}

function currentView() {
  const v = document.querySelector(".view.active");
  return v ? v.id.replace("view-", "") : "dashboard";
}

function renderView(name = currentView()) {
  renderChrome();
  if (name === "dashboard") renderDashboard();
  if (name === "subs") renderSubs();
  if (name === "connections") renderConnections();
  if (name === "team") renderTeam();
  if (name === "settings") renderSettings();
}

document.querySelectorAll(".navitem[data-view]").forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.view)));
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto]");
  if (g) { e.preventDefault(); showView(g.dataset.goto); }
});

function renderChrome() {
  const name = S.settings.memberName || "You";
  $("whoName").textContent = name;
  $("avatarInitials").textContent = name.trim().charAt(0).toUpperCase() || "?";
  document.querySelectorAll("#currencySeg button").forEach((b) => b.classList.toggle("on", b.dataset.cur === S.settings.currency));

  const sel = $("memberFilter");
  const ms = members();
  if (S.member !== "all" && !ms.includes(S.member)) S.member = "all";
  sel.innerHTML = `<option value="all">Everyone (${ms.length})</option>` +
    ms.map((m) => `<option value="${esc(m)}">${esc(m)}${m === S.settings.memberName ? " (you)" : ""}</option>`).join("");
  sel.value = S.member;
  sel.classList.toggle("hidden", ms.length < 2);
}

$("memberFilter").addEventListener("change", (e) => { S.member = e.target.value; renderDashboard(); });
$("currencySeg").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-cur]");
  if (!b) return;
  S.settings.currency = b.dataset.cur;
  await SettingsDB.set("currency", b.dataset.cur);
  renderView();
});

// ---------- Sync ----------

async function syncApiConnection(conn) {
  const provider = PROVIDERS[conn.provider];
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_SYNC_ATTEMPTS; attempt++) {
    try {
      const { rows, meta } = await provider.fetchUsage(conn, WINDOW_DAYS);
      const since = addDays(today(), -(WINDOW_DAYS + 1));
      await UsageDB.replaceForConnection(conn.id, since, rows.map((r) => usageRow(conn, r, "api")));
      Object.assign(conn, { status: "ok", lastError: null, lastSyncAt: new Date().toISOString(), meta: { ...(conn.meta || {}), ...meta } });
      await ConnectionsDB.put(conn);
      return true;
    } catch (e) {
      lastErr = e;
      if (e.auth) break; // a revoked key won't fix itself — surface it now
      if (attempt < MAX_SYNC_ATTEMPTS) await sleep(1000 * 3 ** (attempt - 1));
    }
  }
  Object.assign(conn, { status: "error", lastError: lastErr.message, lastErrorAt: new Date().toISOString() });
  await ConnectionsDB.put(conn);
  return false;
}

function usageRow(conn, r, source) {
  const member = conn.member || S.settings.memberName;
  return {
    id: `${conn.id}|${r.date}|${r.model}`,
    connectionId: conn.id,
    provider: conn.provider,
    member,
    date: r.date,
    model: r.model,
    costUsd: r.costUsd,
    inputTokens: r.inputTokens,
    cacheTokens: r.cacheTokens || 0,
    outputTokens: r.outputTokens,
    requests: r.requests,
    source
  };
}

async function* walkJsonl(dir) {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file" && name.endsWith(".jsonl")) yield await handle.getFile();
    else if (handle.kind === "directory") yield* walkJsonl(handle);
  }
}

// files: array of File. Replaces all Claude Code rows for this browser's user.
async function importClaudeCodeFiles(files, dirHandle, onProgress) {
  const { rows, fileCount, messageCount } = await ClaudeCodeProvider.parseFiles(files, onProgress);
  const existing = S.connections.find((c) => c.id === CLAUDE_CODE_ID);
  const conn = existing || { id: CLAUDE_CODE_ID, provider: CLAUDE_CODE_ID, label: "This computer", createdAt: new Date().toISOString() };
  conn.member = S.settings.memberName;
  if (dirHandle) conn.dirHandle = dirHandle;
  await UsageDB.replaceForConnection(conn.id, null, rows.map((r) => usageRow(conn, r, "local")));
  Object.assign(conn, { status: fileCount ? "ok" : "error", lastError: fileCount ? null : "No .jsonl session logs found in that folder. Pick the “projects” folder inside .claude.", lastSyncAt: new Date().toISOString(), meta: { fileCount, messageCount } });
  await ConnectionsDB.put(conn);
  return { fileCount, messageCount, days: new Set(rows.map((r) => r.date)).size };
}

// Re-read the remembered folder. Needs a user gesture if permission lapsed.
async function syncClaudeCode(conn, { interactive }) {
  if (!conn.dirHandle) return false;
  let perm = await conn.dirHandle.queryPermission({ mode: "read" });
  if (perm !== "granted" && interactive) perm = await conn.dirHandle.requestPermission({ mode: "read" });
  if (perm !== "granted") return false;
  const files = [];
  for await (const f of walkJsonl(conn.dirHandle)) files.push(f);
  await importClaudeCodeFiles(files, conn.dirHandle);
  return true;
}

async function syncAll({ interactive = true, onlyStale = false } = {}) {
  if (S.syncing) return;
  S.syncing = true;
  const btn = $("syncAllBtn");
  btn.disabled = true;
  btn.querySelector("svg").classList.add("spin");
  try {
    const staleMs = S.settings.autoSyncHours * 3600 * 1000;
    const due = S.connections.filter((c) => !c.viaFile && (!onlyStale || !c.lastSyncAt || Date.now() - new Date(c.lastSyncAt).getTime() > staleMs));
    await Promise.all(due.map((c) => {
      if (c.provider === CLAUDE_CODE_ID) return syncClaudeCode(c, { interactive }).catch(() => false);
      return syncApiConnection(c);
    }));
    await loadAll();
    renderView();
  } finally {
    S.syncing = false;
    btn.disabled = false;
    btn.querySelector("svg").classList.remove("spin");
  }
}

$("syncAllBtn").addEventListener("click", () => syncAll({ interactive: true }));

// ---------- Dashboard ----------

function sumCost(rows) {
  return rows.reduce((s, r) => s + (r.costUsd || 0), 0);
}

function dashboardNumbers() {
  const t = today();
  const since = addDays(t, -(WINDOW_DAYS - 1));
  const monthStart = t.slice(0, 8) + "01";
  const rows = filteredUsage();
  const rows30 = rows.filter((r) => r.date >= since && r.date <= t);
  const billed30 = rows30.filter(isBilled);
  const ccValue30 = sumCost(rows30.filter((r) => !isBilled(r)));
  const meteredMtd = sumCost(rows.filter((r) => isBilled(r) && r.date >= monthStart && r.date <= t));
  const subs = filteredSubs();
  const subsMonthly = subs.reduce((s, x) => s + subMonthlyUsd(x), 0);
  const monthTotal = meteredMtd + subsMonthly;
  return { t, since, rows30, billed30, metered30: sumCost(billed30), ccValue30, meteredMtd, subs, subsMonthly, monthTotal };
}

function renderDashboard() {
  const n = dashboardNumbers();
  const scope = S.member === "all" ? "" : ` · ${S.member}`;
  $("dashSub").textContent = S.connections.length || S.subs.length
    ? `Everything you pay for AI, in one place${scope}. Last sync ${timeAgo(latestSync())}.`
    : "Connect a provider or add a subscription to get started.";

  $("statMonth").textContent = money(n.monthTotal);
  $("statMonthFoot").textContent = `${money(n.meteredMtd)} metered + ${money(n.subsMonthly)} plans`;
  $("statMetered").textContent = money(n.metered30);
  $("statMeteredFoot").textContent = n.ccValue30 > 0
    ? `+ ${money(n.ccValue30)} Claude Code value, covered by plan`
    : "OpenAI · Anthropic · OpenRouter";
  $("statSubs").textContent = money(n.subsMonthly);
  const tk = sumTokens(n.rows30);
  $("statTokens").textContent = fmtTokens(tk.total);
  $("statTokensFoot").textContent = tk.total ? tokenSplit(tk) : "input · cache · output";
  $("statSubsFoot").textContent = `${n.subs.length} plan${n.subs.length === 1 ? "" : "s"}`;

  const budgetUsd = S.settings.monthlyBudget / S.settings.fxRate;
  const fill = $("budgetFill");
  if (budgetUsd > 0) {
    const pct = (n.monthTotal / budgetUsd) * 100;
    $("statBudget").textContent = `${Math.round(pct)}% of ${money(budgetUsd)}`;
    fill.style.width = Math.min(pct, 100) + "%";
    fill.className = "budget-fill" + (pct >= 100 ? " over" : pct >= 80 ? " warn" : "");
  } else {
    $("statBudget").innerHTML = `<a href="#" data-goto="settings" style="font-size:15px">Set a budget</a>`;
    fill.style.width = "0";
  }

  renderBanners();
  renderDailyChart(n);
  renderBreakdowns(n);
  renderVerdicts(n);
  renderAlerts(n);
}

function latestSync() {
  return S.connections.reduce((m, c) => (c.lastSyncAt && (!m || c.lastSyncAt > m) ? c.lastSyncAt : m), null);
}

function renderBanners() {
  const out = [];
  for (const c of S.connections) {
    if (c.status === "error") {
      out.push(`<div class="banner"><span><b>${esc(providerName(c.provider))}${c.label ? " · " + esc(c.label) : ""}</b> needs attention — its numbers below may be stale. ${esc(c.lastError || "")}</span><button class="btn btn-ghost btn-sm" data-goto="connections">Fix connection</button></div>`);
    } else if (c.provider === CLAUDE_CODE_ID && c.lastSyncAt && Date.now() - new Date(c.lastSyncAt).getTime() > 3 * 864e5) {
      out.push(`<div class="banner info"><span>Claude Code data was last read ${timeAgo(c.lastSyncAt)}. Press <b>Sync now</b> to re-read your logs.</span></div>`);
    } else if (c.viaFile && c.lastSyncAt && Date.now() - new Date(c.lastSyncAt).getTime() > 3 * 864e5) {
      out.push(`<div class="banner info"><span>${esc(providerName(c.provider))} data is from a report pulled ${timeAgo(c.lastSyncAt)}. Run <code>tools/pull.mjs</code> again and import it.</span><button class="btn btn-ghost btn-sm" data-goto="connections">Connections</button></div>`);
    }
  }
  $("banners").innerHTML = out.join("");
}

// Stacked daily bars, one fixed color per provider. Hover a day for values.
// Cache reads can outnumber fresh tokens ~100:1 (they're cheap and re-sent every
// turn), so the tokens chart leaves them out unless "incl. cache" is ticked.
function rowTokens(r) {
  return (r.inputTokens || 0) + (S.includeCache ? r.cacheTokens || 0 : 0) + (r.outputTokens || 0);
}

function sumTokens(rows) {
  const t = { input: 0, cache: 0, output: 0 };
  for (const r of rows) { t.input += r.inputTokens || 0; t.cache += r.cacheTokens || 0; t.output += r.outputTokens || 0; }
  t.total = t.input + t.cache + t.output;
  return t;
}

function tokenSplit(t) {
  return `${fmtTokens(t.input)} in · ${fmtTokens(t.cache)} cache · ${fmtTokens(t.output)} out`;
}

// The chart and breakdowns switch between two measures; never both on one axis.
function metricOf(r) {
  return S.metric === "tokens" ? rowTokens(r) : r.costUsd;
}

function fmtMetric(v) {
  return S.metric === "tokens" ? fmtTokens(v) : money(v);
}

function renderDailyChart(n) {
  const tokens = S.metric === "tokens";
  const days = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) days.push(addDays(n.t, -i));
  const present = PROVIDER_ORDER.filter((p) => n.rows30.some((r) => r.provider === p));
  const blank = () => ({ cost: 0, input: 0, cache: 0, output: 0 });
  const byDay = new Map(days.map((d) => [d, Object.fromEntries(PROVIDER_ORDER.map((p) => [p, blank()]))]));
  for (const r of n.rows30) {
    const d = byDay.get(r.date);
    if (!d) continue;
    const c = d[r.provider];
    c.cost += r.costUsd; c.input += r.inputTokens || 0; c.cache += r.cacheTokens || 0; c.output += r.outputTokens || 0;
  }
  const tok = (c) => c.input + (S.includeCache ? c.cache : 0) + c.output;
  const val = (c) => (tokens ? tok(c) : c.cost);
  const addUp = (list) => list.reduce((s, c) => { s.cost += c.cost; s.input += c.input; s.cache += c.cache; s.output += c.output; return s; }, blank());

  document.querySelectorAll("#metricSeg button").forEach((b) => b.classList.toggle("on", b.dataset.metric === S.metric));
  $("chartTitle").textContent = tokens ? "Daily tokens · last 30 days" : "Daily AI usage · last 30 days";
  $("cacheToggle").classList.toggle("hidden", !tokens);
  $("includeCache").checked = S.includeCache;
  $("dailyLegend").innerHTML = present.map((p) =>
    `<span><i style="background:${PROVIDER_COLORS[p]}"></i>${esc(providerName(p))}${p === CLAUDE_CODE_ID && !tokens ? " (API-equivalent)" : ""}</span>`
  ).join("");

  if (!present.length) {
    $("dailyChart").innerHTML = `<div class="empty">No usage in the last 30 days yet. <a href="#" data-goto="connections">Connect a provider</a> to see daily spend and tokens.</div>`;
    $("dailyTable").innerHTML = "";
    return;
  }

  // Money is plotted in the display currency; tokens as raw counts.
  const scale = tokens ? 1 : (S.settings.currency === "INR" ? S.settings.fxRate : 1);
  const totals = days.map((d) => present.reduce((s, p) => s + val(byDay.get(d)[p]), 0) * scale);
  const maxV = niceMax(Math.max(...totals));
  const W = 900, H = 240, padL = 52, padR = 6, padT = 8, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / days.length;
  const barW = Math.max(4, slot - 6);
  const y = (v) => padT + plotH - (v / maxV) * plotH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily ${tokens ? "tokens" : "spend"} by provider, last 30 days">`;
  for (let i = 0; i <= 4; i++) {
    const v = (maxV / 4) * i;
    const yy = y(v);
    svg += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="var(--grid)" stroke-width="1"/>`;
    svg += `<text class="axis" x="${padL - 8}" y="${yy + 4}" text-anchor="end">${esc(tokens ? fmtTokens(v) : axisMoney(v))}</text>`;
  }
  days.forEach((d, i) => {
    const x = padL + i * slot + (slot - barW) / 2;
    let base = 0;
    const segs = present.filter((p) => val(byDay.get(d)[p]) > 0);
    segs.forEach((p, si) => {
      const v = val(byDay.get(d)[p]) * scale;
      const y0 = y(base), top = y(base + v);
      // 2px surface gap between stacked segments; round only the top of the stack.
      const h = Math.max(1, y0 - top - (si > 0 ? 2 : 0));
      const isTop = si === segs.length - 1;
      svg += isTop ? roundedTopRect(x, top, barW, h, Math.min(4, h, barW / 2), PROVIDER_COLORS[p])
                   : `<rect x="${x}" y="${top}" width="${barW}" height="${h}" fill="${PROVIDER_COLORS[p]}"/>`;
      base += v;
    });
    if (i % 5 === 4 || i === 0) {
      const dt = new Date(d + "T00:00:00");
      svg += `<text class="axis" x="${x + barW / 2}" y="${H - 6}" text-anchor="middle">${dt.getDate()} ${dt.toLocaleString("en", { month: "short" })}</text>`;
    }
    svg += `<rect class="hit" data-day="${d}" x="${padL + i * slot}" y="${padT}" width="${slot}" height="${plotH}" fill="transparent"/>`;
  });
  svg += `</svg>`;
  $("dailyChart").innerHTML = svg;

  // The tooltip always shows both measures for the hovered day.
  const tip = $("tooltip");
  $("dailyChart").querySelectorAll(".hit").forEach((el) => {
    el.addEventListener("mousemove", (e) => {
      const d = el.dataset.day;
      const vals = byDay.get(d);
      const dt = new Date(d + "T00:00:00");
      const sum = addUp(present.map((p) => vals[p]));
      tip.innerHTML = `<div class="tt-head">${dt.toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short" })}</div>` +
        present.slice().reverse().map((p) => `<div class="tt-row"><span><i style="background:${PROVIDER_COLORS[p]}"></i>${esc(providerName(p))}</span><b>${money(vals[p].cost)} · ${fmtTokens(tok(vals[p]))} tok</b></div>`).join("") +
        `<div class="tt-row tt-total"><span>Total</span><b>${money(sum.cost)} · ${fmtTokens(tok(sum))} tok</b></div>` +
        `<div class="tt-sub">${fmtTokens(sum.input)} in · ${fmtTokens(sum.cache)} cache · ${fmtTokens(sum.output)} out${S.includeCache ? "" : " (tok excludes cache)"}</div>`;
      tip.classList.remove("hidden");
      const tw = tip.offsetWidth;
      tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tw - 8) + "px";
      tip.style.top = e.clientY + 14 + "px";
      el.setAttribute("fill", "rgba(255,255,255,0.04)");
    });
    el.addEventListener("mouseleave", () => { tip.classList.add("hidden"); el.setAttribute("fill", "transparent"); });
  });

  const fmtCell = (c) => (tokens ? fmtTokens(tok(c)) : money(c.cost));
  $("dailyTable").innerHTML = `<table class="tbl"><thead><tr><th>Day</th>${present.map((p) => `<th class="num">${esc(providerName(p))}</th>`).join("")}<th class="num">Total ${tokens ? "tokens" : "cost"}</th><th class="num">${tokens ? "Cost" : "Tokens"}</th></tr></thead><tbody>` +
    days.slice().reverse().map((d) => {
      const v = byDay.get(d);
      const sum = addUp(present.map((p) => v[p]));
      return `<tr><td>${d}</td>${present.map((p) => `<td class="num">${fmtCell(v[p])}</td>`).join("")}<td class="num">${fmtCell(sum)}</td><td class="num">${tokens ? money(sum.cost) : fmtTokens(tok(sum))}</td></tr>`;
    }).join("") + `</tbody></table>`;
}

function roundedTopRect(x, y, w, h, r, fill) {
  return `<path d="M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z" fill="${fill}"/>`;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

function axisMoney(v) {
  const sym = S.settings.currency === "INR" ? "₹" : "$";
  if (v >= 1000) return sym + (v / 1000).toLocaleString("en", { maximumFractionDigits: 1 }) + "k";
  return sym + (v < 10 && v % 1 ? v.toFixed(1) : Math.round(v));
}

$("toggleTableBtn").addEventListener("click", () => {
  const showing = !$("dailyTable").classList.toggle("hidden");
  $("dailyChart").classList.toggle("hidden", showing);
  $("toggleTableBtn").textContent = showing ? "Show as chart" : "Show as table";
});

$("metricSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-metric]");
  if (!b || b.dataset.metric === S.metric) return;
  S.metric = b.dataset.metric;
  try { localStorage.setItem("spendtracker_metric", S.metric); } catch (_) { /* per-viewer nicety only */ }
  renderDashboard();
});

$("includeCache").addEventListener("change", (e) => {
  S.includeCache = e.target.checked;
  try { localStorage.setItem("spendtracker_cache", S.includeCache ? "1" : "0"); } catch (_) { /* per-viewer nicety only */ }
  renderDashboard();
});

function hbars(items, max, fmt = money) {
  return items.map((it) => `
    <div class="hbar">
      <div class="label">${it.color ? `<i style="background:${it.color}"></i>` : ""}<span title="${esc(it.label)}">${esc(it.label)}</span></div>
      <div class="val">${fmt(it.value)}</div>
      <div class="track"><div class="fill" style="width:${max > 0 ? (it.value / max) * 100 : 0}%;background:${it.color || "var(--accent)"}"></div></div>
      ${it.meta ? `<div class="meta">${esc(it.meta)}</div>` : ""}
    </div>`).join("");
}

function renderBreakdowns(n) {
  const empty = `<div class="empty">Nothing yet.</div>`;
  const tokens = S.metric === "tokens";
  const tokLabel = tokens ? (S.includeCache ? " · tokens incl. cache" : " · tokens excl. cache") : "";
  $("byModelTitle").textContent = `By model · last 30 days${tokLabel}`;
  $("byProviderTitle").textContent = `By provider · last 30 days${tokLabel}`;

  const byModel = new Map();
  for (const r of n.rows30) {
    const k = `${r.provider}|${r.model}`;
    const m = byModel.get(k) || { provider: r.provider, model: r.model, rows: [] };
    m.rows.push(r);
    byModel.set(k, m);
  }
  const models = [...byModel.values()].map((m) => ({
    ...m, value: m.rows.reduce((s, r) => s + metricOf(r), 0), cost: sumCost(m.rows), t: sumTokens(m.rows)
  })).sort((a, b) => b.value - a.value);
  const top = models.slice(0, 8);
  const rest = models.slice(8);
  const modelItems = top.map((m) => ({
    label: m.model, value: m.value, color: PROVIDER_COLORS[m.provider],
    meta: `${providerName(m.provider)} · ${tokenSplit(m.t)}${tokens ? " · " + money(m.cost) : ""}`
  }));
  if (rest.length) modelItems.push({ label: `Other (${rest.length} models)`, value: rest.reduce((s, m) => s + m.value, 0), color: "#5b616b" });
  $("byModel").innerHTML = modelItems.length ? hbars(modelItems, Math.max(...modelItems.map((i) => i.value)), fmtMetric) : empty;

  const provItems = PROVIDER_ORDER.map((p) => {
    const rows = n.rows30.filter((r) => r.provider === p);
    return {
      label: providerName(p) + (p === CLAUDE_CODE_ID && !tokens ? " (API-equiv.)" : ""),
      value: rows.reduce((s, r) => s + metricOf(r), 0),
      color: PROVIDER_COLORS[p],
      meta: tokens ? `${tokenSplit(sumTokens(rows))} · ${money(sumCost(rows))}` : `${fmtTokens(sumTokens(rows).total)} tokens`,
      has: rows.length > 0
    };
  }).filter((i) => i.has);
  $("byProvider").innerHTML = provItems.length ? hbars(provItems, Math.max(...provItems.map((i) => i.value)), fmtMetric) : empty;

  // Per person stays in money (plans have no token count), with their token total alongside.
  const ms = S.member === "all" ? members() : [S.member];
  const memItems = ms.map((m) => {
    const mine = n.rows30.filter((r) => r.member === m);
    const metered = sumCost(n.billed30.filter((r) => r.member === m));
    const plans = S.subs.filter((s) => (s.member || S.settings.memberName) === m).reduce((s, x) => s + subMonthlyUsd(x), 0);
    return { label: m + (m === S.settings.memberName ? " (you)" : ""), value: metered + plans, meta: `${money(metered)} metered + ${money(plans)} plans · ${fmtTokens(sumTokens(mine).total)} tokens incl. cache` };
  }).sort((a, b) => b.value - a.value);
  $("byMember").innerHTML = hbars(memItems, Math.max(...memItems.map((i) => i.value), 0));
}

const VERDICT_LABEL = {
  keep: "✓ Keep",
  downgrade: "↓ Downgrade",
  cancel: "✕ Cancel",
  unknown: "? Needs data"
};

function verdictChip(sub, ev) {
  return `<button class="v v-${ev.verdict}" data-why="${esc(sub.id)}" title="Why?">${VERDICT_LABEL[ev.verdict]}</button>`;
}

function evaluate(sub) {
  return evaluateSubscription(sub, S.usage, today(), S.settings);
}

function renderVerdicts(n) {
  if (!n.subs.length) {
    $("verdictList").innerHTML = `<div class="empty">No subscriptions yet. <a href="#" data-goto="subs">Add ChatGPT Plus, Claude Pro, Cursor…</a></div>`;
    return;
  }
  const order = { cancel: 0, downgrade: 1, unknown: 2, keep: 3 };
  const rows = n.subs.map((s) => ({ s, ev: evaluate(s) })).sort((a, b) => order[a.ev.verdict] - order[b.ev.verdict]);
  $("verdictList").innerHTML = rows.map(({ s, ev }) => `
    <div class="verdict-row">
      <div class="vr-main">
        <div class="vr-name">${esc(s.name)}${S.member === "all" && members().length > 1 ? ` <span class="muted small">· ${esc(s.member || S.settings.memberName)}</span>` : ""}</div>
        <div class="vr-why">${esc(ev.summary)}</div>
      </div>
      <span class="vr-price">${money(subMonthlyUsd(s))}/mo</span>
      ${verdictChip(s, ev)}
    </div>`).join("");
}

// ---------- Alerts ----------

function buildAlerts(n) {
  const alerts = [];
  const lead = Number(S.settings.renewalLeadDays) || 0;
  for (const s of n.subs) {
    const next = nextRenewal(s, n.t);
    if (!next) continue;
    const inDays = Math.round((new Date(next) - new Date(n.t)) / 864e5);
    if (inDays <= lead) {
      const ev = evaluate(s);
      const when = inDays === 0 ? "today" : inDays === 1 ? "tomorrow" : `in ${inDays} days`;
      const verdictNote = ev.verdict === "cancel" || ev.verdict === "downgrade" ? ` Verdict: ${VERDICT_LABEL[ev.verdict].slice(2)} — ${ev.summary}` : "";
      alerts.push({
        level: ev.verdict === "cancel" ? "crit" : "warn",
        text: `${s.name} renews ${when} (${next}) for ${money(toUsd(s.price, s.currency, S.settings.fxRate))}.${verdictNote}`
      });
    }
  }
  const budgetUsd = S.settings.monthlyBudget / S.settings.fxRate;
  if (budgetUsd > 0) {
    const pct = (n.monthTotal / budgetUsd) * 100;
    if (pct >= 100) alerts.push({ level: "crit", text: `AI spend this month is ${money(n.monthTotal)} — over your ${money(budgetUsd)} budget (${Math.round(pct)}%).` });
    else if (pct >= 80) alerts.push({ level: "warn", text: `AI spend this month is ${money(n.monthTotal)} — ${Math.round(pct)}% of your ${money(budgetUsd)} budget.` });
  }
  for (const c of S.connections) {
    if (c.status === "error") alerts.push({ level: "crit", text: `${providerName(c.provider)} connection is broken: ${c.lastError}` });
  }
  return alerts;
}

function whatsappLink(text) {
  const digits = (S.settings.whatsappNumber || "").replace(/\D/g, "");
  if (!S.settings.whatsappOptIn || !digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent("AI Spend Tracker: " + text)}`;
}

function renderAlerts(n) {
  const alerts = buildAlerts(n);
  if (!alerts.length) {
    $("alertList").innerHTML = `<div class="empty">All clear — no renewals in the next ${S.settings.renewalLeadDays} days and nothing over budget.</div>`;
    return;
  }
  const icon = (lvl) => lvl === "crit"
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="7.5" x2="12" y2="13"/><circle cx="12" cy="16.5" r=".6" fill="currentColor"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l9 15H3l9-15z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="16.6" r=".6" fill="currentColor"/></svg>`;
  $("alertList").innerHTML = alerts.map((a) => {
    const wa = whatsappLink(a.text);
    return `<div class="alert ${a.level}"><span class="ic" aria-label="${a.level === "crit" ? "Critical" : "Warning"}">${icon(a.level)}</span><div class="body">${esc(a.text)}</div>${wa ? `<a class="btn btn-ghost btn-sm wa" href="${esc(wa)}" target="_blank" rel="noopener">Send on WhatsApp</a>` : ""}</div>`;
  }).join("") + (!S.settings.whatsappOptIn ? `<div class="muted small" style="margin-top:6px">Want these on WhatsApp? <a href="#" data-goto="settings">Opt in under Settings.</a></div>` : "");
}

// ---------- Verdict modal ----------

document.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-why]");
  if (!chip) return;
  const sub = S.subs.find((s) => s.id === chip.dataset.why);
  if (!sub) return;
  const ev = evaluate(sub);
  $("ruleModalTitle").innerHTML = `${esc(sub.name)}: <span class="v v-${ev.verdict}">${VERDICT_LABEL[ev.verdict]}</span>`;
  $("ruleModalBody").innerHTML = `<div class="muted">${esc(ev.summary)} Rules are checked top to bottom; the first match decides.</div>` +
    ev.rules.map((r) => `<div class="rule-line ${r.fired ? "fired" : ""}"><span class="mark">${r.fired ? "●" : "○"}</span><div><div class="rt">${esc(r.rule)}</div><div class="rd">${esc(r.detail)}</div></div></div>`).join("");
  $("ruleModal").classList.remove("hidden");
});

document.querySelectorAll(".modal-backdrop").forEach((m) => {
  m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-close]")) m.classList.add("hidden"); });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".modal-backdrop").forEach((m) => m.classList.add("hidden"));
});

// ---------- Subscriptions ----------

function renderSubs() {
  const t = today();
  if (!S.subs.length) {
    $("subsTable").innerHTML = `<div class="empty">No subscriptions yet. Add each AI plan you pay for — ChatGPT Plus, Claude Pro/Max, Cursor, Copilot.</div>`;
    return;
  }
  const rows = S.subs.slice().sort((a, b) => subMonthlyUsd(b) - subMonthlyUsd(a));
  $("subsTable").innerHTML = `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Plan</th><th class="num">Price</th><th class="num">Per month</th><th>Next renewal</th><th>Data source</th><th>Verdict</th><th></th></tr></thead>
    <tbody>${rows.map((s) => {
      const ev = evaluate(s);
      const imported = !!s.importedFrom;
      return `<tr>
        <td><div class="sname">${esc(s.name)}</div><div class="smeta">${esc(s.member || S.settings.memberName)}${imported ? " · imported" : ""}</div></td>
        <td class="num">${s.currency === "INR" ? "₹" : "$"}${Number(s.price).toLocaleString()}<div class="smeta">${s.cycle}</div></td>
        <td class="num">${money(subMonthlyUsd(s))}</td>
        <td>${esc(nextRenewal(s, t) || "—")}</td>
        <td>${s.linkedProvider ? esc(providerName(s.linkedProvider)) : `<span class="muted small">Manual${s.lastUsed ? " · used " + esc(s.lastUsed) : ""}${s.frequency ? " · " + esc(s.frequency) : ""}</span>`}</td>
        <td>${verdictChip(s, ev)}</td>
        <td>${imported ? "" : `<button class="icon-btn" data-edit-sub="${esc(s.id)}">Edit</button>`}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
}

function openSubModal(sub) {
  const f = $("subForm");
  f.reset();
  f.member.innerHTML = members().filter((m) => !S.subs.some((s) => s.importedFrom === m)).map((m) => `<option>${esc(m)}</option>`).join("");
  $("subPresets").innerHTML = SUB_PRESETS.map((p) => `<option value="${esc(p.name)}">`).join("");
  $("subModalTitle").textContent = sub ? "Edit subscription" : "Add subscription";
  $("deleteSubBtn").classList.toggle("hidden", !sub);
  f.dataset.id = sub ? sub.id : "";
  const v = sub || { currency: "USD", cycle: "monthly", member: S.settings.memberName, linkedProvider: "" };
  for (const k of ["name", "price", "currency", "cycle", "renewalDate", "member", "linkedProvider", "lastUsed", "frequency"]) {
    if (v[k] != null) f[k].value = v[k];
  }
  toggleManual();
  $("subModal").classList.remove("hidden");
  f.name.focus();
}

function toggleManual() {
  document.querySelector("#subForm .manual-only").classList.toggle("hidden", !!$("subForm").linkedProvider.value);
}

$("addSubBtn").addEventListener("click", () => openSubModal(null));
$("subForm").linkedProvider.addEventListener("change", toggleManual);
$("subForm").name.addEventListener("change", (e) => {
  const p = SUB_PRESETS.find((x) => x.name === e.target.value);
  if (!p || $("subForm").dataset.id) return;
  const f = $("subForm");
  f.price.value = p.price;
  f.currency.value = p.currency;
  f.linkedProvider.value = p.linkedProvider;
  toggleManual();
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-edit-sub]");
  if (b) openSubModal(S.subs.find((s) => s.id === b.dataset.editSub));
});

$("subForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const sub = {
    id: f.dataset.id || uid(),
    name: f.name.value.trim(),
    price: Number(f.price.value),
    currency: f.currency.value,
    cycle: f.cycle.value,
    renewalDate: f.renewalDate.value || "",
    member: f.member.value || S.settings.memberName,
    linkedProvider: f.linkedProvider.value,
    lastUsed: f.linkedProvider.value ? "" : f.lastUsed.value,
    frequency: f.linkedProvider.value ? "" : f.frequency.value
  };
  await SubsDB.put(sub);
  S.subs = await SubsDB.all();
  $("subModal").classList.add("hidden");
  renderView();
});

$("deleteSubBtn").addEventListener("click", async () => {
  const id = $("subForm").dataset.id;
  if (!id || !confirm("Delete this subscription?")) return;
  await SubsDB.remove(id);
  S.subs = await SubsDB.all();
  $("subModal").classList.add("hidden");
  renderView();
});

// ---------- Connections ----------

function statusChip(c) {
  if (!c) return `<span class="st st-off">Not connected</span>`;
  if (c.status === "error") return `<span class="st st-err">✕ Reconnect needed</span>`;
  return `<span class="st st-ok">✓ Connected</span>`;
}

function renderConnections() {
  const cards = PROVIDER_ORDER.map((pid) => {
    const p = PROVIDERS[pid];
    const conns = S.connections.filter((c) => c.provider === pid);
    const head = `<div class="conn-head"><span class="dot" style="background:${PROVIDER_COLORS[pid]}"></span><span class="cname">${esc(p.name)}</span><span class="status">${statusChip(conns.find((c) => c.status === "error") || conns[0])}</span></div>
      <div class="conn-help">${esc(p.keyHelp)} <a href="${esc(p.docsUrl)}" target="_blank" rel="noopener">Docs</a></div>`;

    if (p.kind === "local") {
      const c = conns[0];
      const canRemember = "showDirectoryPicker" in window;
      return `<div class="conn-card">${head}
        ${c ? `<div class="conn-meta">${c.meta ? `${c.meta.fileCount} log files · ${c.meta.messageCount.toLocaleString()} assistant messages` : ""} · read ${timeAgo(c.lastSyncAt)}${c.dirHandle ? " · folder remembered, Sync now re-reads it" : ""}</div>` : ""}
        ${c && c.status === "error" ? `<div class="conn-err">${esc(c.lastError)}</div>` : ""}
        <div class="btn-row">
          ${canRemember ? `<button class="btn btn-primary btn-sm" id="ccPickBtn">${c ? "Choose folder again" : "Choose .claude/projects folder"}</button>` : ""}
          <label class="btn ${canRemember ? "btn-ghost" : "btn-primary"} btn-sm">${canRemember ? "Or upload folder" : (c ? "Re-import folder" : "Choose .claude/projects folder")}<input type="file" id="ccFolderInput" webkitdirectory multiple hidden></label>
          ${c ? `<button class="icon-btn del push-right" data-del-conn="${esc(c.id)}">Disconnect</button>` : ""}
        </div>
        <div class="conn-meta" id="ccProgress">Only token counts, model names and timestamps are read. Prompts and replies are skipped and never stored. Tip: in the picker, paste the path into the address bar — .claude is a hidden folder.</div>
      </div>`;
    }

    if (p.browserBlocked) {
      const c = conns[0];
      return `<div class="conn-card">${head}
        <div class="conn-help">This API doesn't accept requests from web pages, so the key can't be used here. Pull the report on your machine instead — the key never touches the browser:</div>
        <pre class="cmd">$env:ANTHROPIC_ADMIN_KEY="sk-ant-admin01-…"
node spendtracker/tools/pull.mjs ${pid}</pre>
        ${c ? `<div class="conn-meta">Report generated ${timeAgo(c.lastSyncAt)}${c.meta && c.meta.rowCount != null ? ` · ${c.meta.rowCount} day/model rows` : ""}</div>` : ""}
        <div class="btn-row">
          <label class="btn btn-primary btn-sm">${c ? "Import newer report" : "Import report file"}<input type="file" accept=".json,application/json" data-report-input="${pid}" hidden></label>
          ${c ? `<button class="icon-btn del push-right" data-del-conn="${esc(c.id)}">Disconnect</button>` : ""}
        </div>
        <div class="conn-meta" data-report-msg="${pid}"></div>
      </div>`;
    }

    return `<div class="conn-card">${head}
      ${conns.length ? `<div class="conn-accounts">${conns.map((c) => `
        <div class="conn-account">
          <div class="ca-main">
            <div class="ca-label">${esc(c.label || "Default")} <span class="muted small">· ${esc(c.key.slice(0, 12))}…${esc(c.key.slice(-4))}</span></div>
            <div class="ca-sub">Synced ${timeAgo(c.lastSyncAt)}${c.meta && c.meta.creditsRemainingUsd != null ? ` · ${money(c.meta.creditsRemainingUsd)} credits left` : ""}</div>
            ${c.status === "error" ? `<div class="conn-err" style="margin-top:8px">${esc(c.lastError)}</div>` : ""}
          </div>
          <button class="icon-btn" data-sync-conn="${esc(c.id)}">Sync</button>
          <button class="icon-btn" data-rekey-conn="${esc(c.id)}">Replace key</button>
          <button class="icon-btn del" data-del-conn="${esc(c.id)}">Remove</button>
        </div>`).join("")}</div>` : ""}
      <form class="form conn-form-wrap" data-connect="${pid}">
        <div class="conn-form">
          <input type="password" name="key" placeholder="${esc(p.keyLabel)}" autocomplete="off" required>
          <input type="text" name="label" placeholder="Label (optional)" maxlength="30" style="max-width:150px">
          <button class="btn btn-primary btn-sm" type="submit">${conns.length ? "Add another" : "Connect"}</button>
        </div>
        <div class="conn-meta" data-connect-msg></div>
      </form>
    </div>`;
  });
  $("connGrid").innerHTML = cards.join("");

  const input = $("ccFolderInput");
  if (input) input.addEventListener("change", async () => {
    if (!input.files.length) return;
    await runClaudeCodeImport([...input.files], null);
  });
  const pick = $("ccPickBtn");
  if (pick) pick.addEventListener("click", async () => {
    let dir;
    try { dir = await window.showDirectoryPicker({ id: "claude-projects", mode: "read" }); } catch (_) { return; }
    const files = [];
    $("ccProgress").textContent = "Finding log files…";
    for await (const f of walkJsonl(dir)) files.push(f);
    await runClaudeCodeImport(files, dir);
  });
}

// Report files written by tools/pull.mjs, for providers the browser can't call.
document.addEventListener("change", async (e) => {
  const input = e.target.closest("[data-report-input]");
  if (!input) return;
  const pid = input.dataset.reportInput;
  const file = input.files[0];
  input.value = "";
  if (!file) return;
  const msg = document.querySelector(`[data-report-msg="${pid}"]`);
  try {
    const data = JSON.parse(await file.text());
    if (data.type !== "spendtracker-provider-report" || !Array.isArray(data.rows)) throw new Error("That isn't a report from tools/pull.mjs.");
    if (data.provider !== pid) throw new Error(`That report is for ${providerName(data.provider)}, not ${providerName(pid)}.`);
    const conn = S.connections.find((c) => c.provider === pid && c.viaFile) ||
      { id: `${pid}-file`, provider: pid, label: "Report file", viaFile: true, key: "", member: S.settings.memberName, createdAt: new Date().toISOString() };
    const rows = data.rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
    const since = rows.reduce((m, r) => (r.date < m ? r.date : m), "9999-12-31");
    await UsageDB.replaceForConnection(conn.id, rows.length ? since : null, rows.map((r) => usageRow(conn, r, "api")));
    Object.assign(conn, { status: "ok", lastError: null, lastSyncAt: data.generatedAt, meta: { ...(data.meta || {}), rowCount: rows.length } });
    await ConnectionsDB.put(conn);
    await loadAll();
    renderView();
  } catch (err) {
    if (msg) msg.innerHTML = `<div class="conn-err">${esc(err.message)}</div>`;
  }
});

async function runClaudeCodeImport(files, dirHandle) {
  const prog = $("ccProgress");
  prog.textContent = "Reading logs…";
  try {
    const r = await importClaudeCodeFiles(files, dirHandle, (i, total) => { prog.textContent = `Reading logs… ${i}/${total} files`; });
    await loadAll();
    renderView();
    const p2 = $("ccProgress");
    if (p2) p2.textContent = r.fileCount ? `Imported ${r.messageCount.toLocaleString()} messages across ${r.days} days from ${r.fileCount} files.` : "No .jsonl files found in that folder.";
  } catch (e) {
    prog.textContent = "Couldn't read those logs: " + e.message;
  }
}

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-connect]");
  if (!form) return;
  e.preventDefault();
  const pid = form.dataset.connect;
  const p = PROVIDERS[pid];
  const msg = form.querySelector("[data-connect-msg]");
  const key = form.key.value.trim();
  const rekeyId = form.dataset.rekey;
  if (p.keyPattern && !p.keyPattern.test(key)) {
    msg.innerHTML = `<span style="color:#f3a09c">That doesn't look like an ${esc(p.name)} ${esc(p.keyLabel.toLowerCase())}. ${esc(p.keyHelp)}</span>`;
    return;
  }
  const existing = rekeyId ? S.connections.find((c) => c.id === rekeyId) : null;
  const conn = existing
    ? { ...existing, key }
    : { id: `${pid}-${uid()}`, provider: pid, key, label: form.label.value.trim(), member: S.settings.memberName, createdAt: new Date().toISOString() };
  msg.textContent = "Checking key and pulling the last 30 days…";
  form.querySelector("button").disabled = true;
  try {
    // Validate by doing the real pull; only save the key if it works.
    const { rows, meta } = await p.fetchUsage(conn, WINDOW_DAYS);
    await UsageDB.replaceForConnection(conn.id, addDays(today(), -(WINDOW_DAYS + 1)), rows.map((r) => usageRow(conn, r, "api")));
    Object.assign(conn, { status: "ok", lastError: null, lastSyncAt: new Date().toISOString(), meta });
    await ConnectionsDB.put(conn);
    await loadAll();
    renderView();
  } catch (err) {
    msg.innerHTML = `<div class="conn-err">${esc(err.message)}</div>`;
    form.querySelector("button").disabled = false;
  }
});

document.addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del-conn]");
  if (del) {
    const c = S.connections.find((x) => x.id === del.dataset.delConn);
    if (!c || !confirm(`Remove ${providerName(c.provider)}${c.label ? " · " + c.label : ""}? Its key and usage history are deleted from this browser.`)) return;
    await ConnectionsDB.remove(c.id);
    await UsageDB.deleteWhere("connectionId", c.id);
    await loadAll();
    renderView();
    return;
  }
  const sync = e.target.closest("[data-sync-conn]");
  if (sync) {
    const c = S.connections.find((x) => x.id === sync.dataset.syncConn);
    sync.textContent = "Syncing…";
    await syncApiConnection(c);
    await loadAll();
    renderView();
    return;
  }
  const rekey = e.target.closest("[data-rekey-conn]");
  if (rekey) {
    const c = S.connections.find((x) => x.id === rekey.dataset.rekeyConn);
    const form = document.querySelector(`[data-connect="${c.provider}"]`);
    form.dataset.rekey = c.id;
    form.label.classList.add("hidden");
    form.querySelector("button").textContent = `Replace key for ${c.label || "Default"}`;
    form.key.focus();
  }
});

// ---------- Team ----------

function renderTeam() {
  const t = today();
  const since = addDays(t, -(WINDOW_DAYS - 1));
  const me = S.settings.memberName;
  const list = members().map((m) => {
    const rows = S.usage.filter((r) => r.member === m);
    const billed = sumCost(rows.filter((r) => isBilled(r) && r.date >= since));
    const plans = S.subs.filter((s) => (s.member || me) === m);
    const imported = rows.some((r) => r.source === "import") || plans.some((s) => s.importedFrom === m);
    const importedAt = (S.settings.imports || {})[m];
    return `<div class="member-row">
      <div class="avatar">${esc(m.charAt(0).toUpperCase())}</div>
      <div class="m-main">
        <div class="m-name">${esc(m)}${m === me ? " (you)" : ""}</div>
        <div class="m-sub">${money(billed)} metered in 30 days · ${plans.length} plan${plans.length === 1 ? "" : "s"}${imported && importedAt ? ` · imported ${timeAgo(importedAt)}` : m === me ? " · from this browser's connections" : ""}</div>
      </div>
      ${m !== me && imported ? `<button class="icon-btn del" data-remove-member="${esc(m)}">Remove</button>` : ""}
    </div>`;
  });
  $("memberList").innerHTML = list.join("");
}

$("exportSummaryBtn").addEventListener("click", () => {
  const me = S.settings.memberName;
  const summary = {
    type: "spendtracker-summary",
    version: 1,
    member: me,
    exportedAt: new Date().toISOString(),
    // No keys, no raw logs — just aggregated daily rows and plan details.
    usage: S.usage.filter((r) => r.member === me && r.source !== "import").map(({ provider, date, model, costUsd, inputTokens, cacheTokens, outputTokens, requests }) => ({ provider, date, model, costUsd, inputTokens, cacheTokens, outputTokens, requests })),
    subscriptions: S.subs.filter((s) => (s.member || me) === me && !s.importedFrom).map(({ id, name, price, currency, cycle, renewalDate, linkedProvider, lastUsed, frequency }) => ({ id, name, price, currency, cycle, renewalDate, linkedProvider, lastUsed, frequency }))
  };
  downloadJson(summary, `ai-spend-${me.toLowerCase().replace(/\W+/g, "-")}-${today()}.json`);
  showResult("teamResult", `Exported ${summary.usage.length} usage rows and ${summary.subscriptions.length} plans for ${me}. Send the file to whoever pools the team view.`, true);
});

$("importSummaryInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.type !== "spendtracker-summary" || !Array.isArray(data.usage) || typeof data.member !== "string") throw new Error("That isn't an AI Spend Tracker summary file.");
    const m = data.member.trim().slice(0, 40);
    if (!m) throw new Error("The summary has no member name.");
    if (m === S.settings.memberName) throw new Error(`That summary is labelled “${m}” — the same name as you. Ask them to set their own name under Settings, then export again.`);
    await removeMember(m);
    const connId = `import:${m}`;
    const rows = data.usage.filter((r) => PROVIDERS[r.provider] && /^\d{4}-\d{2}-\d{2}$/.test(r.date)).map((r) => ({
      id: `${connId}|${r.provider}|${r.date}|${String(r.model)}`,
      connectionId: connId, provider: r.provider, member: m, date: r.date, model: String(r.model).slice(0, 120),
      costUsd: Number(r.costUsd) || 0, inputTokens: Number(r.inputTokens) || 0, cacheTokens: Number(r.cacheTokens) || 0, outputTokens: Number(r.outputTokens) || 0, requests: Number(r.requests) || 0,
      source: "import"
    }));
    await UsageDB.putMany(rows);
    const subs = (data.subscriptions || []).map((s) => ({
      id: `import:${m}:${s.id}`, name: String(s.name).slice(0, 60), price: Number(s.price) || 0,
      currency: s.currency === "INR" ? "INR" : "USD", cycle: s.cycle === "yearly" ? "yearly" : "monthly",
      renewalDate: /^\d{4}-\d{2}-\d{2}$/.test(s.renewalDate || "") ? s.renewalDate : "",
      member: m, linkedProvider: PROVIDERS[s.linkedProvider] ? s.linkedProvider : "",
      lastUsed: /^\d{4}-\d{2}-\d{2}$/.test(s.lastUsed || "") ? s.lastUsed : "",
      frequency: ["daily", "weekly", "rarely"].includes(s.frequency) ? s.frequency : "",
      importedFrom: m
    }));
    await SubsDB.putMany(subs);
    const imports = { ...(S.settings.imports || {}), [m]: new Date().toISOString() };
    await SettingsDB.set("imports", imports);
    await loadAll();
    renderView();
    showResult("teamResult", `Pooled ${m}: ${rows.length} usage row${rows.length === 1 ? "" : "s"} and ${subs.length} plan${subs.length === 1 ? "" : "s"}.`, true);
  } catch (err) {
    showResult("teamResult", err.message, false);
  }
});

async function removeMember(m) {
  await UsageDB.deleteWhere("connectionId", `import:${m}`);
  for (const s of S.subs.filter((x) => x.importedFrom === m)) await SubsDB.remove(s.id);
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-remove-member]");
  if (!b) return;
  const m = b.dataset.removeMember;
  if (!confirm(`Remove ${m} from the pooled view? Their imported usage and plans are deleted from this browser.`)) return;
  await removeMember(m);
  const imports = { ...(S.settings.imports || {}) };
  delete imports[m];
  await SettingsDB.set("imports", imports);
  await loadAll();
  renderView();
});

function showResult(id, text, ok) {
  const el = $(id);
  el.textContent = text;
  el.className = "result " + (ok ? "ok" : "err");
}

// ---------- Settings ----------

function renderSettings() {
  const f = $("settingsForm");
  for (const k of ["memberName", "currency", "fxRate", "monthlyBudget", "renewalLeadDays", "whatsappNumber", "autoSyncHours"]) f[k].value = S.settings[k];
  f.whatsappOptIn.checked = !!S.settings.whatsappOptIn;
}

$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const oldName = S.settings.memberName;
  const newName = f.memberName.value.trim() || oldName;
  if (newName !== oldName && members().includes(newName)) {
    alert(`“${newName}” is already a pooled teammate's name.`);
    return;
  }
  const next = {
    memberName: newName,
    currency: f.currency.value,
    fxRate: Number(f.fxRate.value) || S.settings.fxRate,
    monthlyBudget: Number(f.monthlyBudget.value) || 0,
    renewalLeadDays: Number(f.renewalLeadDays.value) || 0,
    whatsappOptIn: f.whatsappOptIn.checked,
    whatsappNumber: f.whatsappNumber.value.trim(),
    autoSyncHours: Number(f.autoSyncHours.value) || 6
  };
  await SettingsDB.setMany(next);
  if (newName !== oldName) await renameSelf(oldName, newName);
  await loadAll();
  renderView();
  $("savedNote").classList.remove("hidden");
  setTimeout(() => $("savedNote").classList.add("hidden"), 1800);
});

// Relabel "my" rows, connections and plans when the user changes their name.
async function renameSelf(oldName, newName) {
  const rows = S.usage.filter((r) => r.member === oldName && r.source !== "import").map((r) => ({ ...r, member: newName }));
  await UsageDB.putMany(rows);
  await ConnectionsDB.putMany(S.connections.filter((c) => (c.member || oldName) === oldName).map((c) => ({ ...c, member: newName })));
  await SubsDB.putMany(S.subs.filter((s) => !s.importedFrom && (s.member || oldName) === oldName).map((s) => ({ ...s, member: newName })));
}

$("exportBackupBtn").addEventListener("click", () => {
  const withKeys = $("includeKeys").checked;
  const backup = {
    type: "spendtracker-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: S.settings,
    connections: S.connections.map(({ dirHandle, ...c }) => (withKeys ? c : { ...c, key: "" })),
    usage: S.usage,
    subscriptions: S.subs
  };
  downloadJson(backup, `ai-spend-backup-${today()}.json`);
  showResult("backupResult", `Backup exported${withKeys ? " — it contains your API keys in plain text; store it somewhere safe" : " (without API keys — you'll re-enter them after restoring)"}.`, true);
});

$("importBackupInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.type !== "spendtracker-backup") throw new Error("That isn't an AI Spend Tracker backup file.");
    if (!confirm("Restoring replaces everything currently in this browser. Continue?")) return;
    await Promise.all([ConnectionsDB.clear(), UsageDB.clear(), SubsDB.clear()]);
    await SettingsDB.setMany(data.settings || {});
    // Keyless connections come back flagged so the dashboard asks for the key.
    await ConnectionsDB.putMany((data.connections || []).map((c) => (c.key || c.viaFile || c.provider === CLAUDE_CODE_ID ? c : { ...c, status: "error", lastError: "Restored without its API key — use Replace key." })));
    await UsageDB.putMany(data.usage || []);
    await SubsDB.putMany(data.subscriptions || []);
    await loadAll();
    renderView();
    showResult("backupResult", `Restored ${S.connections.length} connections, ${S.usage.length} usage rows and ${S.subs.length} plans.`, true);
  } catch (err) {
    showResult("backupResult", err.message, false);
  }
});

$("wipeBtn").addEventListener("click", async () => {
  if (!confirm("Delete every key, usage row, subscription and setting stored in this browser? This can't be undone.")) return;
  await Promise.all([ConnectionsDB.clear(), UsageDB.clear(), SubsDB.clear()]);
  await SettingsDB.setMany({ ...SETTINGS_DEFAULTS, imports: {} });
  await loadAll();
  renderView();
});

// ---------- Boot ----------

(async function boot() {
  try {
    if (localStorage.getItem("spendtracker_metric") === "tokens") S.metric = "tokens";
    S.includeCache = localStorage.getItem("spendtracker_cache") === "1";
  } catch (_) { /* storage blocked */ }
  await loadAll();
  renderView("dashboard");
  // PRD asks for nightly sync; with no server, refresh stale API data whenever the page opens.
  if (S.connections.length) syncAll({ interactive: false, onlyStale: true });
})();
