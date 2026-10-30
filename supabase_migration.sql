-- NEW Supabase project only. Existing projects must run supabase_upgrade.sql instead.
-- Anonymous access to this ONE table exposes real customer data to anyone with the public API key.
create extension if not exists pg_cron;

create table if not exists public.tbvn_cases (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  age text not null default '' check (age = '' or (age ~ '^[0-9]{1,3}$' and age::integer between 0 and 120)),
  sex text not null default '' check (sex in ('', 'Nam', 'Nữ', 'Khác')),
  technician text not null default '' check (char_length(technician) <= 80),
  start_time time without time zone not null,
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  planned_sec integer not null check (planned_sec between 60 and 172800),
  adjustment_sec integer not null default 0,
  remaining_sec double precision not null,
  deadline_at timestamptz,
  actual_started_at timestamptz,
  finished_at timestamptz,
  running boolean not null default false,
  started boolean not null default false,
  completed boolean not null default false,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '720 hours'),
  constraint tbvn_running_deadline check (running = (deadline_at is not null))
);
create index if not exists tbvn_cases_expires_at_idx on public.tbvn_cases(expires_at);

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
