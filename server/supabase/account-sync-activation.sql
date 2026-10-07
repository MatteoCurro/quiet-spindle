-- M10.3C — explicit account sync activation/deactivation with CAS + idempotency.
-- Applied to T-Sand as 20261007081603 account_sync_activation.
alter table public.account_settings add column if not exists last_operation_id uuid;
grant insert(last_operation_id), update(last_operation_id) on public.account_settings to authenticated;

create or replace function public.set_account_sync(
  p_operation_id uuid,
  p_expected_revision bigint,
  p_enabled boolean,
  p_notice_version text default null
) returns table(out_revision bigint,out_updated_at timestamptz,out_sync_enabled boolean)
language plpgsql security invoker set search_path='' as $$
declare
  u uuid:=auth.uid();
  r public.account_settings%rowtype;
  notice text:=nullif(btrim(coalesce(p_notice_version,'')),'');
begin
  if u is null then raise exception 'SYNC_SIGNIN_REQUIRED' using errcode='42501'; end if;
  if p_operation_id is null or p_expected_revision<0 then raise exception 'SYNC_INPUT_INVALID'; end if;
  if p_enabled and notice is null then raise exception 'SYNC_NOTICE_REQUIRED'; end if;

  select * into r from public.account_settings where user_id=u for update;
  if found then
    if r.last_operation_id=p_operation_id then
      return query select r.revision,r.updated_at,r.sync_enabled; return;
    end if;
    if r.revision<>p_expected_revision then raise exception 'SYNC_REVISION_CONFLICT'; end if;
    update public.account_settings
       set sync_enabled=p_enabled,
           notice_version=case when p_enabled then notice else coalesce(notice,r.notice_version) end,
           last_operation_id=p_operation_id
     where user_id=u
     returning * into r;
  else
    if p_expected_revision<>0 then raise exception 'SYNC_REVISION_CONFLICT'; end if;
    insert into public.account_settings(user_id,sync_enabled,notice_version,last_operation_id)
    values(u,p_enabled,case when p_enabled then notice else null end,p_operation_id)
    returning * into r;
  end if;
  return query select r.revision,r.updated_at,r.sync_enabled;
end $$;
revoke all on function public.set_account_sync(uuid,bigint,boolean,text) from public,anon,authenticated;
grant execute on function public.set_account_sync(uuid,bigint,boolean,text) to authenticated;
