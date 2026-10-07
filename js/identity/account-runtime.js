/* M10.3E — shared account runtime. Keeps provider adapter private from transport core. */
(function(g){'use strict';
let adapter=null,config=null,controllerPromise=null;
function freeze(x){return Object.freeze(x)}
function attach(nextAdapter,nextConfig={}){
 if(!nextAdapter)throw new TypeError('Account adapter required');
 adapter=nextAdapter;config=nextConfig||{};controllerPromise=null;
 return true;
}
function available(){return !!adapter}
async function session(){return adapter?.currentSession?adapter.currentSession():null}
async function controller(){
 if(!adapter?.syncController)throw Object.assign(new Error('ACCOUNT_UNAVAILABLE'),{code:'ACCOUNT_UNAVAILABLE'});
 if(!controllerPromise)controllerPromise=Promise.resolve(adapter.syncController()).catch(e=>{controllerPromise=null;throw e});
 return controllerPromise;
}
async function connect(){const c=await controller();return c.connectAccount()}
async function clearCache(){
 if(!controllerPromise){try{return g.UVAccountCache?.defaults?.().purge?.()}catch(_){return null}}
 try{return await (await controller()).clearAccountCache()}finally{controllerPromise=null}
}
function reset(){controllerPromise=null}
function currentConfig(){return freeze({...config})}
g.UVAccountRuntime=freeze({attach,available,session,controller,connect,clearCache,reset,config:currentConfig});
})(typeof window!=='undefined'?window:globalThis);
