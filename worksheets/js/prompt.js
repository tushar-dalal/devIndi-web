// Turns a paper request into the prompt Claude writes the paper from.
// Everything here reads only the ACTIVE student's records: the one
// student object passed in. Nothing is shared across students.

const Prompt = (() => {

  const HISTORY_PER_TOPIC = 5;
  const HISTORY_MAX_LINES = 60;
  // Swapped for the real prompt-log path when the prompt is copied and logged.
  const LOG_PLACEHOLDER = "<this prompt's prompt-log file>";

  function todayISO(d) {
    const x = d || new Date();
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  }
  function daysAgo(iso, today) {
    return Math.round((Date.parse(today) - Date.parse(iso)) / 86400000);
  }

  // Rules that apply to this subject today (temporary rules drop off after "until").
  function activeRules(student, subjectName, today) {
    const rules = (student.profile && student.profile.rules) || [];
    return rules.filter((r) => r && r.text
      && (!r.subject || r.subject === subjectName)
      && (!r.until || r.until >= today));
  }

  function difficultyMap(student, subjectName) {
    const d = (student.profile && student.profile.difficulty) || {};
    return Object.assign({}, d.default || {}, d[subjectName] || {});
  }

  function defaultDiff(student, subjectName, context) {
    const code = difficultyMap(student, subjectName)[context];
    const p = parseDiff(code);
    if (!p) return "MH";
    return p.from === p.to ? p.from : `${p.from}>${p.to}`;
  }

  function capFor(student, subjectName, type, today) {
    let cap = type.max || null;
    for (const r of activeRules(student, subjectName, today)) {
      if (r.type === "cap" && Number(r.max) > 0 && type.id !== "sat") cap = cap ? Math.min(cap, Number(r.max)) : Number(r.max);
    }
    return cap;
  }

  function calculatorDefault(student, subjectName, today) {
    return activeRules(student, subjectName, today).some((r) => r.type === "tool" && r.calculator === true);
  }

  // period: "week" | "2weeks" | "all"  (all = every unresolved item)
  function hardItems(student, subjectName, period, today) {
    const lim = period === "week" ? 7 : period === "2weeks" ? 14 : Infinity;
    return student.hard.filter((h) => !h.resolved
      && (!subjectName || h.subject === subjectName)
      && (lim === Infinity || (h.flagged && daysAgo(h.flagged, today) < lim)));
  }

  // Wrong answers on papers from the last `days` days, grouped by topic.
  function recentMistakes(student, subjectName, today, days) {
    const out = new Map();
    for (const p of student.history) {
      if (p.subject !== subjectName || !p.date || daysAgo(p.date, today) > (days || 14)) continue;
      for (const q of p.questions || []) {
        if (q.correct === false && q.topic) {
          if (!out.has(q.topic)) out.set(q.topic, []);
          out.get(q.topic).push(`${p.title} Q${q.n}${q.mistake ? ": " + q.mistake : ""}`);
        }
      }
      // Back-filled papers only have paper-level mistakes; attach them to a single-topic paper.
      if ((!p.questions || !p.questions.length) && p.mistakes && p.mistakes.length && p.topics.length === 1) {
        const t = p.topics[0];
        if (!out.has(t)) out.set(t, []);
        p.mistakes.forEach((m) => out.get(t).push(`${p.title}: ${m}`));
      }
    }
    return out;
  }

  function topicLabel(t) {
    const code = t.schoolCode || t.code;
    // Codes with lowercase words ("trig-odd", "rw-wic") are ids, not school codes.
    return code && code !== t.title && !/[a-z]{2,}/.test(code) ? `${code} ${t.title}` : t.title;
  }
  function unitLabel(u) {
    if (!u) return "";
    const school = u.schoolCode ? `${u.schoolCode}${u.schoolTitle ? " " + u.schoolTitle : ""}` : null;
    const course = `${u.code && u.code !== u.title ? u.code + " " : ""}${u.title}`;
    return school ? `${school} (course: ${course})` : course;
  }

  function sanitize(name) { return String(name).replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, " ").trim(); }

  // Where the files go, as Windows paths under the Students root.
  function savePlan(student, subject, type, req, rootPath) {
    const title = sanitize(req.options.title || "Untitled");
    const topics = req.rows.map((r) => subject.topics.get(r.topic)).filter(Boolean);
    const units = [...new Set(topics.map((t) => t.unit))];
    let rel;
    if (type.id === "sat") {
      rel = req.satFormat === "vocab" ? [subject.name, "Vocabulary"] : [subject.name, "Practice Papers"];
    } else if (units.length === 1 && units[0].folder && !units[0].crossUnit) {
      rel = [subject.name, ...units[0].folder.split(/[\\/]/)];
    } else {
      rel = [subject.name, "Revision"];
    }
    const folder = [rootPath.replace(/[\\/]+$/, ""), student.dir, ...rel].join("\\") + "\\";
    let files;
    if (type.id === "pack") {
      files = [`0 - Study Guide - ${title}.pdf`, `${title} Worksheet.pdf`, `${title} Solutions.pdf`];
    } else if (type.id === "sat") {
      files = [`${title}.pdf`, `Solutions\\${title} Solutions.pdf`];
    } else {
      files = [`${title}.pdf`, `${title} Solutions.pdf`];
    }
    return { folder, files, relFolder: rel.join("/") };
  }

  function build(student, subject, type, req, opts) {
    const today = opts.today || todayISO();
    const rootPath = opts.rootPath || "D:\\Tushars\\Students";
    const P = student.profile || {};
    const name = student.name;
    const subjMeta = (P.subjects && P.subjects[subject.name]) || {};
    const course = subjMeta.course || subject.label;
    const o = req.options;
    const total = req.rows.reduce((a, r) => a + (Number(r.count) || 0), 0);
    const L = [];
    const H = (title) => { L.push(""); L.push(title.toUpperCase()); };

    // 1. Who / What
    const typeWord = type.id === "sat" ? (req.satFormat === "vocab" ? "SAT VOCABULARY SET" : "SAT SECTION")
      : type.id === "pack" ? "STUDY PACK" : type.name.toUpperCase();
    const who = [P.grade, P.school, course].filter(Boolean).join(", ");
    L.push(`Make a ${typeWord} for ${name}${P.nickname ? ` ("${P.nickname}")` : ""}${who ? ` (${who})` : ""}.`);
    if (P.examContext) L.push(`Exam context: ${P.examContext}.`);
    L.push(`Title: ${o.title}. ${total} questions${type.id === "pack" ? " in the worksheet" : ""}, ` +
      `${o.timeLimit ? `time limit ${o.timeLimit} min` : "no time limit"}, ` +
      `${o.calculator ? "graphing calculator allowed" : "no calculator"}.`);
    L.push(`Purpose: ${type.purpose}. Order: ${o.order === "topic" ? "grouped by topic, in syllabus order" : o.order === "sat" ? "SAT order (by domain, as on the real test)" : "easiest to hardest"}.`);
    if (type.id === "pack") {
      L.push("Pack = 3 files: (1) study guide with notes and worked examples in sections, each section followed by a practice box of 3 unsolved questions with work space; (2) worksheet of at most 20 questions, medium-hard to hard; (3) solutions to both (tutor only). One guide section per school notes handout / learning target.");
    }
    if (type.id === "sat" && req.satFormat === "vocab") {
      L.push("Format: words-in-context vocabulary set. Include a word list with definitions of every answer option in the solutions.");
    }
    if (o.note && o.note.trim()) L.push(`Note from Tushar: ${o.note.trim()}`);

    // 2–4. Scope + per-topic request
    H("Scope and counts");
    const selectedIds = new Set(req.rows.map((r) => r.topic));
    const hardAll = student.hard.filter((h) => !h.resolved && h.subject === subject.name && selectedIds.has(h.topic));
    let lastUnit = null;
    for (const r of req.rows) {
      const t = subject.topics.get(r.topic);
      if (!t) { L.push(`- [unknown topic "${r.topic}"]: ${r.count} questions, ${diffText(r.diff)}.`); continue; }
      if (t.unit !== lastUnit) {
        lastUnit = t.unit;
        L.push(t.unit.crossUnit ? `${t.unit.title}:` : `${unitLabel(t.unit)}:`);
        if (t.unit.styleNotes.length) L.push(`  School style for this unit: ${t.unit.styleNotes.join("; ")}.`);
      }
      L.push(`- ${topicLabel(t)}: ${r.count} question${r.count === 1 ? "" : "s"}, ${diffText(r.diff)}.`);
      if (t.skills.length) L.push(`  Skills: ${t.skills.join("; ")}.`);
      if (t.styleNotes.length) L.push(`  School style: ${t.styleNotes.join("; ")}.`);
      if (t.keyErrors.length) L.push(`  Known errors in school material (do NOT copy): ${t.keyErrors.join("; ")}.`);
      const hs = hardAll.filter((h) => h.topic === t.id);
      for (const h of hs) L.push(`  HARD TOPIC: ${h.issue} (flagged ${h.flagged || "?"}, ${h.source || "class"}).`);
      if (r.retest && r.retest.length) L.push(`  Re-test these exact mistakes with new questions: ${r.retest.join(" | ")}.`);
      if (r.note && r.note.trim()) L.push(`  Note: ${r.note.trim()}.`);
    }
    if (subject.styleNotes.length) L.push(`Subject style: ${subject.styleNotes.join("; ")}.`);
    if (hardAll.length) L.push("For every HARD TOPIC line, aim questions at that specific mistake, not just the topic.");

    // Part A re-test
    if (type.partA && o.partA) {
      const mist = recentMistakes(student, subject.name, today, 14);
      const items = [];
      for (const id of selectedIds) for (const m of mist.get(id) || []) items.push(m);
      for (const h of hardAll) if (h.flagged && daysAgo(h.flagged, today) <= 14) items.push(h.issue);
      H("Part A: re-test of recent mistakes");
      if (items.length) {
        L.push(`Start with a short Part A (about ${Math.min(6, Math.max(3, items.length))} questions, new numbers) that re-tests exactly these:`);
        [...new Set(items)].forEach((x) => L.push(`- ${x}`));
        L.push("Then Part B covers the full scope above. Count Part A inside the total.");
      } else {
        L.push("No recent wrong answers are logged for these topics. Make Part A a 3-question warm-up on the most error-prone skills above.");
      }
    }

    // 5. Hard topics are listed per topic above, so the scope reads in one place.
    // 6. History
    H("History on these topics");
    const hist = historyLines(student, subject, selectedIds);
    if (hist.lines.length) {
      hist.lines.forEach((x) => L.push(x));
      if (hist.trimmed) L.push(`(${hist.trimmed} older entries omitted.)`);
      L.push("Use this to judge what matters most: cover skills not yet practised, revisit the mistakes, and never repeat an earlier question.");
    } else {
      L.push("No earlier papers on these topics are logged.");
    }

    // 7. Standing rules
    H(`Standing rules for ${name}`);
    const ctx = type.context;
    const dm = difficultyMap(student, subject.name);
    if (dm[ctx]) L.push(`- Difficulty when ${CONTEXT_LABEL[ctx]}: ${diffText(dm[ctx])}. The per-topic difficulty above overrides this.`);
    const rules = activeRules(student, subject.name, today);
    const order = ["difficulty", "emphasis", "exclusion", "tool", "convention", "habit", "cap"];
    const lbl = { difficulty: "", emphasis: "Emphasis: ", exclusion: "Never use: ", tool: "Tools: ", convention: "Convention: ", habit: "Work habit: ", cap: "Length: " };
    rules.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    for (const r of rules) {
      const text = r.type === "exclusion" ? r.text.replace(/^(never|no)\s+/i, "") : r.text;
      L.push(`- ${lbl[r.type] || ""}${text}${r.until ? ` (until ${r.until})` : ""}.`.replace(/\.\.$/, "."));
    }
    if (type.addWeak) {
      const weak = [...subject.topics.values()].filter((t) => t.status === "weak" && !selectedIds.has(t.id));
      if (weak.length) L.push(`- Revision paper: also add 1–2 questions on each weak skill: ${weak.map(topicLabel).join("; ")}.`);
    }
    if (!rules.length && !dm[ctx]) L.push("- (none recorded)");

    // 8. Layout
    H("Layout");
    const qpp = o.qpp === "auto" ? "2–3 questions per page (short ones 3, long ones or ones with a figure 2)" : `${o.qpp} questions per page`;
    L.push(`${o.paper === "A4" ? "A4" : "US Letter"}, portrait. ${qpp}; a question never splits across pages.`);
    L.push("Each question gets work space to solve by hand: a light rounded box with an answer line at the bottom.");
    L.push(`Page-1 header: title, ${name}, ${subject.label}, unit, topics, date, number of questions, time limit, calculator icon, and Name / Date / Score lines.`);
    L.push("Each question: large serif number, difficulty stars (★ medium, ★★ medium-hard, ★★★ hard, ★★★★ very hard), small topic tag, typeset maths, any figure or table.");
    L.push("Footer: page X of Y and the title. Answer key (tutor copy): same numbering, final answer, worked solution" + (o.calculator ? ", calculator keystrokes" : "") + "; \"Tutor copy\" in the header band.");
    L.push("Match the look of the packs already built for this student (templates in Claude outputs\\).");

    // 9. Quality
    H("Quality");
    if (subject.verify === "sympy") {
      L.push("Verify every maths answer with sympy before building the PDF. Re-check any answer that depends on a figure.");
    } else {
      L.push("Answers can't all be machine-checked: write the key, then do a second independent pass over every question and answer before building the PDF. Flag anything ambiguous so Tushar can review it before printing.");
    }
    if (type.id === "sat") L.push("SAT rules: balance answer choices across A–D, make every wrong choice plausible, and in the solutions explain the clue and define every option.");
    L.push("New numbers and contexts: mirror the school's examples and skills, but never copy them. Vary question types within each topic.");
    L.push("Draw figures from code (graphs, circuits, residual plots, number lines) and check them against the stated values.");

    // 10. Saving
    const plan = savePlan(student, subject, type, req, rootPath);
    H("Save to");
    L.push(plan.folder);
    plan.files.forEach((f) => L.push(`  "${f}"`));
    L.push(`Then append this paper to ${rootPath.replace(/[\\/]+$/, "")}\\${student.dir}\\paper-history.json (schema 1):`);
    L.push(`  { "date": "${today}", "title": "${o.title}", "type": "${type.id}", "subject": "${subject.name}",`);
    L.push(`    "topics": [${[...selectedIds].map((x) => `"${x}"`).join(", ")}], "total": ${total},`);
    L.push(`    "files": { "paper": "${plan.relFolder}/${plan.files[type.id === "pack" ? 1 : 0].replace(/\\/g, "/")}", "solutions": "${plan.relFolder}/${plan.files[plan.files.length - 1].replace(/\\/g, "/")}" },`);
    L.push(`    "prompt": "${LOG_PLACEHOLDER}", "marked": false,`);
    L.push(`    "questions": [ { "n": 1, "topic": "<topic id>", "difficulty": "MH", "skill": "<question type>" }, … ] }`);
    L.push("");
    L.push(`This paper is for ${name} only. Use no other student's rules, level or history.`);
    return L.join("\n");
  }

  function historyLines(student, subject, selectedIds) {
    const perTopic = new Map();
    const chosen = new Map(); // paper → topics it covers from the selection
    for (const p of student.history) {
      if (p.subject !== subject.name) continue;
      const hit = (p.topics || []).filter((t) => selectedIds.has(t));
      for (const t of hit) {
        const n = perTopic.get(t) || 0;
        if (n >= HISTORY_PER_TOPIC) continue;
        perTopic.set(t, n + 1);
        if (!chosen.has(p)) chosen.set(p, new Set());
        chosen.get(p).add(t);
      }
    }
    const lines = [];
    for (const [p, ts] of chosen) {
      const topicsTxt = [...ts].map((id) => {
        const t = subject.topics.get(id);
        if (!t) return id;
        const code = t.schoolCode || t.code;
        return /[a-z]{2,}/.test(code) ? t.title : code;
      }).join(", ");
      const qs = (p.questions || []).filter((q) => ts.has(q.topic));
      const skills = qs.length ? [...new Set(qs.map((q) => q.skill).filter(Boolean))] : p.skills || [];
      const score = p.score && p.score.of ? `score ${p.score.got}/${p.score.of}` : p.marked ? "marked" : "not yet marked";
      lines.push(`- ${p.date || "?"} ${p.title} (${p.type || "paper"}${p.total ? `, ${p.total} Q` : ""}): ${topicsTxt}${skills.length ? ` — ${skills.join(", ")}` : ""}. ${score}.`);
      const wrong = qs.filter((q) => q.correct === false).map((q) => `Q${q.n}${q.mistake ? " " + q.mistake : ""}`);
      const mist = wrong.length ? wrong : p.mistakes || [];
      if (mist.length) lines.push(`  Mistakes: ${mist.join("; ")}.`);
      if (p.notes) lines.push(`  Note: ${p.notes}.`);
    }
    const trimmed = Math.max(0, lines.length - HISTORY_MAX_LINES);
    return { lines: lines.slice(0, HISTORY_MAX_LINES), trimmed };
  }

  return {
    LOG_PLACEHOLDER, build, savePlan, activeRules, defaultDiff, capFor, calculatorDefault, hardItems,
    recentMistakes, topicLabel, unitLabel, todayISO, daysAgo, sanitize
  };
})();
