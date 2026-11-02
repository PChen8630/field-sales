-- Field Sales Command Center: one-time database setup.
-- Paste all of this into Supabase → SQL Editor → New query, then click Run.
-- Safe to run again.

-- 1) Your data: one row per user, holding the whole app database as JSON.
create table if not exists public.fscc_state (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  rev        bigint      not null default 1,          -- goes up by 1 on every save
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);

-- 2) Daily copies, made automatically, kept 60 days (restore from Data & settings → Cloud sync).
create table if not exists public.fscc_snapshots (
  id       bigint generated always as identity primary key,
  user_id  uuid        not null references auth.users (id) on delete cascade,
  taken_at timestamptz not null default now(),
  data     jsonb       not null
);
create index if not exists fscc_snapshots_user_time on public.fscc_snapshots (user_id, taken_at desc);

-- 3) Security: a signed-in user can only see and change their own row. Nobody else can read anything.
alter table public.fscc_state     enable row level security;
alter table public.fscc_snapshots enable row level security;

drop policy if exists "own state read"   on public.fscc_state;
drop policy if exists "own state insert" on public.fscc_state;
drop policy if exists "own state update" on public.fscc_state;
drop policy if exists "own copies read"  on public.fscc_snapshots;
create policy "own state read"   on public.fscc_state     for select to authenticated using (user_id = auth.uid());
create policy "own state insert" on public.fscc_state     for insert to authenticated with check (user_id = auth.uid());
create policy "own state update" on public.fscc_state     for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own copies read"  on public.fscc_snapshots for select to authenticated using (user_id = auth.uid());

revoke all on public.fscc_state, public.fscc_snapshots from anon;
grant select, insert, update on public.fscc_state     to authenticated;
grant select                 on public.fscc_snapshots to authenticated;

-- 4) Before each save, keep the previous version as a copy when:
--    - there is no copy from the last 20 hours, or
--    - the save would remove more than half of the accounts (protects against accidental erase).
create or replace function public.fscc_keep_copy() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_n int := coalesce(jsonb_array_length(old.data -> 'customers'), 0);
  new_n int := coalesce(jsonb_array_length(new.data -> 'customers'), 0);
begin
  if new.rev <> old.rev + 1 then
    raise exception 'rev must increase by 1';
  end if;
  if not exists (select 1 from fscc_snapshots s where s.user_id = old.user_id and s.taken_at > now() - interval '20 hours')
     or (old_n >= 10 and new_n < old_n / 2) then
    insert into fscc_snapshots (user_id, data) values (old.user_id, old.data);
  end if;
  delete from fscc_snapshots s where s.user_id = old.user_id and s.taken_at < now() - interval '60 days';
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists fscc_keep_copy on public.fscc_state;
create trigger fscc_keep_copy before update on public.fscc_state
  for each row execute function public.fscc_keep_copy();
