const assert=require('assert');
for(const p of ['../js/navigation/basemap-provider.js','../js/navigation/maneuvers.js','../js/navigation/navigation-provider.js','../js/navigation/street-imagery-provider.js']){
  delete require.cache[require.resolve(p)];require(p);
}

(async()=>{
  const B=globalThis.UVNavigationBasemap;
  assert.equal(B.OPENFREEMAP_STYLE,'https://tiles.openfreemap.org/styles/liberty');
  assert.equal(B.select({localAvailable:false}).id,'openfreemap-liberty');
  assert.equal(B.select({localAvailable:true,documentBase:'https://example.test/trasporti/'}).url,'https://example.test/trasporti/runtime-data/driver-map/driver-basemap.pmtiles');
  assert.equal(B.get('openfreemap-liberty').apiKeyRequired,false);
  assert.equal(B.fallbackOrder({preferLocal:true})[0].id,'uv-local-pmtiles');
  const probed=await B.resolve({documentBase:'https://example.test/trasporti/',fetchImpl:async()=>({ok:true,status:206})});
  assert.equal(probed.id,'uv-local-pmtiles');
  const remote=await B.resolve({documentBase:'https://example.test/trasporti/',fetchImpl:async()=>{throw new Error('offline')}});
  assert.equal(remote.id,'openfreemap-liberty');

  const N=globalThis.UVNavigationProvider;
  assert.throws(()=>N.createValhalla({baseUrl:'https://valhalla1.openstreetmap.de',fetchImpl:async()=>({ok:true})}),/not allowed/);
  let captured=null;
  const fakeFetch=async(url,opts={})=>{
    if(url.endsWith('/status'))return {ok:true,json:async()=>({version:'9.9',tileset_last_modified:123})};
    captured={url,opts};
    return {ok:true,json:async()=>({trip:{summary:{length:1.25,time:420},legs:[{shape:'_izlhA~rlgdF_{geC~ywl@',maneuvers:[{type:15,instruction:'Continua',length:.25,time:90,begin_shape_index:0,end_shape_index:1}]}]}})};
  };
  const provider=N.createValhalla({baseUrl:'https://routing.example.test',fetchImpl:fakeFetch});
  const route=await provider.route({from:{lat:45.44,lon:12.32},to:{lat:45.43,lon:12.34},locale:'it',costingOptions:{type:'wheelchair'}});
  assert.equal(captured.url,'https://routing.example.test/route');
  const body=JSON.parse(captured.opts.body);
  assert.equal(body.costing,'pedestrian');
  assert.equal(body.directions_options.language,'it');
  assert.equal(body.costing_options.pedestrian.type,'wheelchair');
  assert.equal(provider.capabilities.accessibilityProfiles,true);
  assert.equal(route.provider,'valhalla');
  assert.equal(route.distanceMeters,1250);
  assert.ok(route.shape.length>=2);
  assert.equal(route.maneuvers[0].type,'turn_left');
  assert.equal(route.maneuvers[0].providerText,'Continua');
  const health=await provider.health();
  assert.deepEqual(health,{ok:true,status:200,version:'9.9',tilesetLastModified:123});

  const local=N.createLocalWalk({engine:{
    isReady:()=>true,
    walk:async()=>({seconds:120,distance:150,points:[[45.44,12.33],[45.441,12.331]],visited:12})
  }});
  const degraded=await local.route({from:{lat:45.44,lon:12.33},to:{lat:45.441,lon:12.331}});
  assert.equal(degraded.provider,'uv-local-walk');
  assert.equal(degraded.degradedGuidance,true);
  assert.equal(degraded.shape.length,2);

  const fallback=N.createFallback({id:'broken',route:async()=>{throw new Error('primary down')}},local);
  const fallbackRoute=await fallback.route({from:{lat:45.44,lon:12.33},to:{lat:45.441,lon:12.331}});
  assert.equal(fallbackRoute.provider,'uv-local-walk');
  assert.equal(fallbackRoute.fallback.active,true);
  assert.equal(fallbackRoute.fallback.from,'broken');

  const I=globalThis.UVStreetImagery;
  let imgBody=null;
  const panoramax=I.createPanoramax({fetchImpl:async(url,opts)=>{imgBody=JSON.parse(opts.body);return {ok:true,json:async()=>({features:[{
    id:'pic-1',geometry:{type:'Point',coordinates:[12.33,45.44]},properties:{datetime:'2026-01-01T10:00:00Z'},
    assets:{thumb:{href:'https://img.test/thumb.jpg',roles:['thumbnail']}},links:[{rel:'self',href:'https://api.test/pic-1'}]
  }]})}}});
  const images=await panoramax.nearby({lat:45.44,lon:12.33,radiusM:100});
  assert.equal(imgBody.bbox.length,4);
  assert.equal(images[0].id,'pic-1');
  assert.equal(images[0].thumbnailUrl,'https://img.test/thumb.jpg');
  assert.equal(panoramax.blocksNavigation,false);

  const kv=I.createKartaView({fetchImpl:async(url,opts)=>{
    assert(url.includes('/list/nearby-photos/'));
    assert.equal(opts.method,'POST');
    return {ok:true,json:async()=>({result:{data:[{id:'kv1',lat:'45.44',lng:'12.33',fileUrl:'https://img.test/kv.jpg',sequenceId:'s1'}]}})};
  }});
  const kvRows=await kv.nearby({lat:45.44,lon:12.33,radiusM:80});
  assert.equal(kvRows[0].source,'kartaview');
  assert.equal(kvRows[0].thumbnailUrl,'https://img.test/kv.jpg');
  assert.equal(I.createDefault().id,'panoramax-federated','KartaView fallback must remain opt-in');
  const combo=I.createDefault({kartaViewFallback:true,panoramax:{fetchImpl:async()=>({ok:true,json:async()=>({features:[]})})},kartaview:{fetchImpl:async()=>({ok:true,json:async()=>({result:{data:[{id:'kv2',lat:'45.44',lng:'12.33',fileUrl:'https://img.test/kv2.jpg'}]}})})}});
  assert.equal((await combo.nearby({lat:45.44,lon:12.33}))[0].source,'kartaview');
  console.log('navigation-foundation tests passed');
})().catch(err=>{console.error(err);process.exit(1)});
