/* U.Venice 9.0 M10 — guest/user session state, fail-open to M9 guest identity. */
(function(g){'use strict';

function freeze(x){return Object.freeze(x)}
function create(options={}){
  const provider=options.provider||g.UVAccountProvider?.createNoop?.();
  const guest=options.guest||g.UVGuestIdentity;
  if(!provider)throw new Error('AccountProvider unavailable');
  if(!guest||typeof guest.getOrCreate!=='function')throw new Error('Guest identity unavailable');
  const listeners=new Set();
  let state=null;
  function guestState(){
    const row=guest.getOrCreate();
    return freeze({state:'guest',guestId:row.id,account:null});
  }
  function userState(session){
    return freeze({state:'user',guestId:null,account:session.user});
  }
  function publish(next){
    state=next;
    for(const fn of listeners){try{fn(state)}catch(_){}}
    return state;
  }
  function current(){return state||publish(guestState())}
  async function bootstrap(){
    try{
      const session=await provider.currentSession();
      return publish(session?userState(session):guestState());
    }catch(_){
      return publish(guestState());
    }
  }
  async function signIn(input={}){
    const session=await provider.signIn(input);
    if(session)return publish(userState(session));
    const restored=await provider.currentSession();
    return publish(restored?userState(restored):guestState());
  }
  async function signOut(){
    try{await provider.signOut()}finally{return publish(guestState())}
  }
  function subscribe(listener){
    if(typeof listener!=='function')throw new TypeError('Session listener must be a function');
    listeners.add(listener);
    return ()=>listeners.delete(listener);
  }
  return freeze({current,bootstrap,signIn,signOut,subscribe});
}

g.UVAccountSession=freeze({create});
})(typeof window!=='undefined'?window:globalThis);
