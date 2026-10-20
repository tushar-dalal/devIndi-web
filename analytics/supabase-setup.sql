-- devIndi website analytics: one-time Supabase setup.
-- Run this whole file once in Supabase -> SQL Editor -> New query -> Run.
--
-- Visitors can add rows. Reading is open to the public key too, so the admin
-- Analytics page needs no extra sign-in. Trade-off: the key is in the public
-- repo, so anyone who looks can read the analytics data and recordings.
-- Already ran an older version of this file? Run open-reads.sql instead.

-- One row per thing a visitor does: pageview, click, engage (time + scroll),
-- form_submit, js_error, admin_login, admin_login_failed, admin_view, custom.
create table if not exists public.analytics_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  visitor_id  text not null check (char_length(visitor_id) <= 64),
  session_id  text not null check (char_length(session_id) <= 64),
  page_id     text check (char_length(page_id) <= 64),
  type        text not null check (char_length(type) <= 40),
  name        text check (char_length(name) <= 120),
  path        text not null check (char_length(path) <= 300),
  title       text check (char_length(title) <= 300),
  referrer    text check (char_length(referrer) <= 500),
  utm_source  text check (char_length(utm_source) <= 120),
  utm_medium  text check (char_length(utm_medium) <= 120),
  utm_campaign text check (char_length(utm_campaign) <= 120),
  device      text check (char_length(device) <= 20),
  browser     text check (char_length(browser) <= 40),
  os          text check (char_length(os) <= 40),
  screen_w    int,
  screen_h    int,
  viewport_w  int,
  lang        text check (char_length(lang) <= 20),
  tz          text check (char_length(tz) <= 60),
  is_admin    boolean not null default false,
  duration_ms int,
  scroll_pct  smallint,
  x           real,
  y           real,
  doc_h       int,
  target      text check (char_length(target) <= 300),
  href        text check (char_length(href) <= 500),
  props       jsonb not null default '{}'::jsonb check (pg_column_size(props) <= 4000)
);

create index if not exists analytics_events_created_idx on public.analytics_events (created_at);
create index if not exists analytics_events_session_idx on public.analytics_events (session_id);
create index if not exists analytics_events_type_path_idx on public.analytics_events (type, path);

-- Session recordings: rrweb event chunks, a few seconds each.
create table if not exists public.analytics_recordings (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  visitor_id  text not null check (char_length(visitor_id) <= 64),
  session_id  text not null check (char_length(session_id) <= 64),
  page_id     text not null check (char_length(page_id) <= 64),
  path        text not null check (char_length(path) <= 300),
  seq         int not null,
  events      jsonb not null check (pg_column_size(events) <= 2000000)
);

create index if not exists analytics_recordings_session_idx on public.analytics_recordings (session_id);
create index if not exists analytics_recordings_created_idx on public.analytics_recordings (created_at);

-- Row level security: anyone may add rows (stamped "now") and read them; only
-- recordings older than 30 days can be deleted (the admin page's clean-up button).
alter table public.analytics_events enable row level security;
alter table public.analytics_recordings enable row level security;

drop policy if exists "visitors add events" on public.analytics_events;
create policy "visitors add events" on public.analytics_events
  for insert to anon, authenticated
  with check (created_at between now() - interval '1 minute' and now() + interval '1 minute');

drop policy if exists "anyone reads events" on public.analytics_events;
create policy "anyone reads events" on public.analytics_events
  for select to anon, authenticated using (true);

drop policy if exists "visitors add recordings" on public.analytics_recordings;
create policy "visitors add recordings" on public.analytics_recordings
  for insert to anon, authenticated
  with check (created_at between now() - interval '1 minute' and now() + interval '1 minute');

drop policy if exists "anyone reads recordings" on public.analytics_recordings;
create policy "anyone reads recordings" on public.analytics_recordings
  for select to anon, authenticated using (true);

drop policy if exists "clean up old recordings" on public.analytics_recordings;
create policy "clean up old recordings" on public.analytics_recordings
  for delete to anon, authenticated using (created_at < now() - interval '30 days');

revoke all on public.analytics_events, public.analytics_recordings from anon, authenticated;
grant insert, select on public.analytics_events, public.analytics_recordings to anon, authenticated;
grant delete on public.analytics_recordings to anon, authenticated;
