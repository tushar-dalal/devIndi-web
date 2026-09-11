// PDF layout: the question paper and the answer key (PRD P0.6/P0.7).
//
// Runs entirely in the browser via the vendored jsPDF (vendor/jspdf.umd.min.js).
// Progress callbacks fire from real completed units of work — a question
// actually measured and drawn, an image actually decoded — not a timer, so
// the Generating screen's percentages are true (P0.8).

const PAGE = { width: 612, height: 792 }; // US Letter, points
const MARGIN = { top: 56, bottom: 56, left: 56, right: 56 };
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;

async function toDataUrl(src) {
  if (src.startsWith("data:")) return src;
  try {
    const res = await fetch(src, { mode: "cors" });
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return null;
  }
}

function imageFormatFromDataUrl(dataUrl) {
  const m = /^data:image\/(\w+);/.exec(dataUrl || "");
  if (!m) return "PNG";
  const t = m[1].toUpperCase();
  if (t === "JPG") return "JPEG";
  return t;
}

async function prepareImages(questions, onProgress) {
  // Resolves every image to a usable data URL and caches it on the image
  // object as `_resolvedSrc`. Unresolvable images are dropped (with a
  // console warning) rather than failing the whole generation.
  const allImages = [];
  for (const q of questions) {
    for (const img of q.images || []) allImages.push(img);
  }
  let done = 0;
  for (const img of allImages) {
    img._resolvedSrc = await toDataUrl(img.src);
    if (!img._resolvedSrc) console.warn("Could not resolve image", img.src);
    done++;
    if (onProgress) onProgress(done, allImages.length);
  }
  if (allImages.length === 0 && onProgress) onProgress(0, 0);
  return allImages.length;
}

function solvingSpaceLines(q) {
  if (q.type === "gridin") return 8;
  if (q.subject === "Math") return q.difficulty >= 7 ? 8 : 6;
  return 3; // English MC: annotation room, not full work space
}

function measureBlock(doc, q, contentWidth) {
  let h = 0;
  h += 16; // number + id line

  const img = (q.images || [])[0];
  let imgLayout = null;
  if (img && img._resolvedSrc && img.width && img.height) {
    const maxW = contentWidth;
    const maxH = 220;
    let w = maxW;
    let ih = w * (img.height / img.width);
    if (ih > maxH) {
      ih = maxH;
      w = ih * (img.width / img.height);
    }
    imgLayout = { w, h: ih };
    h += ih + 10;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const textLines = doc.splitTextToSize(q.questionText, contentWidth);
  h += textLines.length * 14 + 6;

  let choiceLines = [];
  if (q.type === "mcq") {
    doc.setFontSize(10.5);
    for (const c of q.choices) {
      const lines = doc.splitTextToSize(`${c.label}.  ${c.text}`, contentWidth - 18);
      choiceLines.push(lines);
      h += lines.length * 13.5;
    }
    h += 6;
  } else {
    h += 30; // grid-in answer box
  }

  const lines = solvingSpaceLines(q);
  h += 14 + lines * 15 + 10; // "Show your work" label + ruled lines + trailing gap

  h += 14; // divider gap after block

  return { height: h, textLines, choiceLines, imgLayout };
}

function drawRuledLines(doc, x, y, width, count, spacing) {
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  for (let i = 0; i < count; i++) {
    const ly = y + i * spacing;
    doc.line(x, ly, x + width, ly);
  }
  return y + count * spacing;
}

function drawBlock(doc, q, number, y, measured) {
  const x = MARGIN.left;
  const w = CONTENT_WIDTH;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`${number}.`, x, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(q.shortCode, x + w, y, { align: "right" });
  doc.setTextColor(0, 0, 0);
  y += 16;

  if (measured.imgLayout && q.images[0]._resolvedSrc) {
    const img = q.images[0];
    const ix = x + (w - measured.imgLayout.w) / 2;
    try {
      doc.addImage(img._resolvedSrc, imageFormatFromDataUrl(img._resolvedSrc), ix, y, measured.imgLayout.w, measured.imgLayout.h);
    } catch (e) {
      console.warn("addImage failed", e);
    }
    y += measured.imgLayout.h + 10;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  for (const line of measured.textLines) {
    doc.text(line, x, y);
    y += 14;
  }
  y += 6;

  if (q.type === "mcq") {
    doc.setFontSize(10.5);
    for (const lines of measured.choiceLines) {
      for (const line of lines) {
        doc.text(line, x + 18, y);
        y += 13.5;
      }
    }
    y += 6;
  } else {
    doc.setDrawColor(120, 120, 120);
    doc.setLineWidth(0.75);
    doc.rect(x, y, 160, 26);
    doc.setFontSize(9);
    doc.setTextColor(130, 130, 130);
    doc.text("Answer:", x + 6, y + 16);
    doc.setTextColor(0, 0, 0);
    y += 38;
  }

  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text("Show your work", x, y);
  doc.setTextColor(0, 0, 0);
  y += 12;
  const lineCount = solvingSpaceLines(q);
  y = drawRuledLines(doc, x, y + 4, CONTENT_WIDTH, lineCount, 15);
  y += 10;

  doc.setDrawColor(225, 225, 225);
  doc.setLineWidth(0.5);
  doc.line(x, y, x + w, y);
  y += 14;

  return y;
}

function drawSectionHeader(doc, subject, count) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(subject === "Math" ? "Section: Math" : "Section: Reading & Writing", MARGIN.left, MARGIN.top + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(110, 110, 110);
  doc.text(`${count} questions`, MARGIN.left, MARGIN.top + 26);
  doc.setTextColor(0, 0, 0);
  return MARGIN.top + 56;
}

function drawFooter(doc, pageNum) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(160, 160, 160);
  doc.text(String(pageNum), PAGE.width / 2, PAGE.height - 30, { align: "center" });
  doc.setTextColor(0, 0, 0);
}

async function buildQuestionPaperPdf(paper, paperName, onProgress) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let pageNum = 1;
  let questionsDone = 0;
  const totalQuestions = paper.all.length;

  const sections = [
    { subject: "Math", list: paper.Math },
    { subject: "English", list: paper.English }
  ].filter((s) => s.list.length > 0);

  let firstSection = true;
  for (const section of sections) {
    if (!firstSection) doc.addPage();
    firstSection = false;
    let y = drawSectionHeader(doc, section.subject, section.list.length);
    drawFooter(doc, pageNum);

    let num = 1;
    for (const q of section.list) {
      const measured = measureBlock(doc, q, CONTENT_WIDTH);
      if (y + measured.height > PAGE.height - MARGIN.bottom) {
        doc.addPage();
        pageNum++;
        drawFooter(doc, pageNum);
        y = MARGIN.top;
      }
      y = drawBlock(doc, q, num, y, measured);
      num++;
      questionsDone++;
      if (onProgress) onProgress(questionsDone, totalQuestions);
      if (questionsDone % 5 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  }

  return { doc, pages: doc.internal.getNumberOfPages() };
}

async function buildAnswerKeyPdf(paper, paperName, onProgress) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Answer Key", MARGIN.left, MARGIN.top);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(110, 110, 110);
  doc.text(paperName, MARGIN.left, MARGIN.top + 18);
  doc.setTextColor(0, 0, 0);

  let y = MARGIN.top + 46;
  const colWidth = CONTENT_WIDTH / 2;
  let col = 0;
  let done = 0;
  const total = paper.all.length;

  const sections = [
    { subject: "Math", list: paper.Math },
    { subject: "English", list: paper.English }
  ].filter((s) => s.list.length > 0);

  for (const section of sections) {
    if (y > PAGE.height - MARGIN.bottom - 40 || col !== 0) {
      if (col !== 0) { col = 0; }
      doc.addPage();
      y = MARGIN.top;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(section.subject === "Math" ? "Math" : "Reading & Writing", MARGIN.left, y);
    y += 20;

    let num = 1;
    for (const q of section.list) {
      const x = MARGIN.left + col * colWidth;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      doc.text(`${num}.`, x, y);
      doc.setFont("helvetica", "bold");
      doc.text(String(q.correctAnswer), x + 24, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(150, 150, 150);
      doc.text(q.shortCode, x + colWidth - 10, y, { align: "right" });
      doc.setTextColor(0, 0, 0);

      num++;
      done++;
      if (onProgress) onProgress(done, total);

      if (col === 0) {
        col = 1;
      } else {
        col = 0;
        y += 18;
        if (y > PAGE.height - MARGIN.bottom) {
          doc.addPage();
          y = MARGIN.top;
        }
      }
    }
    if (col !== 0) { y += 18; col = 0; }
    y += 14;
    if (done % 20 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  return { doc, pages: doc.internal.getNumberOfPages() };
}

function timestampedName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `SATPrepPaper_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
