// Paper-building algorithm: turns a topic/difficulty selection into a
// concrete list of questions, per PRD P0.4 and P0.5.
//
//   1. distributeCounts()   — largest-remainder rounding so a set of
//                              weighted buckets sums to an exact total.
//   2. planSection()        — re-normalizes domain weights across whatever
//                              the tutor selected, then splits each domain's
//                              share evenly across its selected subtopics.
//   3. checkAvailability()  — fails fast (P0.5) if any subtopic/difficulty
//                              slot doesn't have enough bank questions,
//                              naming every deficit at once.
//   4. weightedSampleWithoutReplacement() — Efraimidis-Spirakis weighted
//                              reservoir sampling, weight = 1/(usageCount+1),
//                              so unused questions are always favored over
//                              used ones without ever hard-excluding a used one.

function distributeCounts(total, items) {
  // items: [{ key, weight }] with weights summing to ~1. Returns
  // [{ key, count }] whose counts sum to exactly `total` (largest-remainder
  // / Hamilton apportionment, so no domain silently loses its rounding).
  const raw = items.map((it) => ({ key: it.key, exact: total * it.weight }));
  const floors = raw.map((r) => ({ key: r.key, count: Math.floor(r.exact), remainder: r.exact - Math.floor(r.exact) }));
  let assigned = floors.reduce((s, f) => s + f.count, 0);
  let remaining = total - assigned;
  const byRemainder = [...floors].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < remaining; i++) {
    byRemainder[i % byRemainder.length].count += 1;
  }
  return floors.map((f) => ({ key: f.key, count: f.count }));
}

function planSection(subject, domainSelection, defaultMin, defaultMax) {
  // domainSelection: { [domainName]: { included, min, max, subtopics: { [subtopicName]: included } } }
  const subjectDef = SYLLABUS[subject];
  const selectedDomains = Object.entries(domainSelection)
    .filter(([, d]) => d.included && Object.values(d.subtopics || {}).some(Boolean));
  if (selectedDomains.length === 0) return [];

  const domainWeightSum = selectedDomains.reduce((s, [name]) => s + subjectDef.domains[name].weight, 0);
  const domainCounts = distributeCounts(
    subjectDef.total,
    selectedDomains.map(([name]) => ({ key: name, weight: subjectDef.domains[name].weight / domainWeightSum }))
  );

  const slots = [];
  for (const { key: domain, count: domainCount } of domainCounts) {
    if (domainCount === 0) continue;
    const d = domainSelection[domain];
    const selectedSubtopics = Object.entries(d.subtopics).filter(([, on]) => on).map(([name]) => name);
    const subtopicCounts = distributeCounts(
      domainCount,
      selectedSubtopics.map((name) => ({ key: name, weight: 1 / selectedSubtopics.length }))
    );
    for (const { key: subtopic, count } of subtopicCounts) {
      if (count === 0) continue;
      slots.push({
        subject,
        domain,
        subtopic,
        count,
        min: d.min != null ? d.min : defaultMin,
        max: d.max != null ? d.max : defaultMax
      });
    }
  }
  return slots;
}

class GenerationError extends Error {
  constructor(deficits) {
    const lines = deficits.map(
      (d) => `${d.subject} → ${d.domain} → ${d.subtopic} (difficulty ${d.min}–${d.max}): needs ${d.needed}, bank has ${d.available}`
    );
    super(`Not enough questions in the bank to fill this paper:\n${lines.join("\n")}`);
    this.name = "GenerationError";
    this.deficits = deficits;
  }
}

async function checkAvailability(slots) {
  const deficits = [];
  const pools = [];
  for (const slot of slots) {
    const pool = await QuestionsDB.byPool(slot.subject, slot.domain, slot.subtopic, slot.min, slot.max);
    pools.push({ slot, pool });
    if (pool.length < slot.count) {
      deficits.push({ ...slot, needed: slot.count, available: pool.length });
    }
  }
  if (deficits.length > 0) throw new GenerationError(deficits);
  return pools;
}

function weightedSampleWithoutReplacement(pool, k) {
  // Efraimidis-Spirakis: key_i = U(0,1)^(1/weight_i); take top-k keys.
  const keyed = pool.map((item) => {
    const weight = 1 / ((item.usageCount || 0) + 1);
    const u = Math.random();
    return { item, key: Math.pow(u, 1 / weight) };
  });
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, k).map((k) => k.item);
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function buildPaper(selection, onProgress) {
  // selection: { math: { included, defaultMin, defaultMax, domains }, english: { ... } }
  const sections = [];
  if (selection.math && selection.math.included) {
    sections.push({ subject: "Math", slots: planSection("Math", selection.math.domains, selection.math.defaultMin, selection.math.defaultMax) });
  }
  if (selection.english && selection.english.included) {
    sections.push({ subject: "English", slots: planSection("English", selection.english.domains, selection.english.defaultMin, selection.english.defaultMax) });
  }

  const allSlots = sections.flatMap((s) => s.slots);
  const pools = await checkAvailability(allSlots);

  const bySubject = { Math: [], English: [] };
  let picked = 0;
  const totalToPick = allSlots.reduce((s, sl) => s + sl.count, 0);
  for (const { slot, pool } of pools) {
    const chosen = weightedSampleWithoutReplacement(pool, slot.count);
    bySubject[slot.subject].push(...chosen);
    picked += chosen.length;
    if (onProgress) onProgress(picked, totalToPick);
  }

  shuffleInPlace(bySubject.Math);
  shuffleInPlace(bySubject.English);

  return {
    Math: bySubject.Math,
    English: bySubject.English,
    all: [...bySubject.Math, ...bySubject.English]
  };
}
