// UI controller: view routing, the New Paper topic picker, the generation
// pipeline, the Ready screen, and the Question Bank manager. All state is
// in-memory + IndexedDB (js/db.js) — there is no server.

const LOW_SUBTOPIC_THRESHOLD = 15; // dashboard "running low" cutoff, tune as the bank grows
const HEALTH_BAR_MAX = 100; // count that reads as a "full" bar on the dashboard

let selectionState = null;
let lastResult = null; // { paperBlob, keyBlob, keyName, paperName, paperPages, keyPages, paper }

// ---------- View routing ----------

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${name}`).classList.add("active");
  document.querySelectorAll(".navitem").forEach((n) => n.classList.toggle("active", n.dataset.view === name));
  if (name === "dashboard") renderDashboard();
  if (name === "new" && !selectionState) initSelectionState();
  if (name === "new") renderTopics();
  if (name === "bank") renderBank();
}

document.querySelectorAll(".navitem[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});
document.querySelectorAll("[data-goto]").forEach((el) => {
  el.addEventListener("click", (e) => { e.preventDefault(); showView(el.dataset.goto); });
});

// ---------- Dashboard ----------

async function renderDashboard() {
  const [papers, questions] = await Promise.all([PapersDB.all(), QuestionsDB.all()]);

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const papersThisWeek = papers.filter((p) => new Date(p.createdAt).getTime() >= weekAgo).length;
  document.getElementById("stat-papers-week").textContent = papersThisWeek;
  document.getElementById("stat-bank-size").textContent = questions.length.toLocaleString();

  const counts = subtopicCounts(questions);
  const low = counts.filter((c) => c.count < LOW_SUBTOPIC_THRESHOLD);
  document.getElementById("stat-low-topics").textContent = low.length;

  const listEl = document.getElementById("recent-papers-list");
  listEl.innerHTML = "";
  if (papers.length === 0) {
    listEl.innerHTML = `<div class="empty">No papers generated yet. <a href="#" data-goto="new">Generate your first one</a>.</div>`;
    listEl.querySelector("[data-goto]").addEventListener("click", (e) => { e.preventDefault(); showView("new"); });
  } else {
    for (const p of papers.slice(0, 8)) {
      const row = document.createElement("div");
      row.className = "table-row";
      const sections = p.sections.map((s) => `<span class="pill">${s}</span>`).join("");
      const when = new Date(p.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      row.innerHTML = `
        <span class="pname">${p.name}</span>
        <span>${sections}</span>
        <span class="muted">${p.questionCount} Q</span>
        <span class="muted">${when}</span>
        <span></span>`;
      listEl.appendChild(row);
    }
  }

  const healthEl = document.getElementById("bank-health-list");
  healthEl.innerHTML = "";
  const thinnest = [...counts].sort((a, b) => a.count - b.count).slice(0, 3);
  if (thinnest.length === 0) {
    healthEl.innerHTML = `<div class="empty">Import questions to see bank health.</div>`;
  }
  for (const c of thinnest) {
    const pct = Math.min(100, Math.round((c.count / HEALTH_BAR_MAX) * 100));
    const color = c.count < LOW_SUBTOPIC_THRESHOLD ? "var(--warn)" : "var(--accent)";
    const item = document.createElement("div");
    item.className = "bank-health-item";
    item.innerHTML = `
      <div class="bank-health-row"><span>${c.subtopic}</span><span class="bank-health-num" style="color:${color}">${c.count}</span></div>
      <div class="bank-health-bar"><div class="bank-health-fill" style="width:${pct}%; background:${color}"></div></div>`;
    healthEl.appendChild(item);
  }
}

function subtopicCounts(questions) {
  const result = [];
  for (const subject of Object.keys(SYLLABUS)) {
    for (const domain of Object.keys(SYLLABUS[subject].domains)) {
      for (const subtopic of SYLLABUS[subject].domains[domain].subtopics) {
        const count = questions.filter((q) => q.subject === subject && q.domain === domain && q.subtopic === subtopic).length;
        result.push({ subject, domain, subtopic, count });
      }
    }
  }
  return result;
}

// ---------- New Paper ----------

function initSelectionState() {
  selectionState = {};
  for (const subject of Object.keys(SYLLABUS)) {
    const domains = {};
    for (const domain of Object.keys(SYLLABUS[subject].domains)) {
      const subtopics = {};
      for (const st of SYLLABUS[subject].domains[domain].subtopics) subtopics[st] = true;
      domains[domain] = { included: true, min: 1, max: 10, subtopics, open: false };
    }
    selectionState[subject] = { included: true, defaultMin: 1, defaultMax: 10, domains };
  }
}

function domainCheckState(domain) {
  const vals = Object.values(domain.subtopics);
  const onCount = vals.filter(Boolean).length;
  if (onCount === 0) return "off";
  if (onCount === vals.length) return "on";
  return "mixed";
}

function renderCheckbox(state, small) {
  const cls = small ? "checkbox-sm" : "checkbox";
  const on = state === "on" || state === "mixed";
  const bg = state === "mixed" ? "background:var(--ink-faint);border-color:var(--ink-faint);" : "";
  const check = state === "on"
    ? `<svg width="${small ? 10 : 12}" height="${small ? 10 : 12}" viewBox="0 0 24 24" fill="none" stroke="#06211f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"></path></svg>`
    : "";
  return `<div class="${cls} ${on ? "on" : ""}" style="${bg}">${check}</div>`;
}

function renderTopics() {
  const col = document.getElementById("topics-col");
  col.innerHTML = "";

  const defaultsBar = document.createElement("div");
  defaultsBar.className = "panel";
  defaultsBar.style.flexDirection = "row";
  defaultsBar.style.alignItems = "center";
  defaultsBar.style.gap = "14px";
  defaultsBar.style.padding = "14px 18px";
  defaultsBar.innerHTML = `
    <span style="font-size:13px; font-weight:600;">Default difficulty for all topics</span>
    <input type="number" min="1" max="10" value="1" id="default-min" style="width:48px;">
    <span class="muted">to</span>
    <input type="number" min="1" max="10" value="10" id="default-max" style="width:48px;">
    <button class="btn btn-ghost btn-sm" id="apply-default-diff">Apply to all</button>`;
  col.appendChild(defaultsBar);
  defaultsBar.querySelector("#apply-default-diff").addEventListener("click", () => {
    const min = clampDiff(defaultsBar.querySelector("#default-min").value, 1);
    const max = clampDiff(defaultsBar.querySelector("#default-max").value, 10);
    for (const subject of Object.keys(selectionState)) {
      for (const domain of Object.values(selectionState[subject].domains)) {
        domain.min = min;
        domain.max = max;
      }
    }
    renderTopics();
  });

  for (const subject of ["Math", "English"]) {
    col.appendChild(renderSubjectBlock(subject));
  }

  updateSummary();
}

function clampDiff(v, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(1, Math.min(10, n));
}

function renderSubjectBlock(subject) {
  const def = SYLLABUS[subject];
  const state = selectionState[subject];
  const block = document.createElement("div");
  block.className = "subject-block";

  const icon = subject === "Math"
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17c3-1 4-9 7-9s3 8 6 8"></path></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5.5c2.5-1.2 5-1.2 8 0v13c-3-1.2-5.5-1.2-8 0v-13z"></path><path d="M20 5.5c-2.5-1.2-5-1.2-8 0v13c3-1.2 5.5-1.2 8 0v-13z"></path></svg>`;

  const head = document.createElement("div");
  head.className = "subject-head";
  head.innerHTML = `${icon}<span class="name">${subject === "Math" ? "Math" : "English"}</span><span class="meta">${def.total} questions &middot; fixed section length</span>`;
  block.appendChild(head);

  for (const domainName of Object.keys(def.domains)) {
    block.appendChild(renderDomainRow(subject, domainName));
  }

  return block;
}

function renderDomainRow(subject, domainName) {
  const domainDef = SYLLABUS[subject].domains[domainName];
  const domain = selectionState[subject].domains[domainName];
  const wrap = document.createElement("div");
  wrap.className = `domain ${domain.open ? "open" : "collapsed"}`;

  const state = domainCheckState(domain);
  const row = document.createElement("div");
  row.className = "domain-row";
  row.innerHTML = `
    <span class="dcheck">${renderCheckbox(state, false)}</span>
    <div class="info"><span class="dname">${domainName}</span><span class="dcount">${domainDef.subtopics.length} subtopics</span></div>
    <div class="diff-controls">
      <input type="number" min="1" max="10" value="${domain.min}" class="domain-min">
      <span>&ndash;</span>
      <input type="number" min="1" max="10" value="${domain.max}" class="domain-max">
    </div>
    <svg class="chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>`;
  wrap.appendChild(row);

  row.querySelector(".dcheck").addEventListener("click", (e) => {
    e.stopPropagation();
    const turnOn = domainCheckState(domain) !== "on";
    for (const st of Object.keys(domain.subtopics)) domain.subtopics[st] = turnOn;
    domain.included = turnOn;
    renderTopics();
  });
  row.querySelectorAll(".domain-min, .domain-max").forEach((inp) => {
    inp.addEventListener("click", (e) => e.stopPropagation());
    inp.addEventListener("change", () => {
      domain.min = clampDiff(row.querySelector(".domain-min").value, domain.min);
      domain.max = clampDiff(row.querySelector(".domain-max").value, domain.max);
      if (domain.min > domain.max) [domain.min, domain.max] = [domain.max, domain.min];
      updateSummary();
    });
  });
  row.addEventListener("click", (e) => {
    if (e.target.closest(".diff-controls") || e.target.closest(".dcheck")) return;
    domain.open = !domain.open;
    renderTopics();
  });

  const subEl = document.createElement("div");
  subEl.className = "subtopics";
  for (const st of domainDef.subtopics) {
    const on = domain.subtopics[st];
    const row2 = document.createElement("div");
    row2.className = `subtopic-row ${on ? "" : "off"}`;
    row2.innerHTML = `${renderCheckbox(on ? "on" : "off", true)}<span>${st}</span>`;
    row2.addEventListener("click", () => {
      domain.subtopics[st] = !domain.subtopics[st];
      domain.included = Object.values(domain.subtopics).some(Boolean);
      renderTopics();
    });
    subEl.appendChild(row2);
  }
  wrap.appendChild(subEl);

  return wrap;
}

function currentSelectionForBuild() {
  return {
    math: { included: true, defaultMin: 1, defaultMax: 10, domains: selectionState.Math.domains },
    english: { included: true, defaultMin: 1, defaultMax: 10, domains: selectionState.English.domains }
  };
}

async function updateSummary() {
  const sel = currentSelectionForBuild();
  const body = document.getElementById("summary-body");
  body.innerHTML = "";
  let grandTotal = 0;
  const allSlots = [];

  for (const [subject, key] of [["Math", "math"], ["English", "english"]]) {
    const slots = planSection(subject, sel[key].domains, 1, 10);
    allSlots.push(...slots);
    const subjectTotal = slots.reduce((s, x) => s + x.count, 0);
    grandTotal += subjectTotal;

    const byDomain = {};
    for (const s of slots) byDomain[s.domain] = (byDomain[s.domain] || 0) + s.count;

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="summary-subject"><span class="sname">${subject}</span><span class="stotal">${subjectTotal}</span></div>
      <div style="display:flex; flex-direction:column; gap:5px; padding-left:2px; margin-top:6px;">
        ${Object.entries(byDomain).map(([d, c]) => `<div class="summary-sub-row"><span>${d}</span><span>${c}</span></div>`).join("")}
      </div>`;
    body.appendChild(wrap);
    if (subject === "Math") { const div = document.createElement("div"); div.className = "summary-divider"; body.appendChild(div); }
  }

  document.getElementById("summary-total").textContent = grandTotal;

  const genBtn = document.getElementById("btn-generate");
  const hint = document.getElementById("summary-hint");
  if (grandTotal === 0) {
    genBtn.disabled = true;
    hint.className = "summary-hint";
    hint.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1fc8bd" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M8 12.5l2.5 2.5L16 9.5"></path></svg><span>Select at least one subtopic to begin.</span>`;
    return;
  }

  let deficits = [];
  for (const slot of allSlots) {
    const pool = await QuestionsDB.byPool(slot.subject, slot.domain, slot.subtopic, slot.min, slot.max);
    if (pool.length < slot.count) deficits.push({ ...slot, available: pool.length });
  }

  if (deficits.length > 0) {
    genBtn.disabled = false;
    hint.className = "summary-hint err";
    hint.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e2695f" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="8" x2="12" y2="13"></line><circle cx="12" cy="16" r="0.6" fill="#e2695f"></circle></svg><span>${deficits.length} subtopic(s) are short on questions — generation will fail fast and name them.</span>`;
  } else {
    genBtn.disabled = false;
    hint.className = "summary-hint";
    hint.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1fc8bd" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M8 12.5l2.5 2.5L16 9.5"></path></svg><span>Bank coverage looks sufficient for this mix.</span>`;
  }
}

document.getElementById("btn-generate").addEventListener("click", () => startGeneration());

// ---------- Generation pipeline ----------

const GEN_STEPS = [
  { key: "select", label: "Selecting questions", weight: 0.30 },
  { key: "images", label: "Rendering question images", weight: 0.10 },
  { key: "layout", label: "Laying out pages", weight: 0.40 },
  { key: "key", label: "Building answer key", weight: 0.15 },
  { key: "finalize", label: "Finalizing PDF", weight: 0.05 }
];

let genStepEls = {};

function renderGenSteps() {
  const el = document.getElementById("gen-steps");
  el.innerHTML = "";
  genStepEls = {};
  for (const step of GEN_STEPS) {
    const row = document.createElement("div");
    row.className = "gen-step pending";
    row.innerHTML = `
      <svg class="ico" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#3a3f45" stroke-width="1.75"><circle cx="12" cy="12" r="9"></circle></svg>
      <span class="label">${step.label}</span>
      <span class="count">&mdash;</span>`;
    el.appendChild(row);
    genStepEls[step.key] = row;
  }
}

function setStepState(key, state, countText) {
  const row = genStepEls[key];
  row.className = `gen-step ${state}`;
  row.querySelector(".count").textContent = countText;
  const ico = row.querySelector(".ico");
  if (state === "done") {
    ico.outerHTML = `<svg class="ico" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#1fc8bd" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" fill="#1fc8bd" stroke="none"></circle><path d="M8 12.5l2.5 2.5L16 9.5" stroke="#06211f" stroke-width="2"></path></svg>`;
  } else if (state === "active") {
    ico.outerHTML = `<svg class="ico" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#1fc8bd" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9" stroke-dasharray="34 12"></circle></svg>`;
  }
}

let stepFraction = {};

function updateOverall() {
  const overall = GEN_STEPS.reduce((s, st) => s + st.weight * (stepFraction[st.key] || 0), 0);
  const pct = Math.round(overall * 100);
  document.getElementById("gen-overall-pct").textContent = `${pct}%`;
  document.getElementById("gen-overall-fill").style.width = `${pct}%`;
}

function stepProgress(key, done, total) {
  stepFraction[key] = total > 0 ? done / total : (total === 0 ? 1 : 0);
  setStepState(key, stepFraction[key] >= 1 ? "done" : "active", total === 0 ? "0/0" : `${done}/${total}`);
  updateOverall();
}

async function startGeneration() {
  const paperName = timestampedName();
  showView("generating");
  renderGenSteps();
  stepFraction = {};
  updateOverall();
  document.getElementById("gen-paper-name").textContent = paperName;
  document.getElementById("gen-error").style.display = "none";
  document.getElementById("gen-error-actions").style.display = "none";
  document.getElementById("gen-note").style.display = "block";

  try {
    const sel = currentSelectionForBuild();

    setStepState("select", "active", "0/—");
    const paper = await buildPaper(sel, (done, total) => stepProgress("select", done, total));
    stepProgress("select", paper.all.length, paper.all.length);

    setStepState("images", "active", "0/0");
    await prepareImages(paper.all, (done, total) => stepProgress("images", done, total));

    setStepState("layout", "active", "0/—");
    const paperPdf = await buildQuestionPaperPdf(paper, paperName, (done, total) => stepProgress("layout", done, total));

    setStepState("key", "active", "0/—");
    const keyPdf = await buildAnswerKeyPdf(paper, paperName, (done, total) => stepProgress("key", done, total));

    setStepState("finalize", "active", "…");
    const paperBlob = paperPdf.doc.output("blob");
    const keyBlob = keyPdf.doc.output("blob");
    await QuestionsDB.incrementUsage(paper.all.map((q) => q.id));

    const record = {
      id: paperName,
      name: paperName,
      createdAt: new Date().toISOString(),
      sections: [paper.Math.length > 0 ? "Math" : null, paper.English.length > 0 ? "English" : null].filter(Boolean),
      questionCount: paper.all.length,
      breakdown: breakdownBySubjectDomain(paper)
    };
    await PapersDB.add(record);
    stepFraction.finalize = 1;
    setStepState("finalize", "done", "");
    updateOverall();

    downloadBlob(paperBlob, `${paperName}.pdf`);
    downloadBlob(keyBlob, `${paperName}_AnswerKey.pdf`);

    lastResult = {
      paperBlob, keyBlob, paperName,
      paperPages: paperPdf.pages, keyPages: keyPdf.pages,
      questionCount: paper.all.length,
      breakdown: record.breakdown
    };
    showReady();
  } catch (err) {
    console.error(err);
    document.getElementById("gen-note").style.display = "none";
    document.getElementById("gen-error").style.display = "block";
    document.getElementById("gen-error").textContent = err.message || String(err);
    document.getElementById("gen-error-actions").style.display = "block";
  }
}

function breakdownBySubjectDomain(paper) {
  const out = {};
  for (const [subject, list] of [["Math", paper.Math], ["English", paper.English]]) {
    if (list.length === 0) continue;
    out[subject] = {};
    for (const q of list) out[subject][q.domain] = (out[subject][q.domain] || 0) + 1;
  }
  return out;
}

function showReady() {
  showView("ready");
  document.getElementById("ready-filename").textContent = `${lastResult.paperName}.pdf`;
  document.getElementById("ready-paper-meta").textContent = `${lastResult.questionCount} questions · ${lastResult.paperPages} pages`;
  document.getElementById("ready-key-meta").textContent = `${lastResult.questionCount} answers · ${lastResult.keyPages} pages`;

  const summaryEl = document.getElementById("ready-summary");
  summaryEl.innerHTML = "";
  for (const subject of Object.keys(lastResult.breakdown)) {
    const total = Object.values(lastResult.breakdown[subject]).reduce((a, b) => a + b, 0);
    const col = document.createElement("div");
    col.className = "col";
    col.innerHTML = `
      <div class="summary-subject"><span class="sname">${subject}</span><span class="stotal">${total}</span></div>
      ${Object.entries(lastResult.breakdown[subject]).map(([d, c]) => `<div class="summary-sub-row"><span>${d}</span><span>${c}</span></div>`).join("")}`;
    summaryEl.appendChild(col);
  }
}

document.getElementById("btn-download-paper").addEventListener("click", () => {
  if (lastResult) downloadBlob(lastResult.paperBlob, `${lastResult.paperName}.pdf`);
});
document.getElementById("btn-download-key").addEventListener("click", () => {
  if (lastResult) downloadBlob(lastResult.keyBlob, `${lastResult.paperName}_AnswerKey.pdf`);
});

// ---------- Question Bank ----------

async function renderBank() {
  const questions = await QuestionsDB.all();
  const domainSel = document.getElementById("filter-domain");
  const subjectVal = document.getElementById("filter-subject").value;
  const domains = subjectVal ? domainsForSubject(subjectVal) : [...domainsForSubject("Math"), ...domainsForSubject("English")];
  const currentDomain = domainSel.value;
  domainSel.innerHTML = `<option value="">All domains</option>` + domains.map((d) => `<option ${d === currentDomain ? "selected" : ""}>${d}</option>`).join("");

  const batchSel = document.getElementById("filter-batch");
  const currentBatch = batchSel.value;
  const batchCounts = {};
  for (const q of questions) batchCounts[q.sourceBatch] = (batchCounts[q.sourceBatch] || 0) + 1;
  const batches = Object.keys(batchCounts).sort();
  batchSel.innerHTML = `<option value="">Delete batch…</option>` + batches.map((b) => `<option ${b === currentBatch ? "selected" : ""} value="${b}">${b} (${batchCounts[b]})</option>`).join("");
  document.getElementById("btn-delete-batch").disabled = !batchSel.value;

  const search = document.getElementById("filter-search").value.trim().toLowerCase();
  const domainVal = domainSel.value;

  const filtered = questions.filter((q) => {
    if (subjectVal && q.subject !== subjectVal) return false;
    if (domainVal && q.domain !== domainVal) return false;
    if (search && !q.questionText.toLowerCase().includes(search)) return false;
    return true;
  });

  document.getElementById("bank-count-hint").textContent = `${filtered.length} of ${questions.length} questions`;

  const body = document.getElementById("bank-table-body");
  body.innerHTML = "";
  if (filtered.length === 0) {
    body.innerHTML = `<tr><td colspan="9" class="empty">No questions match. Import a batch to get started.</td></tr>`;
    return;
  }
  for (const q of filtered.slice(0, 500)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="muted">${q.shortCode}</td>
      <td>${q.subject} &middot; ${q.domain}</td>
      <td class="muted">${q.subtopic}</td>
      <td><span class="diff-chip">${q.difficulty}</span></td>
      <td><span class="type-chip">${q.type}</span></td>
      <td><div class="qtext-preview" title="${q.questionText.replace(/"/g, "&quot;")}">${q.questionText}</div></td>
      <td class="muted">${q.usageCount || 0}</td>
      <td class="muted">${q.sourceBatch}</td>
      <td><button class="icon-btn" title="Delete question" data-id="${q.id}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M9 7V4h6v3"></path><path d="M6 7l1 13h10l1-13"></path></svg>
      </button></td>`;
    body.appendChild(tr);
  }
  body.querySelectorAll(".icon-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this question from the bank?")) return;
      await QuestionsDB.deleteById(btn.dataset.id);
      renderBank();
    });
  });
}

document.getElementById("filter-subject").addEventListener("change", renderBank);
document.getElementById("filter-domain").addEventListener("change", renderBank);
document.getElementById("filter-search").addEventListener("input", debounce(renderBank, 200));
document.getElementById("filter-batch").addEventListener("change", (e) => {
  document.getElementById("btn-delete-batch").disabled = !e.target.value;
});
document.getElementById("btn-delete-batch").addEventListener("click", async () => {
  const batch = document.getElementById("filter-batch").value;
  if (!batch) return;
  if (!confirm(`Delete every question tagged "${batch}" from the bank? This can't be undone — export a backup first if unsure.`)) return;
  const removed = await QuestionsDB.deleteBatch(batch);
  renderBank();
  renderDashboard();
  alert(`Deleted ${removed} question(s) tagged "${batch}".`);
});

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

document.getElementById("btn-export-bank").addEventListener("click", async () => {
  const questions = await QuestionsDB.all();
  const blob = new Blob([JSON.stringify(questions, null, 2)], { type: "application/json" });
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  downloadBlob(blob, `papergen-bank-backup_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`);
});

// ---------- Import modal ----------

const importModal = document.getElementById("import-modal");
document.getElementById("btn-open-import").addEventListener("click", () => {
  importModal.classList.remove("hidden");
  document.getElementById("import-result").style.display = "none";
});
document.getElementById("btn-close-import").addEventListener("click", () => importModal.classList.add("hidden"));

document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById("import-textarea").value = await file.text();
});

document.getElementById("btn-run-import").addEventListener("click", async () => {
  const raw = document.getElementById("import-textarea").value;
  const tag = document.getElementById("import-batch-tag").value.trim() || undefined;
  const resultEl = document.getElementById("import-result");
  resultEl.style.display = "block";
  resultEl.className = "import-result";
  resultEl.textContent = "Validating…";

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    resultEl.className = "import-result err";
    resultEl.textContent = `Invalid JSON: ${e.message}`;
    return;
  }

  try {
    const { imported } = await importBatch(parsed, tag, (done, total) => {
      resultEl.textContent = `Importing… ${done}/${total}`;
    });
    resultEl.className = "import-result ok";
    resultEl.textContent = `Imported ${imported} question(s) successfully.`;
    renderBank();
    renderDashboard();
  } catch (e) {
    resultEl.className = "import-result err";
    if (e.name === "ImportValidationError") {
      resultEl.textContent = `Import rejected — nothing was written. ${e.errors.length} error(s):\n${e.errors.join("\n")}`;
    } else {
      resultEl.textContent = `Import failed: ${e.message}`;
    }
  }
});

// ---------- Init ----------

renderDashboard();
