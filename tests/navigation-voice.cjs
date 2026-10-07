const assert=require('assert');
globalThis.window=globalThis;
class U {
  constructor(text){this.text=text;this.lang='';this.rate=1;this.pitch=1;this.volume=1;this.onend=null}
}
const calls=[];
const synth={cancel(){calls.push(['cancel'])},speak(u){calls.push(['speak',u.text,u.lang]);u.onend?.()}};
globalThis.speechSynthesis=synth;globalThis.SpeechSynthesisUtterance=U;
globalThis.localStorage={data:{},getItem(k){return this.data[k]||null},setItem(k,v){this.data[k]=v}};
globalThis.location={search:''};
for(const p of ['../js/navigation/voice.js','../js/navigation/preferences.js']){
  delete require.cache[require.resolve(p)];require(p);
}
const V=globalThis.UVNavigationVoice.create({enabled:false});
assert.equal(V.snapshot().supported,true);
assert.equal(V.snapshot().enabled,false);
V.setEnabled(true);
assert.equal(V.speak('Turn left',{key:'a',distanceM:80,locale:'en'}),true);
assert.equal(V.speak('Turn left',{key:'a',distanceM:75,locale:'en'}),false,'same distance band must not repeat');
assert.equal(V.speak('Turn left',{key:'a',distanceM:30,locale:'en'}),true,'new distance band should announce');
V.stale();
assert.equal(V.speak('Turn left',{key:'a',distanceM:30,locale:'en'}),true,'stale cancellation must allow new-route guidance');
assert(calls.some(x=>x[0]==='speak'&&x[2]==='en-GB'));

const P=globalThis.UVNavigationPreferences;
assert.deepEqual(P.costingOptions({accessibility:'wheelchair'}),{type:'wheelchair'});
assert.deepEqual(P.costingOptions({accessibility:'blind'}),{type:'blind'});
assert.equal(P.costingOptions({accessibility:'foot'}),null);
console.log('navigation-voice-preferences tests passed');
