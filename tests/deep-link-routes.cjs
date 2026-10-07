const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const routes=JSON.parse(fs.readFileSync(root+'/data/deep-links/routes.json','utf8'));
const entities=JSON.parse(fs.readFileSync(root+'/data/entities/poi.json','utf8'));
const ids=new Set(entities.entities.map(e=>e.id)),seen=new Set(),langs=['it','en','fr','de'];
assert.equal(routes.schemaVersion,1);assert(routes.routes.length>=5,'expected initial curated stable routes');
for(const route of routes.routes){assert(route.id&&!seen.has(route.id),'route IDs must be unique');seen.add(route.id);assert(ids.has(route.from),'unknown stable route origin '+route.from);assert(ids.has(route.to),'unknown stable route destination '+route.to);assert(['all','aut','nav'].includes(route.mode),'invalid route mode '+route.mode);for(const lang of langs)assert(route.names?.[lang]?.trim(),route.id+' missing '+lang+' name')}
const source=fs.readFileSync(root+'/js/deep-links/routes.js','utf8'),doc={documentElement:{lang:'it'}};let fetches=0;
const entityMap=new Map(entities.entities.map(e=>[e.id,e]));
const sandbox={window:null,globalThis:null,document:doc,fetch:async()=>{fetches++;return{ok:true,status:200,json:async()=>routes}},UVTransitEntities:{get:async id=>entityMap.get(id)||null},UVTransitI18n:{getLocale:()=> 'en'}};sandbox.window=sandbox;sandbox.globalThis=sandbox;
vm.runInContext(source,vm.createContext(sandbox),{filename:'js/deep-links/routes.js'});
(async()=>{const R=sandbox.UVTransitDeepLinkRoutes,row=await R.get('uv_mestre_station_san_marco');assert(row);assert.equal(row.from,'hub:uv_mestre_station');assert.equal(R.display(row),'Mestre Station → St Mark\'s Square');const resolved=await R.resolve(row.id);assert.equal(resolved.fromEntity.id,row.from);assert.equal(resolved.toEntity.id,row.to);await R.get('uv_san_marco_rialto');assert.equal(fetches,1,'catalog should be cached');console.log('RESULT: '+routes.routes.length+' curated stable routes reference valid multilingual entities.');})().catch(e=>{console.error(e);process.exitCode=1});
