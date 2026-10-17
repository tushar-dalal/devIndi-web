// Fixed vocabulary for Class Manager: paper types, difficulty levels,
// topic statuses, and the built-in SAT master syllabi (carried over from the
// old Paper Generator's syllabus.js, re-keyed with stable topic ids so
// syllabus.json "topicStatus" maps and hard-topics.json can point at them).

const DIFFS = ["M", "MH", "H", "VH"];
const DIFF_NAMES = { M: "Medium", MH: "Medium-hard", H: "Hard", VH: "Very hard" };
const DIFF_STARS = { M: "★", MH: "★★", H: "★★★", VH: "★★★★" };

const STATUSES = ["upcoming", "received", "reviewed", "taught", "practised", "tested", "weak"];
const STATUS_LABEL = {
  upcoming: "Upcoming", received: "Material received", reviewed: "Reviewed",
  taught: "Taught", practised: "Practised", tested: "Tested", weak: "Weak"
};
// "Taught or later" — what the picker shows by default.
const USABLE = new Set(["taught", "practised", "tested", "weak"]);

const CONTEXT_LABEL = { home: "alone at home", class: "in class with me", testPrep: "test prep" };

const PAPER_TYPES = [
  {
    id: "worksheet", name: "Worksheet", blurb: "≤ 20 questions · homework",
    max: 20, context: "home", perTopic: 5, order: "difficulty", purpose: "Homework",
    icon: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9.5 12h5M9.5 15h5M9.5 18h3"/>'
  },
  {
    id: "test", name: "Test", blurb: "14–25 Q · optional Part A re-test",
    min: 14, max: 25, context: "testPrep", perTopic: 5, order: "topic", purpose: "Test prep", partA: true,
    icon: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v3h6V3"/><path d="M9 12l2 2 4-4"/><path d="M9 17h6"/>'
  },
  {
    id: "drill", name: "Targeted drill", blurb: "7–10 Q · one error pattern",
    min: 7, max: 10, context: "home", perTopic: 4, order: "difficulty", purpose: "Fix a specific error pattern",
    icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>'
  },
  {
    id: "revision", name: "Revision", blurb: "20–25 Q · mixed + weak skills",
    min: 20, max: 25, context: "home", perTopic: 3, order: "topic", purpose: "Weekend revision", addWeak: true,
    icon: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M4 20v-5h5"/>'
  },
  {
    id: "sat", name: "SAT section", blurb: "27 Q · 32 min  /  22 Q · 35 min",
    context: "testPrep", perTopic: 3, order: "sat", purpose: "Timed SAT practice", satOnly: true,
    icon: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h4"/><circle cx="17" cy="17" r="0.6"/>'
  },
  {
    id: "pack", name: "Study pack", blurb: "Guide + worksheet + solutions",
    max: 20, context: "class", perTopic: 6, order: "difficulty", purpose: "New topic: notes, worked examples, practice",
    icon: '<path d="M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4z"/><path d="M20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z"/>'
  }
];

// SAT section formats. R&W also offers the vocabulary-set format Adi uses.
const SAT_FORMATS = {
  "SAT Reading and Writing": [
    { id: "module", name: "Section module", total: 27, minutes: 32 },
    { id: "vocab", name: "Vocabulary set", total: 50, minutes: 55 }
  ],
  "SAT Math": [
    { id: "module", name: "Section module", total: 22, minutes: 35 }
  ]
};

// Built-in master syllabi. A student's SAT syllabus.json sets "master" to one
// of these names and only stores per-student topicStatus.
const BUILTIN_MASTERS = {
  "SAT Reading and Writing": {
    subject: "SAT Reading and Writing", kind: "sat", verify: "review",
    units: [
      { id: "rw-ii", code: "Information and Ideas", title: "Information and Ideas", topics: [
        { id: "rw-cid", title: "Central Ideas and Details" },
        { id: "rw-coe-t", title: "Command of Evidence: Textual" },
        { id: "rw-coe-q", title: "Command of Evidence: Quantitative" },
        { id: "rw-inf", title: "Inferences" }
      ] },
      { id: "rw-cs", code: "Craft and Structure", title: "Craft and Structure", topics: [
        { id: "rw-wic", title: "Words in Context" },
        { id: "rw-tsp", title: "Text Structure and Purpose" },
        { id: "rw-ctc", title: "Cross-Text Connections" }
      ] },
      { id: "rw-ei", code: "Expression of Ideas", title: "Expression of Ideas", topics: [
        { id: "rw-rs", title: "Rhetorical Synthesis" },
        { id: "rw-trans", title: "Transitions" }
      ] },
      { id: "rw-sec", code: "Standard English Conventions", title: "Standard English Conventions", topics: [
        { id: "rw-bound", title: "Boundaries" },
        { id: "rw-fss", title: "Form, Structure, and Sense" }
      ] }
    ]
  },
  "SAT Math": {
    subject: "SAT Math", kind: "sat", verify: "sympy",
    units: [
      { id: "m-alg", code: "Algebra", title: "Algebra", topics: [
        { id: "m-lin1", title: "Linear equations in one variable" },
        { id: "m-linf", title: "Linear functions" },
        { id: "m-lin2", title: "Linear equations in two variables" },
        { id: "m-sys", title: "Systems of two linear equations in two variables" },
        { id: "m-ineq", title: "Linear inequalities in one or two variables" }
      ] },
      { id: "m-adv", code: "Advanced Math", title: "Advanced Math", topics: [
        { id: "m-nlf", title: "Nonlinear functions" },
        { id: "m-nle", title: "Nonlinear equations in one variable and systems in two variables" },
        { id: "m-eqx", title: "Equivalent expressions" }
      ] },
      { id: "m-psda", code: "Problem-Solving and Data Analysis", title: "Problem-Solving and Data Analysis", topics: [
        { id: "m-ratio", title: "Ratios, rates, proportional relationships, and units" },
        { id: "m-pct", title: "Percentages" },
        { id: "m-1var", title: "One-variable data: distributions and measures of centre and spread" },
        { id: "m-2var", title: "Two-variable data: models and scatterplots" },
        { id: "m-prob", title: "Probability and conditional probability" },
        { id: "m-infer", title: "Inference from sample statistics and margin of error" },
        { id: "m-claims", title: "Evaluating statistical claims" }
      ] },
      { id: "m-geo", code: "Geometry and Trigonometry", title: "Geometry and Trigonometry", topics: [
        { id: "m-area", title: "Area and volume" },
        { id: "m-lat", title: "Lines, angles, and triangles" },
        { id: "m-rtt", title: "Right triangles and trigonometry" },
        { id: "m-circ", title: "Circles" }
      ] }
    ]
  }
};

// "M>H" → { from: "M", to: "H" }; "MH" → { from: "MH", to: "MH" }.
function parseDiff(code) {
  const s = String(code || "").replace(/\s|→/g, ">").replace(/-(?=[A-Z])/g, ">").toUpperCase();
  const parts = s.split(">").filter(Boolean);
  const ok = (x) => DIFFS.includes(x);
  if (parts.length >= 2 && ok(parts[0]) && ok(parts[parts.length - 1])) {
    return { from: parts[0], to: parts[parts.length - 1] };
  }
  if (parts.length && ok(parts[0])) return { from: parts[0], to: parts[0] };
  return null;
}

function diffText(code) {
  const d = parseDiff(code);
  if (!d) return code || "";
  if (d.from === d.to) return DIFF_NAMES[d.from].toLowerCase();
  return `ramp ${DIFF_NAMES[d.from].toLowerCase()} → ${DIFF_NAMES[d.to].toLowerCase()}`;
}

// Spread n questions over the levels a difficulty code covers (for the mix bar).
function diffSpread(code, n) {
  const d = parseDiff(code);
  const out = { M: 0, MH: 0, H: 0, VH: 0 };
  if (!d || !n) return out;
  const a = DIFFS.indexOf(d.from), b = DIFFS.indexOf(d.to);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const levels = DIFFS.slice(lo, hi + 1);
  levels.forEach((lv, i) => { out[lv] += Math.floor(n / levels.length) + (i < n % levels.length ? 1 : 0); });
  return out;
}
