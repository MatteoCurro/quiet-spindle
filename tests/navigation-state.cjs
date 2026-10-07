const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js','app','navigation-state.js'),'utf8');
const sandbox={};
sandbox.window=sandbox;
sandbox.globalThis=sandbox;
vm.runInContext(source,vm.createContext(sandbox),{filename:'js/app/navigation-state.js'});

const N=sandbox.UVTransitNavigationState;
assert(N,'navigation state module must be exported');

assert.equal(N.descriptor('map').presentation,'map');
assert.equal(N.descriptor('lines').presentation,'fullscreen');
assert.equal(N.descriptor('detail').presentation,'context');
assert.equal(N.descriptor('journey').domain,'journey');
assert.equal(N.descriptor('navigation').presentation,'immersive');
assert.equal(N.descriptor('navigation').parent,'itinerary');
assert.equal(N.descriptor('profile').domain,'profile');
assert.equal(N.descriptor('account').domain,'profile');
assert.equal(N.descriptor('account').parent,'profile');
assert.equal(N.normalize(null),'map');

const nav=N.create();
assert.equal(nav.current(),'map');

nav.transition('journey');
assert.equal(nav.current(),'journey');
assert.deepEqual(Array.from(nav.snapshot().stack),['map']);

nav.transition('itinerary');
assert.equal(nav.current(),'itinerary');
nav.transition('navigation');
assert.equal(nav.current(),'navigation');
nav.back();
assert.equal(nav.current(),'itinerary');
nav.back();
assert.equal(nav.current(),'journey');
nav.back();
assert.equal(nav.current(),'map');

nav.transition('profile');
nav.transition('account');
nav.back();
assert.equal(nav.current(),'profile');
nav.transition('more');
nav.back();
assert.equal(nav.current(),'profile');
nav.close();
assert.equal(nav.current(),'map');
assert.equal(nav.snapshot().stack.length,0);

nav.transition('detail');
assert.equal(nav.descriptor().presentation,'context');
nav.back();
assert.equal(nav.current(),'map');

nav.transition('profile');
nav.transition('driver-home');
nav.transition('driver-codes');
nav.back();
assert.equal(nav.current(),'driver-home');
nav.back();
assert.equal(nav.current(),'profile');

const before=nav.snapshot().stack.length;
nav.transition(nav.current());
assert.equal(nav.snapshot().stack.length,before,'same-state transition must not duplicate history');

nav.reset('alerts');
assert.equal(nav.current(),'alerts');
assert.equal(nav.snapshot().stack.length,0);
nav.back();
assert.equal(nav.current(),'map','parent fallback must work with an empty stack');

assert.throws(()=>N.descriptor('missing'),/Unknown navigation state/);
assert.throws(()=>nav.transition('missing'),/Unknown navigation state/);

process.stdout.write('navigation state: registry, stack, parent fallback and presentation contracts OK\n');
