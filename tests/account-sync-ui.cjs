const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const {window}=parseHTML('<html><body><div id="driverToolsBtn"></div><section id="host"></section></body></html>');
global.window=window;global.document=window.document;global.CustomEvent=window.CustomEvent;
require('../js/identity/onboarding.js');
window.UVAccountOnboarding=global.UVAccountOnboarding||window.UVAccountOnboarding;
window.UVTransitI18n={locale:'it',t:(k,vars)=>{let s=k;if(vars)for(const [a,b] of Object.entries(vars))s=s.replace('{{'+a+'}}',String(b));return s}};
let connectCalls=0,clearCalls=0,resetCalls=0,signOutCalls=0,privacyAccepted=false,privacyAcceptCalls=0;
window.UVAccountRuntime={
 connect:async()=>{connectCalls++;return {ok:true}},
 clearCache:async()=>{clearCalls++;return true},
 reset:()=>{resetCalls++}
};
require('../js/ui/account-wizard.js');

const fake={
 hasAuthRedirect:()=>false,authRedirectUrl:()=>'/callback',
 signUp:async()=>({session:null,needsConfirmation:true}),
 signInPassword:async()=>({user:{id:'a',email:'a@b.test'}}),
 requestPasswordReset:async()=>true,updatePassword:async()=>true,
 hasPrivacyNotice:async()=>privacyAccepted,
 acceptPrivacyNotice:async()=>{privacyAccepted=true;privacyAcceptCalls++;return {out_notice_version:'privacy-test'}},
 loadProfile:async()=>({profile:window.UVAccountOnboarding.normalize(),consent:{marketing_email:false,profiling:false}}),
 saveProfile:async()=>true,
 signOut:async()=>{signOutCalls++;return true}
};
const host=document.getElementById('host');
const wizard=window.UVAccountWizard.mount(host,fake,{noticeUrl:'/privacy',noticeVersion:'privacy-test'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const button=key=>[...host.querySelectorAll('button')].find(x=>x.textContent==='account.'+key);
const click=key=>{const b=button(key);assert(b,'missing '+key);b.onclick();return tick()};

(async()=>{
 await click('loginTab');
 let input=host.querySelector('input[type=email]');input.value='a@b.test';input.reportValidity=()=>true;
 const password=host.querySelector('input[type=password]');password.value='12345678';password.reportValidity=()=>true;await click('loginAction');
 assert.equal(wizard.stage(),'privacy');assert.equal(connectCalls,0);
 const privacyCheck=host.querySelector('input[type=checkbox]');assert(privacyCheck);privacyCheck.checked=true;privacyCheck.reportValidity=()=>true;
 await click('privacyContinue');
 assert.equal(privacyAcceptCalls,1);assert.equal(wizard.stage(),'home');assert.equal(connectCalls,1);
 assert(host.textContent.includes('a@b.test'));assert(button('editProfile'));assert(button('editTravel'));assert(button('editConsent'));
 for(const obsolete of ['syncCheck','syncEnable','syncImport','syncNow','syncDisable'])assert.equal(button(obsolete),undefined);
 await click('logout');
 assert.equal(clearCalls,1);assert.equal(signOutCalls,1);assert.equal(resetCalls,1);
 assert.equal(wizard.stage(),'register');
 console.log('account-sync-ui: password login lands on account home, no manual sync UI, cache clear on logout passed');
})().catch(e=>{console.error(e);process.exitCode=1});
