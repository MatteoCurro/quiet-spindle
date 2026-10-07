begin;
select set_config('uv.test.a',gen_random_uuid()::text,true);
select set_config('uv.test.b',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('uv.test.a')::uuid),(current_setting('uv.test.b')::uuid);
select set_config('request.jwt.claim.sub',current_setting('uv.test.a'),true);
set local role authenticated;
insert into public.account_profiles(country,language,is_driver,local_relation,stay_interest)
values('IT','it',true,'resident','not_now');
insert into public.account_marketing_preferences(notice_version) values('test-only');
do $$ begin
 if (select marketing_email or profiling from public.account_marketing_preferences) then raise exception 'Implicit consent'; end if;
 if (select count(*) from public.account_consent_events)<>1 then raise exception 'Missing evidence'; end if;
 begin
  insert into public.account_consent_events(user_id,marketing_email,profiling,notice_version) values(auth.uid(),true,true,'fake');
  raise exception 'Audit forgery allowed';
 exception when insufficient_privilege then null; end;
 begin
  update public.account_consent_events set profiling=true;
  raise exception 'Audit mutation allowed';
 exception when insufficient_privilege then null; end;
end; $$;
update public.account_marketing_preferences set marketing_email=true;
update public.account_marketing_preferences set marketing_email=true;
do $$ begin
 if (select profiling from public.account_marketing_preferences) then raise exception 'Bundled consent'; end if;
 if (select count(*) from public.account_consent_events)<>2 then raise exception 'Duplicate evidence'; end if;
end; $$;
update public.account_marketing_preferences set profiling=true;
update public.account_marketing_preferences set marketing_email=false,profiling=false;
do $$ begin
 if (select count(*) from public.account_consent_events)<>4 then raise exception 'Revocation not logged'; end if;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('uv.test.b'),true);
do $$ declare n bigint; begin
 if exists(select 1 from public.account_marketing_preferences) or exists(select 1 from public.account_consent_events) then raise exception 'Cross user leak'; end if;
 update public.account_marketing_preferences set marketing_email=true;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'Cross user update'; end if;
end; $$;
reset role;
delete from auth.users where id=current_setting('uv.test.a')::uuid;
do $$ begin
 if exists(select 1 from public.account_consent_events where user_id=current_setting('uv.test.a')::uuid) then raise exception 'Cascade failed'; end if;
end; $$;
select 'PASS: optional answers, no default consent, independent consents, immutable server evidence, revocation, isolation, cascade' as result;
rollback;