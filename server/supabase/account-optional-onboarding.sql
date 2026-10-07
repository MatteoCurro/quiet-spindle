begin;
alter table public.account_profiles
 add column local_relation text check(local_relation in ('resident','commuter','visitor','planning')),
 add column is_driver boolean,
 add column stay_interest text check(stay_interest in ('looking','booked','not_now')),
 add column travel_period text check(travel_period in ('soon','later','unsure'));
grant insert(local_relation,is_driver,stay_interest,travel_period), update(local_relation,is_driver,stay_interest,travel_period)
 on public.account_profiles to authenticated;
create table public.account_marketing_preferences(
 user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
 marketing_email boolean not null default false,
 profiling boolean not null default false,
 notice_version text not null check(char_length(notice_version) between 1 and 80),
 revision bigint not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.account_marketing_preferences enable row level security;
revoke all on public.account_marketing_preferences from public,anon,authenticated;
grant select on public.account_marketing_preferences to authenticated;
grant insert(user_id,marketing_email,profiling,notice_version),update(marketing_email,profiling,notice_version)
 on public.account_marketing_preferences to authenticated;
create policy owner_read on public.account_marketing_preferences for select to authenticated using((select auth.uid())=user_id);
create policy owner_insert on public.account_marketing_preferences for insert to authenticated with check((select auth.uid())=user_id);
create policy owner_update on public.account_marketing_preferences for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create trigger set_account_revision before insert or update on public.account_marketing_preferences
for each row execute function uv_private.account_revision();
create table public.account_consent_events(
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 marketing_email boolean not null,
 profiling boolean not null,
 notice_version text not null,
 recorded_at timestamptz not null default now()
);
create index account_consent_events_owner on public.account_consent_events(user_id);
alter table public.account_consent_events enable row level security;
revoke all on public.account_consent_events from public,anon,authenticated;
revoke all on sequence public.account_consent_events_id_seq from public,anon,authenticated;
grant select on public.account_consent_events to authenticated;
create policy owner_read on public.account_consent_events for select to authenticated using((select auth.uid())=user_id);
-- Definer is required only to append immutable evidence unavailable for direct client writes.
-- Internal non-exposed schema, no direct EXECUTE, verified owner, no dynamic SQL.
create function uv_private.record_account_consent() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from NEW.user_id then
  raise exception 'Invalid consent owner' using errcode='42501';
 end if;
 if TG_OP='UPDATE' then
  if (OLD.marketing_email,OLD.profiling,OLD.notice_version) is not distinct from
     (NEW.marketing_email,NEW.profiling,NEW.notice_version) then return NEW; end if;
 end if;
 insert into public.account_consent_events(user_id,marketing_email,profiling,notice_version)
 values(NEW.user_id,NEW.marketing_email,NEW.profiling,NEW.notice_version);
 return NEW;
end;
$$;
revoke all on function uv_private.record_account_consent() from public,anon,authenticated;
create trigger consent_evidence after insert or update on public.account_marketing_preferences
for each row execute function uv_private.record_account_consent();
comment on column public.account_profiles.is_driver is 'Self-declared UI preference only; never an authorization or admin role';
comment on table public.account_marketing_preferences is 'Current email marketing and personalization choices; neither implies third-party advertising consent';
commit;
