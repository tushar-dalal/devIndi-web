// One module per provider, all implementing the same shape so adding
// Cursor/Copilot in Phase 2 means one new entry here and nothing else:
//
//   { id, name, kind: "api" | "local", keyLabel, keyPattern, keyHelp, docsUrl,
//     fetchUsage(conn, days) -> Promise<{ rows, meta }> }
//
// rows: [{ date: "YYYY-MM-DD", model, costUsd, inputTokens, cacheTokens, outputTokens, requests }]
//   inputTokens = fresh (uncached) input; cacheTokens = cache reads + cache writes.
//
// Only aggregate cost/token metadata is ever read or stored — never prompt or
// completion content (PRD › Non-Functional Requirements › Privacy).

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDay(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function utcMidnight(daysAgo) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - daysAgo * DAY_MS);
}

class ProviderError extends Error {
  constructor(message, { auth = false } = {}) {
    super(message);
    this.auth = auth;
  }
}

async function getJson(url, headers, providerName) {
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (e) {
    throw new ProviderError(
      `${providerName} couldn't be reached from this browser (network error or the API refused a cross-origin request). ` +
      `Check your connection; if it persists, this provider needs the server-side pipeline from the PRD.`
    );
  }
  let body = null;
  try { body = await res.json(); } catch (_) { /* non-JSON error page */ }
  if (res.status === 401 || res.status === 403) {
    const detail = body && (body.error && (body.error.message || body.error)) || res.statusText;
    throw new ProviderError(`${providerName} rejected the key (${res.status}): ${typeof detail === "string" ? detail : JSON.stringify(detail)}`, { auth: true });
  }
  if (!res.ok) {
    const detail = body && (body.error && (body.error.message || body.error)) || res.statusText;
    throw new ProviderError(`${providerName} returned ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return body;
}

// Merge helper: rows keyed by date|model, summing numeric fields.
function rowBucket() {
  const map = new Map();
  return {
    add(date, model, fields) {
      const k = `${date}|${model}`;
      let r = map.get(k);
      if (!r) {
        r = { date, model, costUsd: 0, inputTokens: 0, cacheTokens: 0, outputTokens: 0, requests: 0 };
        map.set(k, r);
      }
      for (const [f, v] of Object.entries(fields)) r[f] += Number(v) || 0;
    },
    rows() { return [...map.values()]; }
  };
}

// ---------- OpenAI (Costs API + Completions usage, org admin key) ----------

const OpenAIProvider = {
  id: "openai",
  name: "OpenAI",
  kind: "api",
  keyLabel: "Admin API key",
  keyPattern: /^sk-admin-/,
  keyHelp: "An organization Admin key (sk-admin-…) from platform.openai.com → Settings → Admin keys. Project keys can't read org costs.",
  docsUrl: "https://platform.openai.com/docs/api-reference/usage/costs",

  async fetchUsage(conn, days) {
    const headers = { Authorization: `Bearer ${conn.key}` };
    const start = Math.floor(utcMidnight(days - 1).getTime() / 1000);
    const bucket = rowBucket();

    let page = null;
    do {
      const url = new URL("https://api.openai.com/v1/organization/costs");
      url.searchParams.set("start_time", start);
      url.searchParams.set("bucket_width", "1d");
      url.searchParams.set("limit", String(Math.min(days, 180)));
      url.searchParams.append("group_by", "line_item");
      if (page) url.searchParams.set("page", page);
      const body = await getJson(url, headers, "OpenAI");
      for (const b of body.data || []) {
        const date = isoDay(b.start_time * 1000);
        for (const r of b.results || []) {
          // line_item looks like "gpt-4o-2024-08-06, input" — keep the model part.
          const model = (r.line_item || "Other").split(",")[0].trim() || "Other";
          bucket.add(date, model, { costUsd: r.amount ? r.amount.value : 0 });
        }
      }
      page = body.has_more ? body.next_page : null;
    } while (page);

    // Token counts are a nice-to-have; a key without usage scope still yields costs.
    try {
      page = null;
      do {
        const url = new URL("https://api.openai.com/v1/organization/usage/completions");
        url.searchParams.set("start_time", start);
        url.searchParams.set("bucket_width", "1d");
        url.searchParams.set("limit", String(Math.min(days, 31)));
        url.searchParams.append("group_by", "model");
        if (page) url.searchParams.set("page", page);
        const body = await getJson(url, headers, "OpenAI");
        for (const b of body.data || []) {
          const date = isoDay(b.start_time * 1000);
          for (const r of b.results || []) {
            bucket.add(date, r.model || "Other", {
              // OpenAI's input_tokens already includes the cached portion.
              inputTokens: (r.input_tokens || 0) - (r.input_cached_tokens || 0),
              cacheTokens: r.input_cached_tokens,
              outputTokens: r.output_tokens,
              requests: r.num_model_requests
            });
          }
        }
        page = body.has_more ? body.next_page : null;
      } while (page);
    } catch (e) {
      if (e.auth) throw e;
    }

    return { rows: bucket.rows(), meta: {} };
  }
};

// ---------- Anthropic Console (Usage & Cost Admin API) ----------

const AnthropicProvider = {
  id: "anthropic",
  name: "Anthropic Console",
  kind: "api",
  keyLabel: "Admin API key",
  keyPattern: /^sk-ant-admin/,
  keyHelp: "Needs an organization Admin key (sk-ant-admin01-…) from Console → Settings → Admin keys. Claude.ai Pro/Max usage isn't included — use the Claude Code connection for that.",
  docsUrl: "https://platform.claude.com/docs/en/manage-claude/usage-cost-api",
  // The Admin API rejects cross-origin (CORS) preflights, so a static page
  // can't call it. tools/pull.mjs runs this same fetchUsage in Node instead.
  browserBlocked: true,

  async fetchUsage(conn, days) {
    const headers = {
      "x-api-key": conn.key,
      "anthropic-version": "2023-06-01"
    };
    const startIso = utcMidnight(days - 1).toISOString();
    const endIso = utcMidnight(-1).toISOString();
    const bucket = rowBucket();

    let page = null;
    do {
      const url = new URL("https://api.anthropic.com/v1/organizations/cost_report");
      url.searchParams.set("starting_at", startIso);
      url.searchParams.set("ending_at", endIso);
      url.searchParams.set("limit", String(Math.min(days, 31)));
      url.searchParams.append("group_by[]", "description");
      if (page) url.searchParams.set("page", page);
      const body = await getJson(url, headers, "Anthropic");
      for (const b of body.data || []) {
        const date = b.starting_at.slice(0, 10);
        for (const r of b.results || []) {
          // Amounts are decimal strings in cents.
          bucket.add(date, r.model || r.description || "Other", { costUsd: parseFloat(r.amount || "0") / 100 });
        }
      }
      page = body.has_more ? body.next_page : null;
    } while (page);

    try {
      page = null;
      do {
        const url = new URL("https://api.anthropic.com/v1/organizations/usage_report/messages");
        url.searchParams.set("starting_at", startIso);
        url.searchParams.set("ending_at", endIso);
        url.searchParams.set("bucket_width", "1d");
        url.searchParams.set("limit", String(Math.min(days, 31)));
        url.searchParams.append("group_by[]", "model");
        if (page) url.searchParams.set("page", page);
        const body = await getJson(url, headers, "Anthropic");
        for (const b of body.data || []) {
          const date = b.starting_at.slice(0, 10);
          for (const r of b.results || []) {
            const cc = r.cache_creation || {};
            bucket.add(date, r.model || "Other", {
              inputTokens: r.uncached_input_tokens,
              cacheTokens: (r.cache_read_input_tokens || 0) +
                (cc.ephemeral_1h_input_tokens || 0) + (cc.ephemeral_5m_input_tokens || 0),
              outputTokens: r.output_tokens
            });
          }
        }
        page = body.has_more ? body.next_page : null;
      } while (page);
    } catch (e) {
      if (e.auth) throw e;
    }

    return { rows: bucket.rows(), meta: {} };
  }
};

// ---------- OpenRouter (management key: /activity + /credits) ----------

const OpenRouterProvider = {
  id: "openrouter",
  name: "OpenRouter",
  kind: "api",
  keyLabel: "Management key",
  keyPattern: /^sk-or-/,
  keyHelp: "A Management key from openrouter.ai → Settings → Management keys. Regular inference keys can't read activity. OpenRouter only reports the last 30 completed UTC days.",
  docsUrl: "https://openrouter.ai/docs/api/api-reference/analytics/get-user-activity",

  async fetchUsage(conn) {
    const headers = { Authorization: `Bearer ${conn.key}` };
    const credits = await getJson("https://openrouter.ai/api/v1/credits", headers, "OpenRouter");
    const activity = await getJson("https://openrouter.ai/api/v1/activity", headers, "OpenRouter");
    const bucket = rowBucket();
    for (const r of activity.data || []) {
      bucket.add(r.date.slice(0, 10), r.model || "Other", {
        costUsd: r.usage,
        inputTokens: r.prompt_tokens,
        outputTokens: r.completion_tokens,
        requests: r.requests
      });
    }
    const c = credits.data || {};
    return {
      rows: bucket.rows(),
      meta: { creditsRemainingUsd: (c.total_credits || 0) - (c.total_usage || 0) }
    };
  }
};

// ---------- Claude Code (local JSONL session logs) ----------
//
// Stand-in for the PRD's local agent: instead of a background helper, the
// user points a folder picker at ~/.claude/projects and the browser parses
// the logs in place. Nothing leaves the machine, and only each assistant
// message's model + usage block is read — message content is skipped.

const ClaudeCodeProvider = {
  id: "claudecode",
  name: "Claude Code",
  kind: "local",
  keyLabel: null,
  keyHelp: "Reads the session logs Claude Code writes on this machine: %USERPROFILE%\\.claude\\projects on Windows, ~/.claude/projects on macOS/Linux. Costs are API-equivalent — what the same tokens would cost on the metered API.",
  docsUrl: "https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor",

  // files: FileList from <input webkitdirectory>. Returns rows for every day found.
  async parseFiles(files, onProgress) {
    const bucket = rowBucket();
    const seen = new Set();
    const jsonl = [...files].filter((f) => f.name.endsWith(".jsonl"));
    let lines = 0;
    for (let i = 0; i < jsonl.length; i++) {
      const text = await jsonl[i].text();
      for (const line of text.split("\n")) {
        // Cheap pre-filter so we never JSON.parse user-prompt lines.
        if (!line || line.indexOf('"usage"') === -1) continue;
        let entry;
        try { entry = JSON.parse(line); } catch (_) { continue; }
        const msg = entry.message;
        if (!msg || !msg.usage || !entry.timestamp) continue;
        const model = msg.model;
        if (!model || model === "<synthetic>") continue;
        // The same assistant message is logged once per content block; count it once.
        const dedupe = `${msg.id || ""}:${entry.requestId || ""}`;
        if (dedupe !== ":" && seen.has(dedupe)) continue;
        seen.add(dedupe);
        const u = msg.usage;
        const cost = typeof entry.costUSD === "number" ? entry.costUSD : claudeCostUsd(model, u);
        bucket.add(localDay(entry.timestamp), model, {
          costUsd: cost,
          inputTokens: u.input_tokens,
          cacheTokens: (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
          outputTokens: u.output_tokens,
          requests: 1
        });
        lines++;
      }
      if (onProgress) onProgress(i + 1, jsonl.length);
    }
    return { rows: bucket.rows(), fileCount: jsonl.length, messageCount: lines };
  }
};

// Claude Code timestamps are UTC; bucket them by the user's local day so
// "today" matches what they experienced.
function localDay(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const PROVIDERS = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  openrouter: OpenRouterProvider,
  claudecode: ClaudeCodeProvider
};

// Fixed series order + colors (validated for the dark surface: dataviz
// validate_palette.js, all checks pass). Color follows the provider, never rank.
const PROVIDER_ORDER = ["openai", "anthropic", "openrouter", "claudecode"];
const PROVIDER_COLORS = {
  openai: "#3987e5",
  anthropic: "#d95926",
  openrouter: "#199e70",
  claudecode: "#c98500"
};
