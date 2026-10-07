const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js','entities','registry.js'),'utf8');
const doc=JSON.parse(fs.readFileSync(path.join(root,'data','entities','poi.json'),'utf8'));

let lang='it';
const sandbox={
  document:{documentElement:{lang:'it'}},
  UVTransitI18n:{getLocale:()=>lang},
  fetch:async()=>({ok:true,status:200,json:async()=>doc}),
  console
};
sandbox.window=sandbox;sandbox.globalThis=sandbox;
vm.runInContext(source,vm.createContext(sandbox),{filename:'js/entities/registry.js'});

(async()=>{
  const E=sandbox.UVTransitEntities;
  await E.load();

  const san=await E.get('poi:uv_venice_san_marco');
  assert(san);
  assert.equal(E.display(san,'it'),'Piazza San Marco');
  assert.equal(E.display(san,'en'),"St Mark's Square");

  let rows=await E.search('san marco',{limit:5});
  assert.equal(rows[0].id,'poi:uv_venice_san_marco');
  assert.equal(rows[0].source,'uv-entity');

  lang='en';
  rows=await E.search('st marks');
  assert.equal(rows[0].id,'poi:uv_venice_san_marco');
  assert.equal(rows[0].name,"St Mark's Square");

  lang='de';
  rows=await E.search('markusplatz');
  assert.equal(rows[0].id,'poi:uv_venice_san_marco');
  assert.equal(rows[0].name,'Markusplatz');

  lang='fr';
  rows=await E.search('aéroport de venise');
  assert.equal(rows[0].id,'airport:uv_venice_marco_polo');

  const slug=await E.resolveSlug('rialto-bridge','en');
  assert.equal(slug.id,'poi:uv_venice_rialto_bridge');

  const hubs=await E.search('mestre',{types:['transport_hub']});
  assert(hubs.some(row=>row.id==='hub:uv_mestre_station'));
  assert(!hubs.some(row=>row.type==='poi'));

  const scalziHubs=await E.hubs('poi:uv_venice_scalzi_bridge');
  assert.equal(scalziHubs.length,1);
  assert.equal(scalziHubs[0].id,'hub:uv_venice_santa_lucia');

  const noHubs=await E.hubs('poi:uv_venice_san_marco');
  assert.deepEqual(noHubs,[]);

  assert.equal(E.normalize("Place Saint-Marc"),'place saint marc');
  process.stdout.write('entity runtime: localized aliases, stable IDs, type filters and slugs OK\n');
})().catch(error=>{process.stderr.write(error.stack||String(error));process.exitCode=1});
