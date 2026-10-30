-- Run on the EXISTING TBVN Supabase project before deploying the frontend.
-- Replaces only the case action RPC. Existing case rows and deadlines are untouched.
begin;

do $$ begin
  if to_regclass('public.tbvn_cases') is null
     or to_regprocedure('public.tbvn_change_case(uuid,bigint,text,jsonb)') is null then
    raise exception 'Expected TBVN table/RPC missing; inspect the database';
  end if;
end $$;

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
    if not c.started then
      c.deadline_at := n + c.remaining_sec * interval '1 second';
      c.actual_started_at := n;
    else
      c.deadline_at := n + c.remaining_sec * interval '1 second';
    end if;
    c.running := true;
    c.started := true;
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
    c.appointment_date := (p_data->>'appointment_date')::date;
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
    appointment_date = c.appointment_date, start_time = c.start_time,
    items = c.items, planned_sec = c.planned_sec,
    adjustment_sec = c.adjustment_sec, remaining_sec = c.remaining_sec,
    deadline_at = c.deadline_at, actual_started_at = c.actual_started_at,
    finished_at = c.finished_at, running = c.running, started = c.started,
    completed = c.completed, version = c.version + 1
  where id = c.id and version = p_version returning * into c;
  return c;
end $$;

notify pgrst, 'reload schema';
commit;

