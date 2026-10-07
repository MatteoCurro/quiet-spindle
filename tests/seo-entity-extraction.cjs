const fs=require('fs'),path=require('path'),assert=require('assert');
const E=require(path.resolve(__dirname,'../scripts/enrich_seo_content_index.cjs'));
const registry=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data/entities/poi.json'),'utf8'));

const byId=new Map(registry.entities.map(x=>[x.id,x]));
assert(byId.has('poi:uv_venice_san_marco'),'San Marco entity missing');
assert(byId.has('poi:uv_venice_rialto_bridge'),'Rialto entity missing');

const index={
  schemaVersion:1,
  articleCount:3,
  articles:[
    {
      url:'https://www.unlockvenice.com/ponte-di-rialto/',
      lang:'it',
      title:'Ponte di Rialto: come leggere il cuore commerciale di Venezia',
      slug:'ponte-di-rialto',
      published:'2026-09-01T10:00:00',
      categories:['Ponti'],
      tags:['Rialto','San Polo'],
      keywords:['ponte','rialto','venezia'],
      excerpt:'Una guida al Ponte di Rialto e ai percorsi intorno al mercato.',
      entities:[]
    },
    {
      url:'https://www.unlockvenice.com/en/st-marks-square/',
      lang:'en',
      title:"St Mark's Square: what to notice before crossing San Marco",
      slug:'st-marks-square',
      published:'2026-09-02T10:00:00',
      categories:['Places'],
      tags:['San Marco'],
      keywords:['mark','square','san','marco'],
      excerpt:"A practical introduction to St Mark's Square in Venice.",
      entities:[]
    },
    {
      url:'https://www.unlockvenice.com/briccole-laguna/',
      lang:'it',
      title:'Le briccole nella laguna veneziana',
      slug:'briccole-laguna',
      published:'2026-09-03T10:00:00',
      categories:['Isole e laguna'],
      tags:['briccole','laguna'],
      keywords:['briccole','laguna'],
      excerpt:'Pali di legno, navigazione e paesaggio lagunare.',
      entities:[]
    }
  ]
};

const enriched=E.enrichIndex(index,registry,{minScore:6,maxEntitiesPerArticle:8,maxTopics:20});
assert.equal(enriched.enrichment.schemaVersion,1);
assert.equal(enriched.articles.length,3);

const rialto=enriched.articles[0];
assert(rialto.entities.includes('poi:uv_venice_rialto_bridge'),'Rialto article did not match Rialto entity');
assert(rialto.topics.some(x=>x==='tag:rialto'),'Rialto tag topic missing');
assert(rialto.topics.some(x=>x.startsWith('entity-category:')),'Rialto entity category topic missing');

const sanMarco=enriched.articles[1];
assert(sanMarco.entities.includes('poi:uv_venice_san_marco'),'English San Marco article did not match stable San Marco entity');

const unrelated=enriched.articles[2];
assert(!unrelated.entities.includes('poi:uv_venice_san_marco'),'Unrelated lagoon article falsely matched San Marco');
assert(!unrelated.entities.includes('poi:uv_venice_rialto_bridge'),'Unrelated lagoon article falsely matched Rialto');

const mini={schemaVersion:1,entities:[
  {id:'poi:low-priority-exact',type:'poi',category:'bridge',priority:1,names:{it:'Ponte Prova'},aliases:{it:[]},editorial:{queries:{it:[]}},seo:{slugs:{it:'ponte-prova'}}},
  {id:'poi:high-priority-weak',type:'poi',category:'square',priority:999,names:{it:'Prova'},aliases:{it:[]},editorial:{queries:{it:[]}},seo:{slugs:{it:'prova'}}}
]};
const ranked=E.enrichArticle({lang:'it',title:'Ponte Prova',categories:[],tags:[],excerpt:'',keywords:[]},mini,{minScore:1,maxEntitiesPerArticle:2});
assert.equal(ranked.entities[0],'poi:low-priority-exact','entity priority overrode a stronger textual match');

const genericVenice=E.enrichArticle({
  lang:'it',
  title:'Chioggia in un giorno: cosa vedere tra calli e laguna',
  categories:['Venezia e laguna'],
  tags:['Venezia','Laguna'],
  excerpt:'Una gita dalla zona di Venezia, utile anche a chi soggiorna a Mestre o arriva in stazione.',
  keywords:['venezia','mestre','stazione','laguna']
},registry,{minScore:6,maxEntitiesPerArticle:8});
for(const id of ['hub:uv_mestre_station','hub:uv_venice_santa_lucia','poi:uv_venice_san_marco','airport:uv_venice_marco_polo']){
  assert(!genericVenice.entities.includes(id),'generic Venice vocabulary falsely matched '+id);
}

const excerptOnly=E.enrichArticle({
  lang:'it',
  title:'Come organizzare una giornata nella laguna',
  categories:['Isole e laguna'],
  tags:['Laguna'],
  excerpt:'Al ritorno puoi passare dalla Stazione Mestre per prendere il treno.',
  keywords:['laguna','treno','mestre']
},registry,{minScore:6,maxEntitiesPerArticle:8});
assert(!excerptOnly.entities.includes('hub:uv_mestre_station'),'excerpt-only mention must confirm, not create, an entity match');

const mestreStation=E.enrichArticle({
  lang:'it',
  title:'Stazione Mestre: come arrivare a Venezia in modo semplice',
  categories:['Trasporti'],
  tags:['Mestre'],
  excerpt:'Partire dalla stazione di Venezia Mestre è una delle soluzioni più pratiche.',
  keywords:['mestre','stazione','venezia','treno']
},registry,{minScore:6,maxEntitiesPerArticle:8});
assert(mestreStation.entities.includes('hub:uv_mestre_station'),'specific Mestre Station title did not match the hub');

const duplicateTerms={schemaVersion:1,entities:[{
  id:'poi:duplicate-terms',type:'poi',category:'bridge',priority:1,
  names:{it:'Ponte Prova'},aliases:{it:['Ponte Prova','Prova']},
  editorial:{queries:{it:['ponte prova','prova ponte']}},
  seo:{slugs:{it:'ponte-prova'}}
}]};
const duplicateScore=E.scoreEntity({
  lang:'it',title:'Ponte Prova: guida pratica',categories:[],tags:[],
  excerpt:'Il Ponte Prova collega due zone.',keywords:['ponte','prova']
},duplicateTerms.entities[0]);
assert(duplicateScore.anchor,'specific title must anchor the match');
assert(duplicateScore.score<20,'equivalent aliases/queries were accumulated instead of taking the strongest source match: '+duplicateScore.score);

const accademiaArt=E.enrichArticle({
  lang:'it',
  title:'La Pietà di Tiziano all’Accademia: luce e materia',
  categories:['Arte'],
  tags:['Accademia','Tiziano'],
  excerpt:'Un capolavoro conservato alle Gallerie dell’Accademia.',
  keywords:['accademia','tiziano','arte']
},registry,{minScore:6,maxEntitiesPerArticle:8});
assert(!accademiaArt.entities.includes('poi:uv_venice_accademia_bridge'),'museum/art use of Accademia falsely matched the bridge');

const accademiaBridge=E.enrichArticle({
  lang:'it',
  title:'Ponte dell’Accademia: il ponte di legno sul Canal Grande',
  categories:['Ponti'],
  tags:['Accademia'],
  excerpt:'Il Ponte dell’Accademia collega le due rive del Canal Grande.',
  keywords:['ponte','accademia','canal','grande']
},registry,{minScore:6,maxEntitiesPerArticle:8});
assert(accademiaBridge.entities.includes('poi:uv_venice_accademia_bridge'),'specific Accademia bridge title did not match bridge entity');

const marcoPoloPerson=E.enrichArticle({
  lang:'it',
  title:'Marco Polo e la memoria veneziana dietro Rialto',
  categories:['Storia'],
  tags:['Marco Polo'],
  excerpt:'Un itinerario sulle tracce del mercante veneziano.',
  keywords:['marco','polo','storia','venezia']
},registry,{minScore:6,maxEntitiesPerArticle:8});
assert(!marcoPoloPerson.entities.includes('airport:uv_venice_marco_polo'),'historical Marco Polo article falsely matched airport');

const marcoPoloAirport=E.enrichArticle({
  lang:'it',
  title:'Aeroporto Marco Polo: come arrivare a Venezia',
  categories:['Trasporti'],
  tags:['Aeroporto Venezia'],
  excerpt:'Dall’aeroporto Marco Polo puoi raggiungere Venezia via bus o acqua.',
  keywords:['aeroporto','marco','polo','venezia']
},registry,{minScore:6,maxEntitiesPerArticle:8});
assert(marcoPoloAirport.entities.includes('airport:uv_venice_marco_polo'),'airport-context Marco Polo title did not match airport entity');

const dorsoduroOnly=E.enrichArticle({
  lang:'it',
  title:'Dorsoduro a piedi: calli, campi e silenzio',
  categories:['Quartieri'],
  tags:['Dorsoduro'],
  excerpt:'Un itinerario lento nel sestiere di Dorsoduro.',
  keywords:['dorsoduro','venezia']
},registry,{minScore:6,maxEntitiesPerArticle:8});
assert(!dorsoduroOnly.entities.includes('poi:uv_venice_peggy_guggenheim'),'editorial query Dorsoduro must not create Peggy Guggenheim identity');
assert(!dorsoduroOnly.entities.includes('poi:uv_venice_accademia_bridge'),'editorial query Dorsoduro must not create Accademia bridge identity');

console.log('RESULT: SEO entity/topic extraction uses contextual identity anchors, blocks broad editorial-query leakage and preserves specific matches.');
