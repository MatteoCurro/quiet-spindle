#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');

const REQUIRED_LOCALES=['it','en','fr','de'];
const STATES=new Set(['planned','draft','ready']);
const SLUG_RE=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'))}
function assert(condition,message){if(!condition)throw new Error(message)}
function sameSet(a,b){return a.length===b.length&&a.every(x=>b.includes(x))}
function validateInternalLinking(rule,label){
  assert(rule&&typeof rule==='object',label+' internalLinking missing');
  assert(Number.isInteger(rule.min)&&Number.isInteger(rule.max)&&rule.min>=1&&rule.max>=rule.min,label+' invalid internal link bounds');
  assert(rule.max<=6,label+' internal link max is too high');
  assert(rule.sameLanguageOnly===true,label+' internal links must be same-language');
  assert(rule.crawlableAnchors===true,label+' internal links must be crawlable HTML anchors');
  assert(rule.descriptiveAnchorText===true,label+' internal links require descriptive anchors');
  assert(Array.isArray(rule.strategy)&&rule.strategy.length>0,label+' internal link strategy missing');
}
function validateCommonManifest(manifest,kind){
  assert(manifest.schemaVersion===1,kind+' manifest schemaVersion must be 1');
  assert(manifest.kind===kind,kind+' manifest kind mismatch');
  assert(Array.isArray(manifest.locales)&&sameSet(manifest.locales,REQUIRED_LOCALES),kind+' manifest must support it/en/fr/de');
  assert(manifest.pathSegments&&typeof manifest.pathSegments==='object',kind+' pathSegments missing');
  const segments=[];
  for(const lang of REQUIRED_LOCALES){
    const segment=manifest.pathSegments[lang];
    assert(typeof segment==='string'&&SLUG_RE.test(segment),kind+' invalid path segment for '+lang);
    segments.push(segment);
  }
  assert(new Set(segments).size===segments.length,kind+' path segments must be unique by locale');
  validateInternalLinking(manifest.internalLinking,kind);
  assert(Array.isArray(manifest.pages)&&manifest.pages.length>0,kind+' pages missing');
}
function validatePageCommon(page,manifest,seenIds,seenCopyKeys){
  assert(typeof page.id==='string'&&page.id.startsWith('seo-'),'Invalid page id '+(page.id||''));
  assert(!seenIds.has(page.id),'Duplicate landing id '+page.id);seenIds.add(page.id);
  assert(typeof page.copyKey==='string'&&SLUG_RE.test(page.copyKey),'Invalid copyKey for '+page.id);
  assert(!seenCopyKeys.has(page.copyKey),'Duplicate copyKey '+page.copyKey);seenCopyKeys.add(page.copyKey);
  assert(typeof page.enabled==='boolean','enabled must be boolean for '+page.id);
  assert(STATES.has(page.contentState),'Invalid contentState for '+page.id);
  assert(Array.isArray(page.languages)&&page.languages.length>0,'languages missing for '+page.id);
  assert(page.languages.every(l=>manifest.locales.includes(l)),'Unsupported language in '+page.id);
  assert(new Set(page.languages).size===page.languages.length,'Duplicate language in '+page.id);
  assert(typeof page.priority==='number'&&page.priority>=0&&page.priority<=1,'Invalid priority for '+page.id);
  assert(page.related&&Number.isInteger(page.related.limit)&&page.related.limit>=3&&page.related.limit<=6,'Related limit must be 3–6 for '+page.id);
}
function validatePlaceManifest(manifest,registry,seenIds,seenCopyKeys){
  validateCommonManifest(manifest,'place');
  const byId=new Map(registry.entities.map(e=>[e.id,e]));
  for(const page of manifest.pages){
    validatePageCommon(page,manifest,seenIds,seenCopyKeys);
    assert(typeof page.entity==='string'&&byId.has(page.entity),'Unknown place entity '+page.entity+' in '+page.id);
    const entity=byId.get(page.entity);
    for(const lang of page.languages){
      assert(entity.names?.[lang],'Missing localized entity name '+page.entity+' '+lang);
      assert(entity.seo?.slugs?.[lang]&&SLUG_RE.test(entity.seo.slugs[lang]),'Missing/invalid entity SEO slug '+page.entity+' '+lang);
    }
  }
}
function validateRouteManifest(manifest,routeCatalog,seenIds,seenCopyKeys){
  validateCommonManifest(manifest,'route');
  const byId=new Map(routeCatalog.routes.map(r=>[r.id,r]));
  const slugs=Object.fromEntries(REQUIRED_LOCALES.map(l=>[l,new Set()]));
  for(const page of manifest.pages){
    validatePageCommon(page,manifest,seenIds,seenCopyKeys);
    assert(typeof page.route==='string'&&byId.has(page.route),'Unknown route '+page.route+' in '+page.id);
    const route=byId.get(page.route);
    assert(page.slugs&&typeof page.slugs==='object','Localized slugs missing for '+page.id);
    for(const lang of page.languages){
      assert(route.names?.[lang],'Missing route name '+page.route+' '+lang);
      const slug=page.slugs[lang];
      assert(typeof slug==='string'&&SLUG_RE.test(slug),'Missing/invalid route slug '+page.id+' '+lang);
      assert(!slugs[lang].has(slug),'Duplicate route slug '+lang+': '+slug);slugs[lang].add(slug);
    }
  }
}
function sectionIds(contract,kind){return new Set((contract?.[kind]?.sections||[]).map(s=>s.id))}
function validateCopyContract(contract){
  assert(contract.schemaVersion===1,'Copy contract schemaVersion must be 1');
  assert(Array.isArray(contract.locales)&&sameSet(contract.locales,REQUIRED_LOCALES),'Copy contract must support it/en/fr/de');
  assert(typeof contract.storagePattern==='string'&&contract.storagePattern.includes('{kind}')&&contract.storagePattern.includes('{copyKey}')&&contract.storagePattern.includes('{lang}'),'Copy storagePattern missing placeholders');
  assert(contract.principles?.mobilityFirst===true,'Copy contract must remain mobility-first');
  assert(contract.principles?.noHistoricalDuplication===true,'Copy contract must prevent editorial duplication');
  assert(contract.principles?.noAiOnlyMarkup===true,'Copy contract must forbid AI-only markup');
  assert(contract.aiSearchReadability?.directAnswerNearTop===true,'Copy contract must require a direct answer near top');
  assert(contract.aiSearchReadability?.selfContainedAnswers===true,'Copy contract must require self-contained answers');
  assert(contract.questionsAndAnswers?.visibleOnPage===true,'Q&A must be visible content');
  assert(contract.questionsAndAnswers?.structuredDataRequired===false,'FAQ/Q&A structured data must not be required');
  const transport=contract.internalLinking?.transportLandingLinks;
  assert(transport?.required===true&&transport.min>=2&&transport.max<=4,'Transport internal-link bounds must be 2–4');
  assert(transport.sameLanguageOnly===true&&transport.crawlableHtmlAnchors===true&&transport.descriptiveAnchorText===true,'Transport internal-link contract incomplete');
  const editorial=contract.internalLinking?.editorialArticleLinks;
  assert(editorial?.required===true&&editorial.min>=3&&editorial.max<=6&&editorial.sameLanguageOnly===true,'Editorial related-link contract incomplete');

  const required={
    place:['direct_answer','transport_options','practical_tips','faq','related_transport','related_reading'],
    route:['direct_answer','options','which_option','practical_tips','faq','related_transport','related_reading']
  };
  for(const kind of ['place','route']){
    const ids=sectionIds(contract,kind);
    for(const id of required[kind])assert(ids.has(id),'Copy contract '+kind+' missing section '+id);
    const faq=(contract[kind].sections||[]).find(s=>s.id==='faq');
    assert(faq.required===true&&faq.type==='question_answer','FAQ section must be required Q&A for '+kind);
    assert(faq.recommendedItems?.min>=3,'FAQ count too low for '+kind);
  }
}
function validateAll({places,routes,registry,routeCatalog,copyContract}){
  assert(registry?.schemaVersion===1&&Array.isArray(registry.entities),'Invalid entity registry');
  assert(routeCatalog?.schemaVersion===1&&Array.isArray(routeCatalog.routes),'Invalid route catalog');
  const seenIds=new Set(),seenCopyKeys=new Set();
  validatePlaceManifest(places,registry,seenIds,seenCopyKeys);
  validateRouteManifest(routes,routeCatalog,seenIds,seenCopyKeys);
  validateCopyContract(copyContract);
  return {
    placePages:places.pages.length,
    routePages:routes.pages.length,
    totalPages:places.pages.length+routes.pages.length,
    readyPages:[...places.pages,...routes.pages].filter(p=>p.enabled&&p.contentState==='ready').length
  };
}
function main(){
  const root=process.cwd();
  const result=validateAll({
    places:readJson(path.join(root,'seo/pages/places.json')),
    routes:readJson(path.join(root,'seo/pages/routes.json')),
    registry:readJson(path.join(root,'data/entities/poi.json')),
    routeCatalog:readJson(path.join(root,'data/deep-links/routes.json')),
    copyContract:readJson(path.join(root,'seo/content/COPY-CONTRACT.json'))
  });
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(require.main===module){try{main()}catch(error){console.error(error.stack||error);process.exitCode=1}}

module.exports={REQUIRED_LOCALES,STATES,SLUG_RE,validateInternalLinking,validateCommonManifest,validatePlaceManifest,validateRouteManifest,validateCopyContract,validateAll};
