// SAT syllabus hierarchy (Digital SAT), from the PRD's Appendix A.
// Drives the topic-selection UI, the question bank's domain/subtopic fields,
// and the proportional-distribution math in selection.js.
//
// `weight` is each domain's share of its subject's total, taken from the
// real Digital SAT's own domain weighting. Weights are re-normalized across
// whichever domains a given generate actually selects (see selection.js).

const SYLLABUS = {
  Math: {
    total: 44,
    domains: {
      "Algebra": {
        weight: 0.35,
        subtopics: [
          "Linear equations in one variable",
          "Linear functions",
          "Linear equations in two variables",
          "Systems of two linear equations in two variables",
          "Linear inequalities in one or two variables"
        ]
      },
      "Advanced Math": {
        weight: 0.35,
        subtopics: [
          "Nonlinear functions",
          "Nonlinear equations in one variable and systems of equations in two variables",
          "Equivalent expressions"
        ]
      },
      "Problem-Solving and Data Analysis": {
        weight: 0.15,
        subtopics: [
          "Ratios, rates, proportional relationships, and units",
          "Percentages",
          "One-variable data: distributions and measures of center/spread",
          "Two-variable data: models and scatterplots",
          "Probability and conditional probability",
          "Inference from sample statistics and margin of error",
          "Evaluating statistical claims"
        ]
      },
      "Geometry and Trigonometry": {
        weight: 0.15,
        subtopics: [
          "Area and volume",
          "Lines, angles, and triangles",
          "Right triangles and trigonometry",
          "Circles"
        ]
      }
    }
  },
  English: {
    total: 54,
    domains: {
      "Craft and Structure": {
        weight: 0.28,
        subtopics: [
          "Words in context",
          "Text structure and purpose",
          "Cross-text connections"
        ]
      },
      "Information and Ideas": {
        weight: 0.26,
        subtopics: [
          "Central ideas and details",
          "Inferences",
          "Command of evidence"
        ]
      },
      "Standard English Conventions": {
        weight: 0.26,
        subtopics: [
          "Boundaries",
          "Form, structure, and sense"
        ]
      },
      "Expression of Ideas": {
        weight: 0.20,
        subtopics: [
          "Rhetorical synthesis",
          "Transitions"
        ]
      }
    }
  }
};

// Flat lookup: "Subject|Domain|Subtopic" -> true, used by the importer to
// reject questions tagged with a domain/subtopic that isn't in the tree.
const SYLLABUS_INDEX = (() => {
  const index = new Set();
  for (const [subject, subjectDef] of Object.entries(SYLLABUS)) {
    for (const [domain, domainDef] of Object.entries(subjectDef.domains)) {
      for (const subtopic of domainDef.subtopics) {
        index.add(`${subject}|${domain}|${subtopic}`);
      }
    }
  }
  return index;
})();

function isValidSubtopic(subject, domain, subtopic) {
  return SYLLABUS_INDEX.has(`${subject}|${domain}|${subtopic}`);
}

function domainsForSubject(subject) {
  return SYLLABUS[subject] ? Object.keys(SYLLABUS[subject].domains) : [];
}

function subtopicsForDomain(subject, domain) {
  const d = SYLLABUS[subject] && SYLLABUS[subject].domains[domain];
  return d ? d.subtopics : [];
}
