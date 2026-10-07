const assert=require('assert'),fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const provider=fs.readFileSync(path.join(root,'js/navigation/street-imagery-provider.js'),'utf8');
const preview=fs.readFileSync(path.join(root,'js/navigation/imagery-preview.js'),'utf8');
const t1=fs.readFileSync(path.join(root,'js/navigation/controller.js'),'utf8');
const t3=fs.readFileSync(path.join(root,'js/navigation/journey-controller.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');

assert(index.includes('js/navigation/street-imagery-provider.js?v='));
assert(index.includes('js/navigation/imagery-preview.js?v='));
assert(index.indexOf('street-imagery-provider.js')<index.indexOf('imagery-preview.js'));
assert(index.indexOf('imagery-preview.js')<index.indexOf('navigation/controller.js'));
assert(preview.includes("button.onclick=open"),'imagery search must be user-triggered');
assert(preview.includes("provider.nearby"),'preview must use provider adapter');
assert(!preview.includes('setInterval('),'imagery preview must never poll');
assert(!preview.includes('requestAnimationFrame('),'imagery preview must not create a continuous loop');
assert(t1.includes("imageryPreview?.offer?."),'walking navigation must only offer imagery');
assert(t3.includes("imageryPreview?.offer?."),'multimodal walking legs must only offer imagery');
assert(!t1.includes("imageryPreview?.open?.("),'walking navigation must not auto-open/fetch imagery');
assert(!t3.includes("imageryPreview?.open?.("),'multimodal navigation must not auto-open/fetch imagery');
assert(provider.includes("createPanoramax")&&provider.includes("createKartaView")&&provider.includes("createFallback"));
assert(provider.includes("if(options.kartaViewFallback!==true)return primary"),'KartaView must remain opt-in fallback');
assert(!provider.includes('.php'),'street imagery must not depend on PHP');
for(const lang of ['it','en','fr','de']){
 const locale=JSON.parse(fs.readFileSync(path.join(root,'locales',lang+'.json'),'utf8'));
 for(const key of ['navigation.imagery.open','navigation.imagery.loading','navigation.imagery.none','navigation.imagery.full']){
  assert(locale[key],lang+' missing '+key);
 }
}
console.log('navigation-t5 imagery contracts passed');
