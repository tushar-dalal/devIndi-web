-- devIndi store records: one-time Supabase setup.
-- Run this whole file once in Supabase -> SQL Editor -> New query -> Run.
--
-- A private copy of every Lemon Squeezy order, license key and refund.
-- Unlike the analytics tables, these hold customers' names and emails, so the
-- public (anon/publishable) key can NOT read or write them. Only the two Edge
-- Functions in store/functions use them, with the service-role key that
-- Supabase gives functions automatically.

-- One row per order (kept up to date as it changes, e.g. when refunded).
create table if not exists public.store_orders (
  ls_order_id     text primary key,            -- Lemon Squeezy order id
  order_number    bigint,
  identifier      text,                        -- the order's public id (on receipts)
  status          text not null,               -- paid | refunded | partial_refund | pending | failed | fraudulent
  test_mode       boolean not null default false,
  customer_name   text,
  customer_email  text,
  product_name    text,
  variant_name    text,
  currency        text,
  subtotal        integer,                     -- in the smallest unit (cents, paise)
  tax             integer,
  total           integer,
  total_usd       integer,
  refunded        boolean not null default false,
  refunded_at     timestamptz,
  refunded_amount integer,
  receipt_url     text,
  created_at      timestamptz,
  updated_at      timestamptz,
  synced_at       timestamptz not null default now(),
  raw             jsonb not null default '{}'::jsonb
);
create index if not exists store_orders_created_idx on public.store_orders (created_at desc);
create index if not exists store_orders_email_idx on public.store_orders (lower(customer_email));

-- One row per license key. Only the short form (e.g. XXXX-...-ABCD) is stored,
-- never the full key; the full key stays in Lemon Squeezy.
create table if not exists public.store_license_keys (
  ls_key_id        text primary key,
  ls_order_id      text,
  key_short        text,
  status           text,                       -- inactive | active | expired | disabled
  disabled         boolean not null default false,
  activation_limit integer,
  instances_count  integer,
  test_mode        boolean not null default false,
  created_at       timestamptz,
  updated_at       timestamptz,
  synced_at        timestamptz not null default now()
);
create index if not exists store_license_keys_order_idx on public.store_license_keys (ls_order_id);

-- An audit trail: every notification received and every automatic action taken.
create table if not exists public.store_events (
  id           bigint generated always as identity primary key,
  received_at  timestamptz not null default now(),
  event_name   text not null,                  -- order_created, order_refunded, key_disabled, sync, ...
  ls_object_id text,
  test_mode    boolean not null default false,
  outcome      text not null,                  -- ok | skipped | error
  detail       text
);
create index if not exists store_events_received_idx on public.store_events (received_at desc);

-- Lock them down: row level security on, and no policies, so anon/authenticated get nothing.
alter table public.store_orders enable row level security;
alter table public.store_license_keys enable row level security;
alter table public.store_events enable row level security;
revoke all on public.store_orders, public.store_license_keys, public.store_events from anon, authenticated;
