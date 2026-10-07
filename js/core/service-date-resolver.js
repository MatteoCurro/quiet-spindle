/* U.Venice Transport — provider-neutral ServiceDate Resolver.
   Selects the static snapshot that actually covers a GTFS service date.
   Pure module: no network, map or UI dependencies. */
(function(global){
  'use strict';

  const DAY_RE=/^\d{8}$/;

  function validDay(value){return DAY_RE.test(String(value||''))}

  function shiftDay(day,delta){
    if(!validDay(day))throw new Error('ServiceDate non valida: '+day);
    const d=new Date(Date.UTC(+day.slice(0,4),+day.slice(4,6)-1,+day.slice(6,8)+Number(delta||0)));
    return String(d.getUTCFullYear())+String(d.getUTCMonth()+1).padStart(2,'0')+String(d.getUTCDate()).padStart(2,'0');
  }

  function localDay(timestampMs,timezone){
    const parts=new Intl.DateTimeFormat('en-CA',{
      timeZone:timezone||'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(new Date(timestampMs==null?Date.now():timestampMs));
    const p={};for(const x of parts)if(x.type!=='literal')p[x.type]=x.value;
    return String(p.year)+String(p.month)+String(p.day);
  }

  function relevantServiceDates(timestampMs,timezone){
    const current=localDay(timestampMs,timezone);
    return [current,shiftDay(current,-1)];
  }

  function legacySnapshot(entry){
    if(!entry?.core?.file||!entry?.schedule?.file)return null;
    return {
      id:'legacy-current',
      sourceZipSha256:entry.sourceZipSha256||'',
      core:entry.core,
      shapes:entry.shapes||null,
      schedule:entry.schedule,
      serviceDates:Array.isArray(entry.schedule?.serviceDates)?entry.schedule.serviceDates.filter(validDay):[],
      legacy:true
    };
  }

  function snapshots(entry){
    const rows=Array.isArray(entry?.snapshots)?entry.snapshots.filter(s=>s?.core?.file&&s?.schedule?.file):[];
    if(rows.length)return rows.slice();
    const legacy=legacySnapshot(entry);
    return legacy?[legacy]:[];
  }

  function serviceDatesOf(snapshot){
    const direct=Array.isArray(snapshot?.serviceDates)?snapshot.serviceDates:[];
    const nested=Array.isArray(snapshot?.coverage?.serviceDates)?snapshot.coverage.serviceDates:[];
    return [...new Set([...direct,...nested].map(String).filter(validDay))];
  }

  function covers(snapshot,serviceDate){
    if(!validDay(serviceDate))return false;
    const days=serviceDatesOf(snapshot);
    if(days.length)return days.includes(serviceDate);
    const from=String(snapshot?.coverage?.from||''),to=String(snapshot?.coverage?.to||'');
    if(validDay(from)&&validDay(to))return serviceDate>=from&&serviceDate<=to;
    return false;
  }

  function candidates(entry,serviceDate){
    return snapshots(entry).filter(s=>covers(s,serviceDate));
  }

  function resolve(entry,serviceDate,options){
    options=options||{};
    if(!validDay(serviceDate))throw new Error('ServiceDate non valida: '+serviceDate);
    const all=snapshots(entry),exact=all.filter(s=>covers(s,serviceDate));
    if(exact.length)return {serviceDate,snapshot:exact[0],reason:exact.length>1?'overlap_latest_first':'covered',candidateCount:exact.length,fallback:false};
    if(!Array.isArray(entry?.snapshots)&&options.allowLegacyFallback!==false){
      const legacy=legacySnapshot(entry);
      if(legacy)return {serviceDate,snapshot:legacy,reason:'legacy_unverified',candidateCount:0,fallback:true};
    }
    return {serviceDate,snapshot:null,reason:'uncovered_service_date',candidateCount:0,fallback:false};
  }

  function resolveMany(entry,serviceDates,options){
    const seen=new Set(),rows=[];
    for(const day of serviceDates||[]){
      if(!validDay(day)||seen.has(day))continue;
      seen.add(day);rows.push(resolve(entry,day,options));
    }
    return rows;
  }

  function resolveWindow(entry,timestampMs,timezone,options){
    return resolveMany(entry,relevantServiceDates(timestampMs,timezone),options);
  }

  function audit(entry,serviceDates){
    const resolutions=resolveMany(entry,serviceDates,{allowLegacyFallback:false});
    return {
      requested:resolutions.map(r=>r.serviceDate),
      covered:resolutions.filter(r=>r.snapshot).map(r=>r.serviceDate),
      missing:resolutions.filter(r=>!r.snapshot).map(r=>r.serviceDate),
      overlaps:resolutions.filter(r=>r.candidateCount>1).map(r=>({serviceDate:r.serviceDate,candidateCount:r.candidateCount})),
      snapshots:snapshots(entry).map(s=>({id:s.id||'',serviceDates:serviceDatesOf(s)}))
    };
  }

  global.UVTransitServiceDateResolver=Object.freeze({
    validDay,shiftDay,localDay,relevantServiceDates,snapshots,serviceDatesOf,covers,candidates,resolve,resolveMany,resolveWindow,audit
  });
})(window);
