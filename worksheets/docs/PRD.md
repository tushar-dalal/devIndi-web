# Class Manager — PRD

**Owner:** Tushar Dalal · **Date:** 2026-10-13 · **Status:** v1 built (`worksheets/`)
**Source:** *Tutoring Worksheet System — How I Work (Pre-PRD Brief)*, 2026-10-13

---

## 1. Problem

Tushar tutors three US high-school students one-to-one (Harika, Adithyaa "Adi", Bhargav).
Each needs very different papers: different subjects, difficulty by context, exclusions,
tools, conventions and weak spots. Today every paper request is typed freehand into a
Claude chat. That is slow, and it goes wrong in predictable ways:

- **Student rules get mixed up** (one student's difficulty or exclusions applied to another).
  This is the error he has had to correct most often.
- **History is forgotten.** A new 5-4 worksheet repeats question types she already did,
  or skips the mistake she made yesterday.
- **The end-of-week "hard topics" paper** takes many messages to describe, though the data
  (class logs, results) already exists.
- The current **SAT Paper Maker** (`papergen/`) only covers SAT and relies on a stored question
  bank, which the new workflow doesn't use.

## 2. Solution in one paragraph

A small, single-user web app that **reads the Students folder** (which Claude keeps up to date
from chat), lets Tushar pick a student, paper type, subject, topics, counts and difficulty
in a few clicks, and **assembles one complete, student-correct prompt**. Claude then writes
the paper and answer key from that prompt, saves the PDFs into the student's folder and
logs the paper in `paper-history.json`, so the next prompt knows about it.
**The app writes prompts, never questions.** It stores nothing except prompt logs and templates.

## 3. Users

- **Primary (only) user:** Tushar, on a Windows laptop, in Chrome or Edge.
- **Indirect:** students receive the printed or emailed PDFs. They never use the app.

## 4. Goals and non-goals

### Goals
| # | Goal | Measure |
|---|------|---------|
| G1 | A weekly hard-topics paper in ≤ 3 clicks after opening the app | Home → student card "Hard this week" → Generate |
| G2 | Zero cross-student rule mix-ups | Every prompt is built only from the active student's files; the student's name and colour show on every screen and in every file name |
| G3 | No repeated questions, mistakes revisited | The prompt always includes that student's history on the selected topics |
| G4 | Folder changes show up immediately | Re-read on open and on Refresh; per-file "last changed" shown |
| G5 | Replace SAT Paper Maker | SAT sections (R&W 27 Q / 32 min, Math 22 Q / 35 min) and vocab sets available as presets |

### Non-goals (v1)
- A question bank, or any stored questions.
- Writing questions, or reading Fathom, Gmail or school files. Claude does all of this in chat.
- Editing profiles, syllabi, hard topics or results in the app (all edits are made in chat).
- Student or parent logins, invoicing, multi-tutor use.

## 5. Decisions on the brief's open questions

| Open question | Decision | Why |
|---|---|---|
| How does the prompt reach Claude? | **Copy + log.** "Copy prompt" puts the full prompt on the clipboard and writes it to `prompt-log/`. Tushar pastes it into his Claude project chat. | That chat already has folder access, the PDF builder scripts (`Claude outputs/`), sympy and his commands. A direct API send would need a second way to reach the folder and to build PDFs. This can be revisited later (§12). |
| Where does the app run? | **On the laptop, at `http://localhost:4777`**, served by a tiny Node server (`worksheets/server/serve.mjs`) that already knows the folder (`D:\Tushars\Students`, overridable with `WB_STUDENTS`). It starts hidden at Windows sign-in (Startup shortcut). The devindi.in page just forwards to it. *(Revised 2026-10-13: the first build asked the browser for folder access, which meant a connect step each visit.)* | Nothing to connect, ever. The server listens on 127.0.0.1 only, rejects other Host headers, and can write only `prompt-log/*.md` and `templates.json`. |
| How long can the history get? | **Last 5 papers per selected topic**, newest first, each on one or two lines (skills covered, score, mistakes). Mistakes from older papers are kept if still unresolved. Hard cap of 60 history lines, with a note when trimmed. | Keeps prompts under ~3–4k tokens while keeping what matters. |
| Final folder contract? | **Yes, final for v1**: the brief's contract, made precise in [`folder-contract.md`](folder-contract.md) (JSON schemas, `schema: 1`). | Claude writes to it, so it must be exact. |
| Back-fill of existing papers | Done once by Claude in chat (seed files written on 2026-10-13 from class logs and the PDFs on disk). From then on, each prompt tells Claude to append to `paper-history.json`. | — |
| SAT Paper Maker features to keep | SAT domain/skill lists (built in as master syllabi), section presets and timing. The question bank and in-browser PDF rendering are **not** carried over. `papergen/` stays online until Tushar confirms the switch. | The brief replaces the question bank with Claude-authored papers. |

## 6. Data model (the folder is the database)

```
Students\
  _syllabi\<Master name>.json   optional shared master syllabi (e.g. "AP Statistics")
  <Student>\
    student.json                profile + standing rules                 (Claude writes)
    hard-topics.json            flagged hard topics + specific issue     (Claude writes)
    paper-history.json          every paper given, per-question records  (Claude writes)
    templates.json              saved request templates                  (app writes)
    prompt-log\                 every prompt generated, as .md           (app writes)
    <Subject>\syllabus.json     units → topics → skills, status          (Claude writes)
```

- **Subjects** shown for a student = sub-folders that contain a `syllabus.json`.
- **Topic status:** `upcoming` → `received` → `reviewed` → `taught` → `practised` → `tested`, plus `weak`.
  "Taught or later" = taught, practised, tested, weak.
- **Two numbering systems:** each unit and topic has `code` (course) and an optional `schoolCode`.
  Labels in prompts and file names use the school's code.
- **Shared master syllabus:** a `syllabus.json` can set `"master": "AP Statistics"` and only hold
  per-student status. SAT R&W and SAT Math masters are built into the app.
- **Cross-unit skills** (e.g. "exponent rules") are a unit marked `"crossUnit": true`.
- **Temporary rules:** any rule can have `until: "YYYY-MM-DD"`. It is used until that date, then ignored.

The full schemas are in [`folder-contract.md`](folder-contract.md).

## 7. Requirements

### P0 — must have
1. **No connect step:** the app opens straight onto the Students folder (path known by the local server); "Refresh" re-reads everything; the folder path and last-scanned time are shown.
2. **Student cards:** name (serif), personal colour dot, grade, school, subject pills, last class date, a clay-red "N hard topics this week" badge, and the freshness of the newest file.
3. **Flow:** Student → Paper type → Subject → Topics → Options → Review, with a clickable step trail showing the choices made.
4. **Paper type presets:** Worksheet (≤ 20 Q), Test (optional Part A re-test), Targeted drill (7–10 Q), Revision (20–25 Q, adds weak skills), SAT section (R&W 27 Q / 32 min; Math 22 Q / 35 min), Study pack (guide + worksheet + solutions).
5. **Topic picker:** the syllabus outline in order. Units with substance are full ink, the rest faded. Each topic shows its status and last-practised date. Filters: *All · Taught+ (default) · Hard this week · Hard 2 weeks · Hard (all unresolved)*, plus search. Hard topics carry the word "Hard" and their specific issue.
6. **Per-topic settings:** count stepper, difficulty (M · MH · H · VH · Ramp from→to), optional note, remove. Running total. "Set all to…". "Split total across topics" (weak topics get any remainder first).
7. **Defaults from the student:** the difficulty default comes from the student's rule for the paper's context (worksheet/drill/revision = alone at home; test/SAT = test prep; study pack = class). Calculator comes from tools; the cap comes from the paper type and the student's rules.
8. **Prompt builder** with sections: Who · What · Scope · Per-topic request · Hard topics · History · Standing rules · Layout · Quality · Saving.
9. **Review and edit** the prompt (monospace, editable) before copying.
10. **Copy + log:** one click copies the prompt and writes `prompt-log/<date> <time> <title>.md` (with the request as JSON, for re-runs).
11. **History view:** a timeline per student from `paper-history.json`, with topic chips, score, mistakes, and links that open the PDF and the prompt used.
12. **Loud errors:** missing or malformed files are listed inline with the file name and the reason (e.g. `Statistics/syllabus.json: unit 2, topic 2D has no title`). A broken file never blocks the other students.

### P1 — should have
13. **Re-test mistakes:** pre-selects the topics of wrong answers from the last 14 days and puts the exact mistakes into the prompt.
14. **Saved templates** per student (e.g. "Harika weekend test"), shown as pills under the paper types.
15. **Re-run** a past prompt: same scope, rebuilt with fresh history ("new questions").
16. **Remember choices** (last student, filter, paper size) in browser storage, used as a convenience only.
17. **Keyboard:** 1–9 picks cards and tiles, Enter continues, Esc goes back, `/` focuses search, Ctrl+Enter goes to Review, Ctrl+Shift+C copies.

### P2 — could have / later
- Mixed-subject papers (weekend test across subjects).
- When a rule changes, list past materials that break it and offer a rebuild prompt.
- Mark a material as superseded from the history view (written to `paper-history.json` by Claude).
- Direct send through the Claude API, once Claude can save to the folder from that path.

## 8. The prompt (contract with Claude)

The prompt is plain text with fixed headings, so Claude (and Tushar) can scan it:

```
Make a WORKSHEET for Harika (9th grade, Westlake High School, Algebra 2 Honors).
Title: … · N questions · time limit · calculator · order · paper size · questions per page

SCOPE AND COUNTS        one block per topic: school code + title, unit (school numbering),
                        skills, school style notes, count, difficulty, note
HARD TOPICS             issue, date flagged, source
RE-TEST (PART A)        only for tests / re-test mode: exact recent mistakes
HISTORY ON THESE TOPICS last 5 papers per topic: date, title, skills, score, mistakes
                        + "cover skills not yet practised, revisit mistakes, never repeat a question"
STANDING RULES          difficulty for this context, emphasis, exclusions, tools, conventions, habits
LAYOUT                  the house worksheet standard (§9)
QUALITY                 sympy-verify maths; second-pass check for non-maths; new numbers; flag key errors
SAVE TO                 exact folder + file names; append the paper to paper-history.json (schema given)
```

The full prompt also names the student at the top and bottom ("This paper is for Harika only").
This guards against the student mix-up error (G2).

## 9. Layout standard Claude must follow (passed in every prompt)

US Letter portrait (A4 option). 2–3 questions per page (short questions 3, long ones or ones with a figure 2); a question never
splits across pages. A light rounded work-space box with an answer line. Page-1 header: title,
student, subject, unit, topics, date, question count, time limit, calculator icon, and Name / Date / Score lines.
Each question: a large serif number, difficulty stars (★ M, ★★ MH, ★★★ H, ★★★★ VH) and a small topic tag.
Footer: "page X of Y" and the title. The answer key uses the same numbering and has final answers, worked
solutions and calculator keystrokes, with "Tutor copy" in the header band.

## 10. Design

Following brief §12a: an editorial, calm look. Warm paper background (#F7F4EE) / deep ink (#121212),
**one accent** (terracotta), a clay-red tint for hard topics, sage green for success. Fraunces
(display), Inter (UI, tabular figures), JetBrains Mono (prompt). One step owns the screen at a time;
a sticky summary bar from Topics onwards (total, estimated pages, difficulty mix bar, Generate).
Light and dark themes. AA contrast, visible focus rings, hard topics labelled in words. Laptop first;
on a phone the two panes stack.

## 11. Edge cases

| Case | Handling |
|---|---|
| Students mixed up | Each student's data is loaded separately. The student's colour dot and name show in the trail on every step. The prompt names the student at the start and end, and file names include the student's folder. |
| Course vs school numbering | Both are stored; the school's is shown first in the picker and used in prompts and file names. |
| Errors in school keys | Syllabus `keyErrors` are passed as "do NOT copy" warnings, never as answers. |
| Non-maths subjects | The quality section switches to "second-pass answer-key review; Tushar reviews before printing" for subjects with `"verify": "review"`. |
| Figures | Prompt asks for figures to be drawn from code (matplotlib/TikZ) and checked against the stated values. |
| Temporary rules | Rules with `until` are dropped automatically after that date; shown with "(until …)" while active. |
| Topic in hard-topics.json not in the syllabus | Shown as a warning with the file name; the hard topic is still usable under "Unlisted topics". |
| Local server not running | The page says so and shows the one command to start it. If a log write fails, the prompt is still copied and the log is offered as a download. |
| Over the cap (e.g. > 20 on a worksheet) | Soft warning in the summary bar. The SAT section count is fixed by the preset, but can be changed. |

## 12. Rollout

1. **Done (2026-10-13):** seed files for all three students from class logs and existing PDFs; app v1 with P0 and P1 features.
2. **Done (2026-10-13):** `/sync-class-logs` now updates the class log and all four JSON files (and handles results Tushar reports in chat);
   `/prep-tomorrow` reads them and appends every paper it makes to `paper-history.json`. Sources: `worksheets/skills/`.
3. After two weeks of use, retire `papergen/` (with confirmation).
