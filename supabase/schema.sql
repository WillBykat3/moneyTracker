-- Money Tracker: database setup for sign-in & sync.
--
-- Run this once in your Supabase project: Dashboard -> SQL Editor -> New query ->
-- paste this whole file -> Run. It is safe to run again (e.g. after an update).
--
-- Each signed-in user gets one row holding all of their data as JSON.
-- Row Level Security makes sure people can only ever read or change their own row.

create table if not exists public.money_tracker_data (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  -- Goes up by one on every save; lets two devices saving at once detect each other.
  version    bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  -- About 2 MB, which is many years of entries. Stops the table being used as free storage.
  constraint money_tracker_data_size check (octet_length(data::text) <= 2000000)
);

alter table public.money_tracker_data enable row level security;

-- Only signed-in users can reach the table at all; signed-out visitors (anon) get nothing.
revoke all on table public.money_tracker_data from anon, authenticated;
grant select, insert, update, delete on table public.money_tracker_data to authenticated;

drop policy if exists "Users can read their own data" on public.money_tracker_data;
create policy "Users can read their own data"
  on public.money_tracker_data for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own data" on public.money_tracker_data;
create policy "Users can create their own data"
  on public.money_tracker_data for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own data" on public.money_tracker_data;
create policy "Users can update their own data"
  on public.money_tracker_data for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own data" on public.money_tracker_data;
create policy "Users can delete their own data"
  on public.money_tracker_data for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Keep updated_at accurate (handy when looking at the table in the dashboard).
create or replace function public.money_tracker_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.money_tracker_touch_updated_at() from public, anon, authenticated;

drop trigger if exists money_tracker_touch_updated_at on public.money_tracker_data;
create trigger money_tracker_touch_updated_at
  before update on public.money_tracker_data
  for each row execute function public.money_tracker_touch_updated_at();
