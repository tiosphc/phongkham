-- Run on the EXISTING TBVN Supabase project, after reviewing the schema notes.
-- Adds rooms without recreating the table, changing dates, policies, Realtime, or Cron.
begin;

do $$
declare
  required_column text;
begin
  if to_regclass('public.tbvn_cases') is null then
    raise exception 'Missing public.tbvn_cases; stop and inspect the existing project';
  end if;
  if to_regprocedure('public.tbvn_change_case(uuid,bigint,text,jsonb)') is null then
    raise exception 'Missing expected tbvn_change_case RPC; stop and inspect its signature';
  end if;
  foreach required_column in array array[
    'id','name','age','sex','technician','start_time','items','planned_sec',
    'adjustment_sec','remaining_sec','deadline_at','actual_started_at',
    'finished_at','running','started','completed','version','created_at',
    'updated_at','expires_at'
  ] loop
    if not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'tbvn_cases' and column_name = required_column) then
      raise exception 'Missing expected column %. Stop and inspect the existing schema', required_column;
    end if;
  end loop;
end $$;

alter table public.tbvn_cases add column if not exists room text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tbvn_case_room_valid' and conrelid = 'public.tbvn_cases'::regclass) then
    alter table public.tbvn_cases add constraint tbvn_case_room_valid
      check (room is null or room in ('room_1', 'room_2', 'room_3'));
  end if;
end $$;

-- Existing rows may keep room = NULL. New rows and changed customer/room details must be valid.
create or replace function public.tbvn_validate_case_details()
returns trigger language plpgsql set search_path = '' as $$
declare
  needs_validation boolean := tg_op = 'INSERT';
  service_item jsonb;
begin
  if tg_op = 'UPDATE' then
    needs_validation := new.room is distinct from old.room
      or new.name is distinct from old.name
      or new.age is distinct from old.age
      or new.sex is distinct from old.sex
      or new.start_time is distinct from old.start_time
      or new.items is distinct from old.items
      or new.planned_sec is distinct from old.planned_sec;
  end if;
  if not needs_validation then return new; end if;
  if new.room is null or new.room not in ('room_1', 'room_2', 'room_3') then
    raise exception 'TBVN_INVALID_CASE: Invalid room' using errcode = 'P0001';
  end if;
  if new.name is null or char_length(btrim(new.name)) not between 1 and 80 then
    raise exception 'TBVN_INVALID_CASE: Invalid name' using errcode = 'P0001';
  end if;
  if new.sex is null or new.sex not in ('Nam', 'Nữ', 'Khác') then
    raise exception 'TBVN_INVALID_CASE: Invalid sex' using errcode = 'P0001';
  end if;
  if new.start_time is null then
    raise exception 'TBVN_INVALID_CASE: Invalid start time' using errcode = 'P0001';
  end if;
  if new.age is null or not (new.age = '' or (new.age ~ '^[0-9]{1,3}$' and new.age::integer between 0 and 120)) then
    raise exception 'TBVN_INVALID_CASE: Invalid age' using errcode = 'P0001';
  end if;
  if new.items is null or jsonb_typeof(new.items) is distinct from 'array' or jsonb_array_length(new.items) = 0 then
    raise exception 'TBVN_INVALID_CASE: Invalid items' using errcode = 'P0001';
  end if;
  for service_item in select value from jsonb_array_elements(new.items) loop
    if jsonb_typeof(service_item) is distinct from 'object'
      or coalesce(service_item->>'id', '') = ''
      or jsonb_typeof(service_item->'minutes') is distinct from 'number' then
      raise exception 'TBVN_INVALID_CASE: Invalid items' using errcode = 'P0001';
    end if;
    if (service_item->>'minutes')::numeric not between 1 and 600
      or (service_item->>'minutes')::numeric <> trunc((service_item->>'minutes')::numeric) then
      raise exception 'TBVN_INVALID_CASE: Invalid items' using errcode = 'P0001';
    end if;
    if service_item->>'perUnit' = 'true' then
      if jsonb_typeof(service_item->'qty') is distinct from 'number' then
        raise exception 'TBVN_INVALID_CASE: Invalid items' using errcode = 'P0001';
      end if;
      if (service_item->>'qty')::numeric not between 1 and 100
        or (service_item->>'qty')::numeric <> trunc((service_item->>'qty')::numeric) then
        raise exception 'TBVN_INVALID_CASE: Invalid items' using errcode = 'P0001';
      end if;
    end if;
  end loop;
  if new.planned_sec is null or new.planned_sec not between 60 and 172800 then
    raise exception 'TBVN_INVALID_CASE: Invalid total duration' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists tbvn_case_details_validation_trigger on public.tbvn_cases;
create trigger tbvn_case_details_validation_trigger before insert or update on public.tbvn_cases
for each row execute function public.tbvn_validate_case_details();

-- Same signature and clock logic as the current source RPC. Only the edit branch carries room.
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
  elsif p_action = 'set_room' then
    if coalesce(p_data->>'room', '') not in ('room_1', 'room_2', 'room_3') then
      raise exception 'TBVN_INVALID_CASE: Invalid room' using errcode = 'P0001';
    end if;
    c.room := p_data->>'room';
  elsif p_action = 'edit' then
    new_planned := (p_data->>'planned_sec')::integer;
    if new_planned is null or new_planned < 60 or new_planned > 172800 then
      raise exception 'Invalid total duration';
    end if;
    if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') = 0 then
      raise exception 'Invalid items';
    end if;
    if coalesce(p_data->>'room', '') not in ('room_1', 'room_2', 'room_3') then
      raise exception 'TBVN_INVALID_CASE: Invalid room' using errcode = 'P0001';
    end if;
    left_sec := case when c.running then extract(epoch from (c.deadline_at - n)) else c.remaining_sec end;
    delta_sec := new_planned - c.planned_sec;
    c.name := p_data->>'name';
    c.age := p_data->>'age';
    c.sex := p_data->>'sex';
    c.technician := p_data->>'technician';
    c.room := p_data->>'room';
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
    name = c.name, age = c.age, sex = c.sex, technician = c.technician, room = c.room,
    start_time = c.start_time, items = c.items, planned_sec = c.planned_sec,
    adjustment_sec = c.adjustment_sec, remaining_sec = c.remaining_sec,
    deadline_at = c.deadline_at, actual_started_at = c.actual_started_at,
    finished_at = c.finished_at, running = c.running, started = c.started,
    completed = c.completed, version = c.version + 1
  where id = c.id and version = p_version returning * into c;
  return c;
end $$;

commit;
