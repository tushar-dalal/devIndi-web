// Worksheet Builder UI: Student → Paper → Subject → Topics → Options → Review,
// plus a per-student History. State lives in S; each step owns the screen
// and re-renders from S. Only the active student's records are ever read.

(() => {
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => [...(el || document).querySelectorAll(sel)];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const STEPS = ["home", "type", "subject", "topics", "options", "review"];
  const STEP_NAME = { home: "Student", type: "Paper", subject: "Subject", topics: "Topics", options: "Options", review: "Review" };

  // ── Preferences (per-viewer conveniences only) ──────────
  const prefs = (() => {
    let p = {};
    try { p = JSON.parse(localStorage.getItem("worksheet-builder") || "{}"); } catch (_) { p = {}; }
    return {
      get: (k, d) => (p[k] === undefined ? d : p[k]),
      set: (k, v) => { p[k] = v; try { localStorage.setItem("worksheet-builder", JSON.stringify(p)); } catch (_) { /* fine */ } }
    };
  })();

  const S = {
    src: null, data: null, storedHandle: null, loading: false,
    view: "connect", back: false,
    student: null, req: null,
    filter: "taught", search: "", closed: new Set(), openNotes: new Set(), justAdded: new Set(),
    promptText: "", promptEdited: false, saved: null, histSubject: "all",
    shownTotal: 0
  };

  const ICON = {
    check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    chev: '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    arrow: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    folder: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    drawn: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    leaf: '<svg width="40" height="40" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6h17l7 7v29H12z"/><path d="M29 6v7h7"/><path d="M17 22h14M17 28h14M17 34h8"/></svg>'
  };

  const today = () => Prompt.todayISO();
  // The server reports where the Students folder is; prompts use that path.
  const root = () => (S.src && S.src.root) || "D:\\Tushars\\Students";

  // ── Lookups ─────────────────────────────────────────────
  const stu = () => S.data && S.data.students.find((s) => s.dir === S.student);
  const subj = () => { const s = stu(); return s && S.req && s.subjects.find((x) => x.name === S.req.subject); };
  const ptype = () => S.req && PAPER_TYPES.find((t) => t.id === S.req.type);
  const color = (s) => (s && s.profile && s.profile.color) || "var(--faint)";
  const total = () => (S.req ? S.req.rows.reduce((a, r) => a + (Number(r.count) || 0), 0) : 0);

  function relTime(ms) {
    if (!ms) return "never";
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    return d === 1 ? "yesterday" : `${d} days ago`;
  }
  function niceDate(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }
  function ago(iso) {
    if (!iso) return "";
    const n = Prompt.daysAgo(iso, today());
    return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n}d ago`;
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ── Theme ───────────────────────────────────────────────
  function applyTheme() {
    const t = prefs.get("theme", "auto");
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  }
  $("#themeLink").addEventListener("click", () => {
    const dark = document.documentElement.getAttribute("data-theme") === "dark"
      || (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
    prefs.set("theme", dark ? "light" : "dark");
    applyTheme();
  });

  // ── Folder connection ───────────────────────────────────
  async function openSource(src) {
    S.src = src;
    S.loading = true;
    if (S.view === "connect") go("home");
    else render();
    try {
      S.data = await Folder.scan(src);
    } catch (e) {
      S.data = { students: [], errors: [{ file: src.name, msg: "could not be read: " + e.message, level: "error" }], scannedAt: new Date() };
    }
    S.loading = false;
    if (S.student && !stu()) { S.student = null; S.req = null; S.view = "home"; }
    render();
  }

  async function refresh() {
    if (!S.src) return;
    const btn = $("#refreshLink");
    btn.disabled = true;
    await openSource(S.src);
    btn.disabled = false;
    toast("Folder re-read");
  }
  $("#refreshLink").addEventListener("click", refresh);
  $("#brand").addEventListener("click", () => { if (S.data) go("home", true); });
  $("#historyLink").addEventListener("click", () => go("history"));

  // ── Navigation ──────────────────────────────────────────
  function go(view, back) {
    S.back = !!back;
    S.view = view;
    S.changed = true;
    if (view !== "review") S.saved = null;
    render();
    window.scrollTo(0, 0);
  }
  function stepIndex(v) { return STEPS.indexOf(v); }
  function canReach(v) {
    if (!S.data) return false;
    if (v === "home") return true;
    if (!S.student || !S.req) return v === "type" && !!S.student;
    if (v === "type") return true;
    if (v === "subject") return !!S.req.type;
    if (v === "topics") return !!S.req.subject;
    if (v === "options" || v === "review") return !!S.req.subject && S.req.rows.length > 0;
    return false;
  }
  function next() {
    const i = stepIndex(S.view);
    if (i < 0 || i >= STEPS.length - 1) return;
    const v = STEPS[i + 1];
    if (canReach(v)) go(v);
    else if (S.view === "topics") toast("Pick at least one topic first");
  }
  function prev() {
    if (S.view === "history") { go(S.req ? "type" : "home", true); return; }
    const i = stepIndex(S.view);
    if (i > 0) {
      let v = STEPS[i - 1];
      // Skip the auto-chosen subject step on the way back when there was only one choice.
      if (v === "subject" && eligibleSubjects().length === 1) v = "type";
      go(v, true);
    }
  }

  // ── Request building ────────────────────────────────────
  function startReq(typeId) {
    const s = stu();
    const keep = S.req && S.req.student === s.dir ? S.req : null;
    S.req = {
      v: 1, student: s.dir, type: typeId, subject: null, satFormat: "module", rows: [], fromHard: false,
      options: { title: "", titleEdited: false, order: "difficulty", qpp: "auto", timeLimit: "", calculator: false, paper: prefs.get("paper", "Letter"), note: "", partA: true }
    };
    if (keep && keep.subject && eligibleSubjects().some((x) => x.name === keep.subject)) {
      S.req.subject = keep.subject;
      S.req.rows = keep.rows;
      applySubjectDefaults(false);
    }
  }

  function eligibleSubjects() {
    const s = stu(); const t = ptype();
    if (!s) return [];
    return s.subjects.filter((x) => !x.broken && (!t || !t.satOnly || x.kind === "sat"));
  }

  function chooseSubject(name, resetRows) {
    const changed = S.req.subject !== name;
    S.req.subject = name;
    if (changed || resetRows) { S.req.rows = []; S.req.fromHard = false; }
    applySubjectDefaults(true);
    S.filter = "taught";
    S.search = "";
    const sb = subj();
    // Open on what matters now: the unit at school, cross-unit skills, and anything already picked.
    const picked = new Set(S.req.rows.map((r) => r.topic));
    S.closed = new Set(sb ? sb.units.filter((u) => {
      if (u.crossUnit || u.topics.some((t) => picked.has(t.id))) return false;
      return sb.currentUnit ? u.id !== sb.currentUnit : !u.substance;
    }).map((u) => u.id) : []);
    if (ptype().id === "sat" && !S.req.rows.length) prefillSat();
  }

  function applySubjectDefaults(resetOptions) {
    const s = stu(), t = ptype(), sb = subj();
    if (!sb) return;
    const o = S.req.options;
    if (resetOptions) {
      o.calculator = Prompt.calculatorDefault(s, sb.name, today());
      o.order = t.order;
      o.timeLimit = "";
      o.partA = !!t.partA;
    }
    if (t.id === "sat") {
      const fmts = SAT_FORMATS[sb.master] || [];
      if (!fmts.some((f) => f.id === S.req.satFormat)) S.req.satFormat = "module";
      const f = fmts.find((x) => x.id === S.req.satFormat);
      if (f && resetOptions) o.timeLimit = f.minutes;
    }
    autoTitle();
  }

  function satPreset() {
    const sb = subj();
    return (SAT_FORMATS[sb && sb.master] || []).find((f) => f.id === S.req.satFormat) || null;
  }

  function prefillSat() {
    const sb = subj();
    const f = satPreset();
    if (S.req.satFormat === "vocab") {
      const wic = sb.topics.get("rw-wic");
      S.req.rows = wic ? [{ topic: "rw-wic", count: f.total, diff: "M>H", note: "", retest: [] }] : [];
      return;
    }
    const usable = [...sb.topics.values()].filter((t) => USABLE.has(t.status));
    S.req.rows = usable.map((t) => ({ topic: t.id, count: 1, diff: defaultDiffFor(), note: "", retest: [] }));
    splitTotal(f ? f.total : 20);
  }

  function defaultDiffFor() {
    return Prompt.defaultDiff(stu(), S.req.subject, ptype().context);
  }

  function autoTitle() {
    const o = S.req.options;
    if (o.titleEdited) return;
    const s = stu(), t = ptype(), sb = subj();
    if (!sb) { o.title = ""; return; }
    let title;
    if (t.id === "sat") {
      const base = S.req.satFormat === "vocab" ? "SAT Vocabulary Set" : sb.master === "SAT Math" ? "SAT Math Practice Paper" : "SAT Reading and Writing Practice Paper";
      let n = 0;
      for (const title of takenTitles(s)) {
        const m = title.match(new RegExp("^" + base.replace(/ /g, "\\s+") + "\\s+(\\d+)"));
        if (m) n = Math.max(n, Number(m[1]));
      }
      title = `${base} ${n + 1}`;
    } else {
      const topics = S.req.rows.map((r) => sb.topics.get(r.topic)).filter(Boolean);
      const word = { worksheet: "Worksheet", test: "Practice Test", drill: "Drill", revision: "Revision Test", pack: "" }[t.id];
      if (!topics.length) title = `${sb.label} ${word}`.trim();
      else if (S.req.fromHard) title = `Hard Topics Review ${niceDate(today()).replace(/^\w+,?\s*/, "")} ${t.id === "worksheet" ? "Worksheet" : word}`.trim();
      else if (topics.length === 1) {
        const tp = topics[0];
        title = `${Prompt.topicLabel(tp)} ${t.id === "pack" ? "" : word}`.trim();
      } else {
        const units = [...new Set(topics.map((x) => x.unit))];
        const codes = topics.map((x) => x.schoolCode || x.code).filter((c) => !/[a-z]{2,}/.test(c));
        if (units.length === 1 && codes.length === topics.length && codes.length > 1) title = `${codes[0]} to ${codes[codes.length - 1]} ${word || units[0].title}`;
        else if (units.length === 1) title = `${units[0].schoolTitle || units[0].title} ${word}`.trim();
        else title = `Mixed ${word || "Review"}`;
      }
      title = Prompt.sanitize(title);
      // Don't collide with a paper already on file.
      const taken = takenTitles(s);
      if (taken.has(title)) { let i = 2; while (taken.has(`${title} ${i}`)) i++; title = `${title} ${i}`; }
    }
    o.title = title;
  }

  // Titles already used: logged papers plus prompts sent but not yet logged.
  function takenTitles(s) {
    return new Set([
      ...s.history.map((p) => String(p.title)),
      ...s.prompts.map((p) => p.name.replace(/^\d{4}-\d{2}-\d{2} \d{4} /, "").replace(/\.md$/i, ""))
    ]);
  }

  function sortRows() {
    const sb = subj();
    const order = [...sb.topics.keys()];
    S.req.rows.sort((a, b) => order.indexOf(a.topic) - order.indexOf(b.topic));
  }

  function toggleTopic(id) {
    const i = S.req.rows.findIndex((r) => r.topic === id);
    if (i >= 0) { S.req.rows.splice(i, 1); S.openNotes.delete(id); }
    else {
      S.req.rows.push({ topic: id, count: ptype().perTopic, diff: defaultDiffFor(), note: "", retest: [] });
      S.justAdded.add(id);
      sortRows();
    }
    if (!S.req.rows.length) S.req.fromHard = false;
    autoTitle();
  }

  // Split n across selected rows; weak/hard topics take the remainder first.
  function splitTotal(n) {
    const rows = S.req.rows;
    if (!rows.length || !(n > 0)) return;
    const sb = subj(), s = stu();
    const hardIds = new Set(s.hard.filter((h) => !h.resolved && h.subject === sb.name).map((h) => h.topic));
    const prio = rows.map((r, i) => ({ r, i, p: (hardIds.has(r.topic) ? 2 : 0) + ((sb.topics.get(r.topic) || {}).status === "weak" ? 1 : 0) }))
      .sort((a, b) => b.p - a.p || a.i - b.i);
    const base = Math.floor(n / rows.length);
    let rem = n % rows.length;
    for (const x of prio) { x.r.count = base + (rem > 0 ? 1 : 0); rem--; }
  }

  function hardFilterPeriod() {
    return { week: "week", "2weeks": "2weeks", hardall: "all" }[S.filter] || null;
  }

  function selectHard(period) {
    const s = stu(), sb = subj();
    const items = Prompt.hardItems(s, sb.name, period, today());
    const ids = [...new Set(items.map((h) => h.topic))].filter((id) => sb.topics.has(id));
    const t = ptype();
    const cap = Prompt.capFor(s, sb.name, t, today());
    const per = Math.max(2, Math.min(t.perTopic, cap ? Math.floor(cap / Math.max(1, ids.length)) : t.perTopic));
    for (const id of ids) {
      if (!S.req.rows.some((r) => r.topic === id)) {
        S.req.rows.push({ topic: id, count: per, diff: defaultDiffFor(), note: "", retest: [] });
        S.justAdded.add(id);
      }
    }
    S.req.fromHard = true;
    sortRows();
    autoTitle();
  }

  function retestMistakes() {
    const s = stu(), sb = subj();
    const mist = Prompt.recentMistakes(s, sb.name, today(), 14);
    const recentHard = Prompt.hardItems(s, sb.name, "2weeks", today());
    let added = 0;
    const all = new Map(mist);
    for (const h of recentHard) { if (!all.has(h.topic)) all.set(h.topic, []); all.get(h.topic).push(h.issue); }
    for (const [id, list] of all) {
      if (!sb.topics.has(id)) continue;
      let row = S.req.rows.find((r) => r.topic === id);
      if (!row) { row = { topic: id, count: Math.min(4, Math.max(2, list.length)), diff: defaultDiffFor(), note: "", retest: [] }; S.req.rows.push(row); S.justAdded.add(id); }
      row.retest = [...new Set([...(row.retest || []), ...list])];
      added++;
    }
    sortRows();
    autoTitle();
    toast(added ? `Added ${added} topic${added === 1 ? "" : "s"} with recent mistakes` : "No mistakes logged in the last 2 weeks");
  }

  // Home-card shortcut: a hard-topics worksheet in the subject with the most recent flags.
  function quickHard(dir) {
    S.student = dir;
    prefs.set("lastStudent", dir);
    const s = stu();
    const counts = new Map();
    for (const h of Prompt.hardItems(s, null, "week", today())) counts.set(h.subject, (counts.get(h.subject) || 0) + 1);
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    startReq("worksheet");
    S.req.rows = [];
    chooseSubject(best[0], true);
    S.filter = "week";
    selectHard("week");
    go("topics");
  }

  // ── Templates & re-run ──────────────────────────────────
  function loadRequest(request, toView) {
    const s = stu();
    const r = clone(request);
    r.student = s.dir;
    if (!PAPER_TYPES.some((t) => t.id === r.type)) r.type = "worksheet";
    S.req = Object.assign({ v: 1, satFormat: "module", rows: [], options: {}, fromHard: false }, r);
    S.req.options = Object.assign({ order: "difficulty", qpp: "auto", timeLimit: "", calculator: false, paper: "Letter", note: "", partA: true }, r.options || {});
    const sb = s.subjects.find((x) => x.name === S.req.subject);
    if (!sb) { S.req.subject = null; S.req.rows = []; go("subject"); return; }
    const missing = S.req.rows.filter((x) => !sb.topics.has(x.topic));
    S.req.rows = S.req.rows.filter((x) => sb.topics.has(x.topic));
    if (missing.length) toast(`${missing.length} topic(s) no longer in the syllabus were dropped`);
    S.req.options.titleEdited = false;
    autoTitle();
    S.promptEdited = false;
    go(S.req.rows.length ? toView : "topics");
  }

  function rerunPaper(p) {
    const s = stu();
    const log = p.prompt && s.prompts.find((x) => x.path === p.prompt || x.name === p.prompt.split("/").pop());
    if (log && log.request) { loadRequest(log.request, "review"); return; }
    const sb = s.subjects.find((x) => x.name === p.subject);
    if (!sb) { toast(`No syllabus for ${p.subject}`); return; }
    const typeMap = { classwork: "worksheet", guide: "pack" };
    const type = typeMap[p.type] || (PAPER_TYPES.some((t) => t.id === p.type) ? p.type : "worksheet");
    const topics = (p.topics || []).filter((id) => sb.topics.has(id));
    const per = p.total && topics.length ? Math.max(1, Math.round(p.total / topics.length)) : PAPER_TYPES.find((t) => t.id === type).perTopic;
    S.req = { v: 1, student: s.dir, type, subject: sb.name, satFormat: /vocab/i.test(p.title) ? "vocab" : "module", rows: [], fromHard: false,
      options: { title: "", titleEdited: false, order: "difficulty", qpp: "auto", timeLimit: "", calculator: false, paper: prefs.get("paper", "Letter"), note: "", partA: true } };
    applySubjectDefaults(true);
    S.req.rows = topics.map((id) => ({ topic: id, count: per, diff: Prompt.defaultDiff(s, sb.name, PAPER_TYPES.find((t) => t.id === type).context), note: "", retest: [] }));
    autoTitle();
    S.promptEdited = false;
    go(topics.length ? "topics" : "topics");
  }

  async function saveTemplate(name) {
    const s = stu();
    name = name.trim();
    if (!name) { toast("Give the template a name"); return; }
    if (!S.src.canWrite) { toast("Folder is read-only here; templates can't be saved"); return; }
    const req = clone(S.req);
    req.options.titleEdited = false;
    const list = s.templates.filter((t) => t.name !== name);
    list.push({ name, saved: today(), request: req });
    try {
      await S.src.write([s.dir, "templates.json"], JSON.stringify({ schema: 1, templates: list }, null, 2));
      s.templates = list;
      toast(`Saved template "${name}"`);
      render();
    } catch (e) { toast("Couldn't save template: " + e.message); }
  }

  // ── Prompt: copy + log ──────────────────────────────────
  function currentPrompt() {
    // After a copy & log the shown text keeps the real log path filled in.
    if (!S.promptEdited && !S.saved) S.promptText = Prompt.build(stu(), subj(), ptype(), S.req, { rootPath: root(), today: today() });
    return S.promptText;
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (__) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  function logName() {
    const d = new Date();
    const hhmm = `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
    return `${today()} ${hhmm} ${Prompt.sanitize(S.req.options.title || "Untitled")}.md`;
  }
  function logBody(text) {
    const reqJson = JSON.stringify(S.req).replace(/>/g, "\\u003e");
    return `<!-- worksheet-builder request: ${reqJson} -->\n# ${S.req.options.title}\n\nStudent: ${stu().name} · ${new Date().toLocaleString()}\n\n${text}\n`;
  }

  async function copyAndLog(logIt) {
    const s = stu();
    const name = logName();
    let text = $("#promptText") ? $("#promptText").value : currentPrompt();
    if (logIt) text = text.split(Prompt.LOG_PLACEHOLDER).join("prompt-log/" + name);
    const copied = await copyText(text);
    if (!logIt) {
      if (copied) toast("Copied");
      else selectPrompt("Clipboard blocked. The prompt is selected: press Ctrl+C.");
      return;
    }
    S.promptText = text;
    if (S.src.canWrite) {
      try {
        await S.src.write([s.dir, "prompt-log", name], logBody(text));
        s.prompts.unshift({ name, path: "prompt-log/" + name, mtime: Date.now(), request: clone(S.req) });
        S.saved = { name, written: true, copied };
      } catch (e) {
        S.saved = { name, written: false, copied, error: e.message };
      }
    } else {
      S.saved = { name, written: false, copied, error: "the folder was opened read-only" };
    }
    render();
    if (!copied) selectPrompt("Clipboard blocked. The prompt is selected: press Ctrl+C.");
  }

  function selectPrompt(msg) {
    const ta = $("#promptText");
    if (ta) { ta.focus(); ta.select(); }
    toast(msg);
  }

  function downloadLog() {
    const text = $("#promptText") ? $("#promptText").value : currentPrompt();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([logBody(text)], { type: "text/markdown" }));
    a.download = logName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function openFile(rel) {
    const s = stu();
    if (!rel) return;
    const f = await S.src.file([s.dir, ...rel.split(/[\\/]/)]);
    if (!f) { toast("Not found: " + rel); return; }
    const type = /\.pdf$/i.test(rel) ? "application/pdf" : "text/plain;charset=utf-8";
    const url = URL.createObjectURL(new Blob([await f.arrayBuffer()], { type }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ── Render ──────────────────────────────────────────────
  function render() {
    const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
    renderTrail();
    const main = $("#main");
    const views = { connect: vConnect, home: vHome, type: vType, subject: vSubject, topics: vTopics, options: vOptions, review: vReview, history: vHistory };
    if (S.data && !S.loading && S.view !== "connect" && S.view !== "home" && !stu()) S.view = "home";
    main.innerHTML = `<div class="view${S.changed ? (S.back ? " back" : "") : ""}" style="${S.changed ? "" : "animation:none"}">${(views[S.view] || vHome)()}</div>`;
    S.changed = false;
    bind[S.view] && bind[S.view](main);
    renderSumbar();
    $("#historyLink").hidden = !(S.student && S.data && S.view !== "history");
    $("#refreshLink").hidden = !S.src;
    if (focusKey) { const el = $(`[data-key="${CSS.escape(focusKey)}"]`); if (el) el.focus({ preventScroll: true }); }
    S.justAdded.clear();
  }

  function renderTrail() {
    const t = $("#trail");
    if (!S.data || S.view === "connect" || S.view === "home") { t.innerHTML = ""; return; }
    const s = stu();
    if (S.view === "history") {
      t.innerHTML = `<button data-go="home">Students</button><span class="sep">›</span>
        <button data-go="type" class="done"><span class="dot" style="background:${esc(color(s))}"></span>${esc(s.name)}</button><span class="sep">›</span>
        <button class="current" disabled>History</button>`;
    } else {
      const cur = stepIndex(S.view);
      const val = {
        home: s ? `<span class="dot" style="background:${esc(color(s))}"></span>${esc(s.name)}` : "Student",
        type: ptype() ? ptype().name : "Paper",
        subject: S.req && S.req.subject ? esc(S.req.subject) : "Subject",
        topics: S.req && S.req.rows.length ? `${S.req.rows.length} topic${S.req.rows.length === 1 ? "" : "s"}` : "Topics",
        options: "Options", review: "Review"
      };
      t.innerHTML = STEPS.map((v, i) => {
        const cls = i === cur ? "current" : i < cur ? "done" : "";
        const dis = i === cur || !canReach(v);
        return `<button data-go="${v}" class="${cls}" ${dis ? "disabled" : ""}>${val[v]}</button>`;
      }).join('<span class="sep">›</span>');
    }
    $$("button[data-go]", t).forEach((b) => b.addEventListener("click", () => {
      const v = b.dataset.go;
      go(v, v === "home" || stepIndex(v) < stepIndex(S.view) || S.view === "history");
    }));
  }

  // ── Views ───────────────────────────────────────────────
  // Shown only when the local server can't be reached or the folder is missing.
  function vConnect() {
    const missing = S.src && S.src.exists === false;
    return `<section class="connect">
      <div class="eyebrow">Worksheet Builder</div>
      <h1 class="display">${missing ? "The Students folder isn't there." : "Worksheet Builder isn't running."}</h1>
      <p class="lede">${missing
        ? `The server is looking for <b>${esc(S.src.root)}</b> and can't find it. Is the drive connected?`
        : "It runs on this laptop and starts by itself when you sign in to Windows. To start it now, run:"}</p>
      ${missing ? "" : `<pre class="cmd">node D:\\Tushars\\Stuff\\devIndi\\worksheets\\server\\serve.mjs</pre>`}
      <div class="actions"><button class="btn primary" id="retry">Try again</button></div>
    </section>`;
  }

  function vHome() {
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    if (S.loading || !S.data) {
      return `<div class="head"><div class="eyebrow">Reading the folder…</div><h1 class="display">${greet}, Tushar</h1></div>
        <div class="cards" style="margin-top:32px">${'<div class="skel"></div>'.repeat(3)}</div>`;
    }
    const d = S.data;
    const real = d.students.filter((s) => !s.missing);
    const cards = d.students.map((s, i) => {
      if (s.missing) {
        return `<div class="card dim"><div class="name" style="font-size:22px">${esc(s.dir)}</div>
          <div class="meta">No student.json yet. Ask Claude in chat to set this folder up as a student.</div></div>`;
      }
      const P = s.profile || {};
      const hw = Prompt.hardItems(s, null, "week", today()).length;
      const errs = s.errors.filter((e) => e.level === "error").length;
      const idx = real.indexOf(s) + 1;
      return `<div class="card" style="--c:${esc(color(s))}">
        <button class="stretch" data-student="${esc(s.dir)}" data-key="card-${esc(s.dir)}" aria-label="${esc(s.name)}"></button>
        ${idx <= 9 ? `<span class="num kbd" aria-hidden="true">${idx}</span>` : ""}
        <div class="name"><span class="dot" style="background:${esc(color(s))}"></span>${esc(s.name)}${P.nickname ? `<span class="meta" style="font-family:var(--sans);font-size:14px">“${esc(P.nickname)}”</span>` : ""}</div>
        <div class="meta">${esc([P.grade, P.school || P.city].filter(Boolean).join(" · ") || "—")}</div>
        <div class="pills">${s.subjects.map((x) => `<span class="pill">${esc(x.name)}</span>`).join("") || '<span class="meta">No subjects with a syllabus yet</span>'}</div>
        <div class="meta">${P.lastClass ? `Last class ${esc(niceDate(P.lastClass))}` : "No class logged"} · updated ${esc(relTime(s.newest))}</div>
        <div class="row">
          ${hw ? `<span class="pill hard">${hw} hard topic${hw === 1 ? "" : "s"} this week</span>` : '<span class="pill ok">No new hard topics</span>'}
          ${hw ? `<button class="btn small quick" data-quick="${esc(s.dir)}">Hard-topics paper ${ICON.arrow}</button>` : ""}
        </div>
        ${errs ? `<button class="issues" data-showerr>${errs} file problem${errs === 1 ? "" : "s"}</button>` : ""}
      </div>`;
    }).join("");
    const allErr = [...d.errors, ...d.students.flatMap((s) => s.errors)];
    const hasHard = allErr.some((e) => e.level === "error");
    return `<div class="head">
        <div class="eyebrow">${real.length} student${real.length === 1 ? "" : "s"} · ${esc(S.src.name)}</div>
        <h1 class="display">${greet}, Tushar</h1>
        <p class="lede">Who is this paper for?</p>
      </div>
      ${d.students.length ? `<div class="cards">${cards}</div>` :
        `<div class="empty">${ICON.leaf}<div>No student folders found in “${esc(S.src.name)}”. Is this the Students folder?</div></div>`}
      ${allErr.length ? `<details class="errors" id="errors" ${hasHard ? "open" : ""}>
        <summary><span class="pill ${hasHard ? "hard" : "solid"}">${allErr.length}</span> File problems. Ask Claude to fix these in chat.</summary>
        <ul>${allErr.map((e) => `<li><span class="lvl ${e.level}">${e.level === "error" ? "Error" : "Note"}</span><span><span class="f">${esc(e.file)}</span> ${esc(e.msg)}</span></li>`).join("")}</ul>
      </details>` : ""}
      <div class="homefoot">
        <span>${esc(root())} · scanned ${esc(d.scannedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</span>
      </div>`;
  }

  function vType() {
    const s = stu();
    const hasSat = s.subjects.some((x) => x.kind === "sat");
    const tiles = PAPER_TYPES.map((t, i) => {
      const dis = t.satOnly && !hasSat;
      const on = S.req && S.req.type === t.id;
      return `<button class="tile${on ? " on" : ""}" data-type="${t.id}" data-key="type-${t.id}" ${dis ? "disabled title=\"No SAT subject for this student\"" : ""}>
        <span class="num kbd" aria-hidden="true">${i + 1}</span>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg>
        <span class="t">${esc(t.name)}</span><span class="s">${esc(t.blurb)}</span></button>`;
    }).join("");
    return `<div class="head"><div class="eyebrow">${esc(s.name)}</div><h2 class="display">What are we making?</h2>
      <p class="lede">Each type brings its own defaults: question cap, timing, difficulty context.</p></div>
      <div class="tiles">${tiles}</div>
      ${s.templates.length ? `<div class="templates"><span class="eyebrow">Templates</span>${s.templates.map((t, i) => `<button class="pill solid" data-tpl="${i}">${esc(t.name)}</button>`).join("")}</div>` : ""}
      ${s.subjects.length ? "" : `<div class="inline-error" style="margin-top:24px">${esc(s.name)} has no subject folder with a syllabus.json yet. Ask Claude to add one in chat.</div>`}`;
  }

  function vSubject() {
    const s = stu();
    const list = eligibleSubjects();
    if (!list.length) {
      return `<div class="head"><h2 class="display">No subjects for this paper type</h2></div>
        <div class="empty">${ICON.leaf}<div>${esc(s.name)} has no ${ptype().satOnly ? "SAT " : ""}subject with a syllabus. Ask Claude to add one in chat.</div></div>`;
    }
    const tiles = list.map((x, i) => {
      const units = x.units.filter((u) => !u.crossUnit);
      const taught = units.filter((u) => u.topics.some((t) => USABLE.has(t.status))).length;
      const hard = Prompt.hardItems(s, x.name, "all", today()).length;
      const meta = (s.profile && s.profile.subjects && s.profile.subjects[x.name]) || {};
      return `<button class="tile${S.req.subject === x.name ? " on" : ""}" data-subject="${esc(x.name)}" data-key="subj-${esc(x.name)}">
        <span class="num kbd" aria-hidden="true">${i + 1}</span>
        <span class="s">${esc(meta.course || (x.kind === "sat" ? x.master : x.label))}</span>
        <span class="t">${esc(x.name)}</span>
        <span class="s">${taught} of ${units.length} ${x.kind === "sat" ? "domains" : "units"} taught${hard ? ` · <span style="color:var(--hard)">${hard} hard</span>` : ""}</span>
        <span class="progressbar"><i style="width:${units.length ? Math.round(100 * taught / units.length) : 0}%"></i></span>
      </button>`;
    }).join("");
    return `<div class="head"><div class="eyebrow">${esc(s.name)} · ${esc(ptype().name)}</div><h2 class="display">Which subject?</h2>
      <p class="lede">Only subjects with a syllabus are listed.</p></div>
      <div class="tiles subjtiles">${tiles}</div>`;
  }

  function topicVisible(t, hardIds) {
    const q = S.search.trim().toLowerCase();
    if (q) {
      const hay = [t.title, t.code, t.schoolCode, ...t.skills].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    const selected = S.req.rows.some((r) => r.topic === t.id);
    if (S.filter === "all") return true;
    if (S.filter === "taught") return USABLE.has(t.status) || selected;
    return hardIds.has(t.id);
  }

  function vTopics() {
    const s = stu(), sb = subj(), t = ptype();
    const period = hardFilterPeriod();
    const hardList = Prompt.hardItems(s, sb.name, period || "all", today());
    const hardIds = new Set(hardList.map((h) => h.topic));
    const allHard = Prompt.hardItems(s, sb.name, "all", today());
    const issuesBy = new Map();
    for (const h of (period ? hardList : allHard)) { if (!issuesBy.has(h.topic)) issuesBy.set(h.topic, []); issuesBy.get(h.topic).push(h); }
    const selected = new Set(S.req.rows.map((r) => r.topic));
    const lastFor = lastPractisedMap(s, sb);

    let any = false;
    const units = sb.units.map((u) => {
      const vis = u.topics.filter((tp) => topicVisible(tp, hardIds));
      if (!vis.length) return "";
      any = true;
      const closed = S.closed.has(u.id) && !S.search && !period;
      const rows = vis.map((tp) => {
        const on = selected.has(tp.id);
        const issues = issuesBy.get(tp.id) || [];
        const last = tp.lastPractised || lastFor.get(tp.id);
        const isHard = allHard.some((h) => h.topic === tp.id);
        const code = tp.schoolCode || tp.code;
        return `<li><button class="trow${on ? " on" : ""}${USABLE.has(tp.status) ? "" : " notyet"}" data-topic="${esc(tp.id)}" data-key="t-${esc(tp.id)}" role="checkbox" aria-checked="${on}">
          <span class="box">${ICON.check}</span>
          <span style="min-width:0">
            <span class="tt">${code && !/[a-z]{2,}/.test(code) && code !== tp.title ? `<span class="code">${esc(code)}</span>` : ""}${esc(tp.title)}</span>
            <span class="sub">
              <span class="stat ${esc(tp.status)}">${esc(STATUS_LABEL[tp.status] || tp.status)}</span>
              ${isHard ? '<span class="stat hardtag">Hard</span>' : ""}
              ${last ? `<span>practised ${esc(ago(last))}</span>` : ""}
            </span>
            ${(period || S.filter === "hardall") ? issues.map((h) => `<span class="issue">${esc(h.issue)} <span style="color:var(--muted)">· ${esc(ago(h.flagged))}</span></span>`).join("") : ""}
          </span></button></li>`;
      }).join("");
      const ucode = u.schoolCode ? `${u.schoolCode} · course ${u.code}` : u.code !== u.title ? u.code : "";
      return `<div class="unit${closed ? " closed" : ""}${u.substance ? "" : " faded"}">
        <button class="unit-h" data-unit="${esc(u.id)}" data-key="u-${esc(u.id)}" aria-expanded="${!closed}">${ICON.chev}
          <span style="min-width:0"><span class="ut">${esc(u.schoolTitle || u.title)}</span>
          <span class="uc">${esc(ucode)}${u.crossUnit ? "Cross-unit skills" : ""}</span>
          ${u.id === sb.currentUnit ? '<span class="cur">· at school now</span>' : ""}</span>
        </button><ul class="tlist">${rows}</ul></div>`;
    }).join("");

    const emptyMsg = !sb.topics.size ? `No syllabus yet for ${esc(sb.name)}. Ask Claude to add one in chat.`
      : period || S.filter === "hardall" ? `No ${S.filter === "hardall" ? "unresolved" : "new"} hard topics flagged for ${esc(s.name)} in ${esc(sb.name)}${period === "week" ? " this week" : period === "2weeks" ? " in the last 2 weeks" : ""}.`
      : S.search ? "Nothing matches that search."
      : `Nothing marked taught yet in ${esc(sb.name)}. Switch to “All” to see upcoming topics.`;

    const recentMist = Prompt.recentMistakes(s, sb.name, today(), 14);
    const recentHard = Prompt.hardItems(s, sb.name, "2weeks", today());
    const canRetest = recentMist.size + recentHard.length > 0;
    const hardVisibleNotSelected = [...hardIds].filter((id) => sb.topics.has(id) && !selected.has(id)).length;

    const filters = [["all", "All"], ["taught", "Taught+"], ["week", "Hard this week"], ["2weeks", "Hard 2 weeks"], ["hardall", "Hard (all)"]];
    const sat = t.id === "sat" ? satPreset() : null;

    const rows = S.req.rows.map((r) => {
      const tp = sb.topics.get(r.topic);
      if (!tp) return "";
      const pd = parseDiff(r.diff) || { from: "MH", to: "MH" };
      const ramp = pd.from !== pd.to;
      const cur = ramp ? "ramp" : pd.from;
      const hardHere = allHard.filter((h) => h.topic === tp.id);
      const noteOpen = S.openNotes.has(tp.id) || (r.note && r.note.length);
      return `<div class="srow" data-row="${esc(tp.id)}" style="${S.justAdded.has(tp.id) ? "" : "animation:none"}">
        <div class="top">
          <div class="title">${esc(Prompt.topicLabel(tp))}${hardHere.length ? ' <span class="stat hardtag">Hard</span>' : ""}
            <small>${esc(tp.unit.crossUnit ? "Cross-unit skill" : tp.unit.schoolTitle || tp.unit.title)}</small></div>
          <button class="x" data-remove="${esc(tp.id)}" aria-label="Remove ${esc(tp.title)}">${ICON.x}</button>
        </div>
        <div class="ctl">
          <span class="stepper"><button data-dec="${esc(tp.id)}" aria-label="One fewer">−</button><input type="number" min="0" max="99" value="${Number(r.count) || 0}" data-count="${esc(tp.id)}" data-key="c-${esc(tp.id)}" aria-label="Questions for ${esc(tp.title)}"><button data-inc="${esc(tp.id)}" aria-label="One more">+</button></span>
          <span class="seg" role="radiogroup" aria-label="Difficulty">${[...DIFFS, "ramp"].map((d) => `<button data-diff="${d}" data-for="${esc(tp.id)}" class="${cur === d ? "on" : ""}" title="${d === "ramp" ? "Ramp" : DIFF_NAMES[d]}" role="radio" aria-checked="${cur === d}">${d === "ramp" ? "Ramp" : d}</button>`).join("")}</span>
          ${ramp ? `<span class="ramp"><select data-rampfrom="${esc(tp.id)}" aria-label="Ramp from">${DIFFS.map((d) => `<option ${d === pd.from ? "selected" : ""}>${d}</option>`).join("")}</select>→<select data-rampto="${esc(tp.id)}" aria-label="Ramp to">${DIFFS.map((d) => `<option ${d === pd.to ? "selected" : ""}>${d}</option>`).join("")}</select></span>` : ""}
          ${noteOpen ? "" : `<button class="notebtn" data-opennote="${esc(tp.id)}">+ note</button>`}
        </div>
        ${noteOpen ? `<input class="note" data-note="${esc(tp.id)}" data-key="n-${esc(tp.id)}" value="${esc(r.note)}" placeholder="e.g. word problems only">` : ""}
        ${r.retest && r.retest.length ? `<div class="retest">Re-test: ${r.retest.map(esc).join(" · ")} <button class="notebtn" data-clearretest="${esc(tp.id)}">clear</button></div>` : ""}
      </div>`;
    }).join("");

    return `<div class="head head-row">
        <div><div class="eyebrow">${esc(s.name)} · ${esc(t.name)} · ${esc(sb.name)}</div><h2 class="display">Choose topics</h2></div>
        ${sat ? `<span class="pill accent">${sat.name}: ${sat.total} Q · ${sat.minutes} min</span>` : ""}
      </div>
      <div class="topics">
        <section class="pane">
          <div class="pane-head">
            <div class="seg filters" role="tablist" aria-label="Filter topics">${filters.map(([k, l]) => `<button data-filter="${k}" class="${S.filter === k ? "on" : ""} ${k !== "all" && k !== "taught" ? "hardf" : ""}" role="tab" aria-selected="${S.filter === k}">${l}</button>`).join("")}</div>
            <div class="line">
              <input class="search" id="search" type="search" placeholder="Search topics and skills  /" value="${esc(S.search)}" aria-label="Search topics">
              ${(period || S.filter === "hardall") && hardVisibleNotSelected ? `<button class="btn small" id="selectAllHard">Select all (${hardVisibleNotSelected})</button>` : ""}
              ${canRetest ? `<button class="btn small ghost" id="retest" title="Pre-select topics with wrong answers or hard flags from the last 14 days">Re-test mistakes</button>` : ""}
            </div>
          </div>
          <div class="outline" id="outline">${any ? units : `<div class="empty">${ICON.leaf}<div>${emptyMsg}</div></div>`}</div>
        </section>
        <section class="pane">
          <div class="pane-head">
            <div class="line" style="justify-content:space-between"><span class="eyebrow">Selected · ${S.req.rows.length}</span>
              ${S.req.rows.length ? `<button class="linkbtn" id="clearAll">Clear</button>` : ""}</div>
            ${S.req.rows.length > 1 ? `<div class="bulk">
              <span>Set all to</span><input type="number" id="bulkCount" min="0" max="99" value="${ptype().perTopic}" aria-label="Questions per topic">
              <select class="mini-select" id="bulkDiff" aria-label="Difficulty for all">${DIFFS.map((d) => `<option value="${d}">${DIFF_NAMES[d]}</option>`).join("")}<option value="ramp">Ramp (student default)</option></select>
              <button class="btn small" id="bulkApply">Apply</button>
              <span style="margin-left:6px">or split</span><input type="number" id="splitN" min="1" max="99" value="${sat ? sat.total : total() || 10}" aria-label="Total to split">
              <button class="btn small" id="splitApply">Split</button>
            </div>` : ""}
          </div>
          <div class="sel">${rows || `<div class="empty">${ICON.leaf}<div>Tick topics on the left. Space selects, arrow keys move.</div></div>`}</div>
        </section>
      </div>`;
  }

  function lastPractisedMap(s, sb) {
    const m = new Map();
    for (const p of s.history) {
      if (p.subject !== sb.name || !p.date) continue;
      for (const id of p.topics || []) if (!m.has(id) || m.get(id) < p.date) m.set(id, p.date);
    }
    return m;
  }

  function vOptions() {
    const s = stu(), t = ptype(), sb = subj(), o = S.req.options;
    const fmts = t.id === "sat" ? (SAT_FORMATS[sb.master] || []) : [];
    const seg = (name, val, opts) => `<span class="seg" role="radiogroup">${opts.map(([v, l]) => `<button data-opt="${name}" data-val="${v}" class="${String(val) === String(v) ? "on" : ""}" role="radio" aria-checked="${String(val) === String(v)}">${l}</button>`).join("")}</span>`;
    const plan = Prompt.savePlan(s, sb, t, S.req, root());
    return `<div class="head"><div class="eyebrow">${esc(s.name)} · ${esc(t.name)} · ${esc(sb.name)}</div><h2 class="display">Options</h2>
      <p class="lede">Defaults come from the paper type and ${esc(s.name)}'s profile.</p></div>
      <div class="form">
        <div class="field"><label for="o-title">Title</label><input type="text" id="o-title" value="${esc(o.title)}" data-key="o-title"></div>
        <div class="savehint">Saves to ${esc(plan.folder)}</div>
        ${fmts.length > 1 ? `<div class="field"><span class="lab">SAT format</span>${seg("satFormat", S.req.satFormat, fmts.map((f) => [f.id, `${f.name} · ${f.total} Q`]))}</div>` : ""}
        ${t.partA ? `<div class="field"><span class="lab">Part A re-test</span><span class="inline"><button class="toggle" data-toggle="partA" role="switch" aria-checked="${!!o.partA}" aria-label="Part A re-test"></button><span class="lab">Start with a re-test of recent mistakes</span></span></div>` : ""}
        <div class="field"><span class="lab">Order</span>${seg("order", o.order, t.id === "sat" ? [["sat", "SAT order"], ["difficulty", "Easiest → hardest"]] : [["difficulty", "Easiest → hardest"], ["topic", "By topic"]])}</div>
        <div class="field"><span class="lab">Questions per page</span>${seg("qpp", o.qpp, [["auto", "Auto (2–3)"], ["2", "2"], ["3", "3"]])}</div>
        <div class="field"><label for="o-time">Time limit (min)</label><input type="number" id="o-time" min="0" max="240" placeholder="None" value="${esc(o.timeLimit)}" style="max-width:140px"></div>
        <div class="field"><span class="lab">Calculator</span><span class="inline"><button class="toggle" data-toggle="calculator" role="switch" aria-checked="${!!o.calculator}" aria-label="Calculator allowed"></button><span class="lab">${o.calculator ? "Allowed; keystrokes in solutions" : "Not allowed"}</span></span></div>
        <div class="field"><span class="lab">Paper</span>${seg("paper", o.paper, [["Letter", "US Letter"], ["A4", "A4"]])}</div>
        <div class="field"><label for="o-note">Note for the paper</label><textarea id="o-note" placeholder="e.g. include one ladder problem">${esc(o.note)}</textarea></div>
      </div>
      <div style="margin-top:28px;display:flex;gap:10px"><button class="btn" data-back>Back</button><button class="btn primary" data-next>Review prompt ${ICON.arrow}</button></div>`;
  }

  function vReview() {
    const s = stu(), t = ptype(), sb = subj(), o = S.req.options;
    const text = currentPrompt();
    const words = text.split(/\s+/).filter(Boolean).length;
    const plan = Prompt.savePlan(s, sb, t, S.req, root());
    const sv = S.saved;
    return `<div class="head"><div class="eyebrow">${esc(s.name)} · ${esc(t.name)} · ${esc(sb.name)}</div><h2 class="display">Review the prompt</h2>
      <p class="lede">Edit anything below, then copy it into your Claude project chat. Claude writes the paper and saves it to ${esc(s.name)}'s folder.</p></div>
      <div class="review">
        <div class="paper">
          <div class="bar"><span>${words} words · about ${Math.round(words * 1.4).toLocaleString()} tokens</span>
            ${S.promptEdited ? `<button class="linkbtn" id="rebuild" title="Discard your edits and rebuild from the settings">Edited · rebuild</button>` : "<span>Built from the folder just now</span>"}</div>
          <label class="sr" for="promptText">Prompt</label>
          <textarea id="promptText" spellcheck="false" data-key="prompt">${esc(text)}</textarea>
        </div>
        <aside class="side">
          <div class="sumcard">
            <div class="who"><span class="dot" style="background:${esc(color(s))}"></span>${esc(s.name)}</div>
            <dl>
              <dt>Paper</dt><dd>${esc(t.name)}</dd>
              <dt>Subject</dt><dd>${esc(sb.name)}</dd>
              <dt>Questions</dt><dd>${total()}</dd>
              <dt>Topics</dt><dd>${S.req.rows.length}</dd>
              <dt>Time</dt><dd>${o.timeLimit ? esc(o.timeLimit) + " min" : "none"}</dd>
              <dt>Calculator</dt><dd>${o.calculator ? "yes" : "no"}</dd>
            </dl>
            <div style="margin-top:12px;font-size:12px;color:var(--muted);word-break:break-word">${esc(plan.folder)}</div>
          </div>
          <button class="btn primary" id="copyLog">Copy prompt &amp; log it <span class="kbd">Ctrl ↵</span></button>
          <button class="btn" id="copyOnly">Copy only</button>
          ${sv ? (sv.written
            ? `<div class="saved">${ICON.drawn}<span>${sv.copied ? "Copied. " : ""}Saved to <b>prompt-log/${esc(sv.name)}</b>. ${sv.copied ? "Paste it into your Claude project." : "Press Ctrl+C to copy the selected prompt."}</span></div>`
            : `<div class="saved" style="background:var(--warn-bg);color:var(--warn)"><span>${sv.copied ? "Copied" : "Not copied"}, and not logged: ${esc(sv.error)}.</span></div><button class="btn small" id="dlLog">Download the log (.md)</button>`) : ""}
          <a class="btn ghost" href="https://claude.ai/new" target="_blank" rel="noopener">Open Claude ↗</a>
          <div class="tplsave"><input id="tplName" placeholder="Save as template…" aria-label="Template name" value=""><button class="btn small" id="tplSave">Save</button></div>
        </aside>
      </div>`;
  }

  function vHistory() {
    const s = stu();
    const subjects = [...new Set(s.history.map((p) => p.subject).filter(Boolean))];
    const f = S.histSubject;
    const logged = new Set(s.history.map((p) => p.prompt && p.prompt.split("/").pop()).filter(Boolean));
    const pending = s.prompts.filter((p) => !logged.has(p.name)).map((p) => ({
      pending: true, date: p.name.slice(0, 10), title: p.name.replace(/^\d{4}-\d{2}-\d{2} \d{4} /, "").replace(/\.md$/, ""),
      subject: p.request && p.request.subject, log: p
    }));
    const items = [...pending, ...s.history].filter((p) => f === "all" || p.subject === f)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.pending ? 1 : 0) - (a.pending ? 1 : 0));
    const label = (p, id) => {
      const sb = s.subjects.find((x) => x.name === p.subject);
      const tp = sb && sb.topics.get(id);
      return tp ? Prompt.topicLabel(tp) : id;
    };
    const list = items.map((p) => {
      if (p.pending) {
        return `<div class="tl pending"><div class="date">${esc(niceDate(p.date))} · prompt sent</div>
          <div class="tt">${esc(p.title)}</div>
          <div class="line"><span class="pill accent">Waiting for Claude to log the paper</span>${p.subject ? `<span class="pill">${esc(p.subject)}</span>` : ""}</div>
          <div class="acts"><button class="btn small" data-openpath="${esc(p.log.path)}">Prompt</button>${p.log.request ? `<button class="btn small" data-rerunlog="${esc(p.log.name)}">Re-run</button>` : ""}</div></div>`;
      }
      const idx = s.history.indexOf(p);
      const score = p.score && p.score.of ? `<span class="pill ${p.score.got / p.score.of >= .85 ? "ok" : "solid"}">${p.score.got}/${p.score.of}</span>` : `<span class="pill">${p.marked ? "Marked" : "Not yet marked"}</span>`;
      const wrong = (p.questions || []).filter((q) => q.correct === false).map((q) => `Q${q.n}${q.mistake ? " " + q.mistake : ""}`);
      const mist = wrong.length ? wrong : p.mistakes || [];
      return `<div class="tl"><div class="date">${esc(niceDate(p.date))} · ${esc(p.subject || "")}${p.total ? ` · ${p.total} Q` : ""}</div>
        <div class="tt">${esc(p.title)}${p.superseded ? ' <span class="pill">superseded</span>' : ""}</div>
        <div class="line"><span class="pill solid">${esc(p.type || "paper")}</span>${score}${(p.topics || []).map((id) => `<span class="pill">${esc(label(p, id))}</span>`).join("")}</div>
        ${mist.length ? `<div class="mist">Mistakes: ${mist.map(esc).join(" · ")}</div>` : ""}
        ${p.notes ? `<p class="note">${esc(p.notes)}</p>` : ""}
        <div class="acts">
          ${p.files && p.files.paper ? `<button class="btn small" data-openpath="${esc(p.files.paper)}">Paper PDF</button>` : ""}
          ${p.files && p.files.solutions ? `<button class="btn small" data-openpath="${esc(p.files.solutions)}">Solutions</button>` : ""}
          ${p.prompt ? `<button class="btn small" data-openpath="${esc(p.prompt)}">Prompt</button>` : ""}
          <button class="btn small ghost" data-rerun="${idx}">Re-run ${ICON.arrow}</button>
        </div></div>`;
    }).join("");
    return `<div class="head"><div class="eyebrow"><span class="dot" style="background:${esc(color(s))};margin-right:6px"></span>${esc(s.name)}</div>
      <h2 class="display">Paper history</h2>
      <p class="lede">From paper-history.json, newest first. Prompts sent from here show until Claude logs the paper.</p></div>
      ${subjects.length > 1 ? `<div class="seg filters histfilter">${[["all", "All"], ...subjects.map((x) => [x, x])].map(([k, l]) => `<button data-hist="${esc(k)}" class="${f === k ? "on" : ""}">${esc(l)}</button>`).join("")}</div>` : ""}
      ${items.length ? `<div class="timeline">${list}</div>` : `<div class="empty">${ICON.leaf}<div>No papers logged for ${esc(s.name)} yet.</div></div>`}`;
  }

  // ── Summary bar ─────────────────────────────────────────
  function renderSumbar() {
    const bar = $("#sumbar");
    const show = ["topics", "options", "review"].includes(S.view) && S.req && subj();
    bar.classList.toggle("show", !!show);
    if (!show) { bar.innerHTML = ""; return; }
    const s = stu(), t = ptype(), sb = subj();
    const n = total();
    const mix = { M: 0, MH: 0, H: 0, VH: 0 };
    for (const r of S.req.rows) { const sp = diffSpread(r.diff, Number(r.count) || 0); for (const k of DIFFS) mix[k] += sp[k]; }
    const qpp = S.req.options.qpp === "auto" ? 2.5 : Number(S.req.options.qpp);
    const pages = n ? Math.ceil(n / qpp) : 0;
    const cap = Prompt.capFor(s, sb.name, t, today());
    const sat = t.id === "sat" ? satPreset() : null;
    let warn = "";
    if (cap && n > cap) warn = `Over ${s.name}'s ${cap}-question cap for a ${t.name.toLowerCase()}`;
    else if (t.min && n && n < t.min) warn = `Short for a ${t.name.toLowerCase()} (usually ${t.min}–${t.max})`;
    else if (sat && n && n !== sat.total) warn = `${sat.name} is ${sat.total} questions`;
    const btn = S.view === "review"
      ? `<button class="btn primary" id="sbCopy">Copy prompt &amp; log <span class="kbd">Ctrl ↵</span></button>`
      : `<button class="btn primary" id="sbGen" ${S.req.rows.length && n ? "" : "disabled"}>Generate prompt <span class="kbd">Ctrl ↵</span></button>`;
    bar.innerHTML = `<div class="in">
      <span class="who"><span class="dot" style="background:${esc(color(s))}"></span>${esc(s.name)}</span>
      <div><div class="stat-n" id="sbTotal">${S.shownTotal}</div><div class="stat-l">questions</div></div>
      <div><div class="stat-n">${pages}</div><div class="stat-l">pages (est.)</div></div>
      <div class="mix" aria-label="Difficulty mix"><div class="bar">${DIFFS.map((d) => `<i style="width:${n ? (100 * mix[d] / n) : 0}%;background:var(--d-${d})" title="${DIFF_NAMES[d]}: ${mix[d]}"></i>`).join("")}</div>
        <div class="legend">${DIFFS.filter((d) => mix[d]).map((d) => `<span><b style="background:var(--d-${d})"></b>${d} ${mix[d]}</span>`).join("")}</div></div>
      ${warn ? `<span class="warnmsg">${esc(warn)}</span>` : ""}
      <span class="grow"></span>${btn}</div>`;
    tween(n);
    const g = $("#sbGen"); if (g) g.addEventListener("click", () => go("review"));
    const c = $("#sbCopy"); if (c) c.addEventListener("click", () => copyAndLog(true));
  }

  function tween(to) {
    const el = $("#sbTotal");
    const from = S.shownTotal;
    if (!el || from === to) { if (el) el.textContent = to; S.shownTotal = to; return; }
    const t0 = performance.now();
    cancelAnimationFrame(tween.raf);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 220);
      const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      const e = $("#sbTotal"); if (e) e.textContent = v;
      if (k < 1) tween.raf = requestAnimationFrame(step); else S.shownTotal = to;
    };
    S.shownTotal = to;
    tween.raf = requestAnimationFrame(step);
  }

  // ── Event binding per view ──────────────────────────────
  const bind = {
    connect(main) {
      $("#retry", main).addEventListener("click", boot);
    },
    home(main) {
      $$("[data-student]", main).forEach((b) => b.addEventListener("click", () => {
        S.student = b.dataset.student;
        prefs.set("lastStudent", S.student);
        if (!S.req || S.req.student !== S.student) S.req = null;
        go("type");
      }));
      $$("[data-quick]", main).forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); quickHard(b.dataset.quick); }));
      $$("[data-showerr]", main).forEach((b) => b.addEventListener("click", () => { const d = $("#errors"); if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth" }); } }));
    },
    type(main) {
      $$("[data-type]", main).forEach((b) => b.addEventListener("click", () => chooseType(b.dataset.type)));
      $$("[data-tpl]", main).forEach((b) => b.addEventListener("click", () => loadRequest(stu().templates[Number(b.dataset.tpl)].request, "topics")));
    },
    subject(main) {
      $$("[data-subject]", main).forEach((b) => b.addEventListener("click", () => { chooseSubject(b.dataset.subject); go("topics"); }));
    },
    topics(main) {
      $$("[data-filter]", main).forEach((b) => b.addEventListener("click", () => { S.filter = b.dataset.filter; render(); }));
      const search = $("#search", main);
      search.addEventListener("input", () => { S.search = search.value; renderOutlineOnly(); });
      $$("[data-unit]", main).forEach((b) => b.addEventListener("click", () => {
        const id = b.dataset.unit; S.closed.has(id) ? S.closed.delete(id) : S.closed.add(id); render();
      }));
      $$("[data-topic]", main).forEach((b) => {
        b.addEventListener("click", () => { toggleTopic(b.dataset.topic); render(); });
        b.addEventListener("keydown", outlineKeys);
      });
      const sa = $("#selectAllHard", main); if (sa) sa.addEventListener("click", () => { selectHard(hardFilterPeriod() || "all"); render(); });
      const rt = $("#retest", main); if (rt) rt.addEventListener("click", () => { retestMistakes(); render(); });
      const ca = $("#clearAll", main); if (ca) ca.addEventListener("click", () => { S.req.rows = []; S.req.fromHard = false; autoTitle(); render(); });
      const row = (id) => S.req.rows.find((r) => r.topic === id);
      $$("[data-remove]", main).forEach((b) => b.addEventListener("click", () => { toggleTopic(b.dataset.remove); render(); }));
      $$("[data-inc]", main).forEach((b) => b.addEventListener("click", () => { const r = row(b.dataset.inc); r.count = Math.min(99, (Number(r.count) || 0) + 1); render(); }));
      $$("[data-dec]", main).forEach((b) => b.addEventListener("click", () => { const r = row(b.dataset.dec); r.count = Math.max(0, (Number(r.count) || 0) - 1); render(); }));
      $$("[data-count]", main).forEach((i) => i.addEventListener("input", () => { row(i.dataset.count).count = Math.max(0, Math.min(99, parseInt(i.value, 10) || 0)); renderSumbar(); }));
      $$("[data-diff]", main).forEach((b) => b.addEventListener("click", () => {
        const r = row(b.dataset.for);
        if (b.dataset.diff === "ramp") {
          // Student's default ramp if there is one, else one step up from the default level.
          const d = parseDiff(defaultDiffFor());
          const i = Math.min(DIFFS.indexOf(d.from), DIFFS.length - 2);
          r.diff = d.from !== d.to ? `${d.from}>${d.to}` : `${DIFFS[i]}>${DIFFS[i + 1]}`;
        } else r.diff = b.dataset.diff;
        render();
      }));
      $$("[data-rampfrom]", main).forEach((sel) => sel.addEventListener("change", () => { const r = row(sel.dataset.rampfrom); r.diff = `${sel.value}>${parseDiff(r.diff).to}`; render(); }));
      $$("[data-rampto]", main).forEach((sel) => sel.addEventListener("change", () => { const r = row(sel.dataset.rampto); r.diff = `${parseDiff(r.diff).from}>${sel.value}`; render(); }));
      $$("[data-opennote]", main).forEach((b) => b.addEventListener("click", () => { S.openNotes.add(b.dataset.opennote); render(); const n = $(`[data-note="${CSS.escape(b.dataset.opennote)}"]`); if (n) n.focus(); }));
      $$("[data-note]", main).forEach((i) => i.addEventListener("input", () => { row(i.dataset.note).note = i.value; }));
      $$("[data-clearretest]", main).forEach((b) => b.addEventListener("click", () => { row(b.dataset.clearretest).retest = []; render(); }));
      const ba = $("#bulkApply", main);
      if (ba) ba.addEventListener("click", () => {
        const n = Math.max(0, Math.min(99, parseInt($("#bulkCount").value, 10) || 0));
        const d = $("#bulkDiff").value;
        for (const r of S.req.rows) { r.count = n; r.diff = d === "ramp" ? defaultDiffFor() : d; }
        render();
      });
      const sp = $("#splitApply", main);
      if (sp) sp.addEventListener("click", () => { splitTotal(parseInt($("#splitN").value, 10) || 0); render(); });
    },
    options(main) {
      const o = S.req.options;
      const title = $("#o-title", main);
      title.addEventListener("input", () => { o.title = title.value; o.titleEdited = true; });
      $$("[data-opt]", main).forEach((b) => b.addEventListener("click", () => {
        const k = b.dataset.opt, v = b.dataset.val;
        if (k === "satFormat") {
          S.req.satFormat = v;
          const f = satPreset(); if (f) o.timeLimit = f.minutes;
          S.req.rows = []; prefillSat(); o.titleEdited = false; autoTitle();
        } else {
          o[k] = v;
          if (k === "paper") prefs.set("paper", v);
        }
        render();
      }));
      $$("[data-toggle]", main).forEach((b) => b.addEventListener("click", () => { o[b.dataset.toggle] = !o[b.dataset.toggle]; render(); }));
      const tm = $("#o-time", main); tm.addEventListener("input", () => { o.timeLimit = tm.value ? Math.max(0, parseInt(tm.value, 10) || 0) : ""; });
      const nt = $("#o-note", main); nt.addEventListener("input", () => { o.note = nt.value; });
      $("[data-back]", main).addEventListener("click", prev);
      $("[data-next]", main).addEventListener("click", next);
    },
    review(main) {
      const ta = $("#promptText", main);
      ta.addEventListener("input", () => {
        S.promptText = ta.value;
        if (!S.promptEdited) { S.promptEdited = true; const bar = $(".paper .bar span:last-child", main); if (bar) bar.textContent = "Edited"; }
      });
      $("#copyLog", main).addEventListener("click", () => copyAndLog(true));
      $("#copyOnly", main).addEventListener("click", () => copyAndLog(false));
      const rb = $("#rebuild", main); if (rb) rb.addEventListener("click", () => { S.promptEdited = false; S.saved = null; render(); });
      const dl = $("#dlLog", main); if (dl) dl.addEventListener("click", downloadLog);
      const ts = $("#tplSave", main); ts.addEventListener("click", () => saveTemplate($("#tplName").value));
    },
    history(main) {
      $$("[data-hist]", main).forEach((b) => b.addEventListener("click", () => { S.histSubject = b.dataset.hist; render(); }));
      $$("[data-openpath]", main).forEach((b) => b.addEventListener("click", () => openFile(b.dataset.openpath)));
      $$("[data-rerun]", main).forEach((b) => b.addEventListener("click", () => rerunPaper(stu().history[Number(b.dataset.rerun)])));
      $$("[data-rerunlog]", main).forEach((b) => b.addEventListener("click", () => {
        const log = stu().prompts.find((p) => p.name === b.dataset.rerunlog);
        if (log && log.request) loadRequest(log.request, "review");
      }));
    }
  };

  // Search re-renders only the outline so the search box keeps focus and caret.
  function renderOutlineOnly() {
    const pos = $("#search").selectionStart;
    render();
    const s = $("#search");
    s.focus();
    try { s.setSelectionRange(pos, pos); } catch (_) { /* type=search may refuse */ }
  }

  function chooseType(id) {
    const t = PAPER_TYPES.find((x) => x.id === id);
    if (!t || (t.satOnly && !stu().subjects.some((x) => x.kind === "sat"))) return;
    startReq(id);
    S.promptEdited = false;
    const list = eligibleSubjects();
    if (S.req.subject) { applySubjectDefaults(true); if (id === "sat" && !S.req.rows.length) prefillSat(); go("topics"); }
    else if (list.length === 1) { chooseSubject(list[0].name); go("topics"); }
    else go("subject");
  }

  function outlineKeys(e) {
    const rows = $$("[data-topic]");
    const i = rows.indexOf(e.currentTarget);
    if (e.key === "ArrowDown") { e.preventDefault(); (rows[i + 1] || rows[i]).focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); (rows[i - 1] || rows[i]).focus(); }
    else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); next(); }
    else if (/^[0-9]$/.test(e.key)) {
      const r = S.req.rows.find((x) => x.topic === e.currentTarget.dataset.topic);
      if (r) { e.preventDefault(); r.count = e.key === "0" ? 10 : Number(e.key); render(); }
    }
  }

  // ── Global keys ─────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "textarea" || tag === "select";
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (S.view === "review") copyAndLog(true);
      else if ((S.view === "topics" || S.view === "options") && canReach("review") && total() > 0) go("review");
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "C" || e.key === "c") && S.view === "review") { e.preventDefault(); copyAndLog(true); return; }
    if (e.key === "Escape") {
      if (typing) { e.target.blur(); return; }
      if (S.view !== "home" && S.view !== "connect") { e.preventDefault(); prev(); }
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "/" && S.view === "topics") { e.preventDefault(); $("#search").focus(); return; }
    if (/^[1-9]$/.test(e.key)) {
      const n = Number(e.key) - 1;
      if (S.view === "home") { const b = $$("[data-student]")[n]; if (b) { e.preventDefault(); b.click(); } }
      else if (S.view === "type") { const t = PAPER_TYPES[n]; if (t) { e.preventDefault(); chooseType(t.id); } }
      else if (S.view === "subject") { const b = $$("[data-subject]")[n]; if (b) { e.preventDefault(); b.click(); } }
      else if (S.view === "topics") {
        const row = e.target.closest && e.target.closest("[data-row]");
        if (row) { const r = S.req.rows.find((x) => x.topic === row.dataset.row); if (r) { r.count = Number(e.key); render(); } }
      }
      return;
    }
    if (e.key === "Enter" && tag !== "button" && tag !== "a" && ["topics", "options"].includes(S.view)) { e.preventDefault(); next(); }
  });

  // ── Boot ────────────────────────────────────────────────
  // No folder picking: the local server already knows where the Students folder is.
  async function boot() {
    applyTheme();
    try {
      const src = await Folder.httpSource();
      if (src.exists) { await openSource(src); return; }
      S.src = src;
    } catch (_) { S.src = null; }
    S.data = null;
    S.view = "connect";
    render();
  }

  // Debug hook: load an in-memory folder, e.g. WB.openMemory({ "Harika/student.json": "{…}" }).
  window.WB = { openMemory: (map) => openSource(Folder.memorySource(map)), state: S };

  boot();
})();
