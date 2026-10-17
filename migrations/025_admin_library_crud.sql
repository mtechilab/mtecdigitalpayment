-- Admin management of library material: archiving hides an item from students but keeps it.
alter table library_items add column if not exists archived_at timestamptz;
