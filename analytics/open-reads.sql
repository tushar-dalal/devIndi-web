-- Switch an existing analytics setup to "no Supabase sign-in":
-- the public key can read the data, and old recordings can be cleaned up.
-- Run once in Supabase -> SQL Editor.

drop policy if exists "admin reads events" on public.analytics_events;
drop policy if exists "admin deletes events" on public.analytics_events;
drop policy if exists "admin reads recordings" on public.analytics_recordings;
drop policy if exists "admin deletes recordings" on public.analytics_recordings;
drop function if exists public.is_analytics_admin();

drop policy if exists "anyone reads events" on public.analytics_events;
create policy "anyone reads events" on public.analytics_events
  for select to anon, authenticated using (true);

drop policy if exists "anyone reads recordings" on public.analytics_recordings;
create policy "anyone reads recordings" on public.analytics_recordings
  for select to anon, authenticated using (true);

drop policy if exists "clean up old recordings" on public.analytics_recordings;
create policy "clean up old recordings" on public.analytics_recordings
  for delete to anon, authenticated using (created_at < now() - interval '30 days');

revoke delete on public.analytics_events from anon, authenticated;
grant select on public.analytics_events, public.analytics_recordings to anon, authenticated;
grant delete on public.analytics_recordings to anon, authenticated;
