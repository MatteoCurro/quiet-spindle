-- M10.5 — privacy notice acknowledgement.
-- Applied to T-Sand as 20261007111634 account_privacy_notice_acceptance.
create table public.account_privacy_acceptances(
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  notice_version text not null check(char_length(notice_version) between 1 and 80),
  locale text check(locale in ('it','en','fr','de')),
  source text not null default 'account' check(source in ('account','reauth','social')),
  accepted_at timestamptz not null default now(),
  unique(user_id,notice_version)
);
alter table public.account_privacy_acceptances enable row level security;
revoke all on public.account_privacy_acceptances from public,anon,authenticated;
revoke all on sequence public.account_privacy_acceptances_id_seq from public,anon,authenticated;
grant select on public.account_privacy_acceptances to authenticated;
grant insert(user_id,notice_version,locale,source) on public.account_privacy_acceptances to authenticated;

create policy owner_read on public.account_privacy_acceptances
 for select to authenticated using((select auth.uid())=user_id);
create policy owner_insert on public.account_privacy_acceptances
 for insert to authenticated with check((select auth.uid())=user_id);

create function public.accept_privacy_notice(
  p_notice_version text,
  p_locale text default null,
  p_source text default 'account'
) returns table(out_notice_version text,out_accepted_at timestamptz)
language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null then raise exception 'ACCOUNT_SIGNIN_REQUIRED' using errcode='42501'; end if;
 if nullif(btrim(coalesce(p_notice_version,'')),'') is null or char_length(p_notice_version)>80 then
  raise exception 'PRIVACY_NOTICE_INVALID';
 end if;
 if p_locale is not null and p_locale not in ('it','en','fr','de') then
  raise exception 'PRIVACY_LOCALE_INVALID';
 end if;
 if p_source not in ('account','reauth','social') then raise exception 'PRIVACY_SOURCE_INVALID'; end if;
 insert into public.account_privacy_acceptances(user_id,notice_version,locale,source)
 values(u,p_notice_version,p_locale,p_source)
 on conflict(user_id,notice_version) do nothing;
 return query
 select a.notice_version,a.accepted_at
 from public.account_privacy_acceptances a
 where a.user_id=u and a.notice_version=p_notice_version;
end $$;
revoke all on function public.accept_privacy_notice(text,text,text) from public,anon,authenticated;
grant execute on function public.accept_privacy_notice(text,text,text) to authenticated;

create function public.has_privacy_notice(p_notice_version text) returns boolean
language sql security invoker set search_path='' stable as $$
 select exists(
  select 1 from public.account_privacy_acceptances a
  where a.user_id=auth.uid() and a.notice_version=p_notice_version
 )
$$;
revoke all on function public.has_privacy_notice(text) from public,anon,authenticated;
grant execute on function public.has_privacy_notice(text) to authenticated;

comment on table public.account_privacy_acceptances is
'Immutable evidence that the authenticated user acknowledged a specific privacy notice version. This is not a blanket consent to processing.';
