#!/usr/bin/env node
// Pulls a provider's last-30-day cost/usage report on your machine and writes
// it to a JSON file you import on the Connections page.
//
// Why this exists: the Anthropic Admin API doesn't allow browser (CORS)
// requests, so the static page can't call it directly. Running the same
// provider module here in Node sidesteps that — and the admin key stays in
// your terminal instead of browser storage.
//
// Usage (Node 18+):
//   ANTHROPIC_ADMIN_KEY=sk-ant-admin01-... node spendtracker/tools/pull.mjs anthropic
//   PowerShell: $env:ANTHROPIC_ADMIN_KEY="sk-ant-admin01-..."; node spendtracker/tools/pull.mjs anthropic
// Also works for openai (OPENAI_ADMIN_KEY) and openrouter (OPENROUTER_MANAGEMENT_KEY).

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const KEY_ENV = { anthropic: "ANTHROPIC_ADMIN_KEY", openai: "OPENAI_ADMIN_KEY", openrouter: "OPENROUTER_MANAGEMENT_KEY" };
const DAYS = 30;

const providerId = process.argv[2];
if (!KEY_ENV[providerId]) {
  console.error(`Usage: node pull.mjs <${Object.keys(KEY_ENV).join("|")}>`);
  process.exit(1);
}
const key = process.env[KEY_ENV[providerId]];
if (!key) {
  console.error(`Set ${KEY_ENV[providerId]} to your key first.`);
  process.exit(1);
}

// Load the browser provider modules unchanged, so there's one implementation.
const ctx = vm.createContext({ fetch, URL, console });
for (const f of ["pricing.js", "providers.js"]) {
  vm.runInContext(fs.readFileSync(path.join(here, "..", "js", f), "utf8"), ctx, { filename: f });
}
const provider = vm.runInContext("PROVIDERS", ctx)[providerId];

try {
  const { rows, meta } = await provider.fetchUsage({ key }, DAYS);
  const date = new Date().toISOString().slice(0, 10);
  const out = path.resolve(`ai-spend-${providerId}-${date}.json`);
  fs.writeFileSync(out, JSON.stringify({
    type: "spendtracker-provider-report",
    version: 1,
    provider: providerId,
    generatedAt: new Date().toISOString(),
    days: DAYS,
    meta,
    rows
  }, null, 2));
  const total = rows.reduce((s, r) => s + r.costUsd, 0);
  console.log(`${provider.name}: ${rows.length} day/model rows, $${total.toFixed(2)} over ${DAYS} days.`);
  console.log(`Wrote ${out}\nImport it on the Connections page.`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
