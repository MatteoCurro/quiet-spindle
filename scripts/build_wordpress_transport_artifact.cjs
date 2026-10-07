#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');

const CORE_LOCALES=['it','en','fr','de'];

function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'))}
function assertString(value,label){
  if(typeof value!=='string'||!value.trim())throw new Error('Missing '+label);
  return value.trim();
}
function entityToken(id){
  const m=String(id||'').match(/^(?:poi|hub|airport):(.+)$/);
  if(!m)throw new Error('Unsupported entity id '+id);
  return m[1];
}
function sortedObject(entries){
  return Object.fromEntries([...entries].sort(([a],[b])=>a.localeCompare(b)));
}
function buildArtifact(root=process.cwd()){
  const registry=readJson(path.join(root,'data/entities/poi.json'));
  const routes=readJson(path.join(root,'data/deep-links/routes.json'));
  const locales=Object.fromEntries(CORE_LOCALES.map(lang=>[
    lang,readJson(path.join(root,'locales',lang+'.json'))
  ]));
  const entityEntries=(registry.entities||[]).map(entity=>{
    const names={};
    for(const lang of CORE_LOCALES)names[lang]=assertString(entity.names?.[lang],entity.id+' name '+lang);
    return [entity.id,{
      id:entity.id,
      token:entityToken(entity.id),
      type:entity.type,
      names
    }];
  });
  const routeEntries=(routes.routes||[]).map(route=>{
    const names={};
    for(const lang of CORE_LOCALES)names[lang]=assertString(route.names?.[lang],route.id+' name '+lang);
    return [route.id,{
      id:route.id,
      from:route.from,
      to:route.to,
      mode:route.mode||'all',
      names
    }];
  });
  const entityIds=new Set(entityEntries.map(([id])=>id));
  for(const [,route] of routeEntries){
    if(!entityIds.has(route.from)||!entityIds.has(route.to))throw new Error('Route references unknown entity '+route.id);
  }
  const strings={};
  for(const lang of CORE_LOCALES){
    strings[lang]={
      findRoute:assertString(locales[lang]['journey.find'],lang+' journey.find'),
      destination:assertString(locales[lang]['journey.destination'],lang+' journey.destination'),
      route:assertString(locales[lang]['common.route'],lang+' common.route')
    };
  }
  return {
    schemaVersion:1,
    appBase:'https://www.unlockvenice.com/trasporti',
    operationalBase:'https://www.unlockvenice.com/trasporti/go',
    locales:CORE_LOCALES,
    sourceSchemaVersions:{
      entities:registry.schemaVersion,
      routes:routes.schemaVersion
    },
    strings,
    entities:sortedObject(entityEntries),
    routes:sortedObject(routeEntries)
  };
}
function writeArtifact(outFile,root=process.cwd()){
  const artifact=buildArtifact(root);
  fs.mkdirSync(path.dirname(outFile),{recursive:true});
  fs.writeFileSync(outFile,JSON.stringify(artifact,null,2)+'\n');
  return artifact;
}
function parseArgs(argv){
  const args={out:'wordpress/uv-transport-shortcodes/data/catalog.json'};
  for(let i=0;i<argv.length;i++)if(argv[i]==='--out')args.out=argv[++i];
  return args;
}
function main(){
  const args=parseArgs(process.argv.slice(2));
  const out=path.resolve(process.cwd(),args.out);
  const artifact=writeArtifact(out);
  process.stdout.write(JSON.stringify({
    out,entities:Object.keys(artifact.entities).length,
    routes:Object.keys(artifact.routes).length,
    locales:artifact.locales
  },null,2)+'\n');
}
if(require.main===module){try{main()}catch(error){console.error(error.stack||error);process.exitCode=1}}

module.exports={CORE_LOCALES,entityToken,buildArtifact,writeArtifact};
