/* U.Venice 9.0 M10 — provider-neutral account boundary.
   Authentication tokens remain private to the concrete provider adapter. */
(function(g){'use strict';

function freeze(x){return Object.freeze(x)}
function cleanText(v){return typeof v==='string'&&v.trim()?v.trim():null}
function providerError(code,message){
  const e=new Error(message||code);e.code=code;return e;
}
function normalizeUser(raw){
  if(!raw||typeof raw!=='object')return null;
  const id=cleanText(raw.id||raw.sub||raw.user_id);
  if(!id)return null;
  const out={id};
  const email=cleanText(raw.email);if(email)out.email=email;
  const displayName=cleanText(raw.displayName||raw.display_name||raw.name);if(displayName)out.displayName=displayName;
  const language=cleanText(raw.language||raw.locale);if(language)out.language=language;
  const country=cleanText(raw.country);if(country)out.country=country;
  return freeze(out);
}
function normalizeSession(raw){
  if(!raw||typeof raw!=='object')return null;
  const user=normalizeUser(raw.user||raw.account||raw);
  if(!user)return null;
  return freeze({state:'user',user});
}
function assertProvider(provider){
  if(!provider||typeof provider!=='object')throw new TypeError('AccountProvider requires an adapter');
  for(const name of ['currentSession','signIn','signOut']){
    if(typeof provider[name]!=='function')throw new TypeError('AccountProvider missing '+name+'()');
  }
  return provider;
}
function create(adapter){
  assertProvider(adapter);
  const subscribe=typeof adapter.subscribe==='function'
    ?listener=>adapter.subscribe(listener)
    :()=>()=>{};
  return freeze({
    kind:String(adapter.kind||'custom'),
    currentSession:async()=>normalizeSession(await adapter.currentSession()),
    signIn:async input=>normalizeSession(await adapter.signIn(input||{})),
    signOut:async()=>!!(await adapter.signOut()),
    subscribe
  });
}
function createNoop(){
  return create({
    kind:'noop',
    currentSession:async()=>null,
    signIn:async()=>{throw providerError('ACCOUNT_PROVIDER_DISABLED','Account provider is not configured')},
    signOut:async()=>true,
    subscribe:()=>()=>{}
  });
}

g.UVAccountProvider=freeze({create,createNoop,normalizeUser,normalizeSession});
})(typeof window!=='undefined'?window:globalThis);
