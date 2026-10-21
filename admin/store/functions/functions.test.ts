// Tests for the two store functions, with Supabase and Lemon Squeezy simulated.
// Run from the devIndi folder:  node --test admin/store/functions/functions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as hook from "./lemon-webhook/index.ts";
import * as admin from "./admin-orders/index.ts";

const SECRET = "whsec-test-123";
const ADMIN_EMAIL = "owner@example.com";
const ADMIN_PASSWORD = "correct horse battery staple";

async function sha256Hex(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// A tiny fake of Supabase's REST API + Lemon Squeezy's API.
function world(opts: { lsKeys?: any[]; dbFails?: boolean; lsPages?: Record<string, any[]> } = {}) {
  const db: Record<string, Map<string, any> | any[]> = {
    store_orders: new Map(), store_license_keys: new Map(), store_events: [] as any[],
  };
  const lsKeys = opts.lsKeys ?? [];
  const calls: string[] = [];
  const fetchFn = async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = (init.method || "GET").toUpperCase();
    calls.push(`${method} ${url.host}${url.pathname}`);
    if (url.host === "db.test") {
      if (opts.dbFails) return new Response("boom", { status: 500 });
      const table = url.pathname.split("/").pop()!;
      if (method === "POST") {
        const rows = JSON.parse(init.body);
        if (table === "store_events") (db.store_events as any[]).push(...rows);
        else {
          const pk = table === "store_orders" ? "ls_order_id" : "ls_key_id";
          const m = db[table] as Map<string, any>;
          for (const r of rows) m.set(r[pk], { ...(m.get(r[pk]) || {}), ...r });
        }
        return new Response(null, { status: 201 });
      }
      const all = table === "store_events" ? (db.store_events as any[]) : [...(db[table] as Map<string, any>).values()];
      return new Response(JSON.stringify(all), { status: 200 });
    }
    if (url.host === "api.lemonsqueezy.com") {
      if (url.pathname === "/v1/license-keys" && url.searchParams.get("filter[order_id]")) {
        const id = url.searchParams.get("filter[order_id]");
        return new Response(JSON.stringify({ data: lsKeys.filter((k) => String(k.attributes.order_id) === id) }));
      }
      const m = url.pathname.match(/^\/v1\/license-keys\/(\w+)$/);
      if (m && method === "PATCH") {
        const k = lsKeys.find((x) => String(x.id) === m[1]);
        k.attributes.disabled = true;
        k.attributes.status = "disabled";
        return new Response(JSON.stringify({ data: k }));
      }
      const res = url.pathname.replace("/v1/", "");
      if (opts.lsPages && opts.lsPages[res]) {
        const page = Number(url.searchParams.get("page[number]") || "1");
        const items = opts.lsPages[res];
        const next = page * 2 < items.length ? `https://api.lemonsqueezy.com/v1/${res}?page%5Bsize%5D=2&page%5Bnumber%5D=${page + 1}` : null;
        return new Response(JSON.stringify({ data: items.slice((page - 1) * 2, page * 2), links: { next } }));
      }
    }
    return new Response("not found", { status: 404 });
  };
  const env: Record<string, string> = {
    SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "service-key",
    LEMON_WEBHOOK_SECRET: SECRET, LEMON_API_KEY: "ls-api-key",
  };
  return { db, calls, deps: { env: (k: string) => env[k], fetch: fetchFn as any, sleep: async () => {} }, env };
}

const order = (status: string, extra: any = {}) => ({
  meta: { event_name: status === "paid" ? "order_created" : "order_refunded", test_mode: true },
  data: { type: "orders", id: "1001", attributes: {
    order_number: 42, identifier: "abc-123", status, user_name: "Asha Verma", user_email: "asha@example.com",
    currency: "INR", subtotal: 159900, tax: 28782, total: 188682, total_usd: 1900, total_formatted: "₹1,886.82",
    refunded: status !== "paid", refunded_at: status === "paid" ? null : "2026-10-22T10:00:00Z",
    first_order_item: { product_name: "Shotly", variant_name: "Default" }, urls: { receipt: "https://r.test/1" },
    created_at: "2026-10-21T10:00:00Z", test_mode: true, ...extra } },
});
const lsKey = (id: string, disabled = false) => ({ id, type: "license-keys", attributes: {
  order_id: 1001, key_short: "XXXX-" + id, status: disabled ? "disabled" : "active", disabled,
  activation_limit: 3, instances_count: 1, test_mode: true } });

async function send(w: any, payload: any, secret = SECRET) {
  const body = JSON.stringify(payload);
  const sig = await hook.hmacHex(secret, body);
  return hook.handle(new Request("https://fn.test/lemon-webhook", { method: "POST", body, headers: { "X-Signature": sig } }), w.deps);
}

test("rejects notifications that aren't signed by Lemon Squeezy", async () => {
  const w = world();
  const res = await send(w, order("paid"), "wrong-secret");
  assert.equal(res.status, 401);
  assert.equal((w.db.store_orders as Map<string, any>).size, 0);
});

test("saves a new order", async () => {
  const w = world();
  const res = await send(w, order("paid"));
  assert.equal(res.status, 200);
  const row = (w.db.store_orders as Map<string, any>).get("1001");
  assert.equal(row.customer_email, "asha@example.com");
  assert.equal(row.status, "paid");
  assert.equal(row.product_name, "Shotly");
  assert.equal((w.db.store_events as any[])[0].outcome, "ok");
});

test("saves license keys without the full key", async () => {
  const w = world();
  const res = await send(w, { meta: { event_name: "license_key_created", test_mode: true },
    data: { id: "7", attributes: { ...lsKey("7").attributes, key: "FULL-SECRET-KEY" } } });
  assert.equal(res.status, 200);
  const row = (w.db.store_license_keys as Map<string, any>).get("7");
  assert.equal(row.key_short, "XXXX-7");
  assert.ok(!JSON.stringify(row).includes("FULL-SECRET-KEY"));
});

test("full refund disables the order's key and logs it", async () => {
  const keys = [lsKey("7")];
  const w = world({ lsKeys: keys });
  const res = await send(w, order("refunded"));
  assert.equal(res.status, 200);
  assert.ok(w.calls.includes("PATCH api.lemonsqueezy.com/v1/license-keys/7"));
  assert.equal(keys[0].attributes.disabled, true);
  assert.equal((w.db.store_license_keys as Map<string, any>).get("7").disabled, true);
  assert.equal((w.db.store_orders as Map<string, any>).get("1001").status, "refunded");
  const ev = (w.db.store_events as any[]).find((e) => e.event_name === "key_disable");
  assert.equal(ev.outcome, "ok");
  assert.match(ev.detail, /disabled after the refund/);
});

test("partial refund keeps the key active", async () => {
  const keys = [lsKey("7")];
  const w = world({ lsKeys: keys });
  await send(w, order("partial_refund", { refunded_amount: 50000 }));
  assert.ok(!w.calls.some((c) => c.startsWith("PATCH")));
  assert.equal(keys[0].attributes.disabled, false);
  const ev = (w.db.store_events as any[]).find((e) => e.event_name === "key_disable");
  assert.equal(ev.outcome, "skipped");
});

test("an already-disabled key is left alone", async () => {
  const w = world({ lsKeys: [lsKey("7", true)] });
  await send(w, order("refunded"));
  assert.ok(!w.calls.some((c) => c.startsWith("PATCH")));
  assert.match((w.db.store_events as any[]).find((e) => e.event_name === "key_disable").detail, /already disabled/);
});

test("without an API key it logs that the key needs disabling by hand", async () => {
  const w = world({ lsKeys: [lsKey("7")] });
  delete w.env.LEMON_API_KEY;
  const res = await send(w, order("refunded"));
  assert.equal(res.status, 200);
  const ev = (w.db.store_events as any[]).find((e) => e.event_name === "key_disable");
  assert.equal(ev.outcome, "error");
  assert.match(ev.detail, /by hand/);
});

test("database trouble returns an error so Lemon Squeezy retries", async () => {
  const w = world({ dbFails: true });
  const res = await send(w, order("paid"));
  assert.equal(res.status, 500);
});

// ---- admin-orders --------------------------------------------------------------
async function adminWorld() {
  const w = world({ lsPages: {
    orders: [order("paid").data, { ...order("paid").data, id: "1002" }, { ...order("refunded").data, id: "1003" }],
    "license-keys": [lsKey("7"), lsKey("8")],
  } });
  w.env.ADMIN_LOGIN_HASH = await sha256Hex(ADMIN_EMAIL + ":" + ADMIN_PASSWORD);
  return w;
}
const ask = (w: any, body: any, origin = "https://devindi.in") =>
  admin.handle(new Request("https://fn.test/admin-orders", { method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Origin: origin } }), w.deps);

test("admin: wrong password gets nothing", async () => {
  const w = await adminWorld();
  (w.db.store_orders as Map<string, any>).set("1001", { ls_order_id: "1001", customer_email: "asha@example.com" });
  const res = await ask(w, { email: ADMIN_EMAIL, password: "guess", action: "list" });
  assert.equal(res.status, 401);
  assert.ok(!(await res.text()).includes("asha"));
});

test("admin: right password lists orders, from devindi.in only", async () => {
  const w = await adminWorld();
  await send(w, order("paid"));
  const res = await ask(w, { email: "  OWNER@example.com ", password: ADMIN_PASSWORD, action: "list" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://devindi.in");
  const body = await res.json();
  assert.equal(body.orders.length, 1);
  const other = await ask(w, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, action: "list" }, "https://evil.example");
  assert.equal(other.headers.get("access-control-allow-origin"), null);
});

test("admin: sync copies every order and key across pages", async () => {
  const w = await adminWorld();
  const res = await ask(w, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, action: "sync" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.orders.length, 3);
  assert.equal(body.keys.length, 2);
  assert.match(body.note, /3 order\(s\) and 2 license key\(s\)/);
});
