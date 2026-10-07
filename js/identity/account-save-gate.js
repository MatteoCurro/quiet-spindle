/* M10.4 — saving becomes an account feature once Account is enabled.
   Until Auth is enabled in config, legacy/local behavior remains untouched. */
(function(g){'use strict';

function freeze(x){return Object.freeze(x)}
let accountAvailable=false;
let accountState='guest';

function onAvailability(event){accountAvailable=event?.detail?.enabled===true}
function onState(event){accountState=event?.detail?.state==='user'?'user':'guest'}

g.addEventListener?.('uv:account-availability',onAvailability);
g.addEventListener?.('uv:account-state',onState);

function canCreate(){
  // Important rollout gate: do not break production/local saving before Auth is actually enabled.
  return !accountAvailable||accountState==='user';
}
function message(){
  return g.UVTransitI18n?.t?.('account.saveRequiresAccount')||
    'Accedi o crea un account per salvare.';
}
function request(kind='item'){
  if(canCreate())return true;
  try{
    g.dispatchEvent(new CustomEvent('uv:account-save-required',{detail:{kind}}));
    g.dispatchEvent(new CustomEvent('uv:account-open-request',{detail:{reason:'save',kind}}));
  }catch(_){}
  return false;
}
function error(kind='item'){
  const e=new Error(message());e.code='ACCOUNT_REQUIRED_TO_SAVE';e.kind=kind;return e;
}
function requireAccount(kind='item'){
  if(request(kind))return true;
  throw error(kind);
}
function snapshot(){return freeze({accountAvailable,accountState,canCreate:canCreate()})}

g.UVAccountSaveGate=freeze({canCreate,request,requireAccount,error,snapshot});
})(typeof window!=='undefined'?window:globalThis);
