---
name: "prep-tomorrow"
description: "Prepare all material for tomorrow's tutoring classes (Bhargav, Harika, Adithyaa), skipping students already prepared, and log every paper made into the student's paper-history.json. Use for /prep-tomorrow, 'prepare tomorrow's classes', or when Tushar pastes a Class Manager prompt."
---

# Prep Tomorrow's Classes

Start replies with "Hi Tushar!".

## Students and folders (Tushar's laptop, D:\Tushars\Students)
- **Bhargav**: AP Calculus 2, SAT Math (Hard/Very Hard only). Folder `Bhargav\` — `AP Calculus 2\<Topic>\`, `AP Calculus 2\In-Class Work\`, `SAT Math\Practice Papers\`
- **Harika**: Algebra II. Folder `Harika\Algebra II\Unit N - <Topic>\`. Medium difficulty for anything she does alone; extra weight on quadratics with real solutions; calculator, never Gaussian elimination.
- **Adithyaa (Adi)**: Physics, AP Statistics, SAT English (medium-hard), English essays, Heartlinks. Folder `Adithyaa\<Subject>\Unit N\`. Show calculator routes alongside hand methods.

These one-liners are a summary. **The source of truth for each student's rules is `<S>\student.json`**; if they differ, follow student.json.

Each student folder also holds the Class Manager files (schemas are in the sync-class-logs skill):
`student.json` (rules), `<Subject>\syllabus.json` (topics + status), `hard-topics.json` (specific struggles), `paper-history.json` (every paper given: topics, question types, scores, mistakes).

If D:\Tushars\Students isn't connected, request access to it first.

## Steps
1. **Sync first.** Run the `sync-class-logs` skill so each class log **and** each student's JSON files reflect the latest Fathom recap.
2. **Read context.** For each student read:
   - the class log's `## Current Status` and the newest `Next class: what and how` block;
   - `student.json` (active rules only: skip rules whose `until` has passed; apply rules with a `subject` only to that subject);
   - unresolved items in `hard-topics.json`;
   - `paper-history.json` entries for the topics you'll cover (what was asked, scores, mistakes);
   - the project doc `students/<name>.md`, the memory file for that student, and the project `preferences.md`.
3. **Who has class tomorrow.** Assume all three unless the logs/recaps or Tushar say otherwise (e.g. a test date, a cancelled class). State the assumption in the reply.
4. **Skip check (per student).** List the student's folder recursively. A student counts as *already prepared* when every item in the next-class plan that needs a printed resource already has a matching file (dated for tomorrow, or created after the last class and named for that topic). Activities that need no paper (homework checks, reading aloud, oral recall) don't need a file. If everything is covered, skip that student and say which existing files to use.
5. **Build only the gaps.** Typical gaps: a warm-up/re-test sheet targeting the last class's errors, an answer key for assigned homework, a mock test before a school test, a drill for a misconception, or a new topic pack in the standard structure (study guide with 3 practice Qs per section + worksheet ≤20 Q + solutions). Rules:
   - Aim re-test and warm-up questions at the exact `issue` text of unresolved hard topics, not just the topic.
   - Never repeat questions already in that student's guides/worksheets or listed in `paper-history.json`; use fresh numbers and cover question types not yet practised.
   - Use only topics at `taught` status or later in `syllabus.json` (unless it's a preview pack Tushar asked for). Never copy anything listed in a topic's `keyErrors`.
   - Verify every answer with sympy/scipy before building (differentiate antiderivatives back). For non-maths subjects (`verify: "review"`), do a second independent pass over the key.
   - Build PDFs with LaTeX using `Harika\Claude outputs\study_packs\guide.sty` (override `\lhead`/`\rhead` for subject and student). Student sheet + separate tutor Solutions file.
   - Naming: in-class sheets `YYYY-MM-DD Class Warm-up.pdf` (+ ` Solutions`) in `In-Class Work\`; topic files `<Topic> Worksheet.pdf` / `<Topic> Solutions.pdf` / `0 - Study Guide - <Topic>.pdf` in the topic folder.
6. **Save.** Commit each PDF into the student's folder (never overwrite an existing file; pick a new name). Save the generator script to `Harika\Claude outputs\study_packs\gen_<date>_prep.py`.
7. **Record.**
   a. Append one entry per paper to the student's `paper-history.json`: `date` (the class date it's for), `title`, `type` (`classwork` for warm-ups/in-class sheets, else worksheet/test/drill/revision/sat/pack), `subject` (the folder name), `topics` (topic ids from syllabus.json), `total`, `files` (`paper` + `solutions`, relative to the student folder with `/`), `skills`, and `questions` with one `{ "n", "topic", "difficulty", "skill" }` per question. Set `marked: false`. Parse the JSON before committing, and commit with expectedMtimeMs.
   b. Add a line to the student's project doc (`students/<name>.md`) under Materials made / the subject section: date, file names, what it targets.
8. **Report.** One line per student: prepared (files + what they target) or skipped (which existing files cover the plan). Mention anything needing Tushar's decision.

## Class Manager prompts
When Tushar pastes a prompt from the Class Manager app (it starts "Make a … for <Student>" and ends "This paper is for <Student> only"), follow that prompt exactly: its scope, counts, difficulty, rules, layout, file names and folder. Then append the paper to `paper-history.json` as it says, with the `prompt` field set to the prompt-log path it gives. Use steps 5 (build rules) and 7 above for anything the prompt leaves open.

## Rules
- Don't edit or delete existing files, except: the class logs and JSON files via sync-class-logs, and appending to `paper-history.json` in step 7.
- Never touch `prompt-log\`, `templates.json` or `extra-hours.json` (the app owns them).
- Never send or modify emails.
