// Supabase Edge Function: admin-orders
//
// The devIndi admin Orders page asks this function for the private order records.
// It only answers when it's sent your real admin email and password: it hashes them
// exactly like admin/index.html does and compares with ADMIN_LOGIN_HASH, here on the
// server, where a visitor can't skip the check.
//
//   POST { email, password, action: "list" }  -> orders, license keys and recent events
//   POST { email, password, action: "sync" }  -> first copies every order and key from
//                                               Lemon Squeezy (fills gaps), then lists
//
// Self-contained (no imports) so it can be pasted into the Supabase dashboard editor.
// Secrets (Supabase -> Edge Functions -> Secrets):
//   ADMIN_LOGIN_HASH  the EXPECTED_HASH value from admin/index.html
//   LEMON_API_KEY     only needed for "sync"
//   ADMIN_ORIGINS     optional; comma-separated sites allowed to call this
//                     (default: https://devindi.in, https://www.devindi.in, http://localhost:8743)
// "Verify JWT" must be OFF for this function (it does its own check).

declare const Deno: any;

export interface Deps {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const LS_API = "https://api.lemonsqueezy.com/v1";
const DEFAULT_ORIGINS = "https://devindi.in,https://www.devindi.in,http://localhost:8743";

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isAdmin(deps: Deps, email: unknown, password: unknown): Promise<boolean> {
  const expected = (deps.env("ADMIN_LOGIN_HASH") || "").trim().toLowerCase();
  if (!expected || typeof email !== "string" || typeof password !== "string" || !password) return false;
  return sameText(await sha256Hex(email.trim().toLowerCase() + ":" + password), expected);
}

// ---- database -----------------------------------------------------------------
function dbHeaders(deps: Deps): Record<string, string> {
  const key = deps.env("STORE_SERVICE_KEY") || deps.env("SUPABASE_SERVICE_ROLE_KEY") || "";
  const h: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_")) h.Authorization = `Bearer ${key}`;
  return h;
}

async function select(deps: Deps, query: string): Promise<any[]> {
  const res = await deps.fetch(`${deps.env("SUPABASE_URL")}/rest/v1/${query}`, { headers: dbHeaders(deps) });
  if (!res.ok) throw new Error(`Reading ${query.split("?")[0]} failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

async function upsert(deps: Deps, table: string, rows: object[], onConflict: string): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    const res = await deps.fetch(`${deps.env("SUPABASE_URL")}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: "POST",
      headers: { ...dbHeaders(deps), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(i, i + 200)),
    });
    if (!res.ok) throw new Error(`Saving to ${table} failed (${res.status}): ${await res.text()}`);
  }
}

async function logEvent(deps: Deps, row: Record<string, unknown>) {
  try {
    await deps.fetch(`${deps.env("SUPABASE_URL")}/rest/v1/store_events`, {
      method: "POST",
      headers: { ...dbHeaders(deps), Prefer: "return=minimal" },
      body: JSON.stringify([row]),
    });
  } catch { /* the log is best-effort */ }
}

// ---- rows (same mapping as lemon-webhook) ----------------------------------------
function orderRow(id: string, a: any): Record<string, unknown> {
  const item = a.first_order_item || {};
  return {
    ls_order_id: String(id), order_number: a.order_number ?? null, identifier: a.identifier ?? null,
    status: a.status || "unknown", test_mode: !!a.test_mode, customer_name: a.user_name ?? null,
    customer_email: a.user_email ?? null, product_name: item.product_name ?? null,
    variant_name: item.variant_name ?? null, currency: a.currency ?? null, subtotal: a.subtotal ?? null,
    tax: a.tax ?? null, total: a.total ?? null, total_usd: a.total_usd ?? null, refunded: !!a.refunded,
    refunded_at: a.refunded_at ?? null, refunded_amount: a.refunded_amount ?? null,
    receipt_url: a.urls?.receipt ?? null, created_at: a.created_at ?? null, updated_at: a.updated_at ?? null,
    synced_at: new Date().toISOString(), raw: a,
  };
}

function keyRow(id: string, a: any): Record<string, unknown> {
  return {
    ls_key_id: String(id), ls_order_id: a.order_id != null ? String(a.order_id) : null,
    key_short: a.key_short ?? null, status: a.status ?? null, disabled: !!a.disabled,
    activation_limit: a.activation_limit ?? null, instances_count: a.instances_count ?? null,
    test_mode: !!a.test_mode, created_at: a.created_at ?? null, updated_at: a.updated_at ?? null,
    synced_at: new Date().toISOString(),
  };
}

// ---- pulling everything from Lemon Squeezy -------------------------------------
async function pullAll(deps: Deps, apiKey: string, resource: string): Promise<any[]> {
  const out: any[] = [];
  let url: string | null = `${LS_API}/${resource}?page%5Bsize%5D=100`;
  for (let page = 0; url && page < 100; page++) {
    const res: Response = await deps.fetch(url, {
      headers: { Accept: "application/vnd.api+json", Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Lemon Squeezy ${resource} request failed (${res.status})`);
    const body = await res.json();
    out.push(...(body.data || []));
    url = body.links?.next || null;
  }
  return out;
}

async function sync(deps: Deps): Promise<string> {
  const apiKey = deps.env("LEMON_API_KEY");
  if (!apiKey) throw new Error("LEMON_API_KEY is not set, so there's nothing to sync from.");
  const orders = await pullAll(deps, apiKey, "orders");
  const keys = await pullAll(deps, apiKey, "license-keys");
  await upsert(deps, "store_orders", orders.map((o) => orderRow(o.id, o.attributes || {})), "ls_order_id");
  await upsert(deps, "store_license_keys", keys.map((k) => keyRow(k.id, k.attributes || {})), "ls_key_id");
  const detail = `Copied ${orders.length} order(s) and ${keys.length} license key(s) from Lemon Squeezy.`;
  await logEvent(deps, { event_name: "sync", outcome: "ok", detail, test_mode: false, ls_object_id: null });
  return detail;
}

// ---- handler ------------------------------------------------------------------
function cors(deps: Deps, origin: string | null): Record<string, string> {
  const allowed = (deps.env("ADMIN_ORIGINS") || DEFAULT_ORIGINS).split(",").map((s) => s.trim());
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    Vary: "Origin",
  };
  if (origin && allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const headers = { ...cors(deps, req.headers.get("origin")), "Content-Type": "application/json" };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "POST only" });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "Body isn't JSON" });
  }
  if (!(await isAdmin(deps, body.email, body.password))) {
    await (deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))))(800); // slow down guessing
    return reply(401, { error: "Wrong admin email or password." });
  }
  try {
    let note = "";
    if (body.action === "sync") note = await sync(deps);
    const [orders, keys, events] = await Promise.all([
      select(deps, "store_orders?select=ls_order_id,order_number,identifier,status,test_mode,customer_name,customer_email,product_name,variant_name,currency,subtotal,tax,total,total_usd,refunded,refunded_at,refunded_amount,receipt_url,created_at,updated_at&order=created_at.desc&limit=2000"),
      select(deps, "store_license_keys?select=*&limit=5000"),
      select(deps, "store_events?select=*&order=received_at.desc&limit=200"),
    ]);
    return reply(200, { orders, keys, events, note });
  } catch (err) {
    return reply(500, { error: err instanceof Error ? err.message : String(err) });
  }
}

if (typeof Deno !== "undefined" && Deno.serve) {
  Deno.serve((req: Request) => handle(req, { env: (k) => Deno.env.get(k), fetch: (...args) => fetch(...args) }));
}
