-- Merge a duplicate course into the course to keep. Every record that refers to the duplicate is moved to the
-- course to keep, then the duplicate is removed. It runs as one step: if anything fails, nothing changes.
create or replace function admin_merge_references(p_table text, p_from text, p_into text)
returns table(ref_table text, ref_column text, moved bigint)
language plpgsql security definer set search_path = public as $$
declare
  r record;
  cnt bigint;
begin
  if p_from = p_into then
    raise exception 'Choose two different courses.';
  end if;
  for r in
    select tc.table_name::text as rt, kcu.column_name::text as rc
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public' and ccu.table_name = p_table
  loop
    execute format('update %I set %I = %L where %I::text = %L', r.rt, r.rc, p_into, r.rc, p_from);
    get diagnostics cnt = row_count;
    if cnt > 0 then
      ref_table := r.rt; ref_column := r.rc; moved := cnt;
      return next;
    end if;
  end loop;
  execute format('delete from %I where id::text = %L', p_table, p_from);
  ref_table := p_table; ref_column := 'id'; moved := 1;
  return next;
end $$;
