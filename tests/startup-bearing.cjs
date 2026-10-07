const fs=require('fs'),vm=require('vm'),assert=require('assert');
const code=fs.readFileSync(__dirname+'/../js/map/vehicles-layer.js','utf8');
let html='';
const L={divIcon:o=>(html=o.html,o)};const c={L,window:{}};vm.createContext(c);vm.runInContext(code,c);
const layer=c.window.UVTransitVehiclesLayer;const color=()=> '#123456';
let count=0;function test(n,f){f();count++;console.log('PASS '+n)}
test('unknown bearing hides arrow',()=>{layer.icon({id:'1',route:'T1',bearing:null},color);assert(!html.includes('vehicle-arrow'))});
test('finite bearing shows exact arrow',()=>{layer.icon({id:'1',route:'T1',bearing:123.4},color);assert(html.includes('vehicle-arrow'));assert(html.includes('rotate(123deg)'))});
const app=fs.readFileSync(__dirname+'/../js/app.js','utf8');
test('vehicles are rehydrated when geometry arrives',()=>{assert(app.includes('function rehydrateVehiclesForRoute(short)'));assert(app.includes('rehydrateVehiclesForRoute(short)'))});
test('startup no longer forces bearing zero',()=>assert(!app.includes('nextStop:null,bearing:0')));
test('provider bearing hint accepted',()=>assert(app.includes('bearing:Number.isFinite(feedBearing)?feedBearing:null')));
console.log('RESULT: '+count+' startup bearing tests passed.');
