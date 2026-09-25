-- Hot Tail leaderboard + anonymous gameplay stats (J3/J4/J6/J8) for Supabase Postgres.
-- All access goes through the functions below, called by the Vercel API with the
-- service-role key. Tables have RLS enabled with no policies, and the functions
-- are revoked from anon/authenticated, so the public anon key can read nothing.

create table if not exists scores (
  id bigint generated always as identity primary key,
  player_id text not null,
  name text not null,
  score bigint not null,
  mode text not null,
  stage int not null,
  jet text not null,
  difficulty text not null,
  seed bigint not null,
  version text not null,
  replay text,
  ip_hash text not null,
  created_at bigint not null,
  -- J4 replay validation: pending | verified | rejected | unverifiable
  status text not null default 'unverifiable'
);
create index if not exists scores_mode_score on scores (mode, score desc);
create index if not exists scores_mode_created on scores (mode, created_at);
create index if not exists scores_player on scores (player_id, created_at);
create index if not exists scores_ip on scores (ip_hash, created_at);
create index if not exists scores_status on scores (status, created_at);

create table if not exists events (
  day date not null,
  type text not null,
  stage int not null,
  count int not null,
  total double precision not null,
  primary key (day, type, stage)
);

alter table scores enable row level security;
alter table events enable row level security;

create or replace function lb_insert(
  p_player_id text, p_name text, p_score bigint, p_mode text, p_stage int, p_jet text,
  p_difficulty text, p_seed bigint, p_version text, p_replay text, p_ip_hash text,
  p_created_at bigint, p_status text
) returns bigint language sql as $$
  insert into scores (player_id, name, score, mode, stage, jet, difficulty, seed, version, replay, ip_hash, created_at, status)
  values (p_player_id, p_name, p_score, p_mode, p_stage, p_jet, p_difficulty, p_seed, p_version, p_replay, p_ip_hash, p_created_at, p_status)
  returning id
$$;

-- Best score per player (ties: earliest, then first submitted), rejected runs excluded.
create or replace function lb_best_rows(p_mode text, p_since bigint)
returns table (id bigint, player_id text, name text, score bigint, stage int, jet text, created_at bigint, status text)
language sql stable as $$
  select distinct on (s.player_id) s.id, s.player_id, s.name, s.score, s.stage, s.jet, s.created_at, s.status
  from scores s
  where s.mode = p_mode and s.created_at >= p_since and s.status <> 'rejected'
  order by s.player_id, s.score desc, s.created_at asc, s.id asc
$$;

create or replace function lb_top(p_mode text, p_since bigint, p_limit int, p_offset int)
returns table (name text, score bigint, stage int, jet text, created_at bigint, status text)
language sql stable as $$
  select b.name, b.score, b.stage, b.jet, b.created_at, b.status
  from lb_best_rows(p_mode, p_since) b
  order by b.score desc, b.created_at asc, b.id asc
  limit p_limit offset p_offset
$$;

create or replace function lb_best(p_mode text, p_since bigint, p_player_id text)
returns bigint language sql stable as $$
  select coalesce(max(score), 0) from scores
  where mode = p_mode and created_at >= p_since and player_id = p_player_id and status <> 'rejected'
$$;

-- 1-based rank of the player's best, or 0 when they have no score.
create or replace function lb_rank(p_mode text, p_since bigint, p_player_id text)
returns int language sql stable as $$
  with me as (
    select b.id, b.score, b.created_at from lb_best_rows(p_mode, p_since) b where b.player_id = p_player_id
  )
  select case when not exists (select 1 from me) then 0 else (
    select count(*)::int + 1 from lb_best_rows(p_mode, p_since) o, me
    where o.score > me.score
      or (o.score = me.score and (o.created_at < me.created_at or (o.created_at = me.created_at and o.id < me.id)))
  ) end
$$;

create or replace function lb_recent(p_player_id text, p_ip_hash text, p_since bigint)
returns int language sql stable as $$
  select count(*)::int from scores
  where created_at >= p_since and (player_id = p_player_id or ip_hash = p_ip_hash)
$$;

create or replace function lb_pending(p_limit int)
returns setof scores language sql stable as $$
  select * from scores where status = 'pending' order by created_at asc limit p_limit
$$;

create or replace function lb_set_status(p_id bigint, p_status text)
returns void language sql as $$
  update scores set status = p_status where id = p_id
$$;

create or replace function stats_record(p_day date, p_type text, p_stage int, p_value double precision)
returns void language sql as $$
  insert into events (day, type, stage, count, total) values (p_day, p_type, p_stage, 1, p_value)
  on conflict (day, type, stage) do update set count = events.count + 1, total = events.total + excluded.total
$$;

-- Lock the API down to the service role (Supabase exposes functions to anon by default).
do $$
declare fn text;
begin
  foreach fn in array array[
    'lb_insert(text,text,bigint,text,int,text,text,bigint,text,text,text,bigint,text)',
    'lb_best_rows(text,bigint)', 'lb_top(text,bigint,int,int)', 'lb_best(text,bigint,text)',
    'lb_rank(text,bigint,text)', 'lb_recent(text,text,bigint)', 'lb_pending(int)',
    'lb_set_status(bigint,text)', 'stats_record(date,text,int,double precision)'
  ] loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon, authenticated', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end $$;
