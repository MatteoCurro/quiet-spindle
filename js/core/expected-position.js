/* U.Venice Transport — provider-neutral Expected Position Model.
   Consumes ServicePlan + static shapes. No realtime, network, map or UI dependencies. */
(function(global){
  'use strict';

  const G=global.UVTransitGTFS;
  if(!G)throw new Error('UVTransitGTFS required before UVTransitExpectedPosition');

  const text=v=>String(v??'').trim();
  const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const DEFAULTS=Object.freeze({projectionTieDistanceM:7});

  function rawShapes(source){
    if(!source)return {};
    return source.shapes&&typeof source.shapes==='object'?source.shapes:source;
  }

  function prepareRawShape(source){
    if(!Array.isArray(source)||source.length<2)return null;
    const points=source.map((p,i)=>{
      if(Array.isArray(p))return {lat:num(p[0]),lon:num(p[1]),seq:i};
      return {lat:num(p?.lat),lon:num(p?.lon??p?.lng),seq:num(p?.seq)??i};
    }).filter(p=>p.lat!==null&&p.lon!==null);
    return points.length>1?G.prepareShape(points):null;
  }

  function segmentProjection(shape,pos,i,minProgress){
    const a=shape.pts[i],b=shape.pts[i+1];
    const lat0=pos.lat*Math.PI/180,mx=111320*Math.cos(lat0),my=110540;
    const ax=(a.lon-pos.lon)*mx,ay=(a.lat-pos.lat)*my;
    const bx=(b.lon-pos.lon)*mx,by=(b.lat-pos.lat)*my;
    const vx=bx-ax,vy=by-ay,den=vx*vx+vy*vy||1;
    let t=-(ax*vx+ay*vy)/den;
    const segStart=shape.cum[i],segEnd=shape.cum[i+1],segLen=Math.max(.001,segEnd-segStart);
    if(minProgress>segEnd+.001)return null;
    const minT=minProgress<=segStart?0:clamp((minProgress-segStart)/segLen,0,1);
    t=clamp(t,minT,1);
    const x=ax+vx*t,y=ay+vy*t;
    return {
      distance:Math.hypot(x,y),
      progress:segStart+(segEnd-segStart)*t,
      point:{lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t},
      segmentIndex:i
    };
  }

  function projectForward(shape,pos,minProgress,targetProgress,options){
    if(!shape||shape.pts.length<2||!pos||!Number.isFinite(pos.lat)||!Number.isFinite(pos.lon))return null;
    minProgress=clamp(Number(minProgress)||0,0,shape.total);
    targetProgress=clamp(Number(targetProgress)||minProgress,minProgress,shape.total);
    const candidates=[];
    let bestDistance=Infinity;
    for(let i=0;i<shape.pts.length-1;i++){
      const c=segmentProjection(shape,pos,i,minProgress);
      if(!c)continue;
      if(c.distance<bestDistance)bestDistance=c.distance;
      candidates.push(c);
    }
    if(!candidates.length)return null;
    const tie=Math.max(0,Number(options?.projectionTieDistanceM??DEFAULTS.projectionTieDistanceM));
    const near=candidates.filter(c=>c.distance<=bestDistance+tie);
    near.sort((a,b)=>
      Math.abs(a.progress-targetProgress)-Math.abs(b.progress-targetProgress)||
      a.distance-b.distance||
      a.progress-b.progress
    );
    return near[0];
  }

  function targetProgressForStop(instance,shape,index){
    if(index<=0)return 0;
    if(index>=instance.stops.length-1)return shape.total;
    const first=instance.plannedStart,last=instance.plannedEnd,stop=instance.stops[index];
    if(!(last>first))return shape.total*(index/(instance.stops.length-1));
    const t=(stop.plannedArrival+stop.plannedDeparture)/2;
    return shape.total*clamp((t-first)/(last-first),0,1);
  }

  function stopView(stop,index){
    if(!stop)return null;
    return Object.freeze({
      index,id:stop.id,sequence:stop.sequence,name:stop.stop?.name||stop.id,
      code:stop.stop?.code||'',lat:stop.stop?.lat??null,lon:stop.stop?.lon??null,
      plannedArrival:stop.plannedArrival,plannedDeparture:stop.plannedDeparture
    });
  }

  function geometryQuality(maxDistance){
    if(maxDistance===null||!Number.isFinite(maxDistance))return {label:'unavailable',confidence:0};
    if(maxDistance<=25)return {label:'high',confidence:.98};
    if(maxDistance<=75)return {label:'good',confidence:.9};
    if(maxDistance<=150)return {label:'fair',confidence:.75};
    return {label:'low',confidence:.5};
  }

  class ExpectedPositionModel{
    constructor({servicePlan,shapes,shapesBySnapshot,options}){
      if(!servicePlan||typeof servicePlan.instances!=='function')throw new Error('ExpectedPosition: ServicePlan non valido');
      this.servicePlan=servicePlan;
      this.options={...DEFAULTS,...(options||{})};
      this.defaultShapes=rawShapes(shapes);
      this.shapesBySnapshot={};
      for(const [id,value] of Object.entries(shapesBySnapshot||{}))this.shapesBySnapshot[text(id)]=rawShapes(value);
      this.shapeCache=new Map();
      this.geometryCache=new Map();
    }

    _shapeSource(instance){
      const sid=text(instance.snapshotId);
      return (sid&&this.shapesBySnapshot[sid])||this.defaultShapes;
    }

    _preparedShape(instance){
      const snapshot=text(instance.snapshotId)||'default',shapeId=text(instance.shape);
      if(!shapeId)return null;
      const key=snapshot+'|'+shapeId;
      if(this.shapeCache.has(key))return this.shapeCache.get(key);
      const prepared=prepareRawShape(this._shapeSource(instance)?.[shapeId]);
      this.shapeCache.set(key,prepared);return prepared;
    }

    geometry(instanceOrId){
      const instance=typeof instanceOrId==='string'?this.servicePlan.get(instanceOrId):instanceOrId;
      if(!instance)return null;
      if(this.geometryCache.has(instance.id))return this.geometryCache.get(instance.id);
      const shape=this._preparedShape(instance);
      if(!shape){
        const missing=Object.freeze({
          tripInstanceId:instance.id,status:'unavailable',shapeId:text(instance.shape)||null,
          shape:null,shapeLengthM:null,shapeProgressByStop:Object.freeze(instance.stops.map(()=>null)),
          projectionDistanceByStop:Object.freeze(instance.stops.map(()=>null)),
          maxStopDistanceM:null,quality:'unavailable',confidence:0
        });
        this.geometryCache.set(instance.id,missing);return missing;
      }

      const progress=[],distances=[];
      let minProgress=0,resolved=0;
      for(let i=0;i<instance.stops.length;i++){
        const stop=instance.stops[i],lat=num(stop.stop?.lat),lon=num(stop.stop?.lon);
        if(lat===null||lon===null){progress.push(null);distances.push(null);continue}
        const target=targetProgressForStop(instance,shape,i);
        const pr=projectForward(shape,{lat,lon},minProgress,target,this.options);
        if(!pr){progress.push(null);distances.push(null);continue}
        const p=clamp(pr.progress,minProgress,shape.total);
        progress.push(p);distances.push(pr.distance);minProgress=p;resolved++;
      }
      const finiteDistances=distances.filter(Number.isFinite),maxDistance=finiteDistances.length?Math.max(...finiteDistances):null;
      const q=geometryQuality(maxDistance),status=resolved===instance.stops.length?'resolved':resolved>=2?'partial':'unavailable';
      const geometry=Object.freeze({
        tripInstanceId:instance.id,status,shapeId:text(instance.shape)||null,shape,
        shapeLengthM:shape.total,shapeProgressByStop:Object.freeze(progress),
        projectionDistanceByStop:Object.freeze(distances),maxStopDistanceM:maxDistance,
        quality:q.label,confidence:status==='unavailable'?0:q.confidence
      });
      this.geometryCache.set(instance.id,geometry);return geometry;
    }

    progressAtTimestamp(instanceOrId,timestampSec){
      const instance=typeof instanceOrId==='string'?this.servicePlan.get(instanceOrId):instanceOrId;
      if(!instance)return null;
      const geometry=this.geometry(instance);
      if(!geometry||geometry.status==='unavailable')return null;
      if(timestampSec===null||timestampSec===undefined)return null;
      const rawTs=Number(timestampSec);
      if(!Number.isFinite(rawTs))return null;
      const ts=clamp(rawTs,instance.plannedStart,instance.plannedEnd);
      const stops=instance.stops,p=geometry.shapeProgressByStop;

      if(ts<=stops[0].plannedDeparture)return p[0];
      for(let i=0;i<stops.length-1;i++){
        const a=stops[i],b=stops[i+1],pa=p[i],pb=p[i+1];
        if(pa===null||pb===null)continue;
        if(ts<=a.plannedDeparture)return pa;
        if(ts<b.plannedArrival){
          const span=Math.max(.001,b.plannedArrival-a.plannedDeparture);
          const ratio=clamp((ts-a.plannedDeparture)/span,0,1);
          return pa+(pb-pa)*ratio;
        }
        if(ts<=b.plannedDeparture)return pb;
      }
      return p.at(-1);
    }

    timeAtProgress(instanceOrId,shapeProgress,hintTimestamp){
      const instance=typeof instanceOrId==='string'?this.servicePlan.get(instanceOrId):instanceOrId;
      if(!instance)return null;
      const geometry=this.geometry(instance),p=geometry?.shapeProgressByStop;
      if(!geometry||geometry.status==='unavailable'||!p)return null;
      if(shapeProgress===null||shapeProgress===undefined)return null;
      const rawProgress=Number(shapeProgress);
      if(!Number.isFinite(rawProgress))return null;
      const progress=clamp(rawProgress,0,geometry.shapeLengthM);
      const hint=Number(hintTimestamp),hasHint=Number.isFinite(hint);
      const stops=instance.stops;

      for(let i=0;i<stops.length;i++){
        if(p[i]===null||Math.abs(progress-p[i])>.5)continue;
        if(hasHint&&hint>=stops[i].plannedArrival&&hint<=stops[i].plannedDeparture)return hint;
      }

      for(let i=0;i<stops.length-1;i++){
        const pa=p[i],pb=p[i+1];if(pa===null||pb===null)continue;
        if(progress<pa-.001||progress>pb+.001)continue;
        if(pb-pa<=.5)return hasHint
          ?clamp(hint,stops[i].plannedDeparture,stops[i+1].plannedArrival)
          :stops[i+1].plannedArrival;
        const ratio=clamp((progress-pa)/(pb-pa),0,1);
        return stops[i].plannedDeparture+(stops[i+1].plannedArrival-stops[i].plannedDeparture)*ratio;
      }
      const first=p.findIndex(Number.isFinite);
      if(first<0)return null;
      if(progress<=p[first])return stops[first].plannedDeparture;
      for(let i=p.length-1;i>=0;i--)if(Number.isFinite(p[i]))return stops[i].plannedArrival;
      return null;
    }

    _stopPair(instance,timestampSec){
      const stops=instance.stops,ts=clamp(Number(timestampSec),instance.plannedStart,instance.plannedEnd);
      for(let i=0;i<stops.length-1;i++){
        if(ts<stops[i+1].plannedArrival)return [i,i+1];
        if(ts<=stops[i+1].plannedDeparture)return [i+1,i+2<stops.length?i+2:null];
      }
      return [stops.length-1,null];
    }

    expectedState(instanceOrId,timestampSec){
      const instance=typeof instanceOrId==='string'?this.servicePlan.get(instanceOrId):instanceOrId;
      if(!instance)return null;
      if(timestampSec===null||timestampSec===undefined)return null;
      const geometry=this.geometry(instance),requested=Number(timestampSec);
      if(!Number.isFinite(requested))return null;
      const ts=clamp(requested,instance.plannedStart,instance.plannedEnd);
      const progress=this.progressAtTimestamp(instance,ts);
      const pos=progress===null||!geometry?.shape?null:G.pointAt(geometry.shape,progress);
      const [prevIndex,nextIndex]=this._stopPair(instance,ts);
      return Object.freeze({
        tripInstanceId:instance.id,
        timestamp:ts,
        expectedPosition:pos?Object.freeze({lat:pos.lat,lon:pos.lon}):null,
        expectedShapeProgress:progress,
        previousStop:prevIndex===null?null:stopView(instance.stops[prevIndex],prevIndex),
        nextStop:nextIndex===null?null:stopView(instance.stops[nextIndex],nextIndex),
        expectedTimestampAtPosition:progress===null?null:this.timeAtProgress(instance,progress,ts),
        geometryStatus:geometry?.status||'unavailable',
        geometryQuality:geometry?.quality||'unavailable',
        confidence:geometry?.confidence||0,
        source:'schedule_shape'
      });
    }

    activeStates(timestampSec){
      return this.servicePlan.activeAt(timestampSec).map(instance=>this.expectedState(instance,timestampSec));
    }

    summary(){
      let resolved=0,partial=0,unavailable=0;
      for(const instance of this.servicePlan.instances()){
        const status=this.geometry(instance)?.status;
        if(status==='resolved')resolved++;else if(status==='partial')partial++;else unavailable++;
      }
      return {
        provider:this.servicePlan.provider,network:this.servicePlan.network,
        tripInstances:this.servicePlan.instances().length,resolved,partial,unavailable
      };
    }
  }

  function createExpectedPositionModel(args){return new ExpectedPositionModel(args)}

  global.UVTransitExpectedPosition=Object.freeze({
    ExpectedPositionModel,createExpectedPositionModel,prepareRawShape,projectForward
  });
})(window);
