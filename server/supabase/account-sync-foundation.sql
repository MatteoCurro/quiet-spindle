-- M10.3A: remote sync database foundation. Applied to Supabase T-Sand as
-- migration 20261007071926 account_sync_foundation.
-- Adds optimistic concurrency/idempotency metadata plus payload-free tombstones.

alter table public.account_preferences add column if not exists last_operation_id uuid;
alter table public.saved_places add column if not exists last_operation_id uuid;
alter table public.saved_stops add column if not exists last_operation_id uuid;
alter table public.saved_routes add column if not exists last_operation_id uuid;
alter table public.saved_journeys add column if not exists last_operation_id uuid;

grant insert(last_operation_id), update(last_operation_id) on public.account_preferences to authenticated;
grant insert(last_operation_id), update(last_operation_id) on public.saved_places to authenticated;
grant insert(last_operation_id), update(last_operation_id) on public.saved_stops to authenticated;
grant insert(last_operation_id), update(last_operation_id) on public.saved_routes to authenticated;
grant insert(last_operation_id), update(last_operation_id) on public.saved_journeys to authenticated;

create table if not exists uv_private.sync_tombstones (
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_type text not null check(resource_type in ('saved_place','saved_stop','saved_route','saved_journey')),
  resource_id uuid not null,
  revision bigint not null check(revision > 0),
  operation_id uuid not null,
  deleted_at timestamptz not null default now(),
  primary key(user_id, resource_type, resource_id),
  unique(user_id, operation_id)
);
alter table uv_private.sync_tombstones enable row level security;
revoke all on uv_private.sync_tombstones from public, anon, authenticated;
grant select,insert,update,delete on uv_private.sync_tombstones to authenticated;
create policy owner_read on uv_private.sync_tombstones for select to authenticated using ((select auth.uid())=user_id);
create policy owner_insert on uv_private.sync_tombstones for insert to authenticated with check ((select auth.uid())=user_id);
create policy owner_update on uv_private.sync_tombstones for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy owner_delete on uv_private.sync_tombstones for delete to authenticated using ((select auth.uid())=user_id);

create or replace function uv_private.require_account_sync(p_user uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if p_user is null or p_user is distinct from auth.uid() then raise exception 'SYNC_SIGNIN_REQUIRED' using errcode='42501'; end if;
 if not exists(select 1 from public.account_settings s where s.user_id=p_user and s.sync_enabled)
 then raise exception 'SYNC_DISABLED' using errcode='42501'; end if;
end $$;
revoke all on function uv_private.require_account_sync(uuid) from public,anon,authenticated;
grant execute on function uv_private.require_account_sync(uuid) to authenticated;

create or replace function public.sync_account_preferences(p_operation_id uuid,p_expected_revision bigint,p_language text)
returns table(out_revision bigint,out_updated_at timestamptz)
language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid(); r public.account_preferences%rowtype;
begin
 perform uv_private.require_account_sync(u);
 if p_operation_id is null or p_expected_revision<0 then raise exception 'SYNC_INPUT_INVALID'; end if;
 select * into r from public.account_preferences where user_id=u for update;
 if found then
  if r.last_operation_id=p_operation_id then return query select r.revision,r.updated_at; return; end if;
  if r.revision<>p_expected_revision then raise exception 'SYNC_REVISION_CONFLICT'; end if;
  update public.account_preferences set language=p_language,last_operation_id=p_operation_id where user_id=u returning * into r;
 else
  if p_expected_revision<>0 then raise exception 'SYNC_REVISION_CONFLICT'; end if;
  insert into public.account_preferences(user_id,language,last_operation_id) values(u,p_language,p_operation_id) returning * into r;
 end if;
 return query select r.revision,r.updated_at;
end $$;
revoke all on function public.sync_account_preferences(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.sync_account_preferences(uuid,bigint,text) to authenticated;

create or replace function public.sync_saved_place(p_operation_id uuid,p_id uuid,p_expected_revision bigint,p_label text,p_lat double precision,p_lon double precision,p_entity_id text default null)
returns table(out_revision bigint,out_updated_at timestamptz)
language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid(); r public.saved_places%rowtype;
begin
 perform uv_private.require_account_sync(u);
 if p_operation_id is null or p_id is null or p_expected_revision<0 then raise exception 'SYNC_INPUT_INVALID'; end if;
 select * into r from public.saved_places where user_id=u and id=p_id for update;
 if found then
  if r.last_operation_id=p_operation_id then return query select r.revision,r.updated_at; return; end if;
  if r.revision<>p_expected_revision then raise exception 'SYNC_REVISION_CONFLICT'; end if;
  update public.saved_places set label=p_label,lat=p_lat,lon=p_lon,entity_id=p_entity_id,last_operation_id=p_operation_id where user_id=u and id=p_id returning * into r;
 else
  if exists(select 1 from uv_private.sync_tombstones t where t.user_id=u and t.resource_type='saved_place' and t.resource_id=p_id) then raise exception 'SYNC_RESOURCE_DELETED'; end if;
  if p_expected_revision<>0 then raise exception 'SYNC_REVISION_CONFLICT'; end if;
  insert into public.saved_places(user_id,id,label,lat,lon,entity_id,last_operation_id) values(u,p_id,p_label,p_lat,p_lon,p_entity_id,p_operation_id) returning * into r;
 end if;
 return query select r.revision,r.updated_at;
end $$;
revoke all on function public.sync_saved_place(uuid,uuid,bigint,text,double precision,double precision,text) from public,anon,authenticated;
grant execute on function public.sync_saved_place(uuid,uuid,bigint,text,double precision,double precision,text) to authenticated;

create or replace function public.sync_saved_stop(p_operation_id uuid,p_id uuid,p_expected_revision bigint,p_provider_id text,p_stop_id text)
returns table(out_revision bigint,out_updated_at timestamptz)
language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid(); r public.saved_stops%rowtype;
begin
 perform uv_private.require_account_sync(u);
 if p_operation_id is null or p_id is null or p_expected_revision<0 then raise exception 'SYNC_INPUT_INVALID'; end if;
 select * into r from public.saved_stops where user_id=u and id=p_id for update;
 if found then
  if r.last_operation_id=p_operation_id then return query select r.revision,r.updated_at; return; end if;
  if r.revision<>p_expected_revision then raise exception 'SYNC_REVISION_CONFLICT'; end if;
  update public.saved_stops set provider_id=p_provider_id,stop_id=p_stop_id,last_operation_id=p_operation_id where user_id=u and id=p_id returning * into r;
 else
  if exists(select 1 from uv_private.sync_tombstones t where t.user_id=u and t.resource_type='saved_stop' and t.resource_id=p_id) then raise exception 'SYNC_RESOURCE_DELETED'; end if;
  if p_expected_revision<>0 then raise exception 'SYNC_REVISION_CONFLICT'; end if;
  insert into public.saved_stops(user_id,id,provider_id,stop_id,last_operation_id) values(u,p_id,p_provider_id,p_stop_id,p_operation_id) returning * into r;
 end if;
 return query select r.revision,r.updated_at;
end $$;
revoke all on function public.sync_saved_stop(uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.sync_saved_stop(uuid,uuid,bigint,text,text) to authenticated;

create or replace function public.sync_saved_route(p_operation_id uuid,p_id uuid,p_expected_revision bigint,p_provider_id text,p_route_id text)
returns table(out_revision bigint,out_updated_at timestamptz)
language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid(); r public.saved_routes%rowtype;
begin
 perform uv_private.require_account_sync(u);
 if p_operation_id is null or p_id is null or p_expected_revision<0 then raise exception 'SYNC_INPUT_INVALID'; end if;
 select * into r from public.saved_routes where user_id=u and id=p_id for update;
 if found then
  if r.last_operation_id=p_operation_id then return query select r.revision,r.updated_at; return; end if;
  if r.revision<>p_expected_revision then raise exception 'SYNC_REVISION_CONFLICT'; end if;
  update public.saved_routes set provider_id=p_provider_id,route_id=p_route_id,last_operation_id=p_operation_id where user_id=u and id=p_id returning * into r;
 else
  if exists(select 1 from uv_private.sync_tombstones t where t.user_id=u and t.resource_type='saved_route' and t.resource_id=p_id) then raise exception 'SYNC_RESOURCE_DELETED'; end if;
  if p_expected_revision<>0 then raise exception 'SYNC_REVISION_CONFLICT'; end if;
  insert into public.saved_routes(user_id,id,provider_id,route_id,last_operation_id) values(u,p_id,p_provider_id,p_route_id,p_operation_id) returning * into r;
 end if;
 return query select r.revision,r.updated_at;
end $$;
revoke all on function public.sync_saved_route(uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.sync_saved_route(uuid,uuid,bigint,text,text) to authenticated;

create or replace function public.sync_saved_journey(p_operation_id uuid,p_id uuid,p_expected_revision bigint,p_label text,p_origin_label text,p_origin_lat double precision,p_origin_lon double precision,p_destination_label text,p_destination_lat double precision,p_destination_lon double precision)
returns table(out_revision bigint,out_updated_at timestamptz)
language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid(); r public.saved_journeys%rowtype;
begin
 perform uv_private.require_account_sync(u);
 if p_operation_id is null or p_id is null or p_expected_revision<0 then raise exception 'SYNC_INPUT_INVALID'; end if;
 select * into r from public.saved_journeys where user_id=u and id=p_id for update;
 if found then
  if r.last_operation_id=p_operation_id then return query select r.revision,r.updated_at; return; end if;
  if r.revision<>p_expected_revision then raise exception 'SYNC_REVISION_CONFLICT'; end if;
  update public.saved_journeys set label=p_label,origin_label=p_origin_label,origin_lat=p_origin_lat,origin_lon=p_origin_lon,destination_label=p_destination_label,destination_lat=p_destination_lat,destination_lon=p_destination_lon,last_operation_id=p_operation_id where user_id=u and id=p_id returning * into r;
 else
  if exists(select 1 from uv_private.sync_tombstones t where t.user_id=u and t.resource_type='saved_journey' and t.resource_id=p_id) then raise exception 'SYNC_RESOURCE_DELETED'; end if;
  if p_expected_revision<>0 then raise exception 'SYNC_REVISION_CONFLICT'; end if;
  insert into public.saved_journeys(user_id,id,label,origin_label,origin_lat,origin_lon,destination_label,destination_lat,destination_lon,last_operation_id)
  values(u,p_id,p_label,p_origin_label,p_origin_lat,p_origin_lon,p_destination_label,p_destination_lat,p_destination_lon,p_operation_id) returning * into r;
 end if;
 return query select r.revision,r.updated_at;
end $$;
revoke all on function public.sync_saved_journey(uuid,uuid,bigint,text,text,double precision,double precision,text,double precision,double precision) from public,anon,authenticated;
grant execute on function public.sync_saved_journey(uuid,uuid,bigint,text,text,double precision,double precision,text,double precision,double precision) to authenticated;

create or replace function public.sync_delete_saved(p_operation_id uuid,p_resource_type text,p_id uuid,p_expected_revision bigint)
returns table(out_revision bigint,out_deleted_at timestamptz)
language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid(); rev bigint; t uv_private.sync_tombstones%rowtype;
begin
 perform uv_private.require_account_sync(u);
 if p_operation_id is null or p_id is null or p_expected_revision<=0 or p_resource_type not in ('saved_place','saved_stop','saved_route','saved_journey') then raise exception 'SYNC_INPUT_INVALID'; end if;
 select * into t from uv_private.sync_tombstones where user_id=u and operation_id=p_operation_id for update;
 if found then
  if t.resource_type<>p_resource_type or t.resource_id<>p_id then raise exception 'SYNC_OPERATION_REUSED'; end if;
  return query select t.revision,t.deleted_at; return;
 end if;
 if exists(select 1 from uv_private.sync_tombstones x where x.user_id=u and x.resource_type=p_resource_type and x.resource_id=p_id) then raise exception 'SYNC_RESOURCE_DELETED'; end if;
 case p_resource_type
  when 'saved_place' then select revision into rev from public.saved_places where user_id=u and id=p_id for update; if not found then raise exception 'SYNC_RESOURCE_MISSING'; end if; if rev<>p_expected_revision then raise exception 'SYNC_REVISION_CONFLICT'; end if; delete from public.saved_places where user_id=u and id=p_id;
  when 'saved_stop' then select revision into rev from public.saved_stops where user_id=u and id=p_id for update; if not found then raise exception 'SYNC_RESOURCE_MISSING'; end if; if rev<>p_expected_revision then raise exception 'SYNC_REVISION_CONFLICT'; end if; delete from public.saved_stops where user_id=u and id=p_id;
  when 'saved_route' then select revision into rev from public.saved_routes where user_id=u and id=p_id for update; if not found then raise exception 'SYNC_RESOURCE_MISSING'; end if; if rev<>p_expected_revision then raise exception 'SYNC_REVISION_CONFLICT'; end if; delete from public.saved_routes where user_id=u and id=p_id;
  when 'saved_journey' then select revision into rev from public.saved_journeys where user_id=u and id=p_id for update; if not found then raise exception 'SYNC_RESOURCE_MISSING'; end if; if rev<>p_expected_revision then raise exception 'SYNC_REVISION_CONFLICT'; end if; delete from public.saved_journeys where user_id=u and id=p_id;
 end case;
 rev:=rev+1;
 insert into uv_private.sync_tombstones(user_id,resource_type,resource_id,revision,operation_id) values(u,p_resource_type,p_id,rev,p_operation_id) returning * into t;
 return query select t.revision,t.deleted_at;
end $$;
revoke all on function public.sync_delete_saved(uuid,text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.sync_delete_saved(uuid,text,uuid,bigint) to authenticated;

create or replace function public.account_sync_tombstones(p_since timestamptz default null)
returns table(resource_type text,resource_id uuid,revision bigint,deleted_at timestamptz)
language sql security invoker set search_path='' stable as $$
 select t.resource_type,t.resource_id,t.revision,t.deleted_at
 from uv_private.sync_tombstones t
 where t.user_id=(select auth.uid()) and (p_since is null or t.deleted_at>p_since)
 order by t.deleted_at,t.resource_type,t.resource_id
$$;
revoke all on function public.account_sync_tombstones(timestamptz) from public,anon,authenticated;
grant execute on function public.account_sync_tombstones(timestamptz) to authenticated;
