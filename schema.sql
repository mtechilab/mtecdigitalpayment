

-- Admin management (migration 029)
-- Admin management: programmes can be deactivated, and fee structures record who changed them and when.
alter table programmes add column if not exists active boolean not null default true;
alter table fee_structures add column if not exists updated_at timestamptz not null default now();
alter table fee_structures add column if not exists updated_by text;
