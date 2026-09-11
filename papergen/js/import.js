// Question bank import: validates a batch against the schema documented in
// docs/import-schema.md before writing anything (PRD P0.2 — every valid
// question is added, every invalid one is reported by index with a specific
// error, and no partial/corrupt records are written on a failed batch).

const VALID_TYPES = ["mcq", "gridin"];
const VALID_SUBJECTS = ["Math", "English"];

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function shortCode(id) {
  return "Q-" + id.replace(/-/g, "").slice(0, 6).toUpperCase();
}

function validateQuestionShape(raw, index) {
  const errors = [];
  const tag = (msg) => errors.push(`[${index}] ${msg}`);

  if (!raw || typeof raw !== "object") {
    return [`[${index}] not an object`];
  }

  if (!VALID_SUBJECTS.includes(raw.subject)) {
    tag(`subject must be one of ${VALID_SUBJECTS.join("/")}, got ${JSON.stringify(raw.subject)}`);
  }
  if (typeof raw.domain !== "string" || !raw.domain) {
    tag(`domain is required`);
  }
  if (typeof raw.subtopic !== "string" || !raw.subtopic) {
    tag(`subtopic is required`);
  }
  if (
    VALID_SUBJECTS.includes(raw.subject) &&
    raw.domain && raw.subtopic &&
    !isValidSubtopic(raw.subject, raw.domain, raw.subtopic)
  ) {
    tag(`"${raw.domain} → ${raw.subtopic}" is not a valid domain/subtopic for ${raw.subject} (see Appendix A / docs/import-schema.md)`);
  }

  if (!Number.isInteger(raw.difficulty) || raw.difficulty < 1 || raw.difficulty > 10) {
    tag(`difficulty must be an integer 1–10, got ${JSON.stringify(raw.difficulty)}`);
  }

  if (!VALID_TYPES.includes(raw.type)) {
    tag(`type must be one of ${VALID_TYPES.join("/")}, got ${JSON.stringify(raw.type)}`);
  }
  if (raw.type === "gridin" && raw.subject === "English") {
    tag(`grid-in questions are not valid for English (Math only)`);
  }

  if (typeof raw.questionText !== "string" || !raw.questionText.trim()) {
    tag(`questionText is required`);
  }

  if (raw.type === "mcq") {
    if (!Array.isArray(raw.choices) || raw.choices.length < 2) {
      tag(`mcq questions need a choices array with at least 2 entries`);
    } else {
      const labels = raw.choices.map((c) => c && c.label);
      for (const c of raw.choices) {
        if (!c || typeof c.label !== "string" || typeof c.text !== "string" || !c.text.trim()) {
          tag(`each choice needs a { label, text }`);
          break;
        }
      }
      if (typeof raw.correctAnswer !== "string" || !labels.includes(raw.correctAnswer)) {
        tag(`correctAnswer must match one of the choice labels (${labels.join(", ")})`);
      }
    }
  } else if (raw.type === "gridin") {
    if (raw.choices != null && raw.choices.length > 0) {
      tag(`gridin questions must not have choices`);
    }
    if (raw.correctAnswer == null || String(raw.correctAnswer).trim() === "") {
      tag(`correctAnswer is required for gridin questions`);
    }
  }

  if (raw.images != null) {
    if (!Array.isArray(raw.images)) {
      tag(`images must be an array if present`);
    } else {
      raw.images.forEach((img, i) => {
        if (!img || (!img.svg && !img.dataUrl && !img.url)) {
          tag(`images[${i}] needs one of svg, dataUrl, or url`);
        }
        if (img && img.svg && typeof img.svg !== "string") {
          tag(`images[${i}].svg must be a string of SVG markup`);
        }
      });
    }
  }

  return errors;
}

function loadImageDims(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: null, height: null });
    img.src = dataUrl;
  });
}

// Rasterizes an inline SVG figure (the format the AI authoring workflow
// produces — see docs/authoring-prompt.md) to a PNG data URL at import
// time, at 2x scale for print crispness. Loading it via an <img>/Image()
// element (rather than injecting the markup into the DOM) means embedded
// <script>/event-handler content in the SVG never executes — browsers
// treat SVG-as-image-source as static raster content.
function svgToPngDataUrl(svgMarkup) {
  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const w = Math.max(1, img.naturalWidth || 400);
      const h = Math.max(1, img.naturalHeight || Math.round(w * 0.75));
      const canvas = document.createElement("canvas");
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve({ dataUrl: canvas.toDataURL("image/png"), width: w, height: h });
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error("could not rasterize SVG — check the markup has an explicit width/height or viewBox"));
    };
    img.src = url;
  });
}

async function normalizeQuestion(raw, sourceBatch) {
  const images = [];
  if (Array.isArray(raw.images)) {
    for (const img of raw.images) {
      if (img.svg) {
        const rasterized = await svgToPngDataUrl(img.svg);
        images.push({ src: rasterized.dataUrl, width: rasterized.width, height: rasterized.height, alt: img.alt || "", svg: img.svg });
        continue;
      }
      const src = img.dataUrl || img.url;
      let dims = { width: img.width, height: img.height };
      if ((!dims.width || !dims.height) && img.dataUrl) {
        dims = await loadImageDims(img.dataUrl);
      }
      images.push({ src, width: dims.width || null, height: dims.height || null, alt: img.alt || "" });
    }
  }
  const id = uuid();
  return {
    id,
    shortCode: shortCode(id),
    subject: raw.subject,
    domain: raw.domain,
    subtopic: raw.subtopic,
    difficulty: raw.difficulty,
    type: raw.type,
    questionText: raw.questionText.trim(),
    choices: raw.type === "mcq" ? raw.choices.map((c) => ({ label: c.label, text: c.text.trim() })) : null,
    correctAnswer: String(raw.correctAnswer),
    images,
    usageCount: 0,
    createdAt: new Date().toISOString(),
    sourceBatch: raw.sourceBatch || sourceBatch || "unlabeled"
  };
}

class ImportValidationError extends Error {
  constructor(errors) {
    super(`${errors.length} question(s) failed validation:\n${errors.join("\n")}`);
    this.name = "ImportValidationError";
    this.errors = errors;
  }
}

async function importBatch(rawArray, sourceBatchTag, onProgress) {
  if (!Array.isArray(rawArray)) {
    throw new ImportValidationError(["input must be a JSON array of questions"]);
  }

  const allErrors = [];
  rawArray.forEach((raw, i) => {
    allErrors.push(...validateQuestionShape(raw, i));
  });
  if (allErrors.length > 0) {
    throw new ImportValidationError(allErrors);
  }

  const normalized = [];
  for (let i = 0; i < rawArray.length; i++) {
    normalized.push(await normalizeQuestion(rawArray[i], sourceBatchTag));
    if (onProgress) onProgress(i + 1, rawArray.length);
  }

  await QuestionsDB.addBatch(normalized);
  return { imported: normalized.length };
}
