// Claude API list prices (USD per million tokens), used only to turn local
// Claude Code log token counts into an "API-equivalent" dollar value. A
// Pro/Max subscriber doesn't actually pay this — it's what the same usage
// would have cost on the metered API, which is exactly the number the
// renew-or-cut verdict compares the subscription price against.
//
// Cache pricing follows Anthropic's standard multipliers unless overridden:
// 5-minute cache write = 1.25× input, 1-hour cache write = 2× input,
// cache read = 0.1× input. Update this table when prices change.

const CLAUDE_PRICES = [
  // prefix,              input, output, cacheRead override
  ["claude-fable-5-1",     10,    50,    0.25],
  ["claude-fable-5",       10,    50],
  ["claude-mythos",        10,    50],
  ["claude-opus-5-5",      4,     20,    0.20],
  ["claude-opus-5",        5,     25],
  ["claude-opus-4-8",      5,     25],
  ["claude-opus-4-7",      5,     25],
  ["claude-opus-4-6",      5,     25],
  ["claude-opus-4-5",      5,     25],
  ["claude-opus-4-1",      15,    75],
  ["claude-opus-4",        15,    75],
  ["claude-sonnet-5",      2,     10],
  ["claude-sonnet-4",      3,     15],   // 4, 4.5, 4.6
  ["claude-3-7-sonnet",    3,     15],
  ["claude-3-5-sonnet",    3,     15],
  ["claude-haiku-4-5",     1,     5],
  ["claude-3-5-haiku",     0.8,   4],
  ["claude-3-haiku",       0.25,  1.25]
];

function claudePriceFor(model) {
  if (!model) return null;
  const m = model.toLowerCase();
  let best = null;
  for (const row of CLAUDE_PRICES) {
    if (m.startsWith(row[0]) && (!best || row[0].length > best[0].length)) best = row;
  }
  if (!best) return null;
  const [, input, output, cacheRead] = best;
  return {
    input,
    output,
    cacheWrite5m: input * 1.25,
    cacheWrite1h: input * 2,
    cacheRead: cacheRead != null ? cacheRead : input * 0.1
  };
}

// usage: an Anthropic Messages `usage` object as Claude Code logs it.
function claudeCostUsd(model, usage) {
  const p = claudePriceFor(model);
  if (!p || !usage) return 0;
  const cc = usage.cache_creation || {};
  let write1h = cc.ephemeral_1h_input_tokens || 0;
  let write5m = cc.ephemeral_5m_input_tokens || 0;
  // Older logs only carry the combined figure; treat it as 5-minute writes.
  if (!write1h && !write5m) write5m = usage.cache_creation_input_tokens || 0;
  return (
    (usage.input_tokens || 0) * p.input +
    (usage.output_tokens || 0) * p.output +
    write5m * p.cacheWrite5m +
    write1h * p.cacheWrite1h +
    (usage.cache_read_input_tokens || 0) * p.cacheRead
  ) / 1e6;
}
