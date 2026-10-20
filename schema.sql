

-- News, notices, programme thumbnails (migration 036)
-- News feed and notice board, with read tracking for the student's unread count. Programmes get a thumbnail.
create table if not exists news_posts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('news', 'notice')),
  title text not null,
  body text not null,
  audience text not null default 'all',
  image_path text,
  image_type text,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  author text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_news_posts_published on news_posts (published_at desc);

create table if not exists news_reads (
  post_id uuid not null references news_posts(id) on delete cascade,
  student_row_id uuid not null references students(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (post_id, student_row_id)
);

alter table programmes add column if not exists thumbnail_path text;
alter table programmes add column if not exists thumbnail_type text;

alter table news_posts enable row level security;
alter table news_reads enable row level security;
insert into storage.buckets (id, name, public) values ('news-images', 'news-images', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('programme-thumbnails', 'programme-thumbnails', false) on conflict (id) do nothing;
