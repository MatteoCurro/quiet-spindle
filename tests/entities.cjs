const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {validate}=require('../scripts/validate-entities.cjs');

const root=path.join(__dirname,'..');
const doc=JSON.parse(fs.readFileSync(path.join(root,'data','entities','poi.json'),'utf8'));
const result=validate(doc);
assert(result.ok,result.errors.join('\n'));
assert(result.count>=40,'registry must contain at least 40 curated high-intent entities');

const ids=new Set(doc.entities.map(e=>e.id));
for(const expected of [
  'poi:uv_venice_san_marco',
  'poi:uv_venice_rialto_bridge',
  'poi:uv_venice_scalzi_bridge',
  'hub:uv_venice_santa_lucia',
  'hub:uv_venice_piazzale_roma',
  'airport:uv_venice_marco_polo',
  'hub:uv_mestre_station',
  'poi:uv_venice_st_marks_basilica',
  'poi:uv_venice_doges_palace',
  'poi:uv_venice_la_fenice',
  'poi:uv_venice_accademia_galleries',
  'poi:uv_venice_santa_maria_salute',
  'poi:uv_venice_ca_doro',
  'poi:uv_venice_san_rocco',
  'poi:uv_venice_frari',
  'poi:uv_venice_san_giorgio_maggiore',
  'poi:uv_venice_jewish_ghetto',
  'poi:uv_venice_murano',
  'poi:uv_venice_burano',
  'poi:uv_venice_lido',
  'poi:uv_venice_giudecca',
  'poi:uv_venice_torcello',
  'airport:uv_treviso',
  'hub:uv_murano_faro',
  'hub:uv_burano',
  'hub:uv_lido_sme',
  'hub:uv_fondamente_nove',
  'poi:uv_venice_museo_correr',
  'poi:uv_venice_ca_rezzonico',
  'poi:uv_venice_ca_pesaro',
  'poi:uv_venice_punta_dogana',
  'poi:uv_venice_libreria_acqua_alta',
  'poi:uv_venice_scala_bovolo',
  'poi:uv_venice_santi_giovanni_paolo',
  'poi:uv_murano_glass_museum'
])assert(ids.has(expected),'missing core entity '+expected);

assert.deepEqual(
  doc.entities.find(e=>e.id==='poi:uv_venice_scalzi_bridge').hubs,
  ['hub:uv_venice_santa_lucia'],
  'Scalzi must resolve to Santa Lucia as its major transport hub'
);
assert.deepEqual(
  doc.entities.find(e=>e.id==='poi:uv_mestre_piazza_ferretto').hubs,
  ['hub:uv_mestre_station'],
  'Piazza Ferretto must resolve to Venezia Mestre as its major transport hub'
);
assert.deepEqual(doc.entities.find(e=>e.id==='poi:uv_venice_murano').hubs,['hub:uv_murano_faro'],'Murano must reference Murano Faro');
assert.deepEqual(doc.entities.find(e=>e.id==='poi:uv_venice_burano').hubs,['hub:uv_burano'],'Burano must reference its ACTV hub');
assert.deepEqual(doc.entities.find(e=>e.id==='poi:uv_venice_lido').hubs,['hub:uv_lido_sme'],'Lido must reference Santa Maria Elisabetta');

for(const entity of doc.entities){
  assert(!/[àèéìòùäöüß]/i.test(entity.id),'stable id must not contain localized characters: '+entity.id);
  assert.equal(Object.keys(entity.names).sort().join(','),'de,en,fr,it');
  assert.equal(Object.keys(entity.seo.slugs).sort().join(','),'de,en,fr,it');
  assert.equal(Object.keys(entity.editorial.queries).sort().join(','),'de,en,fr,it');
}

const broken=JSON.parse(JSON.stringify(doc));
broken.entities[1].seo.slugs.it=broken.entities[0].seo.slugs.it;
const duplicate=validate(broken);
assert(!duplicate.ok);
assert(duplicate.errors.some(e=>e.includes('duplicate it slug')));

const badRef=JSON.parse(JSON.stringify(doc));
badRef.entities[0].hubs=['hub:uv_missing'];
const refResult=validate(badRef);
assert(!refResult.ok);
assert(refResult.errors.some(e=>e.includes('references missing hub')));

process.stdout.write('entity registry: stable IDs, locale completeness, unique slugs and references OK\n');
