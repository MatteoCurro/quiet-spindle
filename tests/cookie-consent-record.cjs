const assert=require('node:assert/strict');
global.window=globalThis;
const mem=new Map();
global.localStorage={getItem:k=>mem.has(k)?mem.get(k):null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k)};
global.document={};
require('../js/identity/storage.js');
require('../js/identity/stores.js');
require('../js/identity/consent.js');

const consent=UVConsent.create({store:UVIdentityStores.create({adapter:UVIdentityStorage.createLocal()}).consent,clock:()=>123456});
assert.equal(consent.allows('analytics'),false);
let a=consent.set('analytics','denied',{policyVersion:'privacy-v1',source:'cookie_reject'});
assert.equal(a.status,'denied');assert.equal(a.policy_version,'privacy-v1');assert.equal(a.timestamp,123456);
a=consent.set('analytics','granted',{policyVersion:'privacy-v1',source:'cookie_settings'});
assert.equal(consent.allows('analytics'),true);assert.equal(a.source,'cookie_settings');
consent.set('marketing','denied',{policyVersion:'privacy-v1',source:'cookie_settings'});
assert.equal(consent.get('marketing').status,'denied');
console.log('cookie-consent-record: explicit default-off, versioned grant/deny evidence passed');
