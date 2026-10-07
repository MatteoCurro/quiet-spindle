const assert=require('node:assert/strict');
global.window=globalThis;
require('../js/identity/account-provider.js');
require('../js/identity/onboarding.js');
require('../js/identity/supabase-account.js');

const session={user:{id:'11111111-1111-4111-8111-111111111111',email:'user@example.test'}};
const rows={
 account_profiles:[{display_name:'Demo',language:'it',country:'IT',local_relation:'resident',is_driver:false,stay_interest:'not_now',travel_period:'unsure',created_at:'a',updated_at:'b'}],
 account_settings:[{sync_enabled:true,notice_version:'privacy-v1',created_at:'a',updated_at:'b'}],
 account_preferences:[{language:'it',created_at:'a',updated_at:'b'}],
 account_marketing_preferences:[{marketing_email:false,profiling:false,notice_version:'privacy-v1',created_at:'a',updated_at:'b'}],
 account_privacy_acceptances:[{notice_version:'privacy-v1',locale:'it',source:'account',accepted_at:'a'}],
 account_consent_events:[{marketing_email:false,profiling:false,notice_version:'privacy-v1',recorded_at:'a'}],
 saved_routes:[{id:'r',provider_id:'actv',route_id:'4L',revision:1,created_at:'a',updated_at:'b'}],
 saved_stops:[],saved_places:[],saved_journeys:[]
};
const calls=[];
const client={
 auth:{
  onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
  getSession:async()=>({data:{session},error:null}),
  verifyOtp:async()=>({data:{session},error:null}),
  signInWithOtp:async()=>({data:{session:null},error:null}),
  signOut:async()=>({error:null}),
  stopAutoRefresh(){}
 },
 from:table=>({
  select:async fields=>{calls.push(['select',table,fields]);return {data:rows[table]||[],error:null}}
 }),
 rpc:async(name,args)=>{
  calls.push(['rpc',name,args]);
  if(name==='has_privacy_notice')return {data:true,error:null};
  if(name==='accept_privacy_notice')return {data:[{out_notice_version:args.p_notice_version,out_accepted_at:'a'}],error:null};
  return {data:null,error:null};
 },
 functions:{invoke:async(name,args)=>{calls.push(['function',name,args]);return {data:{deleted:true},error:null}}}
};
const adapter=UVSupabaseAccount.create({
 config:{enabled:true,url:'https://abc123.supabase.co',publishableKey:'sb_publishable_test_key',noticeVersion:'privacy-v1'},
 loadSDK:async()=>()=>client
});

(async()=>{
 await adapter.signIn({email:'user@example.test',token:'123456'});
 assert.equal(await adapter.hasPrivacyNotice('privacy-v1'),true);
 const accepted=await adapter.acceptPrivacyNotice({version:'privacy-v1',locale:'it'});
 assert.equal(accepted.out_notice_version,'privacy-v1');
 const out=await adapter.exportAccountData();
 assert.equal(out.schemaVersion,1);
 assert.equal(out.account.email,'user@example.test');
 assert.equal(out.data.saved_routes[0].route_id,'4L');
 assert.equal(out.data.account_privacy_acceptances[0].notice_version,'privacy-v1');
 assert.equal(Object.prototype.hasOwnProperty.call(out,'token'),false);
 assert.equal(JSON.stringify(out).includes('access_token'),false);
 assert.equal(await adapter.deleteAccount(),true);
 assert(calls.some(x=>x[0]==='function'&&x[1]==='delete-account'&&x[2].body.confirmation==='DELETE'));
 console.log('account-rights: privacy ack, export allowlist and authenticated delete call passed');
})().catch(e=>{console.error(e);process.exitCode=1});
