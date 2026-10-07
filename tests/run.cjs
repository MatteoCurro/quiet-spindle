const {spawnSync}=require('child_process'),path=require('path');
for(const name of ['static-contracts','motion','direction-colors','viewport','integration','schedule','journey-ui','places','worker']){const r=spawnSync(process.execPath,[path.join(__dirname,name+'.cjs')],{stdio:'inherit',env:process.env});if(r.status!==0)process.exit(r.status||1)}
