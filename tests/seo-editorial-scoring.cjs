const fs=require('fs'),path=require('path'),assert=require('assert');
const S=require(path.resolve(__dirname,'../scripts/score_seo_related_content.cjs'));

const registry={
  schemaVersion:1,
  locales:['it','en','fr','de'],
  entities:[
    {
      id:'poi:test-rialto',type:'poi',category:'bridge',priority:98,
      names:{it:'Ponte di Rialto',en:'Rialto Bridge'},
      aliases:{it:['Rialto','Ponte Rialto'],en:['Rialto']},
      seo:{slugs:{it:'ponte-di-rialto',en:'rialto-bridge'}},
      editorial:{queries:{it:['ponte di rialto','rialto venezia'],en:['rialto bridge','rialto venice']}}
    },
    {
      id:'hub:test-mestre',type:'transport_hub',category:'rail_station',priority:99,
      names:{it:'Stazione Venezia Mestre'},
      aliases:{it:['Mestre FS','Stazione Mestre','Venezia Mestre']},
      seo:{slugs:{it:'stazione-venezia-mestre'}},
      editorial:{queries:{it:['stazione mestre','mestre venezia treno']}}
    }
  ]
};

const index={
  schemaVersion:1,
  articles:[
    {
      url:'https://example.test/rialto-bridge/',lang:'it',
      title:'Ponte di Rialto: storia e come arrivare',slug:'ponte-di-rialto',
      published:'2024-01-01T10:00:00Z',
      categories:['Ponti'],tags:['Rialto'],keywords:['ponte','rialto','venezia'],
      excerpt:'Guida completa al Ponte di Rialto.',entities:['poi:test-rialto'],
      topics:['category:ponti','tag:rialto','entity-category:bridge']
    },
    {
      url:'https://example.test/mercato-rialto/',lang:'it',
      title:'Mercato di Rialto: cosa vedere la mattina',slug:'mercato-rialto',
      published:'2026-09-10T10:00:00Z',
      categories:['Mercati'],tags:['Rialto'],keywords:['rialto','mercato'],
      excerpt:'Tra bancarelle e bacari nel cuore di Rialto.',entities:[],
      topics:['category:mercati','tag:rialto']
    },
    {
      url:'https://example.test/venezia-due-giorni/',lang:'it',
      title:'Venezia in due giorni',slug:'venezia-due-giorni',
      published:'2026-09-20T10:00:00Z',
      categories:['Itinerari'],tags:['Venezia'],keywords:['venezia','itinerario'],
      excerpt:'Il secondo giorno puoi passare anche da Rialto prima di San Marco.',entities:[],
      topics:['category:itinerari']
    },
    {
      url:'https://example.test/venezia-oggi/',lang:'it',
      title:'Cosa fare a Venezia oggi',slug:'venezia-oggi',
      published:'2026-09-24T10:00:00Z',
      categories:['Venezia'],tags:['Venezia'],keywords:['venezia'],
      excerpt:'Idee generiche per visitare la città.',entities:[],
      topics:['category:venezia']
    },
    {
      url:'https://example.test/en/rialto/',lang:'en',
      title:'Rialto Bridge guide',slug:'rialto-bridge-guide',
      published:'2026-09-24T10:00:00Z',
      categories:['Bridges'],tags:['Rialto'],keywords:['rialto','bridge'],
      excerpt:'Guide to Rialto Bridge.',entities:['poi:test-rialto'],
      topics:['entity-category:bridge']
    },
    {
      url:'https://example.test/mestre-base/',lang:'it',
      title:'Dormire a Mestre per visitare Venezia',slug:'dormire-mestre',
      published:'2026-09-01T10:00:00Z',
      categories:['Mestre'],tags:['Mestre'],keywords:['mestre','venezia','treno'],
      excerpt:'Mestre è una base pratica e ben collegata con Venezia.',entities:[],
      topics:['category:mestre']
    }
  ]
};

const now=new Date('2026-09-25T12:00:00Z');

assert.deepEqual(S.distinctiveTokens('rialto venezia'),['rialto']);
assert.deepEqual(S.distinctiveTokens('venezia trasporti'),[]);

const ranked=S.rankRelated(index,registry,'poi:test-rialto','it',{limit:6,minScore:12,now});
assert.equal(ranked.results.length,3,'generic Venice-only article or cross-language article leaked into Rialto ranking');
assert.equal(ranked.results[0].url,'https://example.test/rialto-bridge/','exact entity article must rank first even when older');
assert.equal(ranked.results[1].url,'https://example.test/mercato-rialto/','strong Rialto area article must rank above a brief excerpt mention');
assert.equal(ranked.results[2].url,'https://example.test/venezia-due-giorni/','brief but real Rialto mention should remain a low-ranked fallback');
assert(ranked.results.every(x=>x.lang==='it'),'cross-language result leaked into same-language ranking');
assert(ranked.results[0].signals.some(x=>x.type==='entity-exact'),'exact entity signal missing');
assert(ranked.results[1].signals.some(x=>x.type==='identity-phrase'),'Rialto alias/title signal missing');
assert(ranked.results[0].score>ranked.results[1].score&&ranked.results[1].score>ranked.results[2].score,'relevance ordering is incorrect');

const mestre=S.rankRelated(index,registry,'hub:test-mestre','it',{limit:6,minScore:12,now});
assert(mestre.results.some(x=>x.url==='https://example.test/mestre-base/'),'editorial query coverage should surface a useful Mestre area article without falsely marking exact identity');
assert(!mestre.results.find(x=>x.url==='https://example.test/mestre-base/').exactEntity,'related Mestre article was incorrectly marked as exact entity');

const overrides={
  schemaVersion:1,
  entities:{
    'poi:test-rialto':{
      it:{
        include:['venezia-oggi'],
        exclude:['https://example.test/rialto-bridge/']
      }
    }
  }
};
assert.equal(S.validateOverrides(overrides,index,registry),true,'valid manual overrides rejected');
const overridden=S.rankRelated(index,registry,'poi:test-rialto','it',{limit:6,minScore:12,now,overrides});
assert.equal(overridden.results[0].url,'https://example.test/venezia-oggi/','manual include must be forced to the top even below semantic threshold');
assert.equal(overridden.results[0].manualInclude,true,'forced include missing manual flag');
assert(overridden.results[0].signals.some(x=>x.type==='manual-include'),'manual include signal missing');
assert(!overridden.results.some(x=>x.url==='https://example.test/rialto-bridge/'),'manual exclude did not remove exact-entity article');
assert.deepEqual(overridden.overridesApplied,{include:1,exclude:1});

const conflictOverrides={
  schemaVersion:1,
  entities:{
    'poi:test-rialto':{
      it:{
        include:['mercato-rialto'],
        exclude:['mercato-rialto']
      }
    }
  }
};
const conflict=S.rankRelated(index,registry,'poi:test-rialto','it',{limit:6,minScore:12,now,overrides:conflictOverrides});
assert(!conflict.results.some(x=>x.slug==='mercato-rialto'),'exclude must win when the same article appears in include and exclude');

const orderedOverrides={
  schemaVersion:1,
  entities:{
    'poi:test-rialto':{
      it:{
        include:['venezia-oggi','venezia-due-giorni'],
        exclude:[]
      }
    }
  }
};
const ordered=S.rankRelated(index,registry,'poi:test-rialto','it',{limit:2,minScore:12,now,overrides:orderedOverrides});
assert.deepEqual(ordered.results.map(x=>x.slug),['venezia-oggi','venezia-due-giorni'],'manual include order must be preserved ahead of score');

assert.throws(
  ()=>S.validateOverrides({schemaVersion:1,entities:{'poi:test-rialto':{it:{include:['https://example.test/en/rialto/'],exclude:[]}}}},index,registry),
  /must resolve to exactly one it article/,
  'cross-language manual include must fail validation'
);
assert.throws(
  ()=>S.validateOverrides({schemaVersion:1,entities:{'poi:test-rialto':{it:{include:['missing-slug'],exclude:[]}}}},index,registry),
  /must resolve to exactly one it article/,
  'unknown manual article ref must fail validation'
);
assert.throws(
  ()=>S.validateOverrides({schemaVersion:1,entities:{'poi:missing':{it:{include:[],exclude:[]}}}},index,registry),
  /unknown entity/,
  'unknown override entity must fail validation'
);

const oldSpecific={
  ...index.articles[1],
  url:'https://example.test/old-rialto/',
  title:'Rialto: guida del mercato',
  published:'2020-01-01T10:00:00Z'
};
const freshGeneric={
  ...index.articles[3],
  url:'https://example.test/fresh-generic/',
  published:'2026-09-25T10:00:00Z'
};
const oldScore=S.scoreArticle(oldSpecific,registry.entities[0],'it',{minScore:12,now});
const freshScore=S.scoreArticle(freshGeneric,registry.entities[0],'it',{minScore:12,now});
assert(oldScore.score>freshScore.score,'freshness must never rescue an unrelated article above specific relevance');

const realRegistry=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data/entities/poi.json'),'utf8'));
const realIndex=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../seo/content-index/articles.json'),'utf8'));
const realOverrides=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../seo/content-index/related-overrides.json'),'utf8'));
assert.equal(S.validateOverrides(realOverrides,realIndex,realRegistry),true,'versioned real override file failed validation');

for(const entityId of ['poi:uv_venice_san_marco','poi:uv_venice_rialto_bridge']){
  const real=S.rankRelated(realIndex,realRegistry,entityId,'it',{limit:6,minScore:12,now});
  assert(real.results.length>0,'real corpus returned no editorial candidates for '+entityId);
  assert(real.results.length<=6,'real corpus exceeded requested limit for '+entityId);
  assert(real.results.every(x=>x.lang==='it'),'real corpus returned cross-language candidate for '+entityId);
  for(let i=1;i<real.results.length;i++)assert(real.results[i-1].score>=real.results[i].score,'real ranking is not score-descending for '+entityId);
  console.log('REAL RELATED',entityId,real.results.slice(0,3).map(x=>({score:x.score,title:x.title,exact:x.exactEntity})));
}

console.log('RESULT: editorial scoring supports validated manual include/exclude overrides, same-language safety, deterministic ordering and real-corpus smoke.');
