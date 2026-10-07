/* U.Venice Transport — generic schedule-only provider.
   Builds canonical TransitState scheduled_simulation from normalized runtime
   schedule/core/shapes. No provider-specific realtime dependency. */
(function(global){
  'use strict';

  const freeze=o=>Object.freeze(o);
  const text=v=>String(v??'').trim();

  function unique(rows,key){
    const out=new Map();
    for(const list of rows)for(const row of list||[]){
      const id=text(row?.[key]);if(id&&!out.has(id))out.set(id,row);
    }
    return [...out.values()];
  }

  function mergeCore(network,parts){
    const routeShapes={};
    for(const core of parts)for(const [rid,ids] of Object.entries(core?.routeShapes||{})){
      const set=new Set(routeShapes[rid]||[]);
      for(const id of ids||[])set.add(id);
      routeShapes[rid]=[...set];
    }
    return {
      schema:1,network,
      agencies:unique(parts.map(x=>x.agencies),'id'),
      routes:unique(parts.map(x=>x.routes),'id'),
      trips:unique(parts.map(x=>x.trips),'id'),
      stops:unique(parts.map(x=>x.stops),'id'),
      routeShapes
    };
  }

  function snapshotId(snapshot){
    return snapshot?.id||snapshot?.sourceZipSha256||snapshot?.schedule?.file||'current';
  }

  function createScheduledProvider({providerId,network,runtimeDelegate,predictionProfile}={}){
    providerId=text(providerId);network=text(network);
    if(!providerId||!network||!runtimeDelegate)
      throw new Error('ScheduledProvider: providerId/network/runtimeDelegate richiesti');

    let serviceCache=null,expectedCache=null,delayCache=null,motionCache=null,stateCache=null;

    async function loadRuntimeManifest(){return runtimeDelegate.loadRuntimeManifest()}
    async function loadRuntimeCore(_network,manifest,snapshot){
      return runtimeDelegate.loadRuntimeCore(network,manifest,snapshot);
    }
    async function loadRuntimeShapes(_network,manifest,snapshot){
      return runtimeDelegate.loadRuntimeShapes(network,manifest,snapshot);
    }
    async function loadRuntimeSchedule(_network,manifest){
      return runtimeDelegate.loadRuntimeSchedule(network,manifest);
    }

    async function loadServicePlan(_network,manifest){
      manifest=manifest||await loadRuntimeManifest();
      const schedule=await loadRuntimeSchedule(network,manifest);
      const snapshots=schedule.snapshots?.length?schedule.snapshots:[schedule.entry||manifest?.networks?.[network]].filter(Boolean);
      const key=snapshots.map(x=>[x.core?.file||'',x.schedule?.file||''].join('|')).join('::');
      if(serviceCache?.key===key)return serviceCache.value;

      const coreRows=await Promise.all(snapshots.map(async snapshot=>({
        id:snapshotId(snapshot),
        data:(await loadRuntimeCore(network,manifest,snapshot)).data
      })));
      const core=mergeCore(network,coreRows.map(x=>x.data));
      const coreBySnapshot=Object.fromEntries(coreRows.map(x=>[x.id,x.data]));
      if(!global.UVTransitServicePlan)throw new Error('ScheduledProvider: ServicePlan core non disponibile');
      const plan=global.UVTransitServicePlan.createServicePlan({
        provider:providerId,network,core,schedule:schedule.data,coreBySnapshot
      });
      const value={provider:providerId,network,manifest,schedule:schedule.data,snapshots,plan};
      serviceCache={key,value};return value;
    }

    async function loadExpectedPositionModel(_network,manifest){
      const service=await loadServicePlan(network,manifest);
      const key=service.snapshots.map(x=>[x.shapes?.file||'',x.core?.file||''].join('|')).join('::');
      if(expectedCache?.key===key&&expectedCache.plan===service.plan)return {...service,expectedPosition:expectedCache.model};
      if(!global.UVTransitExpectedPosition)throw new Error('ScheduledProvider: ExpectedPosition core non disponibile');
      const shapeRows=await Promise.all(service.snapshots.map(async snapshot=>({
        id:snapshotId(snapshot),
        data:(await loadRuntimeShapes(network,service.manifest,snapshot)).data
      })));
      const shapesBySnapshot=Object.fromEntries(shapeRows.map(x=>[x.id,x.data]));
      const model=global.UVTransitExpectedPosition.createExpectedPositionModel({
        servicePlan:service.plan,shapesBySnapshot
      });
      expectedCache={key,plan:service.plan,model};
      return {...service,expectedPosition:model};
    }

    async function loadTransitState(_network,manifest,_wantedDays,now){
      const expected=await loadExpectedPositionModel(network,manifest);
      if(!global.UVTransitDelayPosition||!global.UVTransitMotionState||!global.UVTransitState)
        throw new Error('ScheduledProvider: TransitState dependencies non disponibili');

      if(delayCache?.plan!==expected.plan){
        delayCache={
          plan:expected.plan,
          model:global.UVTransitDelayPosition.createDelayPositionModel({
            servicePlan:expected.plan,expectedPosition:expected.expectedPosition
          })
        };
        motionCache=null;stateCache=null;
      }
      if(!motionCache){
        motionCache=global.UVTransitMotionState.createMotionStateModel({
          servicePlan:expected.plan,
          expectedPosition:expected.expectedPosition,
          delayPosition:delayCache.model,
          predictionOptions:predictionProfile||null
        });
      }
      if(!stateCache){
        stateCache=global.UVTransitState.createTransitStateEngine({
          servicePlan:expected.plan,
          expectedPosition:expected.expectedPosition,
          identityResolver:null,
          delayPosition:delayCache.model,
          motionState:motionCache
        });
      }
      const snapshot=stateCache.snapshot({
        observations:[],resolutions:[],now,persistVehicleRegistry:false
      });
      return freeze({
        provider:providerId,network,
        receivedAt:snapshot.generatedAt,
        observations:freeze([]),resolutions:freeze([]),
        snapshot,
        scheduleOnly:true
      });
    }

    return freeze({
      id:providerId,
      loadRuntimeManifest,loadRuntimeCore,loadRuntimeShapes,loadRuntimeSchedule,
      loadServicePlan,loadExpectedPositionModel,loadTransitState
    });
  }

  global.UVTransitScheduledProvider=freeze({createScheduledProvider,_test:freeze({mergeCore,snapshotId})});
})(window);
