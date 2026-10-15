// Reads the Students folder (the single source of truth) into memory.
//
// A "source" hides where the files come from:
//   - httpSource:   the local server (server/serve.mjs), which already knows
//                   where the Students folder is. Read + write.
//   - memorySource: { "Harika/student.json": "…" } map, for debugging.
// Every source exposes list(path) → [{name, kind}], file(path) → File|null,
// and write(path, text) when canWrite. Paths are arrays of segments relative
// to the Students folder.

const Folder = (() => {

  // ── Sources ────────────────────────────────────────────────

  // base: "" when the page is served by the local server itself, or
  // "http://localhost:4777" when the page runs on devindi.in.
  async function httpSource(base) {
    base = base || "";
    const info = await fetch(base + "/api/info", { cache: "no-store" }).then((r) => r.json());
    const q = (segs) => "path=" + encodeURIComponent(segs.join("/"));
    return {
      kind: "http", name: info.name, root: info.root, exists: info.exists, canWrite: true,
      async list(segs) {
        const r = await fetch(base + "/api/list?" + q(segs), { cache: "no-store" });
        return r.ok ? r.json() : null;
      },
      async file(segs) {
        const r = await fetch(base + "/api/file?" + q(segs), { cache: "no-store" });
        if (!r.ok || r.status === 204) return null;
        const blob = await r.blob();
        return new File([blob], segs[segs.length - 1], { lastModified: Number(r.headers.get("X-Mtime")) || Date.now() });
      },
      async write(segs, text) {
        const r = await fetch(base + "/api/file?" + q(segs), {
          method: "PUT", headers: { "X-Worksheet-Builder": "1", "Content-Type": "text/plain; charset=utf-8" }, body: text
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      }
    };
  }

  function treeSource(name, entries, canWrite) {
    // entries: Map "a/b/c.json" → File
    const dirs = new Map(); // "a/b" → Map(name → kind)
    const add = (path) => {
      const segs = path.split("/");
      for (let i = 0; i < segs.length; i++) {
        const parent = segs.slice(0, i).join("/");
        if (!dirs.has(parent)) dirs.set(parent, new Map());
        dirs.get(parent).set(segs[i], i === segs.length - 1 ? "file" : "directory");
      }
    };
    for (const p of entries.keys()) add(p);
    return {
      kind: canWrite ? "memory" : "files", name, canWrite,
      async list(segs) {
        const m = dirs.get(segs.join("/"));
        return m ? [...m].map(([n, k]) => ({ name: n, kind: k })) : null;
      },
      async file(segs) { return entries.get(segs.join("/")) || null; },
      async write(segs, text) {
        if (!canWrite) throw new Error("This folder was opened read-only.");
        const p = segs.join("/");
        entries.set(p, new File([text], segs[segs.length - 1], { lastModified: Date.now() }));
        add(p);
      }
    };
  }

  function memorySource(map) {
    const entries = new Map();
    for (const [p, v] of Object.entries(map)) {
      const text = typeof v === "string" ? v : v.text;
      const lm = typeof v === "string" ? Date.now() : v.lastModified;
      entries.set(p, new File([text], p.split("/").pop(), { lastModified: lm }));
    }
    return treeSource("Students", entries, true);
  }

  // ── Scanning ───────────────────────────────────────────────

  const isPdf = (n) => /\.pdf$/i.test(n);

  async function readJson(src, segs, errors, label) {
    const f = await src.file(segs);
    if (!f) return { missing: true };
    let text;
    try { text = await f.text(); } catch (e) { errors.push(err(label, "could not be read (" + e.message + ")")); return { bad: true }; }
    try {
      return { data: JSON.parse(text.replace(/^﻿/, "")), mtime: f.lastModified };
    } catch (e) {
      errors.push(err(label, "is not valid JSON: " + e.message));
      return { bad: true, mtime: f.lastModified };
    }
  }

  function err(file, msg, level) { return { file, msg, level: level || "error" }; }

  async function scan(src) {
    const t0 = Date.now();
    const result = { source: src, students: [], errors: [], masters: {}, scannedAt: new Date() };
    const rootList = await src.list([]);
    if (!rootList) {
      result.errors.push(err(src.name, "could not be listed. Reconnect the folder."));
      return result;
    }

    // Shared master syllabi: _syllabi/<Name>.json, plus the built-in SAT ones.
    Object.assign(result.masters, JSON.parse(JSON.stringify(BUILTIN_MASTERS)));
    if (rootList.some((e) => e.name === "_syllabi" && e.kind === "directory")) {
      for (const e of (await src.list(["_syllabi"])) || []) {
        if (e.kind !== "file" || !/\.json$/i.test(e.name)) continue;
        const label = "_syllabi/" + e.name;
        const r = await readJson(src, ["_syllabi", e.name], result.errors, label);
        if (r.data) {
          validateSyllabus(r.data, label, result.errors, true);
          result.masters[e.name.replace(/\.json$/i, "")] = r.data;
        }
      }
    }

    const dirs = rootList.filter((e) => e.kind === "directory" && !/^[_.]/.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirs) result.students.push(await scanStudent(src, d.name, result.masters));

    // Names must be unique — mixing students up is the error that matters most.
    const seen = new Map();
    for (const s of result.students) {
      if (!s.profile) continue;
      const key = s.name.toLowerCase();
      if (seen.has(key)) s.errors.push(err(s.dir + "/student.json", `uses the name "${s.name}", same as ${seen.get(key)}/student.json`));
      else seen.set(key, s.dir);
    }
    result.ms = Date.now() - t0;
    return result;
  }

  async function scanStudent(src, dir, masters) {
    const s = {
      dir, name: dir, profile: null, subjects: [], hard: [], history: [], templates: [], classes: [], extra: [], record: [],
      prompts: [], errors: [], newest: 0, files: {}
    };
    const P = (...x) => [dir, ...x];
    const track = (path, mtime) => { if (mtime) { s.files[path] = mtime; s.newest = Math.max(s.newest, mtime); } };

    const prof = await readJson(src, P("student.json"), s.errors, dir + "/student.json");
    if (prof.missing) {
      s.missing = true;
      s.errors.push(err(dir + "/student.json", "is missing, so this folder isn't set up as a student yet. Ask Claude to create it.", "warn"));
      return s;
    }
    track("student.json", prof.mtime);
    if (prof.data) {
      validateStudent(prof.data, dir + "/student.json", s.errors);
      s.profile = prof.data;
      if (typeof prof.data.name === "string" && prof.data.name.trim()) s.name = prof.data.name.trim();
    }

    const list = (await src.list(P())) || [];

    // Subjects = sub-folders holding a syllabus.json
    for (const e of list.filter((x) => x.kind === "directory" && !/^(prompt-log|Claude outputs)$/i.test(x.name) && !x.name.startsWith("."))) {
      const label = `${dir}/${e.name}/syllabus.json`;
      const r = await readJson(src, P(e.name, "syllabus.json"), s.errors, label);
      if (r.missing) continue;
      track(`${e.name}/syllabus.json`, r.mtime);
      if (!r.data) { s.subjects.push({ name: e.name, broken: true, units: [], topics: new Map() }); continue; }
      const subj = resolveSyllabus(r.data, e.name, label, masters, s.errors);
      // Unit substance and freshness: look inside each unit's folder for PDFs.
      for (const u of subj.units) {
        u.pdfs = 0; u.newest = 0;
        if (u.folder) {
          const ul = await src.list(P(e.name, ...u.folder.split(/[\\/]/)));
          if (ul === null) {
            s.errors.push(err(label, `unit "${u.title}": folder "${u.folder}" not found`, "warn"));
          } else {
            for (const f of ul) {
              if (f.kind !== "file" || !isPdf(f.name)) continue;
              u.pdfs++;
            }
          }
        }
        u.substance = u.pdfs > 0 || u.topics.some((t) => USABLE.has(t.status));
      }
      subj.mtime = r.mtime;
      s.subjects.push(subj);
    }
    s.subjects.sort((a, b) => a.name.localeCompare(b.name));

    // hard-topics.json
    const hard = await readJson(src, P("hard-topics.json"), s.errors, dir + "/hard-topics.json");
    if (hard.missing) s.errors.push(err(dir + "/hard-topics.json", "is missing; the hard-topics filter will be empty.", "warn"));
    if (hard.data) {
      track("hard-topics.json", hard.mtime);
      s.hard = validateHard(hard.data, dir + "/hard-topics.json", s.errors, s.subjects);
    }

    // paper-history.json
    const hist = await readJson(src, P("paper-history.json"), s.errors, dir + "/paper-history.json");
    if (hist.missing) s.errors.push(err(dir + "/paper-history.json", "is missing; prompts will have no history.", "warn"));
    if (hist.data) {
      track("paper-history.json", hist.mtime);
      s.history = validateHistory(hist.data, dir + "/paper-history.json", s.errors);
    }

    // templates.json (app-written)
    const tpl = await readJson(src, P("templates.json"), s.errors, dir + "/templates.json");
    if (tpl.data && Array.isArray(tpl.data.templates)) s.templates = tpl.data.templates.filter((t) => t && t.name && t.request);

    // extra-hours.json (app-written): billable work done outside class.
    const ex = await readJson(src, P("extra-hours.json"), s.errors, dir + "/extra-hours.json");
    if (ex.data) {
      track("extra-hours.json", ex.mtime);
      const list = Array.isArray(ex.data.entries) ? ex.data.entries : [];
      s.extra = list.filter((e, i) => {
        const ok = e && DATE.test(e.date) && Number(e.hours) > 0;
        if (!ok) s.errors.push(err(dir + "/extra-hours.json", `entry ${i + 1} needs a YYYY-MM-DD "date" and positive "hours"`));
        return ok;
      }).map((e) => Object.assign({}, e, { hours: Number(e.hours) }));
    }

    // class-record.json: Tushar's own billing record (e.g. from WhatsApp). Its hours
    // are final: they override the Fathom length of a logged class on the same
    // date and session, and add classes that were never recorded on Fathom.
    const cr = await readJson(src, P("class-record.json"), s.errors, dir + "/class-record.json");
    if (cr.data) {
      track("class-record.json", cr.mtime);
      const list = Array.isArray(cr.data.entries) ? cr.data.entries : [];
      // hours 0 = "this logged session is already counted in another entry" (not billed, not counted).
      s.record = list.filter((e, i) => {
        const ok = e && DATE.test(e.date) && Number(e.hours) >= 0 && e.hours !== "" && e.hours != null;
        if (!ok) s.errors.push(err(dir + "/class-record.json", `entry ${i + 1} needs a YYYY-MM-DD "date" and "hours" (0 or more)`));
        return ok;
      }).map((e) => Object.assign({ session: 1 }, e, { hours: Number(e.hours), session: Number(e.session) || 1 }));
    }

    // "<Name> - Class Log.md" → one record per class (for the Class counter).
    const logName = list.find((e) => e.kind === "file" && e.name.toLowerCase() === `${dir} - class log.md`.toLowerCase())
      || list.find((e) => e.kind === "file" && / - Class Log\.md$/i.test(e.name));
    if (logName) {
      const f = await src.file(P(logName.name));
      if (f) {
        track(logName.name, f.lastModified);
        s.classes = parseClassLog(await f.text(), `${dir}/${logName.name}`, s.errors);
      }
    } else {
      s.errors.push(err(`${dir}/`, "has no class log, so the Class counter can't count this student's classes.", "warn"));
    }

    // prompt-log/*.md — newest first; only the header is parsed.
    const pl = await src.list(P("prompt-log"));
    if (pl) {
      for (const f of pl.filter((x) => x.kind === "file" && /\.md$/i.test(x.name))) {
        const file = await src.file(P("prompt-log", f.name));
        if (!file) continue;
        const text = await file.text();
        const m = text.match(/^<!--\s*worksheet-builder request:\s*([\s\S]*?)\s*-->/);
        let request = null;
        if (m) { try { request = JSON.parse(m[1]); } catch (_) { /* hand-edited log; still listed */ } }
        s.prompts.push({ name: f.name, path: "prompt-log/" + f.name, mtime: file.lastModified, request });
      }
      s.prompts.sort((a, b) => b.name.localeCompare(a.name));
    }
    return s;
  }

  // ── Class log parsing ──────────────────────────────────────
  // Each class is a "### YYYY-MM-DD (Day[, note]) — Subject: Topic" heading in
  // "Session History", followed by "Source: Fathom recap "…", 86 min — <link>".
  // Durations may also be written "1 h 26 min" / "1h 26m".
  function parseClassLog(text, label, errors) {
    const out = [];
    const parts = text.split(/^### /m).slice(1);
    for (const part of parts) {
      const head = part.split(/\r?\n/)[0];
      const m = head.match(/^(\d{4}-\d{2}-\d{2})\s*(?:\(([^)]*)\))?\s*[—–-]+\s*(.*)$/);
      if (!m) continue;
      const body = part.slice(head.length);
      const src = (body.match(/^Source:.*$/m) || [""])[0];
      let minutes = null;
      const hm = src.match(/(\d+)\s*h(?:ours?|rs?)?\s*(\d+)\s*m(?:in(?:utes?)?)?\b/i);
      const mOnly = src.match(/(\d+)\s*min(?:utes?)?\b/i);
      const hOnly = src.match(/(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\b/i);
      if (hm) minutes = Number(hm[1]) * 60 + Number(hm[2]);
      else if (mOnly) minutes = Number(mOnly[1]);
      else if (hOnly) minutes = Math.round(Number(hOnly[1]) * 60);
      const note = (m[2] || "").split(",").slice(1).join(",").trim();
      const title = m[3].trim();
      const link = (src.match(/https?:\/\/\S+/) || [null])[0];
      if (minutes === null) errors.push(err(label, `class on ${m[1]} ("${title.slice(0, 40)}") has no duration, so it isn't billed. Add "NN min" to its Source line.`, "warn"));
      out.push({ date: m[1], note, title, subject: title.split(":")[0].trim(), minutes, link });
    }
    out.sort((a, b) => b.date.localeCompare(a.date));
    return out;
  }

  // ── Validation (fail loudly, name the file and the reason) ────

  const RULE_TYPES = new Set(["difficulty", "emphasis", "exclusion", "tool", "convention", "habit", "cap"]);
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  function validateStudent(d, label, errors) {
    if (typeof d.name !== "string" || !d.name.trim()) errors.push(err(label, 'has no "name"'));
    if (d.rules !== undefined && !Array.isArray(d.rules)) errors.push(err(label, '"rules" must be a list'));
    (Array.isArray(d.rules) ? d.rules : []).forEach((r, i) => {
      if (!r || typeof r.text !== "string") errors.push(err(label, `rule ${i + 1} has no "text"`));
      else if (!RULE_TYPES.has(r.type)) errors.push(err(label, `rule ${i + 1} ("${r.text.slice(0, 40)}…") has unknown type "${r.type}"`, "warn"));
      if (r && r.until && !DATE.test(r.until)) errors.push(err(label, `rule ${i + 1}: "until" must be YYYY-MM-DD`));
    });
    if (d.difficulty) {
      for (const [k, ctx] of Object.entries(d.difficulty)) {
        for (const [c, code] of Object.entries(ctx || {})) {
          if (!parseDiff(code)) errors.push(err(label, `difficulty.${k}.${c} "${code}" isn't a difficulty code (M, MH, H, VH or a ramp like M>H)`));
        }
      }
    }
  }

  function validateSyllabus(d, label, errors, isMaster) {
    if (!d.master && !Array.isArray(d.units)) { errors.push(err(label, isMaster ? 'has no "units" list' : 'has neither "units" nor "master"')); return; }
    const ids = new Set();
    (d.units || []).forEach((u, ui) => {
      const uname = `unit ${ui + 1}${u && u.title ? ` ("${u.title}")` : ""}`;
      if (!u || !u.id) errors.push(err(label, `${uname} has no "id"`));
      if (!u || !u.title) errors.push(err(label, `${uname} has no "title"`));
      if (!u || !Array.isArray(u.topics)) { errors.push(err(label, `${uname} has no "topics" list`)); return; }
      u.topics.forEach((t, ti) => {
        const tname = `${uname}, topic ${t && (t.code || t.id) ? t.code || t.id : ti + 1}`;
        if (!t || !t.id) errors.push(err(label, `${tname} has no "id"`));
        else if (ids.has(t.id)) errors.push(err(label, `topic id "${t.id}" is used twice`));
        else ids.add(t.id);
        if (!t || !t.title) errors.push(err(label, `${tname} has no title`));
        if (t && t.status && !STATUSES.includes(t.status)) errors.push(err(label, `${tname}: unknown status "${t.status}"`));
      });
    });
  }

  function resolveSyllabus(d, folderName, label, masters, errors) {
    validateSyllabus(d, label, errors);
    let base = d;
    if (d.master) {
      const m = masters[d.master];
      if (!m) {
        errors.push(err(label, `uses master "${d.master}", but there's no _syllabi/${d.master}.json`));
        base = { units: [] };
      } else base = Object.assign({}, m, { units: m.units });
    }
    const kind = d.kind || base.kind || "school";
    const subj = {
      name: folderName, label: d.subject || folderName, kind, master: d.master || null,
      verify: d.verify || base.verify || (kind === "sat" ? "review" : "sympy"),
      styleNotes: [...(base.styleNotes || []), ...(d.master ? d.styleNotes || [] : [])],
      currentUnit: d.currentUnit || null, units: [], topics: new Map()
    };
    const statusMap = d.topicStatus || {};
    for (const u of base.units || []) {
      if (!u || !Array.isArray(u.topics)) continue;
      const unit = {
        id: u.id, code: u.code || u.title, schoolCode: u.schoolCode || null, title: u.title || u.id,
        schoolTitle: u.schoolTitle || null, folder: u.folder || null, crossUnit: !!u.crossUnit,
        styleNotes: u.styleNotes || [], topics: []
      };
      for (const t of u.topics) {
        if (!t || !t.id) continue;
        const st = statusMap[t.id] || {};
        const topic = {
          id: t.id, code: t.code || t.id, schoolCode: t.schoolCode || null, title: t.title || t.id,
          skills: t.skills || [], styleNotes: t.styleNotes || [], keyErrors: t.keyErrors || [],
          materials: t.materials || [],
          status: st.status || t.status || (kind === "sat" && d.master ? "taught" : "upcoming"),
          taught: st.taught || t.taught || null, lastPractised: st.lastPractised || t.lastPractised || null,
          unit
        };
        unit.topics.push(topic);
        subj.topics.set(topic.id, topic);
      }
      subj.units.push(unit);
    }
    for (const id of Object.keys(statusMap)) {
      if (!subj.topics.has(id)) errors.push(err(label, `topicStatus names "${id}", which isn't a topic in ${d.master || "this syllabus"}`, "warn"));
    }
    return subj;
  }

  function validateHard(d, label, errors, subjects) {
    if (!Array.isArray(d.items)) { errors.push(err(label, 'has no "items" list')); return []; }
    const out = [];
    d.items.forEach((h, i) => {
      const nm = `item ${i + 1}`;
      if (!h || !h.issue) { errors.push(err(label, `${nm} has no "issue"`)); return; }
      if (!h.topic) { errors.push(err(label, `${nm} ("${h.issue.slice(0, 40)}") has no "topic"`)); return; }
      if (!h.flagged || !DATE.test(h.flagged)) errors.push(err(label, `${nm} ("${h.issue.slice(0, 40)}") needs "flagged" as YYYY-MM-DD`, "warn"));
      const subj = subjects.find((s) => s.name === h.subject);
      if (!subj) errors.push(err(label, `${nm}: subject "${h.subject}" has no syllabus.json`, "warn"));
      else if (!subj.topics.has(h.topic)) errors.push(err(label, `${nm}: topic "${h.topic}" isn't in ${h.subject}/syllabus.json`, "warn"));
      out.push(Object.assign({ id: h.id || `item-${i + 1}`, source: "class", resolved: false }, h));
    });
    return out;
  }

  function validateHistory(d, label, errors) {
    if (!Array.isArray(d.papers)) { errors.push(err(label, 'has no "papers" list')); return []; }
    const out = [];
    d.papers.forEach((p, i) => {
      if (!p || !p.title) { errors.push(err(label, `paper ${i + 1} has no "title"`)); return; }
      if (!p.date || !DATE.test(p.date)) errors.push(err(label, `"${p.title}" needs "date" as YYYY-MM-DD`, "warn"));
      out.push(Object.assign({ topics: [], questions: [], mistakes: [], skills: [], files: {} }, p));
    });
    out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return out;
  }

  return { httpSource, memorySource, scan };
})();
