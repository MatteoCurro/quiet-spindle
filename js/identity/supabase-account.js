/* Supabase isolated adapter. SDK lazy, tokens in memory, no implicit profile sync. */
(function(g){'use strict';
function error(code){const e=new Error(code);e.code=code;return e}
function create(options={}){
 const config=options.config||{};let client=null,pending=null,generation=0,remoteStore=null,syncController=null;
 const listeners=new Set();let unsubscribe=null;
 function publish(session){const clean=g.UVAccountProvider.normalizeSession(session);for(const fn of listeners){try{fn(clean)}catch(_){}}return clean}
 function redirectInfo(){
  if(typeof location==='undefined')return null;
  const hash=new URLSearchParams(String(location.hash||'').replace(/^#/,'')),search=new URLSearchParams(location.search||'');
  const type=hash.get('type')||search.get('type')||null;
  const has=hash.has('access_token')||hash.has('refresh_token')||hash.has('error')||search.has('code')||search.has('token_hash');
  return has?{type,error:hash.get('error_description')||hash.get('error')||search.get('error_description')||search.get('error')||null}:null;
 }
 function hasAuthRedirect(){return !!redirectInfo()}
 function authRedirectUrl(){if(typeof location==='undefined')return config.redirectUrl||null;const u=new URL(location.href);u.hash='';for(const key of ['code','token_hash','type','error','error_code','error_description'])u.searchParams.delete(key);return u.href}
 function cleanAuthUrl(){if(typeof history==='undefined'||typeof location==='undefined'||!history.replaceState)return;const u=new URL(location.href);u.hash='';for(const key of ['code','token_hash','type','error','error_code','error_description'])u.searchParams.delete(key);history.replaceState(history.state,'',u.href)}
 async function getClient(){
  if(!config.enabled)throw error('ACCOUNT_PROVIDER_DISABLED');
  if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(config.url||'')||!String(config.publishableKey||'').startsWith('sb_publishable_'))throw error('ACCOUNT_CONFIG_INVALID');
  if(client)return client;
  if(!pending){const epoch=generation;pending=(async()=>{
   const factory=await options.loadSDK();if(epoch!==generation)throw error('ACCOUNT_CANCELLED');
   const memory=new Map();
   client=factory(config.url,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:hasAuthRedirect(),storage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)}}});
   const subscription=client.auth.onAuthStateChange((_event,session)=>{if(epoch===generation)publish(session)});
   unsubscribe=()=>{subscription.data.subscription.unsubscribe();memory.clear()};
   return client;
  })().catch(e=>{pending=null;throw e})}
  return pending;
 }
 async function currentSession(){if(!client)return null;const {data,error:err}=await client.auth.getSession();if(err)throw error('ACCOUNT_UNAVAILABLE');return g.UVAccountProvider.normalizeSession(data.session)}
 async function signIn(input={}){
  const email=String(input.email||'').trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw error('ACCOUNT_EMAIL_INVALID');
  const c=await getClient(),epoch=generation;
  let result;
  if(input.token!==undefined){if(!/^\d{6,10}$/.test(String(input.token)))throw error('ACCOUNT_CODE_INVALID');result=await c.auth.verifyOtp({email,token:String(input.token),type:'email'})}
  else result=await c.auth.signInWithOtp({email,options:{shouldCreateUser:true}});
  if(epoch!==generation)throw error('ACCOUNT_CANCELLED');
  if(result.error)throw error(input.token!==undefined?'ACCOUNT_CODE_INVALID':'ACCOUNT_UNAVAILABLE');
  return g.UVAccountProvider.normalizeSession(result.data?.session);
 }
 async function signUp(input={}){
  const email=String(input.email||'').trim(),password=String(input.password||'');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw error('ACCOUNT_EMAIL_INVALID');if(password.length<8)throw error('ACCOUNT_PASSWORD_WEAK');
  const c=await getClient(),epoch=generation,result=await c.auth.signUp({email,password,options:{emailRedirectTo:input.redirectTo||authRedirectUrl()}});if(epoch!==generation)throw error('ACCOUNT_CANCELLED');if(result.error)throw error(result.error.code==='weak_password'?'ACCOUNT_PASSWORD_WEAK':'ACCOUNT_SIGNUP_FAILED');return Object.freeze({session:g.UVAccountProvider.normalizeSession(result.data?.session),needsConfirmation:!result.data?.session});
 }
 async function signInPassword(input={}){
  const email=String(input.email||'').trim(),password=String(input.password||'');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw error('ACCOUNT_EMAIL_INVALID');if(!password)throw error('ACCOUNT_PASSWORD_REQUIRED');const c=await getClient(),epoch=generation,result=await c.auth.signInWithPassword({email,password});if(epoch!==generation)throw error('ACCOUNT_CANCELLED');if(result.error)throw error('ACCOUNT_CREDENTIALS_INVALID');return g.UVAccountProvider.normalizeSession(result.data?.session);
 }
 async function requestPasswordReset(input={}){const email=String(input.email||'').trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw error('ACCOUNT_EMAIL_INVALID');const c=await getClient(),result=await c.auth.resetPasswordForEmail(email,{redirectTo:input.redirectTo||authRedirectUrl()});if(result.error)throw error('ACCOUNT_RECOVERY_FAILED');return true}
 async function updatePassword(input={}){const password=String(input.password||'');if(password.length<8)throw error('ACCOUNT_PASSWORD_WEAK');const c=await getClient(),result=await c.auth.updateUser({password});if(result.error)throw error('ACCOUNT_PASSWORD_UPDATE_FAILED');return true}
 async function consumeAuthRedirect(){const info=redirectInfo();if(!info)return Object.freeze({session:await currentSession(),type:null});if(info.error){cleanAuthUrl();throw error('ACCOUNT_CONFIRM_FAILED')}const c=await getClient(),result=await c.auth.getSession();if(result.error||!result.data?.session){cleanAuthUrl();throw error('ACCOUNT_CONFIRM_FAILED')}const session=publish(result.data.session),type=info.type||'auth';cleanAuthUrl();return Object.freeze({session,type})}
 async function signOut(){
  const old=client;generation++;unsubscribe?.();unsubscribe=null;client=null;pending=null;remoteStore=null;syncController=null;publish(null);
  if(old){try{const r=await old.auth.signOut({scope:'local'});if(r.error)throw error('ACCOUNT_SIGNOUT_REMOTE_FAILED')}finally{old.auth.stopAutoRefresh()}}
  return true;
 }
 async function user(){const session=await currentSession();if(!session)throw error('ACCOUNT_SIGNIN_REQUIRED');return session.user.id}
 async function hasPrivacyNotice(version=config.noticeVersion){
  await user();const c=await getClient(),r=await c.rpc('has_privacy_notice',{p_notice_version:String(version||'')});
  if(r.error)throw error('ACCOUNT_PRIVACY_CHECK_FAILED');return r.data===true;
 }
 async function acceptPrivacyNotice(input={}){
  await user();const c=await getClient();
  const version=String(input.version||config.noticeVersion||''),locale=String(input.locale||g.UVTransitI18n?.locale||'').toLowerCase()||null,source=String(input.source||'account');
  const r=await c.rpc('accept_privacy_notice',{p_notice_version:version,p_locale:locale,p_source:source});
  if(r.error)throw error('ACCOUNT_PRIVACY_ACCEPT_FAILED');return Array.isArray(r.data)?r.data[0]||null:r.data;
 }
 async function loadProfile(){const id=await user(),c=await getClient();const [a,b]=await Promise.all([c.from('account_profiles').select('display_name,language,country,local_relation,is_driver,stay_interest,travel_period').eq('user_id',id).maybeSingle(),c.from('account_marketing_preferences').select('marketing_email,profiling,notice_version').eq('user_id',id).maybeSingle()]);if(a.error||b.error)throw error('ACCOUNT_UNAVAILABLE');return {profile:g.UVAccountOnboarding.normalize(a.data||{}),consent:b.data||{marketing_email:false,profiling:false}}}
 async function saveProfile(raw,permissions){
  const id=await user(),c=await getClient(),epoch=generation;
  async function put(table,row){const exists=await c.from(table).select('user_id').eq('user_id',id).maybeSingle();if(exists.error)return exists;return exists.data?c.from(table).update(row).eq('user_id',id):c.from(table).insert({user_id:id,...row})}
  const a=await put('account_profiles',g.UVAccountOnboarding.normalize(raw));
  if(a.error)throw error('ACCOUNT_SAVE_FAILED');
  if(epoch!==generation)throw error('ACCOUNT_CANCELLED');
  const b=await put('account_marketing_preferences',g.UVAccountOnboarding.consent(permissions,config.noticeVersion));
  if(b.error)throw error('ACCOUNT_SAVE_FAILED');
  if(epoch!==generation)throw error('ACCOUNT_CANCELLED');return true;
 }
 async function exportAccountData(){
  const id=await user(),c=await getClient(),session=await currentSession();
  const specs=[
   ['account_profiles','display_name,language,country,local_relation,is_driver,stay_interest,travel_period,created_at,updated_at'],
   ['account_settings','sync_enabled,notice_version,created_at,updated_at'],
   ['account_preferences','language,created_at,updated_at'],
   ['account_marketing_preferences','marketing_email,profiling,notice_version,created_at,updated_at'],
   ['account_privacy_acceptances','notice_version,locale,source,accepted_at'],
   ['account_consent_events','marketing_email,profiling,notice_version,recorded_at'],
   ['saved_routes','id,provider_id,route_id,revision,created_at,updated_at'],
   ['saved_stops','id,provider_id,stop_id,revision,created_at,updated_at'],
   ['saved_places','id,label,lat,lon,entity_id,role,revision,created_at,updated_at'],
   ['saved_journeys','id,label,network,origin_label,origin_lat,origin_lon,origin_kind,origin_ids,destination_label,destination_lat,destination_lon,destination_kind,destination_ids,revision,created_at,updated_at']
  ];
  const rows={};
  for(const [table,fields] of specs){const r=await c.from(table).select(fields);if(r.error)throw error('ACCOUNT_EXPORT_FAILED');rows[table]=Array.isArray(r.data)?r.data:[]}
  return Object.freeze({schemaVersion:1,exportedAt:new Date().toISOString(),account:{id,email:session?.user?.email||null},data:rows});
 }
 async function deleteAccount(){
  await user();const c=await getClient();
  const r=await c.functions.invoke('delete-account',{body:{confirmation:'DELETE'}});
  if(r.error||r.data?.deleted!==true)throw error('ACCOUNT_DELETE_FAILED');
  return true;
 }
 function getRemoteStore(){
  if(remoteStore)return remoteStore;
  if(!g.UVSupabaseSyncStore?.create||!g.UVRemoteProfileStore?.create)throw error('ACCOUNT_SYNC_UNAVAILABLE');
  remoteStore=g.UVRemoteProfileStore.create(g.UVSupabaseSyncStore.create({getClient,getUserId:user}));
  return remoteStore;
 }
 async function getSyncController(){
  if(syncController)return syncController;
  const accountId=await user();
  if(!g.UVSyncIdMap?.create||!g.UVSyncState?.create||!g.UVAccountSyncSerializer?.create||!g.UVAccountSyncController?.create||!g.UVProfileSync?.create)throw error('ACCOUNT_SYNC_UNAVAILABLE');
  const stores=g.UVIdentityStores?.defaults?.();if(!stores)throw error('ACCOUNT_SYNC_UNAVAILABLE');
  const scope=g.UVSyncIdMap.scopeTag(accountId);
  const idMap=g.UVSyncIdMap.create({storage:stores.adapter,scope});
  const state=g.UVSyncState.create({storage:stores.adapter,scope});
  const serializer=g.UVAccountSyncSerializer.create({idMap,providerId:'actv'});
  const profileSync=g.UVProfileSync.create({stores});
  syncController=g.UVAccountSyncController.create({
   remoteStore:getRemoteStore(),profileSync,serializer,idMap,state,cacheManifest:g.UVAccountCache?.defaults?.(),
   getLanguage:()=>g.UVTransitI18n?.locale||null,
   setLanguage:lang=>g.UVTransitI18n?.setLocale?.(lang),
   noticeVersion:config.noticeVersion
  });
  return syncController;
 }
 return Object.freeze({kind:'supabase',currentSession,signIn,signUp,signInPassword,requestPasswordReset,updatePassword,hasAuthRedirect,consumeAuthRedirect,authRedirectUrl,signOut,hasPrivacyNotice,acceptPrivacyNotice,loadProfile,saveProfile,exportAccountData,deleteAccount,remoteStore:getRemoteStore,syncController:getSyncController,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}});

}
g.UVSupabaseAccount=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
