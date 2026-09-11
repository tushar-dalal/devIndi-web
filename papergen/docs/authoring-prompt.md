# AI-assisted question authoring prompt

v1 keeps question authoring human-in-the-loop: run this prompt with an AI
assistant, review what comes back, save it as a single `.json` file, and
upload that file directly in the Question Bank tab's **Import batch**
modal. Nothing writes to the live bank automatically — that's deliberate
(see the PRD's Non-Goals).

The output is one self-contained file — question text, choices/answers,
and any figures a question needs, all in one JSON array. Figures are
authored as inline SVG markup (vector graphics), not linked or attached
separately, so there's nothing else to gather before uploading: the model
that writes the questions also draws the diagrams, in the same pass, as
text it can actually produce reliably.

## How to use it

1. Copy the prompt block below into Claude (or another capable model).
2. Fill in the bracketed request at the top — subject, domain/subtopic(s),
   difficulty range, and how many questions you want.
3. Save the model's output as a `.json` file (it should be pure JSON, no
   surrounding prose — if the model added any, strip it before saving).
4. Review it. Check for: correct answers actually being correct, difficulty
   that matches what you asked for, no duplicate/near-duplicate questions,
   and that any figure actually looks right (open the file in a text editor
   and skim the SVGs, or just import it — the bank table shows every
   question that came in, and you can delete-by-batch if something's off).
5. In the Question Bank tab, click **Import batch**, give it a batch tag
   (e.g. `2026-09-11-algebra-linear`), and either upload the file or paste
   its contents into the text box. The tag is what lets you find and pull
   this exact batch later with **Delete batch** if it turns out to be bad.
6. Import. If anything fails validation, the error names the index and the
   specific problem — fix that entry (or ask the AI to fix it) and
   re-upload the whole file.

## The prompt

```
You are generating SAT practice questions for a private tutoring question
bank. Output ONLY a single JSON array — no prose before or after, no
markdown code fences — matching this exact schema:

[
  {
    "subject": "Math" | "English",
    "domain": "<one of the content domains listed below, exact string>",
    "subtopic": "<one of that domain's subtopics, exact string>",
    "difficulty": <integer 1-10, 10 = hardest>,
    "type": "mcq" | "gridin",
    "questionText": "<the question, plain text, no markdown>",
    "choices": [{ "label": "A", "text": "..." }, ...]   // mcq only, omit for gridin
    "correctAnswer": "<matches a choice label for mcq, or the exact expected value for gridin>",
    "images": []   // include only if the question needs a figure — see below
  }
]

Rules:
- "gridin" is ONLY valid when subject is "Math". Never produce a gridin
  question for English.
- mcq questions need exactly 4 choices labeled A, B, C, D, with exactly one
  correct.
- gridin correctAnswer should be the simplest exact form (e.g. "3/4" or
  "0.75", not both; no units unless the question explicitly asks for a
  labeled quantity).
- difficulty should reflect actual SAT difficulty calibration, not just
  computational complexity — a hard *concept* tested simply is still easy;
  an easy concept wrapped in multi-step real-world context is harder.
- roughly 30% of Math questions should be set in real-world context, per
  the actual Digital SAT's own mix.
- English questions need a short passage (roughly 25-150 words) embedded in
  questionText before the actual question/prompt line.
- Do not reuse the same scenario, numbers, or passage topic across
  questions in one batch.

Figures (charts, graphs, geometric diagrams, number lines, tables rendered
as a figure):
- If, and only if, a question genuinely needs a figure to be answerable,
  add one entry to "images": { "svg": "<the full <svg>...</svg> markup>",
  "alt": "<one-sentence description of what it shows>" }.
- Draw the actual figure as SVG markup — real coordinates, real shapes,
  labeled precisely to match the numbers in the question. Do not describe
  a figure in words instead of drawing it, and do not reference an image
  file or URL — there is no separate asset step, the SVG you write IS the
  figure.
- The root <svg> element MUST declare an explicit width and height (or a
  viewBox), in plain unitless numbers, e.g. <svg xmlns="http://www.w3.org/2000/svg"
  width="320" height="240" viewBox="0 0 320 240">. Without this the app
  can't size the figure on the page.
- Use black/grayscale strokes and fills only (this prints on a
  black-and-white/grayscale test paper) — no color-coding that the
  question depends on being able to see in color.
- Keep text inside the SVG (axis labels, point labels) legible at roughly
  1x scale — don't rely on the viewer zooming in.
- A question with no figure should have "images": [] (or omit the field) —
  don't add an empty/decorative figure.

Now generate: [FILL IN — e.g. "18 Math questions: 10 from Algebra > Linear
equations in one variable, 8 from Algebra > Linear inequalities in one or
two variables, difficulty 3-6, mostly mcq with 3 gridin, include a couple
with a real number line or graph figure where it fits naturally"]
```

## Why SVG, not a generated image

A text-generating model can't reliably produce a bitmap image, but it can
write precise vector markup — coordinates, paths, labeled axes — as text,
in the same response as the question itself. That's what makes a single
uploadable file possible: no separate image-generation step, no manual
attaching of files, no risk of a figure and its question drifting apart.
The app rasterizes each SVG to a print-ready PNG automatically when you
import the file (see `import-schema.md`'s `images[].svg` field) — you
never have to convert anything by hand.

If a figure comes out wrong (mislabeled, wrong proportions, doesn't match
the question), the fix is to ask the model to redraw that one SVG, patch it
back into the file, and re-import — not to hand-edit vector paths yourself.
