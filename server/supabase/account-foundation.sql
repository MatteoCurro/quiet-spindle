-- M10.2A: account database foundation. No application activation.
-- Canonical DDL for the remote account_foundation migration.
begin;
create schema if not exists uv_private;
revoke all on schema uv_private from public, anon, authenticated;
grant usage on schema uv_private to authenticated;
create function uv_private.account_revision() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
 if TG_OP = 'UPDATE' then
  if NEW.user_id is distinct from OLD.user_id then
   raise exception 'Immutable owner' using errcode = '42501';
  end if;
  NEW.revision := OLD.revision + 1;
  NEW.created_at := OLD.created_at;
 else
  NEW.revision := 1;
  NEW.created_at := now();
 end if;
 NEW.updated_at := now();
 return NEW;
end;
$$;
revoke all on function uv_private.account_revision() from public, anon, authenticated;

create table public.account_profiles (
user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
display_name text check(char_length(display_name) between 1 and 80),
language text check(language in ('it','en','fr','de')),
country text check(country ~ '^[A-Z]{2}$'),
revision bigint not null default 1 check(revision > 0),
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
);
alter table public.account_profiles enable row level security;
revoke all on public.account_profiles from public, anon, authenticated;
grant select, delete on public.account_profiles to authenticated;
grant insert (user_id, display_name, language, country) on public.account_profiles to authenticated;
grant update (display_name, language, country) on public.account_profiles to authenticated;
create policy owner_read on public.account_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy owner_insert on public.account_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy owner_update on public.account_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy owner_delete on public.account_profiles for delete to authenticated using ((select auth.uid()) = user_id);
create trigger set_account_revision before insert or update on public.account_profiles
 for each row execute function uv_private.account_revision();

create table public.account_settings (
user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
sync_enabled boolean not null default false,
notice_version text check(char_length(notice_version) between 1 and 80),
check(not sync_enabled or notice_version is not null),
revision bigint not null default 1 check(revision > 0),
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
);
alter table public.account_settings enable row level security;
revoke all on public.account_settings from public, anon, authenticated;
grant select, delete on public.account_settings to authenticated;
grant insert (user_id, sync_enabled, notice_version) on public.account_settings to authenticated;
grant update (sync_enabled, notice_version) on public.account_settings to authenticated;
create policy owner_read on public.account_settings for select to authenticated using ((select auth.uid()) = user_id);
create policy owner_insert on public.account_settings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy owner_update on public.account_settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy owner_delete on public.account_settings for delete to authenticated using ((select auth.uid()) = user_id);
create trigger set_account_revision before insert or update on public.account_settings
 for each row execute function uv_private.account_revision();

create table public.account_preferences (
user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
language text check(language in ('it','en','fr','de')),
revision bigint not null default 1 check(revision > 0),
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
);
alter table public.account_preferences enable row level security;
revoke all on public.account_preferences from public, anon, authenticated;
grant select, delete on public.account_preferences to authenticated;
grant insert (user_id, language) on public.account_preferences to authenticated;
grant update (language) on public.account_preferences to authenticated;
create policy owner_read on public.account_preferences for select to authenticated using ((select auth.uid()) = user_id);
create policy owner_insert on public.account_preferences for insert to authenticated with check ((select auth.uid()) = user_id and exists (select 1 from public.account_settings s where s.user_id = (select auth.uid()) and s.sync_enabled));
create policy owner_update on public.account_preferences for update to authenticated using ((select auth.uid()) = user_id and exists (select 1 from public.account_settings s where s.user_id = (select auth.uid()) and s.sync_enabled)) with check ((select auth.uid()) = user_id and exists (select 1 from public.account_settings s where s.user_id = (select auth.uid()) and s.sync_enabled));
create policy owner_delete on public.account_preferences for delete to authenticated using ((select auth.uid()) = user_id);
create trigger set_account_revision before insert or update on public.account_preferences
 for each row execute function uv_private.account_revision();

create table public.saved_places (
user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
id uuid not null default gen_random_uuid(),
label text not null check(char_length(label) between 1 and 120),
lat double precision not null check(lat between -90 and 90),
lon double precision not null check(lon between -180 and 180),
entity_id text check(char_length(entity_id) between 1 and 200),
primary key(user_id,id),
revision bigint not null default 1 check(revision > 0),
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
);
alter table public.saved_places enable row level security;
revoke all on public.saved_places from public, anon, authenticated;
grant select, delete on public.saved_places to authenticated;
grant insert (user_id, id, label, lat, lon, entity_id) on public.saved_places to authenticated;
grant update (label, lat, lon, entity_id) on public.saved_places to authenticated;
create policy owner_read on public.saved_places for select to authenticated using ((select auth.uid()) = user_id);
create policy owner_insert on public.saved_places for insert to authenticated with check ((select auth.uid()) = user_id and exists (select 1 from public.account_settings s where s.user_id = (select auth.uid()) and s.sync_enabled));
create policy owner_update on public.saved_places for update to authenticated using ((select auth.uid()) = user_id and exists (select 1 from public.account_settings s where s.user_id = (select auth.uid()) and s.sync_enabled)) with check ((select auth.uid()) = user_id and exists (select 1 from public.account_settings s where s.user_id = (select auth.uid()) and s.sync_enabled));
create policy owner_delete on public.saved_places for delete to authenticated using ((select auth.uid()) = user_id);
create trigger set_account_revision before insert or update on public.saved_places
 for each row execute function uv_private.account_revision();

create table public.saved_stops (
user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
id uuid not null default gen_random_uuid(),
provider_id text not null check(char_length(provider_id) between 1 and 80),
stop_id text not null check(char_length(stop_id) between 1 and 200),
primary key(user_id,id), unique(user_id,provider_id,stop_id),
revision bigint not null default 1 check(revision > 0),
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
);
alter table public.saved_stops enable row level security;
revoke all on public.saved_stops from public, anon, authenticated;
grant select, delete on public.saved_stops to authenticated;
grant insert (user_id, id, provider_id, stop_id) on public.saved_stops to authenticated;
grant update (provider_id, stop_id) on public.saved_stops to authenticated;
create policy owner_read on public.saved_stops for select to authenticated using ((select auth.uid()) = user_id);
create policy owner_insert on public.saved_stops for insert to authenticated with check ((select auth.uid()) = user_id and exists (select 1 from public.account_settings s where s.user_id = (select auth.uid()) and s.sync_enabled));
create policy owner_update on public.saved_stops for update to authenticated using ((select auth.uid()) = user_id and exists (select 1 from public.account_settings s where s.user_id = (select auth.uid()) and s.sync_enabled)) with check ((select auth.uid()) = user_id and exists (select 1 from public.account_settings s where s.user_id = (select auth.uid()) and s.sync_enabled));
create policy owner_delete on public.saved_stops for delete to authenticated using ((select auth.uid()) = user_id);
create trigger set_account_revision before insert or update on public.saved_stops
 for each row execute function uv_private.account_revision();

create table public.saved_routes (
user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
id uuid not null default gen_random_uuid(),
provider_id text not null check(char_length(provider_id) between 1 and 80),
route_id text not null check(char_length(route_id) between 1 and 200),
primary key(user_id,id), unique(user_id,provider_id,route_id),
revision bigint not null default 1 check(revision > 0),
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
);
alter table public.saved_routes enable row level security;
revoke all on public.saved_routes from public, anon, authenticated;
grant select, delete on public.saved_routes to authenticated;
grant insert (user_id, id, provider_id, route_id) on public.saved_routes to authenticated;
grant update (provider_id, route_id) on public.saved_routes to authenticated;
create policy owner_read on public.saved_routes for select to authenticated using ((select auth.uid()) = user_id);
create policy owner_insert on public.saved_routes for insert to authenticated with check ((select auth.uid()) = user_id and exists (select 1 from public.account_settings s where s.user_id = (select auth.uid()) and s.sync_enabled));
create policy owner_update on public.saved_routes for update to authenticated using ((select auth.uid()) = user_id and exists (select 1 from public.account_settings s where s.user_id = (select auth.uid()) and s.sync_enabled)) with check ((select auth.uid()) = user_id and exists (select 1 from public.account_settings s where s.user_id = (select auth.uid()) and s.sync_enabled));
create policy owner_delete on public.saved_routes for delete to authenticated using ((select auth.uid()) = user_id);
create trigger set_account_revision before insert or update on public.saved_routes
 for each row execute function uv_private.account_revision();

create table public.saved_journeys (
user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
id uuid not null default gen_random_uuid(),
label text not null check(char_length(label) between 1 and 120),
origin_label text not null check(char_length(origin_label) between 1 and 300),
origin_lat double precision not null check(origin_lat between -90 and 90),
origin_lon double precision not null check(origin_lon between -180 and 180),
destination_label text not null check(char_length(destination_label) between 1 and 300),
destination_lat double precision not null check(destination_lat between -90 and 90),
destination_lon double precision not null check(destination_lon between -180 and 180),
primary key(user_id,id),
revision bigint not null default 1 check(revision > 0),
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
);
alter table public.saved_journeys enable row level security;
revoke all on public.saved_journeys from public, anon, authenticated;
grant select, delete on public.saved_journeys to authenticated;
grant insert (user_id, id, label, origin_label, origin_lat, origin_lon, destination_label, destination_lat, destination_lon) on public.saved_journeys to authenticated;
grant update (label, origin_label, origin_lat, origin_lon, destination_label, destination_lat, destination_lon) on public.saved_journeys to authenticated;
create policy owner_read on public.saved_journeys for select to authenticated using ((select auth.uid()) = user_id);
create policy owner_insert on public.saved_journeys for insert to authenticated with check ((select auth.uid()) = user_id and exists (select 1 from public.account_settings s where s.user_id = (select auth.uid()) and s.sync_enabled));
create policy owner_update on public.saved_journeys for update to authenticated using ((select auth.uid()) = user_id and exists (select 1 from public.account_settings s where s.user_id = (select auth.uid()) and s.sync_enabled)) with check ((select auth.uid()) = user_id and exists (select 1 from public.account_settings s where s.user_id = (select auth.uid()) and s.sync_enabled));
create policy owner_delete on public.saved_journeys for delete to authenticated using ((select auth.uid()) = user_id);
create trigger set_account_revision before insert or update on public.saved_journeys
 for each row execute function uv_private.account_revision();

-- Serialize inserts against each user's settings row before counting; independent users never block one another.
create function uv_private.saved_quota() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare n bigint;
begin
 if NEW.user_id is distinct from auth.uid() then
  raise exception 'Invalid owner' using errcode='42501';
 end if;
 perform 1 from public.account_settings
 where user_id=NEW.user_id and sync_enabled for update;
 if not found then raise exception 'Sync disabled' using errcode='42501'; end if;
 execute format('select count(*) from public.%I where user_id=$1', TG_TABLE_NAME)
 into n using NEW.user_id;
 if n >= 200 then raise exception 'Saved item quota reached' using errcode='23514'; end if;
 return NEW;
end;
$$;
revoke all on function uv_private.saved_quota() from public, anon, authenticated;
create trigger enforce_saved_quota before insert on public.saved_places for each row execute function uv_private.saved_quota();
create trigger enforce_saved_quota before insert on public.saved_stops for each row execute function uv_private.saved_quota();
create trigger enforce_saved_quota before insert on public.saved_routes for each row execute function uv_private.saved_quota();
create trigger enforce_saved_quota before insert on public.saved_journeys for each row execute function uv_private.saved_quota();
commit;
