// Supabase Edge Function: lemon-webhook
//
// Lemon Squeezy calls this whenever an order or license key changes. It:
//   1. checks the notification really came from Lemon Squeezy (signed with your webhook secret),
//   2. saves a private copy of the order / license key in Supabase (store_* tables),
//   3. on a FULL refund, disables that order's license keys through the Lemon Squeezy API,
//   4. writes every step to store_events, so the admin Orders page can show what happened.
//
// Self-contained (no imports) so it can be pasted into the Supabase dashboard editor.
// Secrets it needs (Supabase -> Edge Functions -> Secrets):
//   LEMON_WEBHOOK_SECRET  the "Signing secret" you typed when creating the Lemon Squeezy webhook
//   LEMON_API_KEY         a Lemon Squeezy API key (Settings -> API), used to disable keys
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
// "Verify JWT" must be OFF for this function: Lemon Squeezy can't send a Supabase token.

declare const Deno: any;

export interface Deps {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
}

const LS_API = "https://api.lemonsqueezy.com/v1";
const enc = new TextEncoder();

// ---- signature ----------------------------------------------------------------
export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifySignature(secret: string, body: string, signature: string): Promise<boolean> {
  if (!secret || !signature) return false;
  return sameText(await hmacHex(secret, body), signature.trim().toLowerCase());
}

// ---- database (Supabase REST, with the service-role key) ----------------------
function dbHeaders(deps: Deps): Record<string, string> {
  const key = deps.env("STORE_SERVICE_KEY") || deps.env("SUPABASE_SERVICE_ROLE_KEY") || "";
  const h: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_")) h.Authorization = `Bearer ${key}`; // legacy JWT keys also go here
  return h;
}

async function upsert(deps: Deps, table: string, rows: object[], onConflict: string): Promise<void> {
  if (!rows.length) return;
  const url = `${deps.env("SUPABASE_URL")}/rest/v1/${table}?on_conflict=${onConflict}`;
  const res = await deps.fetch(url, {
    method: "POST",
    headers: { ...dbHeaders(deps), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Saving to ${table} failed (${res.status}): ${await res.text()}`);
}

async function logEvent(deps: Deps, e: { event_name: string; ls_object_id?: string; test_mode?: boolean; outcome: string; detail?: string }) {
  try {
    const res = await deps.fetch(`${deps.env("SUPABASE_URL")}/rest/v1/store_events`, {
      method: "POST",
      headers: { ...dbHeaders(deps), Prefer: "return=minimal" },
      body: JSON.stringify([{ ls_object_id: null, test_mode: false, detail: null, ...e }]),
    });
    if (!res.ok) console.error("store_events insert failed", res.status, await res.text());
  } catch (err) {
    console.error("store_events insert failed", err);
  }
}

// ---- turning Lemon Squeezy objects into rows ---------------------------------
export function orderRow(id: string, a: any): Record<string, unknown> {
  const item = a.first_order_item || {};
  return {
    ls_order_id: String(id),
    order_number: a.order_number ?? null,
    identifier: a.identifier ?? null,
    status: a.status || "unknown",
    test_mode: !!a.test_mode,
    customer_name: a.user_name ?? null,
    customer_email: a.user_email ?? null,
    product_name: item.product_name ?? null,
    variant_name: item.variant_name ?? null,
    currency: a.currency ?? null,
    subtotal: a.subtotal ?? null,
    tax: a.tax ?? null,
    total: a.total ?? null,
    total_usd: a.total_usd ?? null,
    refunded: !!a.refunded,
    refunded_at: a.refunded_at ?? null,
    refunded_amount: a.refunded_amount ?? null,
    receipt_url: a.urls?.receipt ?? null,
    created_at: a.created_at ?? null,
    updated_at: a.updated_at ?? null,
    synced_at: new Date().toISOString(),
    raw: a,
  };
}

export function keyRow(id: string, a: any): Record<string, unknown> {
  return {
    ls_key_id: String(id),
    ls_order_id: a.order_id != null ? String(a.order_id) : null,
    key_short: a.key_short ?? null,
    status: a.status ?? null,
    disabled: !!a.disabled,
    activation_limit: a.activation_limit ?? null,
    instances_count: a.instances_count ?? null,
    test_mode: !!a.test_mode,
    created_at: a.created_at ?? null,
    updated_at: a.updated_at ?? null,
    synced_at: new Date().toISOString(),
  };
}

// ---- disabling keys after a refund -------------------------------------------
function lsHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
    Authorization: `Bearer ${apiKey}`,
  };
}

export async function disableKeysForOrder(deps: Deps, orderId: string, testMode: boolean): Promise<void> {
  const apiKey = deps.env("LEMON_API_KEY");
  if (!apiKey) {
    await logEvent(deps, { event_name: "key_disable", ls_object_id: orderId, test_mode: testMode, outcome: "error",
      detail: "LEMON_API_KEY is not set, so the key wasn't disabled. Disable it by hand in Lemon Squeezy." });
    return;
  }
  const list = await deps.fetch(`${LS_API}/license-keys?filter%5Border_id%5D=${encodeURIComponent(orderId)}`,
    { headers: lsHeaders(apiKey) });
  if (!list.ok) {
    await logEvent(deps, { event_name: "key_disable", ls_object_id: orderId, test_mode: testMode, outcome: "error",
      detail: `Couldn't look up the order's keys (${list.status}). Disable them by hand in Lemon Squeezy.` });
    return;
  }
  const keys: any[] = (await list.json()).data || [];
  if (!keys.length) {
    await logEvent(deps, { event_name: "key_disable", ls_object_id: orderId, test_mode: testMode, outcome: "skipped",
      detail: "No license keys found for this order." });
    return;
  }
  for (const k of keys) {
    const short = k.attributes?.key_short || k.id;
    if (k.attributes?.disabled) {
      await upsert(deps, "store_license_keys", [keyRow(k.id, k.attributes)], "ls_key_id");
      await logEvent(deps, { event_name: "key_disable", ls_object_id: String(k.id), test_mode: testMode, outcome: "skipped",
        detail: `Key ${short} was already disabled.` });
      continue;
    }
    const res = await deps.fetch(`${LS_API}/license-keys/${k.id}`, {
      method: "PATCH",
      headers: lsHeaders(apiKey),
      body: JSON.stringify({ data: { type: "license-keys", id: String(k.id), attributes: { disabled: true } } }),
    });
    if (res.ok) {
      const updated = (await res.json()).data || k;
      await upsert(deps, "store_license_keys", [keyRow(updated.id, { ...updated.attributes, disabled: true })], "ls_key_id");
      await logEvent(deps, { event_name: "key_disable", ls_object_id: String(k.id), test_mode: testMode, outcome: "ok",
        detail: `Key ${short} disabled after the refund of order ${orderId}.` });
    } else {
      await logEvent(deps, { event_name: "key_disable", ls_object_id: String(k.id), test_mode: testMode, outcome: "error",
        detail: `Lemon Squeezy refused to disable key ${short} (${res.status}). Disable it by hand.` });
    }
  }
}

// ---- the request handler -------------------------------------------------------
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const secret = deps.env("LEMON_WEBHOOK_SECRET") || "";
  if (!secret) return json(500, { error: "LEMON_WEBHOOK_SECRET is not set" });
  const raw = await req.text();
  if (!(await verifySignature(secret, raw, req.headers.get("x-signature") || ""))) {
    return json(401, { error: "Bad signature" });
  }
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: "Body isn't JSON" });
  }
  const event: string = payload?.meta?.event_name || "unknown";
  const test = !!payload?.meta?.test_mode;
  const data = payload?.data || {};
  const a = data.attributes || {};
  try {
    if (event === "order_created" || event === "order_refunded") {
      await upsert(deps, "store_orders", [orderRow(data.id, a)], "ls_order_id");
      const who = a.user_email ? ` from ${a.user_email}` : "";
      await logEvent(deps, { event_name: event, ls_object_id: String(data.id), test_mode: test, outcome: "ok",
        detail: event === "order_created"
          ? `Order #${a.order_number ?? data.id}${who}, ${a.total_formatted ?? a.total}.`
          : `Order #${a.order_number ?? data.id}${who} is now "${a.status}".` });
      if (event === "order_refunded") {
        if (a.status === "refunded") {
          await disableKeysForOrder(deps, String(data.id), test);
        } else {
          await logEvent(deps, { event_name: "key_disable", ls_object_id: String(data.id), test_mode: test, outcome: "skipped",
            detail: "Partial refund: the license key stays active." });
        }
      }
    } else if (event === "license_key_created" || event === "license_key_updated") {
      await upsert(deps, "store_license_keys", [keyRow(data.id, a)], "ls_key_id");
      await logEvent(deps, { event_name: event, ls_object_id: String(data.id), test_mode: test, outcome: "ok",
        detail: `Key ${a.key_short ?? data.id} is "${a.status}"${a.disabled ? " (disabled)" : ""}.` });
    } else {
      await logEvent(deps, { event_name: event, ls_object_id: data.id ? String(data.id) : undefined, test_mode: test,
        outcome: "skipped", detail: "Not an event this function handles." });
    }
    return json(200, { ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    await logEvent(deps, { event_name: event, ls_object_id: data.id ? String(data.id) : undefined, test_mode: test,
      outcome: "error", detail: msg.slice(0, 500) });
    return json(500, { error: "Couldn't save; Lemon Squeezy will retry." });
  }
}

if (typeof Deno !== "undefined" && Deno.serve) {
  Deno.serve((req: Request) => handle(req, { env: (k) => Deno.env.get(k), fetch: (...args) => fetch(...args) }));
}
