-- M10.3A transactional DB test; synthetic users only, always rollback.
begin;
select set_config('uv.test.a',gen_random_uuid()::text,true);
select set_config('uv.test.b',gen_random_uuid()::text,true);
select set_config('uv.test.item',gen_random_uuid()::text,true);
select set_config('uv.test.op1',gen_random_uuid()::text,true);
select set_config('uv.test.op2',gen_random_uuid()::text,true);
select set_config('uv.test.op3',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('uv.test.a')::uuid),(current_setting('uv.test.b')::uuid);
select set_config('request.jwt.claim.sub',current_setting('uv.test.a'),true);
set local role authenticated;
insert into public.account_settings(sync_enabled,notice_version) values(true,'sync-test');
select * from public.sync_saved_place(current_setting('uv.test.op1')::uuid,current_setting('uv.test.item')::uuid,0,'Casa test',45.5,12.2,null);
do $$
declare r bigint; n bigint;
begin
 select revision into r from public.saved_places where id=current_setting('uv.test.item')::uuid;
 if r<>1 then raise exception 'Create revision'; end if;
 perform * from public.sync_saved_place(current_setting('uv.test.op1')::uuid,current_setting('uv.test.item')::uuid,0,'Casa test',45.5,12.2,null);
 select revision into r from public.saved_places where id=current_setting('uv.test.item')::uuid;
 if r<>1 then raise exception 'Idempotent retry'; end if;
 begin
  perform * from public.sync_saved_place(current_setting('uv.test.op2')::uuid,current_setting('uv.test.item')::uuid,0,'Stale',45.5,12.2,null);
  raise exception 'Stale accepted';
 exception when others then if sqlerrm<>'SYNC_REVISION_CONFLICT' then raise; end if; end;
 perform * from public.sync_saved_place(current_setting('uv.test.op2')::uuid,current_setting('uv.test.item')::uuid,1,'Aggiornata',45.51,12.21,'poi:test');
 select revision into r from public.saved_places where id=current_setting('uv.test.item')::uuid;
 if r<>2 then raise exception 'Update revision'; end if;
 perform * from public.sync_delete_saved(current_setting('uv.test.op3')::uuid,'saved_place',current_setting('uv.test.item')::uuid,2);
 if exists(select 1 from public.saved_places where id=current_setting('uv.test.item')::uuid) then raise exception 'Payload retained'; end if;
 select count(*) into n from uv_private.sync_tombstones where user_id=auth.uid() and resource_type='saved_place' and resource_id=current_setting('uv.test.item')::uuid and revision=3;
 if n<>1 then raise exception 'Tombstone missing'; end if;
 perform * from public.sync_delete_saved(current_setting('uv.test.op3')::uuid,'saved_place',current_setting('uv.test.item')::uuid,2);
 begin
  perform * from public.sync_saved_place(gen_random_uuid(),current_setting('uv.test.item')::uuid,0,'Resurrected',45,12,null);
  raise exception 'Resurrection accepted';
 exception when others then if sqlerrm<>'SYNC_RESOURCE_DELETED' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('uv.test.b'),true);
insert into public.account_settings(sync_enabled,notice_version) values(true,'sync-test');
do $$ begin if exists(select 1 from public.account_sync_tombstones(null)) then raise exception 'Cross-user leak'; end if; end $$;
select set_config('request.jwt.claim.sub',current_setting('uv.test.a'),true);
update public.account_settings set sync_enabled=false;
do $$ begin
 begin perform * from public.sync_saved_route(gen_random_uuid(),gen_random_uuid(),0,'test','1'); raise exception 'Disabled sync write'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: CAS, idempotency, tombstone, isolation, sync gate' result;
rollback;
