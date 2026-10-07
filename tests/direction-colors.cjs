const assert=require('assert');
function shadeHex(hex,amount){
  const m=String(hex||'').trim().match(/^#([0-9a-f]{6})$/i); if(!m)return hex;
  const n=parseInt(m[1],16); let r=(n>>16)&255,g=(n>>8)&255,b=n&255;
  const target=amount>=0?255:0,p=Math.min(1,Math.abs(amount));
  r=Math.round(r+(target-r)*p); g=Math.round(g+(target-g)*p); b=Math.round(b+(target-b)*p);
  return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const base='#137a59',light=shadeHex(base,.16),dark=shadeHex(base,-.16);
assert.notStrictEqual(light,base); assert.notStrictEqual(dark,base); assert.notStrictEqual(light,dark);
function luminance(hex){const n=parseInt(hex.slice(1),16);return ((n>>16)&255)+((n>>8)&255)+(n&255)}
assert(luminance(light)>luminance(base)); assert(luminance(dark)<luminance(base));
console.log('PASS direction colors', {base,light,dark});
