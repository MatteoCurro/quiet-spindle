-- M10.5 privacy acknowledgement test; synthetic users and rollback.
begin;
select set_config('uv.test.a',gen_random_uuid()::text,true);
select set_config('uv.test.b',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('uv.test.a')::uuid),(current_setting('uv.test.b')::uuid);
select set_config('request.jwt.claim.sub',current_setting('uv.test.a'),true);
set local role authenticated;
do $$
declare ok boolean; r record;
begin
 select public.has_privacy_notice('draft-v1') into ok;
 if ok then raise exception 'Unexpected prior acceptance'; end if;
 select * into r from public.accept_privacy_notice('draft-v1','it','account');
 if r.out_notice_version<>'draft-v1' then raise exception 'Acceptance not recorded'; end if;
 select public.has_privacy_notice('draft-v1') into ok;
 if not ok then raise exception 'Acceptance not visible'; end if;
 perform * from public.accept_privacy_notice('draft-v1','it','account');
 if (select count(*) from public.account_privacy_acceptances)<>1 then raise exception 'Acceptance retry duplicated'; end if;
 begin
  update public.account_privacy_acceptances set notice_version='forged';
  raise exception 'Acceptance audit mutable';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.account_privacy_acceptances;
  raise exception 'Acceptance audit deletable';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('uv.test.b'),true);
do $$
declare ok boolean;
begin
 select public.has_privacy_notice('draft-v1') into ok;
 if ok then raise exception 'Cross-user acceptance leaked'; end if;
 if exists(select 1 from public.account_privacy_acceptances) then raise exception 'Cross-user read leaked'; end if;
end $$;
reset role;
select 'PASS: privacy acknowledgement is explicit, versioned, idempotent, immutable and isolated' result;
rollback;
