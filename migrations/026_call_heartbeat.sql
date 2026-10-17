-- A live call is kept only while its people are still connected. Each status check updates this time;
-- a call whose time is old is closed, so a crashed or disconnected call cannot block new calls.
alter table calls add column if not exists last_seen_at timestamptz;
