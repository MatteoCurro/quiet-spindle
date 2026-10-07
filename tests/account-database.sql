-- Transactional integration tests. Synthetic users only; all changes rolled back.
begin;
select set_config('uv.test.a', gen_random_uuid()::text, true);
select set_config('uv.test.b', gen_random_uuid()::text, true);
insert into auth.users(id) values(current_setting('uv.test.a')::uuid),(current_setting('uv.test.b')::uuid);
select set_config('request.jwt.claim.sub',current_setting('uv.test.a'),true);
set local role authenticated;
insert into public.account_settings(sync_enabled,notice_version) values(true,'test-only');
insert into public.account_profiles(display_name) values('Synthetic');
insert into public.account_preferences(language) values('it');
insert into public.saved_places(label,lat,lon) values('Synthetic',45,12);
insert into public.saved_stops(provider_id,stop_id) values('test','s1');
insert into public.saved_routes(provider_id,route_id) values('test','r1');
insert into public.saved_journeys(label,origin_label,origin_lat,origin_lon,destination_label,destination_lat,destination_lon)
values('Synthetic','A',45,12,'B',46,13);
do $$
declare n bigint; t text;
begin
 foreach t in array array['account_profiles','account_settings','account_preferences','saved_places','saved_stops','saved_routes','saved_journeys'] loop
  execute format('select count(*) from public.%I',t) into n;
  if n<>1 then raise exception 'Owner read failed %',t; end if;
  begin
   execute format('update public.%I set user_id=$1',t) using current_setting('uv.test.b')::uuid;
   raise exception 'Owner change allowed %',t;
  exception when insufficient_privilege then null; end;
  begin
   execute format('update public.%I set revision=999',t);
   raise exception 'Revision overwrite allowed %',t;
  exception when insufficient_privilege then null; end;
 end loop;
 update public.saved_places set label='Updated';
 if (select revision from public.saved_places) <> 2 then raise exception 'Revision trigger failed'; end if;
 begin
  insert into public.saved_places(label,lat,lon) values('Bad',91,12);
  raise exception 'Invalid latitude accepted';
 exception when check_violation then null; end;
end;
$$;
select set_config('request.jwt.claim.sub',current_setting('uv.test.b'),true);
do $$
declare n bigint; t text;
begin
 foreach t in array array['account_profiles','account_settings','account_preferences','saved_places','saved_stops','saved_routes','saved_journeys'] loop
  execute format('select count(*) from public.%I',t) into n;
  if n<>0 then raise exception 'Cross-user read %',t; end if;
  execute format('delete from public.%I',t);
  get diagnostics n = row_count;
  if n<>0 then raise exception 'Cross-user delete %',t; end if;
 end loop;
 update public.saved_places set label='Attack';
 get diagnostics n = row_count;
 if n<>0 then raise exception 'Cross-user update'; end if;
 begin
  insert into public.account_profiles(user_id,display_name) values(current_setting('uv.test.a')::uuid,'Attack');
  raise exception 'Cross-user insert accepted';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.saved_places(user_id,label,lat,lon) values(current_setting('uv.test.a')::uuid,'Attack',45,12);
  raise exception 'Cross-user saved insert accepted';
 exception when insufficient_privilege then null; end;
end;
$$;
reset role;
set local role anon;
do $$
declare t text;
begin
 foreach t in array array['account_profiles','account_settings','account_preferences','saved_places','saved_stops','saved_routes','saved_journeys'] loop
  begin
   execute format('select * from public.%I',t);
   raise exception 'Anonymous access %',t;
  exception when insufficient_privilege then null; end;
 end loop;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('uv.test.a'),true);
set local role authenticated;
insert into public.saved_routes(provider_id,route_id) select 'test','quota-'||g from generate_series(1,199) g;
do $$
begin
 begin
  insert into public.saved_routes(provider_id,route_id) values('test','over-limit');
  raise exception 'Quota not enforced';
 exception when check_violation then null; end;
end;
$$;
update public.account_settings set sync_enabled=false;
do $$
declare n bigint;
begin
 begin
  insert into public.saved_places(label,lat,lon) values('Disabled',45,12);
  raise exception 'Sync disabled insert accepted';
 exception when insufficient_privilege then null; end;
 update public.saved_places set label='Disabled';
 get diagnostics n = row_count;
 if n<>0 then raise exception 'Sync disabled update accepted'; end if;
 if (select count(*) from public.saved_places)<>1 then raise exception 'Export access blocked'; end if;
 delete from public.saved_places;
 get diagnostics n = row_count;
 if n<>1 then raise exception 'Deletion with sync off blocked'; end if;
end;
$$;
reset role;
delete from auth.users where id=current_setting('uv.test.a')::uuid;
do $$
declare n bigint; t text;
begin
 foreach t in array array['account_profiles','account_settings','account_preferences','saved_places','saved_stops','saved_routes','saved_journeys'] loop
  execute format('select count(*) from public.%I where user_id=$1',t) into n using current_setting('uv.test.a')::uuid;
  if n<>0 then raise exception 'Cascade failed %',t; end if;
 end loop;
end;
$$;
set local role authenticated;
do $$
begin
 begin
  insert into public.account_profiles(display_name) values('Deleted user token');
  raise exception 'Deleted user recreated data';
 exception when foreign_key_violation then null; end;
end;
$$;
reset role;
select 'PASS: ownership, anon denial, revision, coordinates, quota, opt-out, rights, cascade, deleted user' as result;
rollback;
