const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const self=path.relative(root,__filename);
const roots=['.github','api','js','server','scripts','tests'];
const rootFiles=['index.html','package.json'];
const binaryExt=new Set(['.png','.jpg','.jpeg','.webp','.gif','.zip','.pmtiles','.woff','.woff2','.ico','.pdf']);
const hits=[];

function inspect(file){
  const rel=path.relative(root,file);
  if(rel===self||binaryExt.has(path.extname(file).toLowerCase()))return;
  let text;try{text=fs.readFileSync(file,'utf8')}catch(_){return}
  if(/busone/i.test(rel)||/busone/i.test(text))hits.push(rel);
}
function walk(dir){
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    if(['node_modules','dist','build','.git'].includes(ent.name))continue;
    const p=path.join(dir,ent.name);
    if(ent.isDirectory())walk(p);else inspect(p);
  }
}
for(const name of roots){const p=path.join(root,name);if(fs.existsSync(p))walk(p)}
for(const name of rootFiles){const p=path.join(root,name);if(fs.existsSync(p))inspect(p)}
assert.deepEqual(hits,[],'Legacy external transit provider references remain in active surfaces:\n'+hits.join('\n'));
console.log('RESULT: active runtime/build/test surfaces contain no legacy transit-provider dependency.');
