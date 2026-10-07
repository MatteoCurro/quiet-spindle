-- M10.3B — preserve local saved-place/journey semantics in the remote model.
-- Applied to T-Sand as 20261007075616 account_sync_payload_v1.
alter table public.saved_places
  add column if not exists role text not null default 'both'
  check(role in ('origin','destination','both'));
grant insert(role), update(role) on public.saved_places to authenticated;

alter table public.saved_journeys
  add column if not exists network text not null default 'all'
    check(network in ('aut','nav','all')),
  add column if not exists origin_kind text not null default 'place'
    check(origin_kind in ('place','stop')),
  add column if not exists origin_ids text[] not null default '{}'::text[]
    check(cardinality(origin_ids) <= 50),
  add column if not exists destination_kind text not null default 'place'
    check(destination_kind in ('place','stop')),
  add column if not exists destination_ids text[] not null default '{}'::text[]
    check(cardinality(destination_ids) <= 50);

alter table public.saved_journeys
  add constraint saved_journeys_origin_shape
    check((origin_kind='place' and cardinality(origin_ids)=0)
       or (origin_kind='stop' and cardinality(origin_ids) between 1 and 50)),
  add constraint saved_journeys_destination_shape
    check((destination_kind='place' and cardinality(destination_ids)=0)
       or (destination_kind='stop' and cardinality(destination_ids) between 1 and 50));

grant insert(network,origin_kind,origin_ids,destination_kind,destination_ids),
      update(network,origin_kind,origin_ids,destination_kind,destination_ids)
on public.saved_journeys to authenticated;

drop function if exists public.sync_saved_place(uuid,uuid,bigint,text,double precision,double precision,text);
create function public.sync_saved_place(
  p_operation_id uuid,p_id uuid,p_expected_revision bigint,p_label text,
  p_lat double precision,p_lon double precision,p_entity_id text default null,p_role text default 'both'
) returns table(out_revision bigint,out_updated_at timestamptz)
language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid(); r public.saved_places%rowtype;
begin
 perform uv_private.require_account_sync(u);
 if p_operation_id is null or p_id is null or p_expected_revision<0 then raise exception 'SYNC_INPUT_INVALID'; end if;
 select * into r from public.saved_places where user_id=u and id=p_id for update;
 if found then
  if r.last_operation_id=p_operation_id then return query select r.revision,r.updated_at; return; end if;
  if r.revision<>p_expected_revision then raise exception 'SYNC_REVISION_CONFLICT'; end if;
  update public.saved_places set label=p_label,lat=p_lat,lon=p_lon,entity_id=p_entity_id,role=p_role,last_operation_id=p_operation_id
  where user_id=u and id=p_id returning * into r;
 else
  if exists(select 1 from uv_private.sync_tombstones t where t.user_id=u and t.resource_type='saved_place' and t.resource_id=p_id)
    then raise exception 'SYNC_RESOURCE_DELETED'; end if;
  if p_expected_revision<>0 then raise exception 'SYNC_REVISION_CONFLICT'; end if;
  insert into public.saved_places(user_id,id,label,lat,lon,entity_id,role,last_operation_id)
  values(u,p_id,p_label,p_lat,p_lon,p_entity_id,p_role,p_operation_id) returning * into r;
 end if;
 return query select r.revision,r.updated_at;
end $$;
revoke all on function public.sync_saved_place(uuid,uuid,bigint,text,double precision,double precision,text,text) from public,anon,authenticated;
grant execute on function public.sync_saved_place(uuid,uuid,bigint,text,double precision,double precision,text,text) to authenticated;

drop function if exists public.sync_saved_journey(uuid,uuid,bigint,text,text,double precision,double precision,text,double precision,double precision);
create function public.sync_saved_journey(
  p_operation_id uuid,p_id uuid,p_expected_revision bigint,p_label text,p_network text,
  p_origin_label text,p_origin_lat double precision,p_origin_lon double precision,p_origin_kind text,p_origin_ids text[],
  p_destination_label text,p_destination_lat double precision,p_destination_lon double precision,p_destination_kind text,p_destination_ids text[]
) returns table(out_revision bigint,out_updated_at timestamptz)
language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid(); r public.saved_journeys%rowtype;
begin
 perform uv_private.require_account_sync(u);
 if p_operation_id is null or p_id is null or p_expected_revision<0 then raise exception 'SYNC_INPUT_INVALID'; end if;
 select * into r from public.saved_journeys where user_id=u and id=p_id for update;
 if found then
  if r.last_operation_id=p_operation_id then return query select r.revision,r.updated_at; return; end if;
  if r.revision<>p_expected_revision then raise exception 'SYNC_REVISION_CONFLICT'; end if;
  update public.saved_journeys set
    label=p_label,network=p_network,
    origin_label=p_origin_label,origin_lat=p_origin_lat,origin_lon=p_origin_lon,origin_kind=p_origin_kind,origin_ids=p_origin_ids,
    destination_label=p_destination_label,destination_lat=p_destination_lat,destination_lon=p_destination_lon,destination_kind=p_destination_kind,destination_ids=p_destination_ids,
    last_operation_id=p_operation_id
  where user_id=u and id=p_id returning * into r;
 else
  if exists(select 1 from uv_private.sync_tombstones t where t.user_id=u and t.resource_type='saved_journey' and t.resource_id=p_id)
    then raise exception 'SYNC_RESOURCE_DELETED'; end if;
  if p_expected_revision<>0 then raise exception 'SYNC_REVISION_CONFLICT'; end if;
  insert into public.saved_journeys(
    user_id,id,label,network,
    origin_label,origin_lat,origin_lon,origin_kind,origin_ids,
    destination_label,destination_lat,destination_lon,destination_kind,destination_ids,last_operation_id
  ) values(
    u,p_id,p_label,p_network,
    p_origin_label,p_origin_lat,p_origin_lon,p_origin_kind,p_origin_ids,
    p_destination_label,p_destination_lat,p_destination_lon,p_destination_kind,p_destination_ids,p_operation_id
  ) returning * into r;
 end if;
 return query select r.revision,r.updated_at;
end $$;
revoke all on function public.sync_saved_journey(uuid,uuid,bigint,text,text,text,double precision,double precision,text,text[],text,double precision,double precision,text,text[]) from public,anon,authenticated;
grant execute on function public.sync_saved_journey(uuid,uuid,bigint,text,text,text,double precision,double precision,text,text[],text,double precision,double precision,text,text[]) to authenticated;
