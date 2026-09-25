-- Ops (J7/R3): client error reports and a public, aggregate-only status summary.

create table if not exists client_errors (
  fingerprint text not null,
  version text not null,
  message text not null,
  stack text,
  user_agent text,
  first_seen bigint not null,
  last_seen bigint not null,
  count int not null default 1,
  primary key (fingerprint, version)
);
alter table client_errors enable row level security;

create or replace function err_record(
  p_fingerprint text, p_version text, p_message text, p_stack text, p_user_agent text, p_now bigint
) returns void language sql as $$
  insert into client_errors (fingerprint, version, message, stack, user_agent, first_seen, last_seen, count)
  values (p_fingerprint, p_version, p_message, p_stack, p_user_agent, p_now, p_now, 1)
  on conflict (fingerprint, version) do update set count = client_errors.count + 1, last_seen = excluded.last_seen
$$;

-- Everything the status page shows: counts and percentiles only, no identities.
create or replace function ops_summary(p_now bigint) returns json language sql stable as $$
  with
    day_ago as (select p_now - 86400000 as t),
    week as (select (to_timestamp(p_now / 1000.0) at time zone 'utc')::date - 7 as d),
    loads as (
      select stage as bucket, sum(count) as n from events, week
      where type = 'load_ms' and day > week.d group by stage
    ),
    load_total as (select coalesce(sum(n), 0) as n from loads),
    load_cum as (
      select bucket, sum(n) over (order by bucket) as c from loads
    )
  select json_build_object(
    'errors24h', (select coalesce(sum(count), 0) from client_errors, day_ago where last_seen >= day_ago.t),
    'topErrors', (
      select coalesce(json_agg(e), '[]'::json) from (
        select left(message, 140) as message, version, count, last_seen as "lastSeen"
        from client_errors order by last_seen desc limit 8
      ) e
    ),
    'scores24h', (select count(*) from scores, day_ago where created_at >= day_ago.t),
    'verified24h', (select count(*) from scores, day_ago where created_at >= day_ago.t and status = 'verified'),
    'rejected24h', (select count(*) from scores, day_ago where created_at >= day_ago.t and status = 'rejected'),
    'pending', (select count(*) from scores where status = 'pending'),
    'loadP50Ms', (select min(bucket) * 250 + 250 from load_cum, load_total where c >= load_total.n * 0.5 and load_total.n > 0),
    'loadP95Ms', (select min(bucket) * 250 + 250 from load_cum, load_total where c >= load_total.n * 0.95 and load_total.n > 0),
    'week', (
      select coalesce(json_object_agg(type, n), '{}'::json) from (
        select type, sum(count) as n from events, week where day > week.d and type <> 'load_ms' group by type
      ) w
    )
  )
$$;

do $$
declare fn text;
begin
  foreach fn in array array['err_record(text,text,text,text,text,bigint)', 'ops_summary(bigint)'] loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon, authenticated', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end $$;
