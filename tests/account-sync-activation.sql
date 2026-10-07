-- M10.3C activation test; synthetic user only and rollback.
begin;
select set_config('uv.test.a',gen_random_uuid()::text,true);
select set_config('uv.test.op1',gen_random_uuid()::text,true);
select set_config('uv.test.op2',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('uv.test.a')::uuid);
select set_config('request.jwt.claim.sub',current_setting('uv.test.a'),true);
set local role authenticated;
do $$
declare r record;
begin
 select * into r from public.set_account_sync(current_setting('uv.test.op1')::uuid,0,true,'notice-test');
 if r.out_revision<>1 or r.out_sync_enabled is not true then raise exception 'Activation failed'; end if;
 select * into r from public.set_account_sync(current_setting('uv.test.op1')::uuid,0,true,'notice-test');
 if r.out_revision<>1 then raise exception 'Activation retry not idempotent'; end if;
 begin
  perform * from public.set_account_sync(current_setting('uv.test.op2')::uuid,0,false,null);
  raise exception 'Stale settings revision accepted';
 exception when others then if sqlerrm<>'SYNC_REVISION_CONFLICT' then raise; end if; end;
 select * into r from public.set_account_sync(current_setting('uv.test.op2')::uuid,1,false,null);
 if r.out_revision<>2 or r.out_sync_enabled is not false then raise exception 'Deactivation failed'; end if;
 begin
  insert into public.saved_routes(provider_id,route_id) values('test','blocked');
  raise exception 'Write after disable accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: explicit activation, idempotent retry, CAS deactivation, sync gate' result;
rollback;
