-- M10.3B DB semantics test; synthetic data only and rollback.
begin;
select set_config('uv.test.a',gen_random_uuid()::text,true);
select set_config('uv.test.place',gen_random_uuid()::text,true);
select set_config('uv.test.journey',gen_random_uuid()::text,true);
select set_config('uv.test.op1',gen_random_uuid()::text,true);
select set_config('uv.test.op2',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('uv.test.a')::uuid);
select set_config('request.jwt.claim.sub',current_setting('uv.test.a'),true);
set local role authenticated;
insert into public.account_settings(sync_enabled,notice_version) values(true,'sync-payload-test');
select * from public.sync_saved_place(current_setting('uv.test.op1')::uuid,current_setting('uv.test.place')::uuid,0,'Casa',45.49,12.24,null,'origin');
select * from public.sync_saved_journey(
 current_setting('uv.test.op2')::uuid,current_setting('uv.test.journey')::uuid,0,
 'Mestre Centro → Piazzale Roma','all',
 'Mestre Centro',45.49,12.24,'place','{}'::text[],
 'Piazzale Roma',45.438,12.319,'stop',array['R1','R2']
);
do $$
declare p_role text; j_network text; o_kind text; d_kind text; d_ids text[];
begin
 select role into p_role from public.saved_places where id=current_setting('uv.test.place')::uuid;
 if p_role<>'origin' then raise exception 'Saved place role lost'; end if;
 select network,origin_kind,destination_kind,destination_ids into j_network,o_kind,d_kind,d_ids
 from public.saved_journeys where id=current_setting('uv.test.journey')::uuid;
 if j_network<>'all' or o_kind<>'place' or d_kind<>'stop' or d_ids<>array['R1','R2']
 then raise exception 'Saved journey semantics lost'; end if;
 begin
  update public.saved_journeys set origin_kind='stop',origin_ids='{}'::text[] where id=current_setting('uv.test.journey')::uuid;
  raise exception 'Invalid stop endpoint accepted';
 exception when check_violation then null; end;
end $$;
reset role;
select 'PASS: saved place role + journey network/kind/IDs preserved and constrained' result;
rollback;
