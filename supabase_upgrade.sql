-- EXISTING Supabase project only. Review anonymous access to real names before running.
-- Keeps existing IDs and rows; rows already deleted by the old Cron cannot be recovered.
create extension if not exists pg_cron;
begin;
lock table public.tbvn_cases in access exclusive mode;
drop trigger if exists tbvn_case_dates_trigger on public.tbvn_cases;
alter table public.tbvn_cases add column if not exists technician text not null default '';
alter table public.tbvn_cases add column if not exists adjustment_sec integer not null default 0;
alter table public.tbvn_cases add column if not exists actual_started_at timestamptz;
alter table public.tbvn_cases add column if not exists finished_at timestamptz;
alter table public.tbvn_cases add column if not exists updated_at timestamptz not null default clock_timestamp();
alter table public.tbvn_cases alter column expires_at set default (clock_timestamp() + interval '720 hours');
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tbvn_technician_length' and conrelid = 'public.tbvn_cases'::regclass) then
    alter table public.tbvn_cases add constraint tbvn_technician_length check (char_length(technician) <= 80);
  end if;
end $$;
-- The old trigger has been dropped inside this transaction, so the owner can extend expiry.
update public.tbvn_cases set expires_at = created_at + interval '720 hours'
where expires_at is distinct from created_at + interval '720 hours';
create index if not exists tbvn_cases_expires_at_idx on public.tbvn_cases(expires_at);
-- Remove the old staff-only policies. The old staff table is deliberately left untouched.
drop policy if exists tbvn_staff_select on public.tbvn_cases;
drop policy if exists tbvn_staff_insert on public.tbvn_cases;
drop policy if exists tbvn_staff_update on public.tbvn_cases;
drop policy if exists tbvn_staff_delete on public.tbvn_cases;
do $$ begin
  if to_regprocedure('public.tbvn_is_staff()') is not null then
    revoke all on function public.tbvn_is_staff() from authenticated, anon, public;
  end if;
end $$;
create or replace function public.tbvn_case_dates()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := clock_timestamp();
    new.expires_at := new.created_at + interval '720 hours';
  else
    new.created_at := old.created_at;
    new.expires_at := old.expires_at;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists tbvn_case_dates_trigger on public.tbvn_cases;
create trigger tbvn_case_dates_trigger before insert or update on public.tbvn_cases
for each row execute function public.tbvn_case_dates();

alter table public.tbvn_cases enable row level security;
revoke all on public.tbvn_cases from anon, authenticated;
grant select, insert, update, delete on public.tbvn_cases to anon;
drop policy if exists tbvn_open_select on public.tbvn_cases;
drop policy if exists tbvn_open_insert on public.tbvn_cases;
drop policy if exists tbvn_open_update on public.tbvn_cases;
drop policy if exists tbvn_open_delete on public.tbvn_cases;
create policy tbvn_open_select on public.tbvn_cases for select to anon
  using (expires_at > now());
create policy tbvn_open_insert on public.tbvn_cases for insert to anon
  with check (expires_at > now());
create policy tbvn_open_update on public.tbvn_cases for update to anon
  using (expires_at > now()) with check (expires_at > now());
create policy tbvn_open_delete on public.tbvn_cases for delete to anon
  using (expires_at > now());

create or replace function public.tbvn_server_time()
returns timestamptz language sql volatile security invoker set search_path = ''
as $$ select clock_timestamp() $$;
revoke all on function public.tbvn_server_time() from public, authenticated;
grant execute on function public.tbvn_server_time() to anon;

-- Per-case version check + row lock; all clock changes use the database clock.
create or replace function public.tbvn_change_case(
  p_id uuid, p_version bigint, p_action text, p_data jsonb default '{}'::jsonb
) returns public.tbvn_cases language plpgsql security invoker set search_path = '' as $$
declare
  c public.tbvn_cases%rowtype;
  n timestamptz := clock_timestamp();
  left_sec double precision;
  delta_sec integer;
  new_planned integer;
begin
  select * into c from public.tbvn_cases
  where id = p_id and version = p_version and expires_at > n for update;
  if not found then raise exception 'TBVN_CONFLICT_OR_EXPIRED' using errcode = 'P0001'; end if;

  if p_action = 'start' then
    if c.completed or c.running then raise exception 'Case cannot start'; end if;
    c.deadline_at := n + c.remaining_sec * interval '1 second';
    c.running := true;
    c.started := true;
    c.actual_started_at := coalesce(c.actual_started_at, n);
  elsif p_action = 'pause' then
    if not c.running then raise exception 'Case is not running'; end if;
    c.remaining_sec := extract(epoch from (c.deadline_at - n));
    c.deadline_at := null;
    c.running := false;
  elsif p_action = 'reset' then
    c.remaining_sec := c.planned_sec;
    c.deadline_at := null;
    c.running := false;
    c.started := false;
    c.completed := false;
    c.actual_started_at := null;
    c.finished_at := null;
  elsif p_action = 'adjust' then
    if c.completed then raise exception 'Case already completed'; end if;
    delta_sec := (p_data->>'minutes')::integer * 60;
    if delta_sec is null then raise exception 'Invalid adjustment'; end if;
    new_planned := c.planned_sec + delta_sec;
    if new_planned < 60 or new_planned > 172800 then raise exception 'Invalid total duration'; end if;
    left_sec := case when c.running then extract(epoch from (c.deadline_at - n)) else c.remaining_sec end;
    c.planned_sec := new_planned;
    c.adjustment_sec := c.adjustment_sec + delta_sec;
    c.remaining_sec := left_sec + delta_sec;
    if c.running then c.deadline_at := n + c.remaining_sec * interval '1 second'; end if;
  elsif p_action = 'finish' then
    c.completed := true;
    c.running := false;
    c.remaining_sec := 0;
    c.deadline_at := null;
    c.finished_at := n;
  elsif p_action = 'edit' then
    new_planned := (p_data->>'planned_sec')::integer;
    if new_planned is null or new_planned < 60 or new_planned > 172800 then
      raise exception 'Invalid total duration';
    end if;
    if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') = 0 then
      raise exception 'Invalid items';
    end if;
    left_sec := case when c.running then extract(epoch from (c.deadline_at - n)) else c.remaining_sec end;
    delta_sec := new_planned - c.planned_sec;
    c.name := p_data->>'name';
    c.age := p_data->>'age';
    c.sex := p_data->>'sex';
    c.technician := p_data->>'technician';
    c.start_time := (p_data->>'start_time')::time;
    c.items := p_data->'items';
    c.planned_sec := new_planned;
    c.adjustment_sec := 0;
    if not c.completed then
      c.remaining_sec := left_sec + delta_sec;
      if c.running then c.deadline_at := n + c.remaining_sec * interval '1 second'; end if;
    end if;
  else
    raise exception 'Unknown action';
  end if;

  update public.tbvn_cases set
    name = c.name, age = c.age, sex = c.sex, technician = c.technician,
    start_time = c.start_time, items = c.items, planned_sec = c.planned_sec,
    adjustment_sec = c.adjustment_sec, remaining_sec = c.remaining_sec,
    deadline_at = c.deadline_at, actual_started_at = c.actual_started_at,
    finished_at = c.finished_at, running = c.running, started = c.started,
    completed = c.completed, version = c.version + 1
  where id = c.id and version = p_version returning * into c;
  return c;
end $$;
revoke all on function public.tbvn_change_case(uuid, bigint, text, jsonb) from public, authenticated;
grant execute on function public.tbvn_change_case(uuid, bigint, text, jsonb) to anon;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'tbvn_cases') then
    alter publication supabase_realtime add table public.tbvn_cases;
  end if;
end $$;

-- A paused Free project runs this again after it resumes; rows are hidden from UI at 720h.
select cron.schedule('tbvn-delete-expired-cases', '* * * * *',
  $$delete from public.tbvn_cases where expires_at <= now()$$);

commit;
