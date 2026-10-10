/** Jarvis TSAND frontend regression tests; no API calls, no secrets. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/jarvis/index.ts'), 'utf8');
const encoded = source.match(/^const HTML=("(?:[^"\\]|\\.)*");/s);
assert.ok(encoded, 'Jarvis HTML source must remain extractable');
const html = JSON.parse(encoded[1]);
const moduleCode = html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert.ok(moduleCode, 'Jarvis must contain the browser module');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function harness({ runs = [], events = {}, admin = {user_id:'admin'} } = {}) {
  const elements = new Map();
  let signedOut = false;
  const get = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        textContent:'',innerHTML:'',className:'',dataset:{},
        classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},
      });
    }
    return elements.get(id);
  };
  const db = {
    from(table) {
      const query = {
        select() {return this;}, eq(key,value){this.key=value;return this;},
        order(){return this;}, limit(){
          if(table==='agent_runs')return Promise.resolve({data:runs,error:null});
          const supplied=events[this.key];
          return supplied?.promise || Promise.resolve({data:supplied || [],error:null});
        },
        maybeSingle(){return Promise.resolve({data:admin,error:null})},
      };
      return query;
    },
    auth:{
      async signOut(){signedOut=true;},
      async getSession(){return {data:{session:null},error:null}},
    },
    channel(){return {on(){return this},subscribe(){return this}};},
    removeChannel(){return Promise.resolve();},
  };
  let code = moduleCode[1]
    .replace(/^import \{ createClient \} from "[^"]+";\s*/,'')
    .replace(/const supabase=createClient\([^;]+\);/,'const supabase=globalThis.__db;')
    .replace(/const \{data:\{session\},error:sessionError\}=await supabase\.auth\.getSession\(\);[\s\S]*$/,'');
  code += '\n;globalThis.__api={totalTokens,runIsStale,refreshRuns,selectRun,enter,renderRun};';
  const context = {
    __db:db,
    document:{getElementById:get,querySelectorAll:()=>[]},
    location:{origin:'https://example.invalid',pathname:'/jarvis'},
    console,Intl,Date,Set,Number,Array,String,
  };
  vm.runInNewContext(code,context);
  return {api:context.__api,get,wasSignedOut:()=>signedOut};
}

test('correct non-duplicated token total',()=>{
  const {api}=harness();
  assert.equal(api.totalTokens({input_tokens:6000,output_tokens:2000,cached_tokens:5000,reasoning_tokens:800}),8000);
  assert.equal(api.totalTokens({}),0);
});
test('stale status only flags active runs with last event older than 15 minutes',()=>{
  const {api}=harness();
  const now=Date.parse('2026-10-10T18:00:00Z');
  assert.equal(api.runIsStale({status:'in_progress',last_event_at:'2026-10-10T17:40:00Z'},now),true);
  assert.equal(api.runIsStale({status:'success',last_event_at:'2026-10-10T17:40:00Z'},now),false);
  assert.equal(api.runIsStale({status:'in_progress',last_event_at:'2026-10-10T17:50:00Z'},now),false);
});
test('event responses from previously selected runs cannot overwrite current timeline',async()=>{
  const a=deferred(),b=deferred();
  const {api,get}=harness({events:{'a':a,'b':b}});
  const old={id:'a',github_run_id:1,run_attempt:1,status:'in_progress',phase:'qa'};
  const now={id:'b',github_run_id:2,run_attempt:1,status:'success',phase:'done'};
  const first=api.selectRun(old),second=api.selectRun(now);
  b.resolve({data:[{id:2,occurred_at:'2026-10-10T17:00:00Z',agent:'Reviewer',message:'LATEST'}],error:null});
  await second;
  a.resolve({data:[{id:1,occurred_at:'2026-10-10T16:00:00Z',agent:'Engineer',message:'OLD'}],error:null});
  await first;
  assert.match(get('timeline').innerHTML,/LATEST/);
  assert.doesNotMatch(get('timeline').innerHTML,/OLD/);
});
test('query failures visibly distinguish errors from an empty timeline',async()=>{
  const {api,get}=harness({events:{bad:{data:null,error:{message:'forbidden'}}}});
  await api.selectRun({id:'bad',github_run_id:3,run_attempt:1,status:'in_progress',phase:'testing'});
  assert.match(get('notice').textContent,/Eventi non disponibili/);
  assert.doesNotMatch(get('timeline').innerHTML,/Nessun evento/);
});
test('users without Jarvis admin membership do not enter the dashboard',async()=>{
  const {api,get,wasSignedOut}=harness({admin:null});
  await api.enter();
  assert.equal(wasSignedOut(),true);
  assert.match(get('loginError').textContent,/non autorizzato/);
});
