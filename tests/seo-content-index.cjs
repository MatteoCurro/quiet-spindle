const assert=require('assert'),path=require('path');
const S=require(path.resolve(__dirname,'../scripts/build_seo_content_index.cjs'));

function response(body,{status=200,headers={}}={}){
  const map=new Map(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),String(v)]));
  return {
    ok:status>=200&&status<300,status,
    headers:{get:key=>map.get(String(key).toLowerCase())||null},
    json:async()=>typeof body==='string'?JSON.parse(body):body,
    text:async()=>typeof body==='string'?body:JSON.stringify(body)
  };
}
function post({id=1,lang='it',link,title,slug='x',date='2026-09-01T10:00:00',category='Itinerari',tag='Venezia'}){
  return {id,lang,link,slug,date,title:{rendered:title},excerpt:{rendered:'<p>Excerpt '+title+'</p>'},_embedded:{'wp:term':[[{taxonomy:'category',name:category}],[{taxonomy:'post_tag',name:tag}]]}};
}

(async()=>{
  {
    const calls=[];
    const fetchImpl=async url=>{
      calls.push(url);const u=new URL(url),lang=u.searchParams.get('lang');
      if(u.pathname.includes('/wp-json/wp/v2/posts')){
        if(lang==='it')return response([post({lang:'it',link:'https://www.unlockvenice.com/rialto/',title:'Rialto a Venezia',slug:'rialto'})],{headers:{'x-wp-totalpages':'1'}});
        if(lang==='en')return response([post({id:2,lang:'en',link:'https://www.unlockvenice.com/en/rialto-bridge/',title:'Rialto Bridge',slug:'rialto-bridge'})],{headers:{'x-wp-totalpages':'1'}});
      }
      return response('',{status:404});
    };
    const index=await S.scan({fetchImpl,config:{baseUrl:'https://www.unlockvenice.com/',locales:['it','en'],defaultLocale:'it',sitemapCandidates:[]},now:new Date('2026-09-25T12:00:00Z')});
    assert.equal(index.articleCount,2);
    assert.deepEqual(index.countsByLanguage,{it:1,en:1});
    assert.deepEqual(index.sourceAdapters,['wordpress-rest']);
    assert(index.articles.find(x=>x.lang==='it').categories.includes('Itinerari'));
    assert(index.articles.find(x=>x.lang==='en').tags.includes('Venezia'));
    assert(calls.some(x=>x.includes('lang=it'))&&calls.some(x=>x.includes('lang=en')));
  }

  {
    const sitemapIndex='<?xml version="1.0"?><sitemapindex><sitemap><loc>https://www.unlockvenice.com/wp-sitemap-posts-post-1.xml</loc></sitemap></sitemapindex>';
    const postMap='<?xml version="1.0"?><urlset><url><loc>https://www.unlockvenice.com/ponte-scalzi/</loc></url><url><loc>https://www.unlockvenice.com/de/scalzi-bruecke/</loc></url></urlset>';
    const itHtml='<!doctype html><html lang="it"><head><meta property="og:url" content="https://www.unlockvenice.com/ponte-scalzi/"><meta property="og:title" content="Ponte degli Scalzi"><meta name="description" content="Guida al Ponte degli Scalzi"><meta property="article:published_time" content="2026-08-01T10:00:00+02:00"></head><body><article><a href="/category/ponti/">Ponti</a><a rel="tag" href="/tag/cannaregio/">Cannaregio</a><p>Testo articolo.</p></article></body></html>';
    const deHtml='<!doctype html><html lang="de-DE"><head><meta property="og:url" content="https://www.unlockvenice.com/de/scalzi-bruecke/"><meta property="og:title" content="Scalzi-Brücke"><meta property="article:published_time" content="2026-08-02T10:00:00+02:00"></head><body><article><p>Artikel.</p></article></body></html>';
    const fetchImpl=async url=>{
      const u=new URL(url);
      if(u.pathname.includes('/wp-json/'))return response('',{status:404});
      if(u.pathname==='/wp-sitemap.xml')return response(sitemapIndex);
      if(u.pathname==='/wp-sitemap-posts-post-1.xml')return response(postMap);
      if(u.pathname==='/ponte-scalzi/')return response(itHtml);
      if(u.pathname==='/de/scalzi-bruecke/')return response(deHtml);
      return response('',{status:404});
    };
    const index=await S.scan({fetchImpl,config:{baseUrl:'https://www.unlockvenice.com/',locales:['it','de'],defaultLocale:'it',sitemapCandidates:['/wp-sitemap.xml']},now:new Date('2026-09-25T12:00:00Z')});
    assert.equal(index.articleCount,2);
    assert.deepEqual(index.countsByLanguage,{it:1,de:1});
    assert.deepEqual(index.sourceAdapters,['sitemap-html']);
    const it=index.articles.find(x=>x.lang==='it'),de=index.articles.find(x=>x.lang==='de');
    assert.equal(it.slug,'ponte-scalzi');
    assert(it.categories.includes('Ponti'));
    assert(it.tags.includes('Cannaregio'));
    assert.equal(de.title,'Scalzi-Brücke');
  }

  {
    const config=S.configWith({baseUrl:'https://www.unlockvenice.com/',locales:['it','en','fr','de']});
    assert.equal(S.localeFromUrl('https://www.unlockvenice.com/fr/rialto/',config),'fr');
    assert.equal(S.localeFromUrl('https://www.unlockvenice.com/rialto/',config),'it');
    assert.deepEqual(S.xmlLocs('<urlset><url><loc>https://example.test/a/</loc></url><url><loc>https://example.test/b/</loc></url></urlset>'),['https://example.test/a/','https://example.test/b/']);

    const articleLikeHome='<!doctype html><html lang="it"><head><meta property="og:url" content="https://www.unlockvenice.com/"><meta property="og:title" content="Unlock Venice"></head><body><article><p>Homepage-like content.</p></article></body></html>';
    assert.equal(S.normalizeHtmlArticle(articleLikeHome,'https://www.unlockvenice.com/',config),null,'homepage/article-like sitemap record without slug must be discarded');

    const merged=S.mergeArticles([{articles:[
      {url:'https://www.unlockvenice.com/en/test-article/',lang:'en',title:' Test article ',slug:'',published:'',categories:[],tags:[],entities:[],keywords:[],excerpt:''},
      {url:'https://www.unlockvenice.com/',lang:'it',title:'Homepage',slug:'',published:'',categories:[],tags:[],entities:[],keywords:[],excerpt:''}
    ]}],config);
    assert.equal(merged.length,1,'mergeArticles must discard records that still cannot produce a slug');
    assert.equal(merged[0].slug,'test-article','mergeArticles must recover slug from canonical URL');
  }

  console.log('RESULT: SEO content scanner REST/sitemap adapters, language detection and incomplete-record guards passed.');
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
