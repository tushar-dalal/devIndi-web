---
name: "sync-class-logs"
description: "Pull new Fathom class recaps from Gmail and log them into Bhargav's, Harika's and Aadithyaa's class log files on demand, and keep each student's Worksheet Builder files (student.json, syllabus.json, hard-topics.json, paper-history.json) in step. Use for /sync-class-logs or 'sync my class logs', and when Tushar reports a student's score or mistakes."
---

# Sync Class Logs

Run the Fathom → student records sync right now (same job as the scheduled 7:15 / 8:45 / 11:00 AM tasks).
One sync updates the class log **and** the structured files the Worksheet Builder app reads to build paper prompts. Stale structured files mean wrong prompts, so both always move together.

## Students
- **Bhargav** (Bhargav Kondapalli): AP Calculus 2, SAT Math
- **Harika**: Algebra II
- **Aadithyaa** (also spelled Adithyaa / Aadithya; Adithyaa Shankar; "Adi"): Physics, AP Statistics (folder `Statistics`), SAT English, Heartlinks research paper

## Files (Tushar's computer, folder D:\Tushars\Students)
Per student `<S>` (Bhargav, Harika, Aadithyaa):
- `<S>\<S> - Class Log.md`: the narrative log
- `<S>\student.json`: profile + standing rules
- `<S>\<Subject>\syllabus.json`: one per subject folder (units → topics, with status)
- `<S>\hard-topics.json`: specific struggles, flagged and resolved
- `<S>\paper-history.json`: every paper given, with scores and mistakes
- `<S>\class-record.json`: Tushar's own class-hours record for billing (see "When Tushar reports class hours")
- `<S>\extra-hours.json`: billable work outside class; only add entries Tushar reports, never edit or remove ones he made in the app

Shared:
- `D:\Tushars\Students\_fathom_processed.txt`: Gmail message IDs already logged, one per line as `id | YYYY-MM-DD | Student`

Ignore any old files named just `Class Log.md`; they are outdated copies. Never touch `prompt-log\` or `templates.json` (the app owns them), or the `rate` in student.json. Only add to `extra-hours.json` when Tushar reports extra work (see "When Tushar reports class hours"); never edit or remove entries he made in the app.
If D:\Tushars\Students isn't connected to the session, ask Tushar to add it with "Add folder" (or request access to it), then continue.

## Steps
1. **Stage** `_fathom_processed.txt` and, for every student, the class log and the four JSON files (every `syllabus.json` under the student folder). Note each mtimeMs.
2. **Search Gmail:** `from:no-reply@fathom.video newer_than:7d`. For each message whose ID is NOT in `_fathom_processed.txt`, read the full thread (PLAIN_TEXT). If nothing is new, say "No new Fathom recaps". Then give a one-line "last class" status per student from the Current Status blocks, and stop.
3. **Identify the student** from names in the summary, Next Steps, action items and attendees. If the recap isn't one of the three students, record its ID as `skipped`. If it's ambiguous, don't guess: ask Tushar which student it was.
4. **Class log** (per matched recap, oldest first; use the meeting date in India time):
   a. Insert a new entry at the TOP of `## Session History (newest first)` (remove the `_No sessions logged yet..._` placeholder if present):
      ```
      ### YYYY-MM-DD (Day) — Subject: Topic
      Source: Fathom recap "<title>", <NN> min — <fathom call link>
      Related material: <matching files/folders in the student's folder>
      **What we covered**: per problem/topic, with method and outcome
      **Where they struggled**: specific misconceptions and error patterns
      **Next class: what and how**: what to check first, what to re-test, what new material to cover, and HOW (activity, format, timing), plus any logistics
      ```
      The heading and Source line feed the Worksheet Builder's Class counter, which bills Tushar's classes: keep the heading exactly `### YYYY-MM-DD (Day) — …` (add `, 2nd session` inside the brackets for a second class that day) and always write the length as whole minutes, `NN min`, from the Fathom recording length. One heading per class; never merge two classes into one entry.
   b. Rewrite `## Current Status`: Last class, Next class should cover, Open homework, Recurring weak spots (merge with earlier ones).
5. **Structured files** (same recap, same pass). Follow the schemas below exactly.
   a. `student.json`: set `lastClass` to the class date. If Tushar or the recap states a standing rule (a difficulty change, a cap such as "worksheets now 15 questions", an exclusion, a tool, a work habit), add or edit the matching `rules` entry. Give one-off rules an `until` date ("next weekend test only" → that weekend's Sunday). Don't invent rules from vague remarks.
   b. `<Subject>\syllabus.json` for each subject covered:
      - Topic taught for the first time → `status: "taught"`, `taught: <date>`.
      - Topic the student worked problems on → `lastPractised: <date>`; raise `status` to `practised` if it was below that.
      - Errors on a topic that repeat across two or more classes or papers → `status: "weak"`. A weak topic answered cleanly in a re-test → back to `practised` (or `tested` if it was a test).
      - New topic or unit from school → add it in syllabus order with the school's own code in `schoolCode`, `status: "received"` (`"taught"` if it was taught in this class). Move `currentUnit` when school moves on.
      - A school key with an error → add it to that topic's `keyErrors`.
      - Never delete topics. Never move a status backwards except weak → practised/tested as above.
   c. `hard-topics.json`: add one item per **specific** struggle in "Where they struggled" (the exact error, not the topic name), with `topic` = the topic id from that subject's syllabus, `flagged` = class date, `source: "class"`. If an unresolved item already describes the same error, keep it (don't duplicate) and, if useful, sharpen its wording. When the recap shows a flagged error now done correctly unaided (re-test, cold check), set `resolved: true`, `resolvedOn: <date>`.
   d. `paper-history.json`: if the class worked through or marked one of Tushar's papers (e.g. "solved 14 of 20", "Q1–4 all correct", a score), update that paper's entry: per-question `correct` / `mistake` where known, `score`, `marked: true` once fully checked, and `notes` for partial progress. If the paper isn't in the history yet (made before the app), add it with `date`, `title`, `type`, `subject`, `topics`, `total`, `files`.
6. **Write** each changed file to `/mnt/user-data/outputs/` and commit it back to its exact original path with expectedMtimeMs. Parse every JSON file before committing; if it doesn't parse, fix it, never commit broken JSON. On mtime drift, re-stage, re-apply and retry. Append the new IDs to `_fathom_processed.txt`.
7. **Report** one line per student who got a new entry (date, topic, next-class focus), then one line per student listing the structured changes (e.g. "Harika: 5-4 → practised; +2 hard topics; 1 resolved; 5-4 Worksheet Q1–14 marked"), plus anything skipped.

## When Tushar reports results in chat (no Fathom recap)
E.g. "Adi got 23/27 on SAT English Paper 1, missed Q1, Q2, Q4, Q27": stage the student's `paper-history.json`, `hard-topics.json` and the subject's `syllabus.json`, then apply steps 5b–5d for that paper (score, per-question `correct` / `mistake`, `marked: true`, topic statuses, hard-topic items for repeated error patterns). Write and report the same way.

## When Tushar reports class hours (his own billing record)
E.g. a WhatsApp screenshot of "Class 5: 1.25" messages. These hours are final for billing and win over Fathom.
Stage `<S>\class-record.json` (create it with `{ "schema": 1, "entries": [] }` if missing) and add one entry per class:
`{ "date": "YYYY-MM-DD", "session": 1, "hours": 1.25, "label": "Class 5 (Sept)", "source": "whatsapp", "note": "…" }`.
- Date = the message date (India time) unless the message clearly reports an earlier class (e.g. two classes in one message: match them to the Fathom classes in the class log).
- Never add a class twice: skip any date+session already in class-record.json. A Fathom class on the same date needs an entry only to set its hours (note the Fathom length in `note` when they differ).
- Extra work posted under the same "Class N" numbering (hours Tushar asks the parent to approve, e.g. "Would it be okay to log 8 hours?", or labelled as essay/paper work) is NOT a class: add it to `<S>\extra-hours.json` instead (`{ "id": "x-…", "date", "hours", "note", "source": "whatsapp", "added" }`).
- If Fathom split one class into two sessions but the record has one class, give session 1 the full hours and add `{ "date", "session": 2, "hours": 0, "note": "Included in session 1" }`.
- If a date is cut off or unclear, don't guess: ask Tushar.
- Never edit the Fathom durations in the class log.

## Schemas (schema 1 — keep every field name exactly)
Dates `YYYY-MM-DD`. Difficulty codes `M`, `MH`, `H`, `VH`, ramps like `"M>H"`. Paths inside files are relative to the student folder with `/`.

student.json
```json
{ "schema": 1, "name": "Harika", "fullName": "", "nickname": null, "aliases": [], "color": "#B4532A",
  "grade": "", "school": "", "city": "", "timezone": "", "examContext": "", "lastClass": "2026-10-13",
  "subjects": { "<Subject folder>": { "course": "", "level": "" } },
  "difficulty": { "default": { "home": "M", "class": "M>MH", "testPrep": "M>MH" }, "<Subject folder>": { "home": "MH" } },
  "rules": [ { "type": "difficulty|emphasis|exclusion|tool|convention|habit|cap", "text": "…",
               "subject": "<Subject folder, optional>", "until": "YYYY-MM-DD optional", "max": 20, "calculator": true } ] }
```
syllabus.json (school subject)
```json
{ "schema": 1, "subject": "Algebra II", "kind": "school", "verify": "sympy|review", "currentUnit": "u4", "styleNotes": [],
  "units": [ { "id": "u4", "code": "Unit 4", "schoolCode": "Unit 5", "title": "Quadratics", "schoolTitle": "Quadratic Functions",
               "folder": "Unit 4 - Quadratics", "crossUnit": false, "styleNotes": [],
               "topics": [ { "id": "5-4", "code": "5-4", "schoolCode": "5-4", "title": "…", "skills": [],
                             "status": "upcoming|received|reviewed|taught|practised|tested|weak",
                             "taught": "YYYY-MM-DD", "lastPractised": "YYYY-MM-DD", "styleNotes": [], "materials": [], "keyErrors": [] } ] } ] }
```
SAT syllabus.json uses a built-in master and only stores status: `{ "schema": 1, "subject": "SAT English", "kind": "sat", "master": "SAT Reading and Writing", "verify": "review", "topicStatus": { "rw-wic": { "status": "weak", "lastPractised": "…" } } }`.
SAT R&W topic ids: rw-cid, rw-coe-t, rw-coe-q, rw-inf, rw-wic, rw-tsp, rw-ctc, rw-rs, rw-trans, rw-bound, rw-fss. SAT Math: m-lin1, m-linf, m-lin2, m-sys, m-ineq, m-nlf, m-nle, m-eqx, m-ratio, m-pct, m-1var, m-2var, m-prob, m-infer, m-claims, m-area, m-lat, m-rtt, m-circ.

hard-topics.json
```json
{ "schema": 1, "items": [ { "id": "h-<short-slug>", "subject": "<Subject folder>", "topic": "<topic id>", "issue": "<the exact error>",
  "flagged": "YYYY-MM-DD", "source": "class|school-test|worksheet|observation", "resolved": false, "resolvedOn": null } ] }
```
paper-history.json
```json
{ "schema": 1, "papers": [ { "id": "<date>-<slug>", "date": "YYYY-MM-DD", "title": "…", "type": "worksheet|test|drill|revision|sat|pack|classwork|guide",
  "subject": "<Subject folder>", "topics": ["<topic id>"], "total": 20,
  "files": { "paper": "<rel path>", "solutions": "<rel path>" }, "prompt": "prompt-log/<file>.md or omit",
  "skills": [], "questions": [ { "n": 1, "topic": "<topic id>", "difficulty": "MH", "skill": "…", "correct": true, "mistake": null } ],
  "score": { "got": 23, "of": 27 }, "mistakes": [], "marked": false, "notes": "", "superseded": false } ] }
```

## Rules
- Never delete or rewrite earlier class-log history entries.
- Never delete papers, topics or hard-topic items; resolve or supersede them instead.
- Never send, reply to or modify any email.
- Only touch the files listed under Files.
