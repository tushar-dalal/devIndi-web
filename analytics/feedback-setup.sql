-- devIndi feedback inbox: one-time Supabase setup.
--
-- Easiest way: open Admin -> Website Analytics -> Feedback while signed in.
-- It shows this file with your reader hash already filled in; copy it into
-- Supabase -> SQL Editor -> New query -> Run.
--
-- How it's protected: the website (public key) can ADD feedback but can't read
-- it. Reading, marking done and deleting go through the functions below, which
-- only answer to the key your admin sign-in creates. Only a hash of that key is
-- stored here. It's as strong as the admin password, so keep that password long.

-- One row per message sent from feedback.html.
create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  app         text not null check (char_length(app) <= 60),
  message     text not null check (char_length(message) between 1 and 5000),
  email       text check (char_length(email) <= 254),
  device      text check (char_length(device) <= 20),
  done        boolean not null default false
);
create index if not exists feedback_created_idx on public.feedback (created_at);

alter table public.feedback enable row level security;

drop policy if exists "visitors add feedback" on public.feedback;
create policy "visitors add feedback" on public.feedback
  for insert to anon, authenticated
  with check (created_at between now() - interval '1 minute' and now() + interval '1 minute' and done = false);

revoke all on public.feedback from anon, authenticated;
grant insert on public.feedback to anon, authenticated;

-- The reader key's hash. Nobody outside the functions below can see this table.
create table if not exists public.feedback_reader (
  id        int primary key default 1 check (id = 1),
  key_hash  text not null
);
alter table public.feedback_reader enable row level security;
revoke all on public.feedback_reader from anon, authenticated;

insert into public.feedback_reader (id, key_hash)
values (1, 'PASTE_READER_HASH_HERE')
on conflict (id) do update set key_hash = excluded.key_hash;

create or replace function public.feedback_key_ok(p_key text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.feedback_reader
    where key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex')
  );
$$;
revoke all on function public.feedback_key_ok(text) from public, anon, authenticated;

-- Newest first, up to 1000 messages.
create or replace function public.read_feedback(p_key text)
returns setof public.feedback
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.feedback_key_ok(p_key) then
    raise exception 'feedback: wrong reader key' using errcode = '42501';
  end if;
  return query select * from public.feedback order by created_at desc limit 1000;
end;
$$;

-- Mark a message done / not done, or delete it.
create or replace function public.update_feedback(p_key text, p_id bigint, p_done boolean default null, p_delete boolean default false)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.feedback_key_ok(p_key) then
    raise exception 'feedback: wrong reader key' using errcode = '42501';
  end if;
  if p_delete then
    delete from public.feedback where id = p_id;
  elsif p_done is not null then
    update public.feedback set done = p_done where id = p_id;
  end if;
end;
$$;

revoke all on function public.read_feedback(text) from public;
revoke all on function public.update_feedback(text, bigint, boolean, boolean) from public;
grant execute on function public.read_feedback(text) to anon, authenticated;
grant execute on function public.update_feedback(text, bigint, boolean, boolean) to anon, authenticated;
