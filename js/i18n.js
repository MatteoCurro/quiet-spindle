(function(global){
'use strict';

const SUPPORTED=['it','en','fr','de'];
const STORAGE_KEY='uv.language';
const DEFAULT_LOCALE='it';
const originalNodes=new WeakMap();
const catalogCache=new Map();
let locale=DEFAULT_LOCALE;
let canonical={};
let active={};
let exactReverse=new Map();
let patternReverse=[];
let observer=null;

function flatten(obj,prefix='',out={}){
  for(const [key,value] of Object.entries(obj||{})){
    const full=prefix?prefix+'.'+key:key;
    if(value && typeof value==='object' && !Array.isArray(value)) flatten(value,full,out);
    else if(typeof value==='string') out[full]=value;
  }
  return out;
}

function normalizeLocale(value){
  const raw=String(value||'').trim().toLowerCase().replace('_','-');
  const base=raw.split('-')[0];
  return SUPPORTED.includes(base)?base:null;
}

function requestedLocale(){
  try{
    const fromUrl=normalizeLocale(new URLSearchParams(location.search).get('lang'));
    if(fromUrl)return fromUrl;
  }catch(_){}
  try{
    const saved=normalizeLocale(localStorage.getItem(STORAGE_KEY));
    if(saved)return saved;
  }catch(_){}
  const prefs=Array.isArray(navigator.languages)?navigator.languages:[navigator.language];
  for(const item of prefs||[]){
    const hit=normalizeLocale(item);
    if(hit)return hit;
  }
  return DEFAULT_LOCALE;
}

async function loadCatalog(code){
  if(catalogCache.has(code))return catalogCache.get(code);
  const url=new URL('locales/'+code+'.json',document.baseURI);
  const res=await fetch(url.href,{cache:'no-cache'});
  if(!res.ok)throw new Error('Unable to load locale '+code+' ('+res.status+')');
  const data=flatten(await res.json());
  catalogCache.set(code,data);
  return data;
}

function escapeRegex(value){
  return value.replace(/[.*+?^$()|[\]\\{}]/g,'\\$&');
}

function buildReverse(){
  exactReverse=new Map();
  patternReverse=[];
  for(const [key,value] of Object.entries(canonical)){
    const source=String(value);
    if(!source.includes('{{')){
      if(!exactReverse.has(source.trim()))exactReverse.set(source.trim(),key);
      continue;
    }
    const names=[];
    let cursor=0;
    let regex='^';
    const token=/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g;
    let match;
    while((match=token.exec(source))){
      regex+=escapeRegex(source.slice(cursor,match.index));
      regex+='(.+?)';
      names.push(match[1]);
      cursor=match.index+match[0].length;
    }
    regex+=escapeRegex(source.slice(cursor))+'$';
    patternReverse.push({key,names,re:new RegExp(regex)});
  }
}

function interpolate(template,vars={}){
  return String(template||'').replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g,(_,name)=>
    Object.prototype.hasOwnProperty.call(vars,name)?String(vars[name]):''
  );
}

function t(key,vars={},fallback){
  const template=active[key] ?? canonical[key] ?? fallback ?? key;
  return interpolate(template,vars);
}

function translateSource(source){
  const raw=String(source??'');
  const leading=(raw.match(/^\s*/)||[''])[0];
  const trailing=(raw.match(/\s*$/)||[''])[0];
  const trimmed=raw.trim();
  if(!trimmed)return raw;

  const exactKey=exactReverse.get(trimmed);
  if(exactKey)return leading+t(exactKey)+trailing;

  for(const item of patternReverse){
    const match=trimmed.match(item.re);
    if(!match)continue;
    const vars={};
    item.names.forEach((name,index)=>vars[name]=match[index+1]);
    return leading+t(item.key,vars)+trailing;
  }
  return raw;
}

function skipped(node){
  const el=node?.nodeType===1?node:node?.parentElement;
  if(!el)return true;
  if(['SCRIPT','STYLE','NOSCRIPT','CODE','PRE'].includes(el.tagName))return true;
  return Boolean(el.closest?.('[data-i18n-skip]'));
}

function stateFor(node){
  let state=originalNodes.get(node);
  if(!state){state={attrs:{}};originalNodes.set(node,state);}
  return state;
}

function translateTextNode(node){
  if(skipped(node))return;
  const state=stateFor(node);
  let source=node.nodeValue;
  if(state.text!==undefined){
    if(state.textTranslated!==undefined && node.nodeValue!==state.textTranslated){
      state.text=node.nodeValue;
    }
    source=state.text;
  }
  const next=translateSource(source);
  if(next!==source || state.text!==undefined){
    if(state.text===undefined)state.text=source;
    state.textTranslated=next;
    if(node.nodeValue!==next)node.nodeValue=next;
  }
}

function translateAttribute(el,attr){
  if(skipped(el) || !el.hasAttribute(attr))return;
  const state=stateFor(el);
  const translatedAttrs=state.translatedAttrs||(state.translatedAttrs={});
  let source=el.getAttribute(attr);
  if(state.attrs[attr]!==undefined){
    if(translatedAttrs[attr]!==undefined && source!==translatedAttrs[attr]){
      state.attrs[attr]=source;
    }
    source=state.attrs[attr];
  }
  const next=translateSource(source);
  if(next!==source || state.attrs[attr]!==undefined){
    if(state.attrs[attr]===undefined)state.attrs[attr]=source;
    translatedAttrs[attr]=next;
    if(el.getAttribute(attr)!==next)el.setAttribute(attr,next);
  }
}

function applyExplicit(el){
  if(!(el instanceof Element))return;
  const textKey=el.getAttribute('data-i18n');
  if(textKey){
    const next=t(textKey);
    if(el.textContent!==next)el.textContent=next;
  }
  for(const [attr,dataAttr] of [['placeholder','data-i18n-placeholder'],['aria-label','data-i18n-aria-label'],['title','data-i18n-title']]){
    const key=el.getAttribute(dataAttr);
    if(key){
      const next=t(key);
      if(el.getAttribute(attr)!==next)el.setAttribute(attr,next);
    }
  }
}

function applyTree(root=document){
  if(root.nodeType===3){translateTextNode(root);return;}
  if(root.nodeType!==1 && root.nodeType!==9 && root.nodeType!==11)return;

  if(root.nodeType===1){
    applyExplicit(root);
    for(const attr of ['placeholder','aria-label','title'])translateAttribute(root,attr);
  }

  const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
  let node;
  while((node=walker.nextNode())){
    if(node.nodeType===3)translateTextNode(node);
    else{
      applyExplicit(node);
      for(const attr of ['placeholder','aria-label','title'])translateAttribute(node,attr);
    }
  }
}

function applyMeta(){
  if(canonical['meta.title'])document.title=t('meta.title');
  const description=document.querySelector('meta[name="description"]');
  if(description && canonical['meta.description'])description.setAttribute('content',t('meta.description'));
}

function syncSelector(){
  const select=document.getElementById('languageSelect');
  if(select && select.value!==locale)select.value=locale;
}

function startObserver(){
  if(observer)return;
  observer=new MutationObserver(mutations=>{
    for(const mutation of mutations){
      if(mutation.type==='characterData')translateTextNode(mutation.target);
      else if(mutation.type==='attributes')translateAttribute(mutation.target,mutation.attributeName);
      else for(const node of mutation.addedNodes)applyTree(node);
    }
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['placeholder','aria-label','title']});
}

async function setLocale(next,{persist=true,updateUrl=true}={}){
  const normalized=normalizeLocale(next)||DEFAULT_LOCALE;
  canonical=Object.keys(canonical).length?canonical:await loadCatalog(DEFAULT_LOCALE);
  active=normalized===DEFAULT_LOCALE?canonical:await loadCatalog(normalized).catch(()=>canonical);
  locale=normalized;
  document.documentElement.lang=locale;
  document.documentElement.dataset.locale=locale;

  if(persist){
    try{localStorage.setItem(STORAGE_KEY,locale);}catch(_){}
  }
  if(updateUrl){
    try{
      const url=new URL(location.href);
      if(locale===DEFAULT_LOCALE)url.searchParams.delete('lang');
      else url.searchParams.set('lang',locale);
      history.replaceState(history.state,'',url);
    }catch(_){}
  }

  applyMeta();
  applyTree(document);
  syncSelector();
  global.dispatchEvent(new CustomEvent('uv:languagechange',{detail:{locale}}));
  return locale;
}

async function init(){
  canonical=await loadCatalog(DEFAULT_LOCALE);
  buildReverse();
  const initial=requestedLocale();
  active=initial===DEFAULT_LOCALE?canonical:await loadCatalog(initial).catch(()=>canonical);
  locale=initial;
  document.documentElement.lang=locale;
  document.documentElement.dataset.locale=locale;

  const boot=()=>{
    applyMeta();
    applyTree(document);
    syncSelector();
    const select=document.getElementById('languageSelect');
    if(select && !select.dataset.i18nBound){
      select.dataset.i18nBound='1';
      select.addEventListener('change',()=>setLocale(select.value));
    }
    startObserver();
    global.dispatchEvent(new CustomEvent('uv:i18nready',{detail:{locale}}));
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
  return locale;
}

const api={
  supported:[...SUPPORTED],
  get locale(){return locale;},
  t,
  setLocale,
  apply:applyTree,
  translateSource
};

global.UVTransitI18n=api;
global.__UV_I18N_READY__=init().catch(error=>{
  global.console?.warn?.('[i18n]',error);
  document.documentElement.lang=DEFAULT_LOCALE;
  return DEFAULT_LOCALE;
});
})(window);
