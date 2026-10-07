/* M10.3C — explicit account sync orchestrator. Never starts on its own. */
(function(g){'use strict';

const RESOURCE_TYPES=Object.freeze(['saved_route','saved_stop','saved_place','saved_journey']);
const LIST_KEY=Object.freeze({
  saved_route:'savedRoutes',
  saved_stop:'savedStops',
  saved_place:'savedPlaces',
  saved_journey:'savedJourneys'
});

function clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v))}
function freeze(v){return Object.freeze(v)}
function syncError(code,detail){
  const e=new Error(code);e.code=code;if(detail!==undefined)e.detail=detail;return e;
}
function uuidV4(api){
  if(api?.randomUUID)return api.randomUUID();
  if(!api?.getRandomValues)throw syncError('SYNC_UUID_UNAVAILABLE');
  const b=new Uint8Array(16);api.getRandomValues(b);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
  const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function content(type,row){
  if(type==='saved_route')return {provider_id:String(row.provider_id||''),route_id:String(row.route_id||'')};
  if(type==='saved_stop')return {provider_id:String(row.provider_id||''),stop_id:String(row.stop_id||'')};
  if(type==='saved_place')return {
    label:String(row.label||''),lat:Number(row.lat),lon:Number(row.lon),
    entity_id:row.entity_id==null?null:String(row.entity_id),role:String(row.role||'both')
  };
  if(type==='saved_journey')return {
    label:String(row.label||''),network:String(row.network||'all'),
    origin_label:String(row.origin_label||''),origin_lat:Number(row.origin_lat),origin_lon:Number(row.origin_lon),
    origin_kind:String(row.origin_kind||'place'),origin_ids:Array.isArray(row.origin_ids)?row.origin_ids.map(String):[],
    destination_label:String(row.destination_label||''),destination_lat:Number(row.destination_lat),destination_lon:Number(row.destination_lon),
    destination_kind:String(row.destination_kind||'place'),destination_ids:Array.isArray(row.destination_ids)?row.destination_ids.map(String):[]
  };
  if(type==='preferences')return {language:String(row?.language||'')};
  throw new TypeError('Unknown sync resource type');
}
function revision(row){const n=Number(row?.revision);return Number.isInteger(n)&&n>0?n:null}
function updatedAt(row){return row?.updated_at||row?.out_updated_at||null}

function create(options={}){
  const remote=options.remoteStore;
  const profileSync=options.profileSync;
  const serializer=options.serializer;
  const idMap=options.idMap;
  const state=options.state;
  const cacheManifest=options.cacheManifest||null;
  const getLanguage=typeof options.getLanguage==='function'?options.getLanguage:()=>null;
  const setLanguage=typeof options.setLanguage==='function'?options.setLanguage:async()=>{};
  const makeOperationId=typeof options.uuid==='function'?options.uuid:()=>uuidV4(options.crypto||g.crypto);
  const noticeVersion=String(options.noticeVersion||'').trim();

  if(!remote||!profileSync||!serializer||!idMap||!state)throw new TypeError('Sync controller dependencies missing');

  let running=false;

  function localLanguage(){
    const lang=String(getLanguage()||'').toLowerCase();
    return ['it','en','fr','de'].includes(lang)?lang:null;
  }
  function hash(type,row){return state.fingerprint(content(type,row))}
  function conflict(list,type,id,reason,local=null,remoteRow=null){
    list.push(freeze({type,id:String(id||''),reason,local:clone(local),remote:clone(remoteRow),remoteRevision:revision(remoteRow)}));
  }
  function mapRows(rows){return new Map((Array.isArray(rows)?rows:[]).map(r=>[String(r.id),clone(r)]))}
  function tombstones(remoteData,type){
    return new Map((remoteData.tombstones||[]).filter(t=>t?.resource_type===type).map(t=>[String(t.resource_id),clone(t)]));
  }
  function publishSaved(type){
    try{
      const name=type==='saved_place'?'uv:saved-places':type==='saved_journey'?'uv:saved-journeys':'uv:favorites';
      g.dispatchEvent?.(new CustomEvent(name));
    }catch(_){}
  }
  async function ensureEnabled(){
    const before=await remote.pull();
    if(before.syncEnabled)return before;
    if(!noticeVersion)throw syncError('SYNC_NOTICE_REQUIRED');
    await remote.configure(true,noticeVersion,{operationId:makeOperationId(),expectedRevision:Number(before.settings?.revision)||0});
    return remote.pull();
  }
  function wireOne(type,value){
    const profile={savedRoutes:[],savedStops:[],savedPlaces:[],savedJourneys:[]};
    let local=clone(value);
    if(type==='saved_route')profile.savedRoutes=[String(value||'')];
    else if(type==='saved_stop')profile.savedStops=[String(value||'')];
    else if(type==='saved_place'){
      local=local&&typeof local==='object'?local:{};
      if(!local.id)local.id=makeOperationId();
      profile.savedPlaces=[local];
    }else if(type==='saved_journey'){
      local=local&&typeof local==='object'?local:{};
      if(!local.id)local.id=makeOperationId();
      profile.savedJourneys=[local];
    }else throw syncError('SYNC_INPUT_INVALID');
    const wire=serializer.serialize({schemaVersion:1,profile},{language:null});
    const payload=wire[LIST_KEY[type]]?.[0];
    if(!payload)throw syncError('SYNC_INPUT_INVALID');
    return {local,payload};
  }
  function existingRemote(remoteData,type,payload){
    const rows=Array.isArray(remoteData[LIST_KEY[type]])?remoteData[LIST_KEY[type]]:[];
    if(type==='saved_route')return rows.find(r=>r.provider_id===payload.provider_id&&r.route_id===payload.route_id)||null;
    if(type==='saved_stop')return rows.find(r=>r.provider_id===payload.provider_id&&r.stop_id===payload.stop_id)||null;
    return rows.find(r=>String(r.id)===String(payload.id))||
      rows.find(r=>state.canonical(content(type,r))===state.canonical(content(type,payload)))||null;
  }
  function owned(type,value){
    let localId='';
    if(type==='saved_route')localId='actv|'+String(value||'');
    else if(type==='saved_stop')localId='actv|'+String(value||'');
    else localId=String(value?.id||value||'');
    if(!localId)return false;
    const mapped=idMap.remoteFor(type,localId);
    const remoteId=mapped||(/^[0-9a-f-]{36}$/i.test(localId)?localId:null);
    const record=remoteId?state.get(type,remoteId):null;
    return !!record&&record.deleted!==true;
  }

  async function rebindExactInitial(type,locals,remotes,conflicts,blocked){
    if(type!=='saved_place'&&type!=='saved_journey')return;
    const localBySig=new Map(),remoteBySig=new Map();
    for(const row of locals.values()){
      const sig=state.canonical(content(type,row));
      if(!localBySig.has(sig))localBySig.set(sig,[]);
      localBySig.get(sig).push(row);
    }
    for(const row of remotes.values()){
      const sig=state.canonical(content(type,row));
      if(!remoteBySig.has(sig))remoteBySig.set(sig,[]);
      remoteBySig.get(sig).push(row);
    }
    for(const [sig,lset] of localBySig){
      const rset=remoteBySig.get(sig)||[];
      if(!rset.length)continue;
      if(lset.length!==1||rset.length!==1){
        for(const row of lset)blocked.add(String(row.id));
        for(const row of rset)blocked.add(String(row.id));
        conflict(conflicts,type,lset[0]?.id||rset[0]?.id,'ambiguous-initial-match',lset,rset);
        continue;
      }
      const l=lset[0],r=rset[0],lid=String(l.id),rid=String(r.id);
      if(lid===rid||state.get(type,lid)||state.get(type,rid))continue;
      const localKey=idMap.localFor(type,lid);
      if(localKey){
        try{idMap.rebind(type,localKey,lid,rid)}
        catch(e){blocked.add(lid);blocked.add(rid);conflict(conflicts,type,lid,e.code||e.message||'id-rebind-failed',l,r);continue}
      }
      locals.delete(lid);l.id=rid;locals.set(rid,l);
    }
  }

  async function reconcileResources(remoteData,canPushLocal,conflicts,stats){
    // Deserialize once before local serialization so natural-key route/stop UUIDs are adopted.
    serializer.deserialize(remoteData);
    const localSnapshot=profileSync.collect();
    const localWire=serializer.serialize(localSnapshot,{language:localLanguage()});
    const result={};

    for(const type of RESOURCE_TYPES){
      const key=LIST_KEY[type];
      const locals=mapRows(localWire[key]);
      const remotes=mapRows(remoteData[key]);
      const tombs=tombstones(remoteData,type);
      const blocked=new Set();
      await rebindExactInitial(type,locals,remotes,conflicts,blocked);
      const desired=new Map(locals);

      const ids=new Set([...locals.keys(),...remotes.keys(),...tombs.keys()]);
      for(const id of ids){
        if(blocked.has(id))continue;
        const l=locals.get(id)||null,r=remotes.get(id)||null,t=tombs.get(id)||null,base=state.get(type,id);

        if(t){
          if(r){conflict(conflicts,type,id,'remote-active-and-deleted',l,r);continue}
          if(l){
            const lh=hash(type,l);
            if(base&&!base.deleted&&base.hash===lh){
              desired.delete(id);
              state.set(type,id,{revision:Number(t.revision),deleted:true,updatedAt:t.deleted_at||null});
              stats.pulledDeletes++;
            }else{
              conflict(conflicts,type,id,base?.deleted?'local-recreated-after-delete':'delete-vs-local-change',l,t);
            }
          }else{
            state.set(type,id,{revision:Number(t.revision),deleted:true,updatedAt:t.deleted_at||null});
          }
          continue;
        }

        if(r&&l){
          const lh=hash(type,l),rh=hash(type,r),rr=revision(r);
          if(!rr){conflict(conflicts,type,id,'remote-revision-invalid',l,r);continue}
          if(!base){
            if(lh===rh){
              desired.set(id,r);
              state.set(type,id,{revision:rr,hash:rh,updatedAt:r.updated_at||null});
              stats.accepted++;
            }else{
              conflict(conflicts,type,id,'initial-divergence',l,r);
            }
            continue;
          }
          if(base.deleted){conflict(conflicts,type,id,'remote-resurrected',l,r);continue}
          const localChanged=lh!==base.hash;
          const remoteChanged=rh!==base.hash;
          if(!localChanged&&remoteChanged){
            desired.set(id,r);
            state.set(type,id,{revision:rr,hash:rh,updatedAt:r.updated_at||null});
            stats.pulledUpdates++;
          }else if(localChanged&&!remoteChanged){
            if(!canPushLocal){conflict(conflicts,type,id,'guest-import-required',l,r);continue}
            try{
              const out=await remote.write(type,l,{operationId:makeOperationId(),expectedRevision:rr});
              const nextRev=Number(out?.out_revision);if(!Number.isInteger(nextRev)||nextRev<1)throw syncError('SYNC_REVISION_INVALID');
              l.revision=nextRev;l.updated_at=updatedAt(out);desired.set(id,l);
              state.set(type,id,{revision:nextRev,hash:lh,updatedAt:l.updated_at});stats.pushedUpdates++;
            }catch(e){
              if(e?.code==='SYNC_REVISION_CONFLICT')conflict(conflicts,type,id,'write-conflict',l,r);else throw e;
            }
          }else if(localChanged&&remoteChanged){
            if(lh===rh){
              desired.set(id,r);state.set(type,id,{revision:rr,hash:rh,updatedAt:r.updated_at||null});stats.accepted++;
            }else conflict(conflicts,type,id,'concurrent-update',l,r);
          }else{
            desired.set(id,r);state.set(type,id,{revision:rr,hash:rh,updatedAt:r.updated_at||null});stats.accepted++;
          }
          continue;
        }

        if(r&&!l){
          const rh=hash(type,r),rr=revision(r);
          if(!rr){conflict(conflicts,type,id,'remote-revision-invalid',null,r);continue}
          if(!base){
            desired.set(id,r);state.set(type,id,{revision:rr,hash:rh,updatedAt:r.updated_at||null});stats.pulledCreates++;
          }else if(base.deleted){
            conflict(conflicts,type,id,'remote-resurrected',null,r);
          }else if(base.hash===rh){
            if(!canPushLocal){
              desired.set(id,r);
              state.set(type,id,{revision:rr,hash:rh,updatedAt:r.updated_at||null});
              stats.pulledCreates++;
              continue;
            }
            try{
              const out=await remote.remove(type,id,{operationId:makeOperationId(),expectedRevision:rr});
              desired.delete(id);
              state.set(type,id,{revision:Number(out?.out_revision),deleted:true,updatedAt:out?.out_deleted_at||null});stats.pushedDeletes++;
            }catch(e){
              if(e?.code==='SYNC_REVISION_CONFLICT')conflict(conflicts,type,id,'delete-conflict',null,r);else throw e;
            }
          }else{
            conflict(conflicts,type,id,'delete-vs-remote-change',null,r);
          }
          continue;
        }

        if(l&&!r){
          const lh=hash(type,l);
          if(!base){
            if(!canPushLocal){stats.pendingLocal++;continue}
            try{
              const out=await remote.write(type,l,{operationId:makeOperationId(),expectedRevision:0});
              const nextRev=Number(out?.out_revision);if(!Number.isInteger(nextRev)||nextRev<1)throw syncError('SYNC_REVISION_INVALID');
              l.revision=nextRev;l.updated_at=updatedAt(out);desired.set(id,l);
              state.set(type,id,{revision:nextRev,hash:lh,updatedAt:l.updated_at});stats.pushedCreates++;
            }catch(e){
              if(e?.code==='SYNC_REVISION_CONFLICT'||e?.code==='SYNC_RESOURCE_DELETED')conflict(conflicts,type,id,'create-conflict',l,null);else throw e;
            }
          }else if(base.deleted){
            conflict(conflicts,type,id,'local-recreated-after-delete',l,null);
          }else{
            conflict(conflicts,type,id,'remote-missing',l,null);
          }
        }
      }
      result[key]=[...desired.values()];
    }
    return {result,localSnapshot};
  }

  async function reconcilePreference(remoteData,canPushLocal,conflicts,stats){
    const lang=localLanguage();
    const local=lang?{language:lang}:null;
    const remotePref=remoteData.preferences||null;
    const base=state.get('preferences','singleton');
    let desired=local?.language||null;

    if(remotePref&&local){
      const lh=hash('preferences',local),rh=hash('preferences',remotePref),rr=revision(remotePref);
      if(!rr){conflict(conflicts,'preferences','singleton','remote-revision-invalid',local,remotePref);return desired}
      if(!base){
        if(lh===rh){state.set('preferences','singleton',{revision:rr,hash:rh,updatedAt:remotePref.updated_at||null});return desired}
        conflict(conflicts,'preferences','singleton','initial-divergence',local,remotePref);return desired;
      }
      if(base.deleted){conflict(conflicts,'preferences','singleton','remote-resurrected',local,remotePref);return desired}
      const lc=lh!==base.hash,rc=rh!==base.hash;
      if(!lc&&rc){
        desired=remotePref.language;state.set('preferences','singleton',{revision:rr,hash:rh,updatedAt:remotePref.updated_at||null});stats.pulledUpdates++;
      }else if(lc&&!rc){
        if(!canPushLocal){conflict(conflicts,'preferences','singleton','guest-import-required',local,remotePref);return desired}
        try{
          const out=await remote.write('preferences',local,{operationId:makeOperationId(),expectedRevision:rr});
          state.set('preferences','singleton',{revision:Number(out?.out_revision),hash:lh,updatedAt:updatedAt(out)});stats.pushedUpdates++;
        }catch(e){if(e?.code==='SYNC_REVISION_CONFLICT')conflict(conflicts,'preferences','singleton','write-conflict',local,remotePref);else throw e}
      }else if(lc&&rc){
        if(lh===rh)state.set('preferences','singleton',{revision:rr,hash:rh,updatedAt:remotePref.updated_at||null});
        else conflict(conflicts,'preferences','singleton','concurrent-update',local,remotePref);
      }else state.set('preferences','singleton',{revision:rr,hash:rh,updatedAt:remotePref.updated_at||null});
      return desired;
    }

    if(remotePref&&!local){
      const rr=revision(remotePref),rh=hash('preferences',remotePref);
      if(rr){desired=remotePref.language;state.set('preferences','singleton',{revision:rr,hash:rh,updatedAt:remotePref.updated_at||null});stats.pulledCreates++}
      return desired;
    }

    if(local&&!remotePref){
      const lh=hash('preferences',local);
      if(!base){
        if(!canPushLocal){stats.pendingLocal++;return desired}
        const out=await remote.write('preferences',local,{operationId:makeOperationId(),expectedRevision:0});
        state.set('preferences','singleton',{revision:Number(out?.out_revision),hash:lh,updatedAt:updatedAt(out)});stats.pushedCreates++;
      }else if(!base.deleted){
        conflict(conflicts,'preferences','singleton','remote-missing',local,null);
      }
    }
    return desired;
  }

  async function applyLocal(result,localSnapshot,language){
    const decoded=serializer.deserialize(result);
    const current=localSnapshot.profile;
    profileSync.apply({
      schemaVersion:1,
      generatedAt:Date.now(),
      profile:{
        savedRoutes:decoded.profile.savedRoutes,
        savedStops:decoded.profile.savedStops,
        savedPlaces:decoded.profile.savedPlaces,
        savedJourneys:decoded.profile.savedJourneys,
        preferences:clone(current.preferences||{}),
        navigationPreferences:clone(current.navigationPreferences||{})
      }
    });
    if(language&&language!==localLanguage())await setLanguage(language);
  }

  async function syncInternal(){
    const remoteData=await remote.pull();
    if(!remoteData.syncEnabled)throw syncError('SYNC_DISABLED');
    const canPushLocal=state.importAccepted();
    const conflicts=[];
    const stats={pushedCreates:0,pushedUpdates:0,pushedDeletes:0,pulledCreates:0,pulledUpdates:0,pulledDeletes:0,accepted:0,pendingLocal:0};
    const {result,localSnapshot}=await reconcileResources(remoteData,canPushLocal,conflicts,stats);
    const language=await reconcilePreference(remoteData,canPushLocal,conflicts,stats);
    await applyLocal(result,localSnapshot,language);
    state.markPull();
    return freeze({ok:conflicts.length===0,conflicts:freeze(conflicts),stats:freeze(stats),needsImport:stats.pendingLocal>0&&!canPushLocal});
  }

  async function withLock(fn){
    if(running)throw syncError('SYNC_BUSY');
    running=true;try{return await fn()}finally{running=false}
  }

  async function status(){
    return withLock(async()=>{
      const remoteData=await remote.pull(),local=profileSync.collect().profile;
      const localCount=(local.savedRoutes?.length||0)+(local.savedStops?.length||0)+(local.savedPlaces?.length||0)+(local.savedJourneys?.length||0);
      const remoteCount=(remoteData.savedRoutes?.length||0)+(remoteData.savedStops?.length||0)+(remoteData.savedPlaces?.length||0)+(remoteData.savedJourneys?.length||0);
      return freeze({syncEnabled:remoteData.syncEnabled===true,localCount,remoteCount,importAccepted:state.importAccepted(),needsImport:localCount>0&&!state.importAccepted(),settingsRevision:Number(remoteData.settings?.revision)||0});
    });
  }

  async function activateAndImport(){
    return withLock(async()=>{
      if(!noticeVersion)throw syncError('SYNC_NOTICE_REQUIRED');
      const before=await remote.pull();
      if(!before.syncEnabled){
        await remote.configure(true,noticeVersion,{operationId:makeOperationId(),expectedRevision:Number(before.settings?.revision)||0});
      }
      state.acceptImport(true);
      return syncInternal();
    });
  }

  function localIdentity(type,id,localRow){
    if(type==='saved_route')return String(localRow?.route_id||idMap.localFor(type,id)?.split('|').slice(1).join('|')||'');
    if(type==='saved_stop')return String(localRow?.stop_id||idMap.localFor(type,id)?.split('|').slice(1).join('|')||'');
    return String(idMap.localFor(type,id)||id||'');
  }

  function removeLocal(type,id,localRow){
    const snapshot=profileSync.collect(),p=clone(snapshot.profile),key=LIST_KEY[type];
    const identity=localIdentity(type,id,localRow);
    if(type==='saved_route')p.savedRoutes=(p.savedRoutes||[]).filter(x=>String(x)!==identity);
    else if(type==='saved_stop')p.savedStops=(p.savedStops||[]).filter(x=>String(x)!==identity);
    else p[key]=(p[key]||[]).filter(x=>String(x?.id)!==identity&&String(x?.id)!==String(id));
    profileSync.apply({schemaVersion:1,generatedAt:Date.now(),profile:p});
  }

  function applyRemoteLocal(type,id,localRow,remoteRow){
    const snapshot=profileSync.collect(),p=clone(snapshot.profile),key=LIST_KEY[type];
    const decoded=serializer.deserialize({[key]:[remoteRow]});
    const incoming=decoded.profile[key]||[];
    const identity=localIdentity(type,id,localRow);
    if(type==='saved_route'){
      p.savedRoutes=[...new Set([...(p.savedRoutes||[]).filter(x=>String(x)!==identity),...incoming])];
    }else if(type==='saved_stop'){
      p.savedStops=[...new Set([...(p.savedStops||[]).filter(x=>String(x)!==identity),...incoming])];
    }else{
      p[key]=[...(p[key]||[]).filter(x=>String(x?.id)!==identity&&String(x?.id)!==String(id)),...incoming];
    }
    profileSync.apply({schemaVersion:1,generatedAt:Date.now(),profile:p});
  }

  async function resolveInternal(item,decision){
    if(!item||!['account','device'].includes(decision))throw syncError('SYNC_RESOLUTION_INVALID');
    const type=String(item.type||''),id=String(item.id||'');
    const local=clone(item.local),remoteRow=clone(item.remote);
    if(type==='preferences'){
      if(decision==='account'){
        if(remoteRow?.language){
          await setLanguage(remoteRow.language);
          const rr=revision(remoteRow);if(rr)state.set('preferences','singleton',{revision:rr,hash:hash('preferences',remoteRow),updatedAt:remoteRow.updated_at||null});
        }else{
          const base=state.get('preferences','singleton');
          state.set('preferences','singleton',{revision:Math.max(1,Number(base?.revision)||1),deleted:true,updatedAt:null});
        }
        return freeze({resolved:true,decision,type,id:'singleton'});
      }
      if(!local?.language)throw syncError('SYNC_RESOLUTION_INVALID');
      const expected=revision(remoteRow)||0;
      const out=await remote.write('preferences',local,{operationId:makeOperationId(),expectedRevision:expected});
      state.set('preferences','singleton',{revision:Number(out?.out_revision),hash:hash('preferences',local),updatedAt:updatedAt(out)});
      return freeze({resolved:true,decision,type,id:'singleton'});
    }

    if(!RESOURCE_TYPES.includes(type)||!id)throw syncError('SYNC_RESOLUTION_INVALID');
    const isTombstone=remoteRow?.resource_type===type&&String(remoteRow?.resource_id||'')===id;
    const remoteActive=remoteRow&&!isTombstone&&revision(remoteRow);

    if(decision==='account'){
      if(remoteActive){
        applyRemoteLocal(type,id,local,remoteRow);
        state.set(type,id,{revision:Number(remoteRow.revision),hash:hash(type,remoteRow),updatedAt:remoteRow.updated_at||null});
      }else{
        removeLocal(type,id,local);
        if(isTombstone)state.set(type,id,{revision:Number(remoteRow.revision),deleted:true,updatedAt:remoteRow.deleted_at||null});
        else state.remove(type,id);
      }
      return freeze({resolved:true,decision,type,id});
    }

    if(local){
      let payload=clone(local),targetId=id,expected=remoteActive?Number(remoteRow.revision):0;
      if(isTombstone){
        const nextId=makeOperationId(),localKey=localIdentity(type,id,local);
        if(localKey&&idMap.localFor(type,id))idMap.rebind(type,localKey,id,nextId);
        else if(localKey)idMap.adopt(type,localKey,nextId);
        state.set(type,id,{revision:Number(remoteRow.revision),deleted:true,updatedAt:remoteRow.deleted_at||null});
        payload.id=nextId;targetId=nextId;expected=0;
      }
      const out=await remote.write(type,payload,{operationId:makeOperationId(),expectedRevision:expected});
      state.set(type,targetId,{revision:Number(out?.out_revision),hash:hash(type,payload),updatedAt:updatedAt(out)});
      return freeze({resolved:true,decision,type,id:targetId,replacedId:targetId===id?null:id});
    }

    if(remoteActive){
      const out=await remote.remove(type,id,{operationId:makeOperationId(),expectedRevision:Number(remoteRow.revision)});
      state.set(type,id,{revision:Number(out?.out_revision),deleted:true,updatedAt:out?.out_deleted_at||null});
    }else if(isTombstone){
      state.set(type,id,{revision:Number(remoteRow.revision),deleted:true,updatedAt:remoteRow.deleted_at||null});
    }else state.remove(type,id);
    return freeze({resolved:true,decision,type,id});
  }

  async function connectAccount(){
    return withLock(async()=>{
      await ensureEnabled();
      // Product rule M10.3E: normal login never implies legacy-device import.
      state.acceptImport(false);
      const result=await syncInternal();
      if(cacheManifest){
        const latest=await remote.pull();
        const decoded=serializer.deserialize(latest);
        cacheManifest.replace(decoded.profile);
      }
      for(const type of RESOURCE_TYPES)publishSaved(type);
      return result;
    });
  }

  async function saveOwnedInternal(type,value){
    const remoteData=await ensureEnabled();
    // Adopt natural-key UUIDs before serializing new route/stop writes.
    serializer.deserialize(remoteData);
    let {local,payload}=wireOne(type,value);
    const existing=existingRemote(remoteData,type,payload);
    let serverRow;
    if(existing&&state.canonical(content(type,existing))===state.canonical(content(type,payload))){
      serverRow=existing;
    }else{
      if(existing&&String(existing.id)!==String(payload.id)){
        if(type==='saved_route')idMap.adopt(type,'actv|'+payload.route_id,String(existing.id));
        else if(type==='saved_stop')idMap.adopt(type,'actv|'+payload.stop_id,String(existing.id));
        payload={...payload,id:String(existing.id)};
      }
      const expected=existing?Number(existing.revision)||0:0;
      const out=await remote.write(type,payload,{operationId:makeOperationId(),expectedRevision:expected});
      const nextRevision=Number(out?.out_revision);
      if(!Number.isInteger(nextRevision)||nextRevision<1)throw syncError('SYNC_REVISION_INVALID');
      serverRow={...payload,revision:nextRevision,updated_at:updatedAt(out)};
    }
    const rid=String(serverRow.id);
    const rr=revision(serverRow);
    if(!rr)throw syncError('SYNC_REVISION_INVALID');
    state.set(type,rid,{revision:rr,hash:hash(type,serverRow),updatedAt:serverRow.updated_at||null});
    applyRemoteLocal(type,rid,local,serverRow);
    const decoded=serializer.deserialize({[LIST_KEY[type]]:[serverRow]});
    const cached=decoded.profile[LIST_KEY[type]]?.[0]??(type==='saved_route'?serverRow.route_id:type==='saved_stop'?serverRow.stop_id:null);
    cacheManifest?.add?.(type,cached);
    publishSaved(type);
    return freeze({saved:true,type,remoteId:rid,local:clone(cached),revision:rr});
  }

  async function removeOwnedInternal(type,value){
    const remoteData=await ensureEnabled();
    let localRow=typeof value==='object'&&value!==null?clone(value):null;
    let localKey='';
    if(type==='saved_route')localKey=String(value||'');
    else if(type==='saved_stop')localKey=String(value||'');
    else localKey=String(localRow?.id||value||'');
    if(!localKey)throw syncError('SYNC_INPUT_INVALID');

    let remoteId=null,row=null;
    if(type==='saved_route')row=(remoteData.savedRoutes||[]).find(r=>r.provider_id==='actv'&&r.route_id===localKey)||null;
    else if(type==='saved_stop')row=(remoteData.savedStops||[]).find(r=>r.provider_id==='actv'&&r.stop_id===localKey)||null;
    else{
      remoteId=idMap.remoteFor(type,localKey)||(/^[0-9a-f-]{36}$/i.test(localKey)?localKey:null);
      row=remoteId?(remoteData[LIST_KEY[type]]||[]).find(r=>String(r.id)===String(remoteId))||null:null;
    }
    if(row){
      remoteId=String(row.id);
      const rr=revision(row);if(!rr)throw syncError('SYNC_REVISION_INVALID');
      const out=await remote.remove(type,remoteId,{operationId:makeOperationId(),expectedRevision:rr});
      state.set(type,remoteId,{revision:Number(out?.out_revision),deleted:true,updatedAt:out?.out_deleted_at||null});
      removeLocal(type,remoteId,localRow||(type==='saved_route'?{route_id:localKey}:type==='saved_stop'?{stop_id:localKey}:null));
    }else{
      removeLocal(type,remoteId||localKey,localRow||(type==='saved_route'?{route_id:localKey}:type==='saved_stop'?{stop_id:localKey}:null));
    }
    cacheManifest?.remove?.(type,localRow||localKey);
    publishSaved(type);
    return freeze({removed:true,type,remoteId});
  }

  async function clearAccountCache(){
    return withLock(async()=>{
      const removed=cacheManifest?.purge?.()||null;
      for(const type of RESOURCE_TYPES)publishSaved(type);
      return removed;
    });
  }

  async function saveOwned(type,value){return withLock(()=>saveOwnedInternal(type,value))}
  async function removeOwned(type,value){return withLock(()=>removeOwnedInternal(type,value))}
  async function sync(){return withLock(syncInternal)}
  async function resolve(item,decision){return withLock(()=>resolveInternal(item,decision))}

  async function deactivate(){
    return withLock(async()=>{
      const before=await remote.pull();
      if(!before.settings)return freeze({syncEnabled:false,revision:0});
      const out=await remote.configure(false,null,{operationId:makeOperationId(),expectedRevision:Number(before.settings.revision)||0});
      return freeze({syncEnabled:false,revision:Number(out?.out_revision)||0});
    });
  }

  return freeze({status,connectAccount,activateAndImport,sync,resolve,owned,saveOwned,removeOwned,clearAccountCache,deactivate});
}

g.UVAccountSyncController=freeze({create,content});
})(typeof window!=='undefined'?window:globalThis);
