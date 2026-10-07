const assert=require('assert');
for(const p of [
  '../js/navigation/route-progress.js',
  '../js/navigation/journey-plan.js',
  '../js/navigation/transit-assist.js'
]){
  delete require.cache[require.resolve(p)];require(p);
}

const J=globalThis.UVJourneyNavigationPlan;
const result={
  walk:{seconds:120,distance:140,points:[[45.0000,12.0000],[45.0000,12.0010]]},
  egress:{seconds:90,distance:100,points:[[45.0130,12.0000],[45.0140,12.0010]]},
  legs:[
    {
      trip:'aut:T1',date:'20261005',network:'aut',routeId:'aut:R1',route:'1',mode:'land',headsign:'Centro',
      departure:1000,arrival:1600,
      from:{id:'aut:A',name:'A',lat:45.0000,lon:12.0010},
      to:{id:'aut:C',name:'C',lat:45.0030,lon:12.0010},
      stops:[
        {id:'aut:A',name:'A',lat:45.0000,lon:12.0010},
        {id:'aut:B',name:'B',lat:45.0015,lon:12.0010},
        {id:'aut:C',name:'C',lat:45.0030,lon:12.0010}
      ],
      points:[[45.0000,12.0010],[45.0015,12.0010],[45.0030,12.0010]]
    },
    {
      trip:'nav:T2',date:'20261005',network:'nav',routeId:'nav:R2',route:'2',mode:'water',headsign:'Laguna',
      departure:1900,arrival:2500,
      transfer:{seconds:180,distance:210,points:[[45.0030,12.0010],[45.0040,12.0020]]},
      from:{id:'nav:D',name:'D',lat:45.0040,lon:12.0020},
      to:{id:'nav:G',name:'G',lat:45.0130,lon:12.0000},
      stops:[
        {id:'nav:D',name:'D',lat:45.0040,lon:12.0020},
        {id:'nav:E',name:'E',lat:45.0080,lon:12.0010},
        {id:'nav:F',name:'F',lat:45.0110,lon:12.0005},
        {id:'nav:G',name:'G',lat:45.0130,lon:12.0000}
      ],
      points:[[45.0040,12.0020],[45.0080,12.0010],[45.0110,12.0005],[45.0130,12.0000]]
    }
  ]
};
const query={
  origin:{name:'Origine',lat:45.0000,lon:12.0000},
  destination:{name:'Destinazione',lat:45.0140,lon:12.0010}
};
const plan=J.create(result,query);
assert.deepEqual(plan.segments.map(x=>x.type+':'+x.kind),[
  'walk:access','transit:ride','walk:transfer','transit:ride','walk:egress'
]);

const A=globalThis.UVTransitNavigationAssist;
const first=plan.segments[1],model=A.createLegModel(first);
const snapshot={
  tripStates:[{
    tripInstanceId:'actv-official:aut:20261005:T1',
    tripId:'T1',routeId:'R1',serviceDate:'20261005',
    status:'observed',plannedStart:1000,
    position:{source:'official_realtime_position',value:{lat:45.0002,lon:12.0010}}
  }]
};
const matched=A.matchTripState(snapshot,first);
assert(matched&&matched.tripId==='T1');

const waiting=A.waiting(model,{
  tripState:matched,userFix:{lat:45.0000,lon:12.0010},now:950
});
assert.equal(waiting.atStop,true);
assert.equal(waiting.boardingSuggested,true);
assert.equal(waiting.mode,'live');

const oneBefore={...matched,position:{source:'official_realtime_position',value:{lat:45.00155,lon:12.0010}}};
const ride=A.ride(model,{tripState:oneBefore,now:1300});
assert.equal(ride.source,'canonical');
assert.equal(ride.stopsToAlight,1);
assert.equal(ride.prepareAlight,true);
assert.equal(ride.alightStop.name,'C');

const scheduled=A.ride(model,{tripState:null,now:1300});
assert.equal(scheduled.source,'schedule');
assert(scheduled.progressM>0&&scheduled.progressM<model.route.totalM);

const cancelled=A.waiting(model,{
  tripState:{...matched,status:'cancelled',position:null},userFix:{lat:45,lon:12.001},now:1000
});
assert.equal(cancelled.missed,true);

console.log('navigation-transit tests passed');
