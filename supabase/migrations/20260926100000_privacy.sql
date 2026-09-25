-- K9 privacy: players can erase their own leaderboard entries. The random
-- 96-bit player id acts as the proof of ownership.
create or replace function lb_delete_player(p_player_id text) returns int language sql as $$
  with d as (delete from scores where player_id = p_player_id returning 1)
  select count(*)::int from d
$$;

do $$
begin
  revoke execute on function lb_delete_player(text) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function lb_delete_player(text) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function lb_delete_player(text) to service_role;
  end if;
end $$;
