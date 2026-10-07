#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const Resolver=require('./resolve_seo_placeholders.cjs');

function esc(value=''){
  return String(value).replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);
}
function inline(value=''){
  let out=esc(value);
  out=out.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  return out;
}
function unquote(value=''){
  const v=String(value).trim();
  if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))return v.slice(1,-1);
  if(v==='true')return true;
  if(v==='false')return false;
  if(/^\d+(?:\.\d+)?$/.test(v))return Number(v);
  return v;
}
function parseFrontmatter(source){
  const match=String(source).match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if(!match)throw new Error('Markdown source is missing YAML frontmatter');
  const meta={};
  for(const line of match[1].split('\n')){
    if(/^\s+-\s+/.test(line))continue;
    const m=line.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
    if(m)meta[m[1]]=unquote(m[2]);
  }
  return {meta,body:match[2].trim()};
}
function stripBrand(title=''){
  return String(title).replace(/\s+[—|-]\s+Unlock Venice\s*$/i,'').trim();
}
function normalizeOrigin(value='https://www.unlockvenice.com'){
  const origin=String(value||'https://www.unlockvenice.com').trim().replace(/\/+$/,'');
  if(!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(origin))throw new Error('Invalid SEO site origin '+origin);
  return origin;
}
function buildSeoLinks(pageId,lang,ctx,options={}){
  const context=Resolver.pageContext(pageId,ctx);
  if(!context.page.languages?.includes(lang))throw new Error('Landing '+pageId+' does not support '+lang);
  const origin=normalizeOrigin(options.siteOrigin);
  const hrefFor=locale=>origin+Resolver.landingHref(context,locale,ctx,{transportRoot:options.transportRoot});
  const canonical=hrefFor(lang);
  const alternates=context.page.languages.map(locale=>({lang:locale,href:hrefFor(locale)}));
  const defaultLocale=context.page.languages.includes('it')?'it':context.page.languages[0];
  if(defaultLocale)alternates.push({lang:'x-default',href:hrefFor(defaultLocale)});
  return {canonical,alternates};
}
function renderHreflangLinks(items=[]){
  return items.map(item=>'<link rel="alternate" hreflang="'+esc(item.lang)+'" href="'+esc(item.href)+'">').join('\n  ');
}
function localeStrings(ctx,lang){
  const strings=ctx.landingI18n?.locales?.[lang];
  if(!strings)throw new Error('Missing landing UI locale '+lang);
  return strings;
}
function reasonLabel(reason='',strings){
  return strings?.reason?.[reason]||strings?.reason?.fallback||reason;
}
function renderJourney(payload,strings){
  return [
    '<aside class="uv-journey">',
      '<div class="uv-journey-copy">',
        '<strong>'+esc(strings.journey.heading)+'</strong>',
        '<small>'+esc(strings.journey.helper)+'</small>',
      '</div>',
      '<a href="'+esc(payload.href)+'">'+esc(payload.label)+'</a>',
    '</aside>'
  ].join('');
}
function interpolate(template,vars={}){
  return String(template||'').replace(/\{([a-zA-Z0-9_]+)\}/g,(_,key)=>vars[key]??'');
}
function renderFareTable(payload,strings){
  const items=payload.items||[];
  if(!items.length)return '';
  const rows=items.map(item=>[
    '<div class="uv-fare-row">',
      '<div class="uv-fare-main">',
        '<strong>'+esc(item.label)+'</strong>',
        (item.note?'<small>'+esc(item.note)+'</small>':''),
      '</div>',
      '<div class="uv-fare-price">',
        '<strong>'+esc(item.displayPrice)+'</strong>',
        (item.sourceType==='indicative-third-party'?'<span>'+esc(strings.fares.indicative)+'</span>':''),
      '</div>',
    '</div>'
  ].join('')).join('');
  const sources=[...new Map(items.map(i=>[i.sourceUrl,i])).values()].map(i=>
    '<a href="'+esc(i.sourceUrl)+'" rel="nofollow noopener">'+esc(interpolate(strings.fares.source,{operator:i.operator}))+'</a>'
  ).join(' · ');
  return [
    '<aside class="uv-fares" aria-label="'+esc(strings.fares.aria)+'">',
      '<div class="uv-fares-head">',
        '<div><span>'+esc(strings.fares.eyebrow)+'</span><h3>'+esc(strings.fares.heading)+'</h3></div>',
        '<small>'+esc(interpolate(strings.fares.verified,{date:payload.lastReviewed}))+'</small>',
      '</div>',
      '<div class="uv-fare-list">'+rows+'</div>',
      '<p class="uv-fare-note">'+esc(strings.fares.note)+' '+sources+'</p>',
    '</aside>'
  ].join('');
}
function renderRelatedTransport(payload,kind='route',strings,options={}){
  const items=payload.items||[];
  const cards=items.map(item=>{
    if(options.clickable){
      return [
        '<a class="uv-link-preview uv-link-live" href="'+esc(item.href)+'">',
          '<small>'+esc(reasonLabel(item.reason,strings))+'</small>',
          '<strong>'+esc(item.label)+'</strong>',
        '</a>'
      ].join('');
    }
    return [
      '<div class="uv-link-preview" data-target="'+esc(item.href)+'">',
        '<small>'+esc(reasonLabel(item.reason,strings))+'</small>',
        '<strong>'+esc(item.label)+'</strong>',
        '<em>'+esc(strings.relatedTransport.planned)+'</em>',
      '</div>'
    ].join('');
  }).join('');
  const description=kind==='place'?strings.relatedTransport.placeDescription:strings.relatedTransport.routeDescription;
  return [
    '<section class="uv-wide-section" aria-labelledby="related-transport-title">',
      '<div class="uv-wide-head">',
        '<h2 id="related-transport-title">'+esc(strings.relatedTransport.heading)+'</h2>',
        '<p>'+esc(description)+'</p>',
      '</div>',
      '<div class="uv-link-grid">'+cards+'</div>',
    '</section>'
  ].join('');
}
function renderRelatedReading(payload,kind='route',strings){
  const items=payload.items||[];
  const cards=items.map(item=>[
    '<a class="uv-reading-card" href="'+esc(item.url)+'">',
      '<span class="uv-reading-label">'+esc(strings.relatedReading.label)+'</span>',
      '<h3>'+esc(stripBrand(item.title))+'</h3>',
    '</a>'
  ].join('')).join('');
  const description=kind==='place'?strings.relatedReading.placeDescription:strings.relatedReading.routeDescription;
  return [
    '<section class="uv-wide-section" aria-labelledby="related-reading-title">',
      '<div class="uv-wide-head">',
        '<h2 id="related-reading-title">'+esc(strings.relatedReading.heading)+'</h2>',
        '<p>'+esc(description)+'</p>',
      '</div>',
      '<div class="uv-reading-grid">'+cards+'</div>',
    '</section>'
  ].join('');
}
function renderRouteHero(context,lang,ctx,strings){
  const route=ctx.routeCatalog.routes.find(r=>r.id===context.page.route);
  if(!route)throw new Error('Route missing from route catalog: '+context.page.route);
  const entities=new Map(ctx.registry.entities.map(e=>[e.id,e]));
  const origin=entities.get(route.from),destination=entities.get(route.to);
  if(!origin||!destination)throw new Error('Route endpoints missing for '+route.id);
  const originName=origin.names?.[lang]||origin.names?.it||route.from;
  const destinationName=destination.names?.[lang]||destination.names?.it||route.to;
  return {
    eyebrow:strings.route.eyebrow,
    html:[
      '<aside class="uv-route-card" aria-label="'+esc(strings.route.kicker)+'">',
        '<div class="uv-route-kicker">'+esc(strings.route.kicker)+'</div>',
        '<div class="uv-route-points">',
          '<div class="uv-route-point"><span>'+esc(originName)+'</span></div>',
          '<div class="uv-route-point"><span>'+esc(destinationName)+'</span></div>',
        '</div>',
      '</aside>'
    ].join('')
  };
}
function renderPlaceHero(context,lang,ctx,strings){
  const entity=ctx.registry.entities.find(e=>e.id===context.page.entity);
  if(!entity)throw new Error('Place entity missing from registry: '+context.page.entity);
  const name=entity.names?.[lang]||entity.names?.it||context.page.entity;
  return {
    eyebrow:strings.place.eyebrow,
    html:[
      '<aside class="uv-route-card uv-place-card" aria-label="'+esc(strings.place.kicker)+'">',
        '<div class="uv-route-kicker">'+esc(strings.place.kicker)+'</div>',
        '<div class="uv-route-points">',
          '<div class="uv-route-point"><span>'+esc(name)+'</span></div>',
        '</div>',
        '<p class="uv-place-hint">'+esc(strings.place.hint)+'</p>',
      '</aside>'
    ].join('')
  };
}
function renderHero(context,lang,ctx,strings){
  return context.kind==='place'?renderPlaceHero(context,lang,ctx,strings):renderRouteHero(context,lang,ctx,strings);
}

function firstParagraph(body){
  const lines=body.split('\n');
  const acc=[];
  let i=0;
  while(i<lines.length&&!lines[i].trim())i++;
  while(i<lines.length&&lines[i].trim()){acc.push(lines[i].trim());i++}
  const rest=lines.slice(i).join('\n').replace(/^\s+/,'');
  return {lead:acc.join(' '),rest};
}
function renderBody(body,pageId,lang,ctx,options={}){
  const strings=localeStrings(ctx,lang);
  const lines=body.split('\n');
  const out=[];
  let paragraph=[];
  let list=[];
  let inFaq=false;
  let faqItemOpen=false;
  let skipGeneratedSection=false;

  function flushParagraph(){
    if(!paragraph.length)return;
    const text=paragraph.join(' ');
    out.push('<p>'+inline(text)+'</p>');
    paragraph=[];
  }
  function flushList(){
    if(!list.length)return;
    out.push('<ul>'+list.map(item=>'<li>'+inline(item)+'</li>').join('')+'</ul>');
    list=[];
  }
  function closeFaqItem(){
    flushParagraph();flushList();
    if(faqItemOpen){out.push('</article>');faqItemOpen=false}
  }
  function closeFaq(){
    closeFaqItem();
    if(inFaq){out.push('</div>');inFaq=false}
  }

  for(let i=0;i<lines.length;i++){
    const raw=lines[i],line=raw.trim();
    if(!line){flushParagraph();flushList();continue}

    if(/^##\s+/.test(line)){
      flushParagraph();flushList();
      const title=line.replace(/^##\s+/,'');
      if(title===strings.sections.relatedTransport||title===strings.sections.relatedReading){
        closeFaq();skipGeneratedSection=true;continue;
      }
      skipGeneratedSection=false;
      if(title===strings.sections.faq){
        closeFaq();
        out.push('<h2>'+esc(title)+'</h2><div class="uv-faq">');
        inFaq=true;continue;
      }
      closeFaq();
      out.push('<h2>'+esc(title)+'</h2>');
      continue;
    }

    if(skipGeneratedSection)continue;

    if(/^###\s+/.test(line)){
      flushParagraph();flushList();
      const title=line.replace(/^###\s+/,'');
      if(inFaq){
        closeFaqItem();
        out.push('<article class="uv-faq-item"><h3>'+esc(title)+'</h3>');
        faqItemOpen=true;
      }else{
        out.push('<h3>'+esc(title)+'</h3>');
      }
      continue;
    }

    if(/^\{\{/.test(line)&&/\}\}$/.test(line)){
      flushParagraph();flushList();
      const parsed=Resolver.parsePlaceholder(line);
      const payload=Resolver.resolvePlaceholder(line,pageId,lang,ctx,{
        appBase:options.appBase||'/trasporti',
        includePlanned:options.includePlanned!==false,
        now:options.now||new Date()
      });
      if(parsed.name==='journey_cta')out.push(renderJourney(payload,strings));
      else if(parsed.name==='fare_table')out.push(renderFareTable(payload,strings));
      continue;
    }

    if(/^[-*]\s+/.test(line)){
      flushParagraph();
      list.push(line.replace(/^[-*]\s+/,''));
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph();flushList();closeFaq();
  return out.join('\n');
}
function fillTemplate(template,replacements){
  let html=template;
  for(const [key,value] of Object.entries(replacements)){
    html=html.split('%%'+key+'%%').join(String(value));
  }
  if(/%%[A-Z0-9_]+%%/.test(html))throw new Error('Template contains unresolved tokens');
  return html;
}
function buildLanding(options={}){
  const root=options.root||process.cwd();
  const mode=options.mode==='public'?'public':'preview';
  const isPublic=mode==='public';
  const sourceFile=path.resolve(root,options.source||'seo/content/route/mestre-san-marco/it.md');
  const defaultOut=isPublic
    ?'build/seo-public/trasporti/percorsi/stazione-mestre-piazza-san-marco/index.html'
    :'build/seo-preview/percorsi/stazione-mestre-piazza-san-marco/index.html';
  const outFile=path.resolve(root,options.out||defaultOut);
  const templateFile=path.resolve(root,'seo/templates/landing.html');
  const cssFile=path.resolve(root,'seo/templates/landing.css');
  const ctx=options.ctx||Resolver.loadContext(root);
  const source=fs.readFileSync(sourceFile,'utf8');
  const {meta,body}=parseFrontmatter(source);
  if(isPublic){
    if(meta.status!=='ready')throw new Error('Public landing copy must be ready');
  }else if(meta.status!=='draft'&&meta.status!=='ready'){
    throw new Error('Preview copy must be draft or ready');
  }
  const context=Resolver.pageContext(meta.pageId,ctx);
  if(isPublic&&(!context.page.enabled||context.page.contentState!=='ready')){
    throw new Error('Public landing manifest must be enabled and ready for '+meta.pageId);
  }
  if(meta.kind!==context.kind)throw new Error('Copy kind does not match landing manifest for '+meta.pageId);
  if(context.kind==='route'&&meta.routeId&&meta.routeId!==context.page.route)throw new Error('Copy routeId does not match landing manifest for '+meta.pageId);
  if(context.kind==='place'&&meta.entityId&&meta.entityId!==context.page.entity)throw new Error('Copy entityId does not match landing manifest for '+meta.pageId);
  if(!context.page.languages?.includes(meta.lang))throw new Error('Landing '+meta.pageId+' does not support '+meta.lang);
  const split=firstParagraph(body);
  const includePlanned=!isPublic;
  const blocks=Resolver.resolvePageBlocks(meta.pageId,meta.lang,ctx,{
    appBase:options.appBase||'/trasporti',
    includePlanned,
    now:options.now||new Date()
  });
  const strings=localeStrings(ctx,meta.lang);
  const hero=renderHero(context,meta.lang,ctx,strings);
  const seoLinks=buildSeoLinks(meta.pageId,meta.lang,ctx,options);
  const renderedBody=renderBody(split.rest,meta.pageId,meta.lang,ctx,{...options,includePlanned});
  const template=fs.readFileSync(templateFile,'utf8');
  const previewBarBlock=isPublic?'':'<div class="uv-preview-bar">'+esc(strings.previewBar)+'</div>';
  const assetBase=options.assetBase||(isPublic?'/trasporti/seo-assets':'/seo-preview/assets');
  const html=fillTemplate(template,{
    LANG:esc(strings.htmlLang||meta.lang),
    TITLE:esc(meta.seoTitle),
    DESCRIPTION:esc(meta.metaDescription),
    ROBOTS:isPublic?'index,follow':'noindex,nofollow',
    CANONICAL_URL:esc(seoLinks.canonical),
    HREFLANG_LINKS:renderHreflangLinks(seoLinks.alternates),
    ASSET_BASE:esc(assetBase),
    SKIP:esc(strings.skip),
    PREVIEW_BAR_BLOCK:previewBarBlock,
    HOME_URL:esc(strings.nav.homeUrl),
    ABOUT_URL:esc(strings.nav.aboutUrl),
    TRANSPORT_URL:esc(strings.nav.transportUrl),
    STAY_URL:esc(strings.nav.stayUrl),
    NAV_ABOUT:esc(strings.nav.about),
    NAV_TRANSPORT:esc(strings.nav.transport),
    NAV_STAY:esc(strings.nav.stay),
    PAGE_NOTE:esc(strings.pageNote),
    FOOTER_DESCRIPTION:esc(strings.footer.description),
    FOOTER_DISCOVER:esc(strings.footer.discover),
    FOOTER_PROJECT:esc(strings.footer.project),
    FOOTER_STAY:esc(strings.footer.stay),
    EYEBROW:esc(hero.eyebrow),
    H1:esc(meta.h1),
    LEAD:inline(split.lead),
    HERO_ASIDE:hero.html,
    BODY:renderedBody,
    RELATED_TRANSPORT:renderRelatedTransport(blocks.related_transport,context.kind,strings,{clickable:isPublic}),
    RELATED_READING:renderRelatedReading(blocks.related_reading,context.kind,strings)
  });
  fs.mkdirSync(path.dirname(outFile),{recursive:true});
  fs.writeFileSync(outFile,html);
  const defaultAssetDir=isPublic?'build/seo-public/trasporti/seo-assets':'build/seo-preview/assets';
  const assetDir=path.resolve(root,options.assetDir||defaultAssetDir);
  fs.mkdirSync(assetDir,{recursive:true});
  fs.copyFileSync(cssFile,path.join(assetDir,'landing.css'));
  return {
    source:sourceFile,out:outFile,css:path.join(assetDir,'landing.css'),
    pageId:meta.pageId,kind:context.kind,lang:meta.lang,status:meta.status,mode,
    relatedTransport:blocks.related_transport.items.length,
    relatedReading:blocks.related_reading.items.length,
    canonical:seoLinks.canonical,
    alternates:seoLinks.alternates,
    bytes:Buffer.byteLength(html)
  };
}
function buildPreview(options={}){
  return buildLanding({...options,mode:'preview'});
}
function buildPublic(options={}){
  return buildLanding({...options,mode:'public'});
}
function parseArgs(argv){
  const args={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--source')args.source=argv[++i];
    else if(a==='--out')args.out=argv[++i];
    else if(a==='--app-base')args.appBase=argv[++i];
    else if(a==='--asset-base')args.assetBase=argv[++i];
    else if(a==='--asset-dir')args.assetDir=argv[++i];
    else if(a==='--site-origin')args.siteOrigin=argv[++i];
    else if(a==='--transport-root')args.transportRoot=argv[++i];
    else if(a==='--mode')args.mode=argv[++i];
  }
  return args;
}
function main(){
  const args=parseArgs(process.argv.slice(2));
  const result=args.mode==='public'?buildPublic(args):buildPreview(args);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(require.main===module){try{main()}catch(error){console.error(error.stack||error);process.exitCode=1}}

module.exports={
  esc,inline,unquote,parseFrontmatter,stripBrand,normalizeOrigin,buildSeoLinks,renderHreflangLinks,localeStrings,reasonLabel,
  interpolate,renderJourney,renderFareTable,renderRelatedTransport,renderRelatedReading,
  renderRouteHero,renderPlaceHero,renderHero,
  firstParagraph,renderBody,fillTemplate,buildLanding,buildPreview,buildPublic
};
