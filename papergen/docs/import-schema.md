# Question bank import format

The Question Bank tab's **Import batch** accepts a JSON array of question
objects in this shape. Every question in the array is validated before
anything is written — if even one fails, nothing in the batch is imported
(you get a per-index list of what to fix and re-run).

```json
[
  {
    "subject": "Math",
    "domain": "Algebra",
    "subtopic": "Linear equations in one variable",
    "difficulty": 4,
    "type": "mcq",
    "questionText": "If 3x + 7 = 22, what is the value of x?",
    "choices": [
      { "label": "A", "text": "3" },
      { "label": "B", "text": "5" },
      { "label": "C", "text": "7" },
      { "label": "D", "text": "9" }
    ],
    "correctAnswer": "B",
    "images": []
  },
  {
    "subject": "Math",
    "domain": "Geometry and Trigonometry",
    "subtopic": "Circles",
    "difficulty": 7,
    "type": "gridin",
    "questionText": "A circle has area 49π. What is its radius?",
    "correctAnswer": "7",
    "images": [
      {
        "svg": "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='220'>...</svg>",
        "alt": "Circle with radius r and area labeled 49π"
      }
    ]
  }
]
```

## Fields

| Field | Required | Notes |
|---|---|---|
| `subject` | yes | `"Math"` or `"English"` exactly. |
| `domain` | yes | Must be one of the content domains for that subject (e.g. `"Algebra"`, `"Craft and Structure"`) — see the full tree below. |
| `subtopic` | yes | Must be a subtopic listed under that domain. Domain/subtopic pairs are checked against the same tree the topic-picker UI uses (`js/syllabus.js`) — a typo here fails import with a specific error, not a silent miss. |
| `difficulty` | yes | Integer 1–10. 10 is hardest. |
| `type` | yes | `"mcq"` or `"gridin"`. `"gridin"` is **rejected for English** — grid-in is Math only. |
| `questionText` | yes | Plain text. Line breaks are respected; no markdown/HTML. |
| `choices` | mcq only | Array of `{ "label": "A", "text": "..." }`. At least 2 entries. Labels don't have to be A–D, but `correctAnswer` must match one of them exactly. |
| `correctAnswer` | yes | For `mcq`: must equal one of `choices[].label`. For `gridin`: the expected value as a string (e.g. `"7"`, `"3/4"`, `"-2.5"`). |
| `images` | no | Array of image objects — one of three shapes. **`{ "svg": "<svg ...>...</svg>", "alt": "..." }`** is the preferred/normal case: raw SVG markup for a figure (chart, graph, geometry diagram, number line) authored inline in the same file, no separate asset needed. It's rasterized to a print-ready PNG automatically on import, at 2x scale — the SVG needs an explicit `width`/`height` or `viewBox` so the app knows its intrinsic size. `{ "dataUrl": "data:image/png;base64,...", "alt": "..." }` and `{ "url": "https://...", "alt": "..." }` are also accepted for a pre-rendered raster image (a photo, a scanned figure) — `url` is the least reliable of the three, since the browser has to fetch it at generation time. Width/height are auto-detected on import if not supplied. |
| `sourceBatch` | no | Overrides the batch tag you type into the Import modal, per-question. Usually leave this out and just set the tag once for the whole batch — it's how a bad AI-generated batch gets identified and pulled later via the Question Bank tab's **Delete batch** control. |

`id`, `usageCount`, `createdAt`, and the printable short ID (`shortCode`)
are assigned automatically on import — don't include them.

## Validation errors you might see

- `subject must be one of Math/English, got "math"` — case-sensitive.
- `"Algebra → Slope-intercept form" is not a valid domain/subtopic for Math` — the subtopic string must match Appendix A exactly, including punctuation (e.g. `"Ratios, rates, proportional relationships, and units"`, not a paraphrase).
- `grid-in questions are not valid for English (Math only)`.
- `correctAnswer must match one of the choice labels (A, B, C, D)`.
- `difficulty must be an integer 1–10, got 4.5`.

## Full domain / subtopic tree

**Math** (44 questions per paper)
- Algebra — Linear equations in one variable; Linear functions; Linear equations in two variables; Systems of two linear equations in two variables; Linear inequalities in one or two variables
- Advanced Math — Nonlinear functions; Nonlinear equations in one variable and systems of equations in two variables; Equivalent expressions
- Problem-Solving and Data Analysis — Ratios, rates, proportional relationships, and units; Percentages; One-variable data: distributions and measures of center/spread; Two-variable data: models and scatterplots; Probability and conditional probability; Inference from sample statistics and margin of error; Evaluating statistical claims
- Geometry and Trigonometry — Area and volume; Lines, angles, and triangles; Right triangles and trigonometry; Circles

**English** (54 questions per paper)
- Craft and Structure — Words in context; Text structure and purpose; Cross-text connections
- Information and Ideas — Central ideas and details; Inferences; Command of evidence
- Standard English Conventions — Boundaries; Form, structure, and sense
- Expression of Ideas — Rhetorical synthesis; Transitions

This is the same tree `js/syllabus.js` uses for the topic picker and the
importer's validation — it's the single source of truth, so it can't drift
out of sync with the app.

See [`authoring-prompt.md`](authoring-prompt.md) for a ready-to-run prompt
that outputs directly into this format.
