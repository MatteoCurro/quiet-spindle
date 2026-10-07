const fs=require('fs'),vm=require('vm'),assert=require('assert');const c={Intl,Date,Map,Set};vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../js/journey/schedule.js','utf8'),c);const {Schedule,seconds,base,day,hubDisplayName,hubKey}=c.UVTransitSchedule;
const now=Date.parse('2026-09-15T08:00:00+02:00')/1000;
const files={'agency.txt':'agency_timezone\nEurope/Rome\n','calendar.txt':'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\ns,1,1,1,1,1,1,1,20260901,20261031\n','calendar_dates.txt':'service_id,date,exception_type\ns,20260916,2\n','routes.txt':'route_id,route_short_name,route_type\nr,T1,0\nb,2,3\n','stops.txt':'stop_id,stop_name,stop_lat,stop_lon\na,Cattaneo,45.49,12.24\nb,Interscambio,45.50,12.25\nc,Venezia Piazzale Roma,45.44,12.32\n','trips.txt':'trip_id,route_id,service_id,trip_headsign\nt,r,s,Venezia\nu,b,s,Venezia\n','stop_times.txt':'trip_id,stop_sequence,stop_id,arrival_time,departure_time,pickup_type,drop_off_type\nt,1,a,08:10:00,08:10:00,0,1\nt,2,b,08:20:00,08:20:00,0,0\nu,1,b,08:23:00,08:23:00,0,1\nu,2,c,08:40:00,08:40:00,1,0\n'};
function engine(overrides={}){const s=new Schedule();s.load({...files,...overrides},now);return s}let count=0;function test(n,f){f();count++;console.log('PASS '+n)}
test('seconds beyond midnight',()=>assert.equal(seconds('25:15:00'),90900));
test('service exception overrides weekday',()=>{const s=engine();assert(s.active('s','20260915'));assert(!s.active('s','20260916'))});
test('date only calendar supported',()=>{const s=engine({'calendar.txt':'','calendar_dates.txt':'service_id,date,exception_type\ns,20260915,1\n'});assert(s.active('s','20260915'));assert(!s.active('s','20260914'))});
test('missing calendar fails explicitly',()=>assert.throws(()=>engine({'calendar.txt':'','calendar_dates.txt':''}),/Calendario/));
test('Rome date around midnight',()=>assert.equal(day(Date.parse('2026-09-14T23:30:00Z')/1000,'Europe/Rome'),'20260915'));
test('DST service day uses noon minus 12 hours',()=>assert.equal(base('20261025','Europe/Rome'),Date.parse('2026-10-24T23:00:00Z')/1000));
test('direct trip',()=>{const r=engine().plan([{id:'a'}],['b'],now);assert(r.length);assert.equal(r[0].legs.length,1)});
test('one same-stop transfer',()=>{const r=engine().plan([{id:'a'}],['c'],now);assert(r.length);assert.equal(r[0].legs.length,2);assert.equal(r[0].legs[1].route,'2')});
test('walking readiness excludes missed trip',()=>assert(engine().plan([{id:'a',seconds:700}],['c'],now).every(r=>r.legs[0].departure>now+86400)));
test('reverse direction cannot board',()=>assert.equal(engine().plan([{id:'c'}],['a'],now).length,0));
test('all departures without selected-marker filters',()=>assert.equal(engine().departures('a',now)[0].route,'T1'));
test('pickup prohibition respected',()=>assert.equal(engine({'stop_times.txt':files['stop_times.txt'].replace('08:10:00,08:10:00,0,1','08:10:00,08:10:00,1,1')}).departures('a',now).length,0));
const update=(ts=now,rel='SCHEDULED',stopRel='SCHEDULED')=>({header:{timestamp:ts},entity:[{trip_update:{trip:{trip_id:'t',start_date:'20260915',schedule_relationship:rel},stop_time_update:[{stop_sequence:1,stop_id:'a',departure:{time:now+900},schedule_relationship:stopRel}]}}]});
test('fresh realtime overlay',()=>{const s=engine();s.update(update());assert(s.departures('a',now)[0].live);assert.equal(s.departures('a',now)[0].time,now+900)});
test('stale realtime falls back to schedule',()=>{const s=engine();s.update(update(now-180));assert(!s.departures('a',now)[0].live);assert.equal(s.departures('a',now)[0].time,now+600)});
test('cancellation excludes trip',()=>{const s=engine();s.update(update(now,'CANCELED'));assert.equal(s.departures('a',now).length,0)});
test('skipped stop excludes boarding',()=>{const s=engine();s.update(update(now,'SCHEDULED','SKIPPED'));assert.equal(s.departures('a',now).length,0)});
test('no data does not create prediction',()=>{const s=engine();s.update(update(now,'SCHEDULED','NO_DATA'));assert(!s.departures('a',now)[0].live)});
test('wrong service date cannot override today',()=>{const s=engine();const u=update();u.entity[0].trip_update.trip.start_date='20260914';s.update(u);assert(!s.departures('a',now)[0].live)});
test('forbidden same-stop transfer',()=>assert.equal(engine({'transfers.txt':'from_stop_id,to_stop_id,transfer_type\nb,b,3\n'}).plan([{id:'a'}],['c'],now).length,0));
test('trip at 24 hours remains usable after midnight',()=>{const s=engine({'stop_times.txt':files['stop_times.txt'].replaceAll('08:10:00','24:10:00').replaceAll('08:20:00','24:20:00')});const late=Date.parse('2026-09-15T00:00:00+02:00')/1000;assert.equal(s.departures('a',late)[0].time,late+600)});
test('search and nearby retain palina IDs',()=>{const s=engine();assert.equal(s.search('piazzale')[0].id,'c');assert.equal(s.nearby({lat:45.49,lon:12.24})[0].id,'a')});
test('platform suffixes collapse to a stable hub name',()=>{assert.equal(hubDisplayName('Stazione MESTRE FS C3'),'Stazione MESTRE FS');assert.equal(hubDisplayName('Piazzale Roma "B"'),'Piazzale Roma');assert.equal(hubKey('Stazione MESTRE FS C1'),hubKey('Stazione MESTRE FS C3'))});
test('grouped stop search exposes every nearby platform of the hub',()=>{
 const h=engine({
  'stops.txt':'stop_id,stop_name,stop_lat,stop_lon\nc1,Stazione MESTRE FS C1,45.48230,12.23160\nc3,Stazione MESTRE FS C3,45.48245,12.23180\nv,VENEZIA,45.4380,12.3181\n',
  'routes.txt':'route_id,route_short_name,route_type\nr1,2,3\n',
  'trips.txt':'trip_id,route_id,service_id,trip_headsign\nt1,r1,s,Venezia\n',
  'stop_times.txt':'trip_id,stop_sequence,stop_id,arrival_time,departure_time,pickup_type,drop_off_type\nt1,1,c3,08:10:00,08:10:00,0,1\nt1,2,v,08:35:00,08:35:00,1,0\n'
 });
 // Give C1 a route presence as a real platform without creating a second useful journey.
 h.stops.get('c1').lines=['2'];h.stops.get('c3').lines=['2'];
 const hub=h.search('mestre fs',true)[0];assert(hub.hub);assert.equal(hub.name,'Stazione MESTRE FS');assert.deepEqual(Array.from(hub.ids).sort(),['c1','c3']);
 const r=h.plan(hub.members.map(m=>({id:m.id,seconds:0})),['v'],now);assert(r.length);assert.equal(r[0].legs[0].route,'2');assert.equal(r[0].legs[0].from.id,'c3');
});
test('delay propagates to downstream arrival',()=>{const s=engine();s.update(update());const r=s.plan([{id:'a'}],['b'],now);assert.equal(r[0].legs[0].arrival,now+1500);assert(r[0].legs[0].liveArrival)});
test('line board lists routes independent of departures window',()=>assert.deepEqual(Array.from(engine().linesAtStop('b'),r=>r.name),['2','T1']));
test('line filter never mixes departures',()=>assert(engine().departures('b',now,24,'b').every(r=>r.routeId==='b')));
test('unknown line has no departures',()=>assert.equal(engine().departures('b',now,24,'missing').length,0));
test('egress walking time is included in arrival',()=>{const s=engine(),r=s.plan([{id:'a'}],[{id:'b',seconds:600}],now)[0];assert.equal(r.arrival,r.legs[0].arrival+600)});
console.log('RESULT: '+count+' schedule tests passed.');


test('public line groups variants and retains all departures',()=>{
 const s=engine(),t=s.trips.get('t'),variant={...t,id:'variant',route:{...t.route,id:'variant-route'},headsign:'Other destination'};
 s.trips.set(variant.id,variant);
 const line=s.linesAtStop('a').find(x=>x.name===t.route.name);
 assert.equal(s.linesAtStop('a').filter(x=>x.name===t.route.name).length,1);
 assert.equal(line.ids.length,2);assert(line.directions.includes('Other destination'));
 const rows=s.departures('a',now,6,line.ids);assert(rows.some(r=>r.trip==='t'));assert(rows.some(r=>r.trip==='variant'));
 assert.equal(rows.filter(r=>r.time===now+600).length,2,'distinct simultaneous trips must survive');
});
