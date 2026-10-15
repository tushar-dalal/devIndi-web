# Students folder contract (schema 1)

This is the contract between **Claude in chat** (which writes these files) and the
**Worksheet Builder** app (which reads them). The app ignores anything it doesn't
recognise. PDFs and school files stay exactly where they are.

```
D:\Tushars\Students\
  _syllabi\                       optional: shared master syllabi, one JSON per course
    AP Statistics.json
  Harika\
    student.json                  Claude writes
    hard-topics.json              Claude writes
    paper-history.json            Claude writes
    templates.json                app writes (saved paper requests)
    prompt-log\                   app writes (one .md per generated prompt)
    Algebra II\
      syllabus.json               Claude writes — its presence makes "Algebra II" a subject
      Unit 4 - Quadratics\        PDFs (school notes/keys, guides, worksheets, solutions)
```

General rules
- UTF-8 JSON, every file has `"schema": 1`.
- Dates are `YYYY-MM-DD`.
- Difficulty codes: `M` medium, `MH` medium-hard, `H` hard, `VH` very hard; a ramp is `"M>H"`.
- Paths inside files are **relative to the student folder**, with `/` separators.
- When you change a file, rewrite the whole file (no partial JSON). The app shows each file's last-modified time.

---

## student.json

```json
{
  "schema": 1,
  "name": "Harika",
  "fullName": "Harika Shankar",
  "nickname": null,
  "aliases": ["Harika S."],
  "color": "#B4532A",
  "grade": "9th grade",
  "school": "Westlake High School (Eanes ISD)",
  "city": "Austin, Texas",
  "timezone": "America/Chicago",
  "emails": { "student": "", "school": "" },
  "examContext": "School unit tests and mid-checks; no state exam for Algebra 2",
  "lastClass": "2026-10-13",
  "subjects": {
    "Algebra II": { "course": "Algebra 2 Honors", "level": "Honors" }
  },
  "difficulty": {
    "default":   { "home": "M", "class": "M>MH", "testPrep": "M>MH" },
    "SAT Math":  { "home": "H>VH", "class": "H", "testPrep": "H>VH" }
  },
  "rules": [
    { "type": "emphasis",   "text": "Extra weight on quadratic equations with real solutions" },
    { "type": "exclusion",  "text": "Never Gaussian elimination or row operations", "subject": "Algebra II" },
    { "type": "tool",       "text": "TI-84 graphing calculator; show keystrokes in solutions" },
    { "type": "convention", "text": "…", "subject": "AP Statistics" },
    { "type": "habit",      "text": "Rarely finishes long sets; keep it finishable" },
    { "type": "cap",        "text": "No more than 20 questions in a set", "max": 20 },
    { "type": "emphasis",   "text": "Algebra basics section", "until": "2026-10-19" }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Display name; must be unique across students. |
| `color` | no | Small personal dot so the active student is unmistakable. |
| `rate` | no | `{ "perHour": 1200, "currency": "INR" }` — used by the Class counter. |
| `subjects` | no | Per-subject course name and level (Honors, AP), keyed by the subject folder name. |
| `difficulty` | no | Per context: `home` (alone), `class` (with Tushar), `testPrep`. Key `default`, or a subject folder name to override. |
| `rules[].type` | yes | `difficulty` · `emphasis` · `exclusion` · `tool` · `convention` · `habit` · `cap` |
| `rules[].subject` | no | Limit the rule to one subject folder. |
| `rules[].until` | no | Temporary rule: ignored after this date. |
| `rules[].max` | for `cap` | The question cap. |
| `rules[].calculator` | no | On a `tool` rule: `true` turns the calculator toggle on by default. |

## <Subject>\syllabus.json

```json
{
  "schema": 1,
  "subject": "Algebra II",
  "kind": "school",
  "verify": "sympy",
  "currentUnit": "u4",
  "styleNotes": ["Word problems → define variables → system → matrix equation → A⁻¹B on calculator"],
  "units": [
    {
      "id": "u4",
      "code": "Unit 4",
      "schoolCode": "Unit 5",
      "title": "Quadratics",
      "schoolTitle": "Quadratic Functions",
      "folder": "Unit 4 - Quadratics",
      "topics": [
        {
          "id": "5-4",
          "code": "5-4",
          "schoolCode": "5-4",
          "title": "Solving quadratics using square roots",
          "skills": ["isolate the square", "± square root", "no-real-solution case", "simplest radical form", "word problems"],
          "status": "practised",
          "taught": "2026-10-13",
          "lastPractised": "2026-10-13",
          "styleNotes": [],
          "materials": ["Algebra II/Unit 4 - Quadratics/Worksheet 5-4 KEY (26-27).pdf"],
          "keyErrors": ["School KEY Q7 prints one equation but solves another — do not copy"]
        }
      ]
    }
  ]
}
```

| Field | Notes |
|---|---|
| `kind` | `school` (default) or `sat`. SAT subjects get the SAT section presets. |
| `verify` | `sympy` (maths, default) or `review` (English, statistics wording, physics explanations): changes the quality section of the prompt. |
| `master` | Optional: the name of a master syllabus (`_syllabi/<master>.json`, or built-in `SAT Reading and Writing` / `SAT Math`). The units come from the master, and this file only needs `topicStatus`. |
| `topicStatus` | With `master`: `{ "<topicId>": { "status": "taught", "taught": "…", "lastPractised": "…" } }` |
| `units[].crossUnit` | `true` for a group of cross-unit skills (e.g. "Algebra basics"). |
| `units[].folder` | Folder inside the subject folder where this unit's PDFs live (used for "substance" and as the save path). |
| `topics[].status` | `upcoming` · `received` · `reviewed` · `taught` · `practised` · `tested` · `weak` |

**A unit has substance** when its folder contains any PDF, or any of its topics is at `taught` or later.

## hard-topics.json

```json
{
  "schema": 1,
  "items": [
    {
      "id": "h-2026-10-06-aos-sign",
      "subject": "Algebra II",
      "topic": "5-1",
      "issue": "Sign of −b/2a when b is negative",
      "flagged": "2026-10-06",
      "source": "class",
      "resolved": false,
      "resolvedOn": null
    }
  ]
}
```
`topic` is a topic `id` from that subject's syllabus. `source`: `class` · `school-test` · `worksheet` · `observation`.

## paper-history.json

```json
{
  "schema": 1,
  "papers": [
    {
      "id": "2026-10-07-5-1-to-5-3-mid-check",
      "date": "2026-10-07",
      "title": "5-1 to 5-3 Mid-Check Practice Test",
      "type": "test",
      "subject": "Algebra II",
      "topics": ["5-1", "5-2", "5-3"],
      "total": 18,
      "files": {
        "paper": "Algebra II/Unit 4 - Quadratics/5-1 to 5-3 Mid-Check Practice Test.pdf",
        "solutions": "Algebra II/Unit 4 - Quadratics/5-1 to 5-3 Mid-Check Practice Test Solutions.pdf"
      },
      "prompt": "prompt-log/2026-10-07 1830 5-1 to 5-3 Mid-Check Practice Test.md",
      "skills": ["axis of symmetry", "vertex", "max/min", "projectile"],
      "questions": [
        { "n": 1, "topic": "5-1", "difficulty": "M", "skill": "axis of symmetry", "correct": true, "mistake": null }
      ],
      "score": { "got": 16, "of": 18 },
      "mistakes": ["max vs min"],
      "marked": true,
      "superseded": false
    }
  ]
}
```
`type`: `worksheet` · `test` · `drill` · `revision` · `sat` · `pack` · `classwork` · `guide`.
`questions` is optional for back-filled papers; `skills` and `mistakes` then carry the summary.
A per-question `mistake` should name the actual error ("dropped ± when square-rooting").

## <Student> - Class Log.md (read by the Class counter)

Each class is one `### YYYY-MM-DD (Day[, 2nd session]) — Subject: Topic` heading under
`## Session History`, followed by a `Source:` line holding the class length as `NN min`
(e.g. `Source: Fathom recap "…", 86 min — <link>`). A class without a length is listed
but not billed. Billing rounds each class up to the next 15 minutes × `student.json` `rate`.

## extra-hours.json (app writes)

Billable work done outside class, entered on the Class counter page.
```json
{ "schema": 1, "entries": [ { "id": "x-…", "date": "2026-10-14", "hours": 1.5, "note": "built Unit 2 revision pack", "added": "<ISO time>" } ] }
```
Billed like classes: rounded up to 15 minutes × `rate`.

## templates.json (app writes)

```json
{ "schema": 1, "templates": [ { "name": "Harika weekend test", "request": { "…": "the app's saved request" } } ] }
```

## prompt-log\ (app writes)

One Markdown file per generated prompt: `YYYY-MM-DD HHMM <Title>.md`. The first line is an
HTML comment holding the request JSON (used by **Re-run**), followed by the prompt text.

---

## How Claude keeps this current (add to /sync-class-logs and /prep-tomorrow)

After each class recap:
1. `student.json` → `lastClass`; add/adjust `rules` the tutor stated (with `until` for one-off rules).
2. `<Subject>/syllabus.json` → move topics forward (`taught`, `lastPractised`); add new topics or units that arrived from school with status `received`.
3. `hard-topics.json` → add one item per specific struggle (topic + exact issue + date + source). Mark `resolved: true` with `resolvedOn` when a re-test goes cleanly.

After a paper is made from a Worksheet Builder prompt: append it to `paper-history.json` (with `questions`).
After results are reported: fill `score`, per-question `correct` / `mistake`, `marked: true`. Set the topic status to `tested` or `weak`, and update `hard-topics.json`.
