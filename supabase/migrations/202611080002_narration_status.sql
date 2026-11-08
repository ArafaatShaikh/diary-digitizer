begin;
create or replace function public.reserve_narration_status(p_cache_key text) returns text
language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); today date := (now() at time zone 'utc')::date;
begin
 if uid is null then raise exception 'Authentication required'; end if;
 if p_cache_key is null or length(p_cache_key)>200 then return 'invalid'; end if;
 perform pg_advisory_xact_lock(41803018);
 if exists(select 1 from public.narration_leases l where l.user_id=uid and l.cache_key=p_cache_key and l.expires_at>now()) then return 'processing'; end if;
 if (select coalesce(sum(requests),0) from public.narration_usage where usage_date=today)>=50 then return 'app_limit'; end if;
 insert into public.narration_usage values(uid,today,1) on conflict(user_id,usage_date) do update set requests=public.narration_usage.requests+1 where public.narration_usage.requests<10;
 if not found then return 'user_limit'; end if;
 insert into public.narration_leases values(uid,p_cache_key,now()+interval '2 minutes') on conflict(user_id,cache_key) do update set expires_at=excluded.expires_at;
 return 'reserved';
end; $$;
revoke all on function public.reserve_narration_status(text) from public,anon;
grant execute on function public.reserve_narration_status(text) to authenticated;
-- Keep older deployments compatible during rollout.
create or replace function public.reserve_narration(p_cache_key text) returns boolean
language sql security definer set search_path='' as $$
 select public.reserve_narration_status(p_cache_key)='reserved';
$$;
revoke all on function public.reserve_narration(text) from public,anon;
grant execute on function public.reserve_narration(text) to authenticated;
commit;
