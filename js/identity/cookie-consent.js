/* M10.5 — versioned cookie/tracking preference center.
   Necessary storage is always available; optional analytics is opt-in. */
(function(g){'use strict';
const CONFIG_URL='config/privacy.json';
const NOTICE_KEY='uv.cookie.notice.v1';
function el(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n}
function t(key){return g.UVTransitI18n?.t?.('cookie.'+key)||key}
function store(){return g.UVIdentityStores?.defaults?.().adapter||null}
function current(type){try{return g.UVConsent?.instance?.().get(type)||null}catch(_){return null}}
function decided(type,version){const r=current(type);return !!r&&['granted','denied'].includes(r.status)&&r.policy_version===version}
function set(type,status,version,source){return g.UVConsent.instance().set(type,status,{policyVersion:version,source})}
function publish(version){
 const analytics=current('analytics'),marketing=current('marketing');
 try{g.dispatchEvent(new CustomEvent('uv:cookie-consent',{detail:{version,analytics:analytics?.status||'unset',marketing:marketing?.status||'unset'}}))}catch(_){}
}
function create(config){
 const version=String(config?.version||'').trim(),policyUrl=String(config?.policyUrl||'privacy.html');
 const categories=config?.cookieConsent||{},analyticsEnabled=categories.analytics===true,marketingEnabled=categories.marketing===true;
 if(!version)return null;
 let shell=null,settings=null;
 function close(){shell?.remove();shell=null;settings=null}
 function rememberNotice(){try{store()?.write?.(NOTICE_KEY,{version,seenAt:Date.now()})}catch(_){}}
 function saveChoices(analytics,marketing,source='cookie_settings'){
  if(analyticsEnabled)set('analytics',analytics?'granted':'denied',version,source);
  if(marketingEnabled)set('marketing',marketing?'granted':'denied',version,source);
  rememberNotice();publish(version);close();
 }
 function policyLink(){
  const a=el('a',t('policy'));a.href=policyUrl;a.target='_blank';a.rel='noopener';return a;
 }
 function renderSettings(){
  if(!shell)return;settings=el('div',undefined,'cookie-settings');
  settings.append(el('h3',t('settingsTitle')),el('p',t('settingsHelp')));
  const necessary=el('label',undefined,'cookie-choice'),n=el('input');n.type='checkbox';n.checked=true;n.disabled=true;
  necessary.append(n,el('span',t('necessary')));
  settings.append(necessary);
  let analytics=null,marketing=null;
  if(analyticsEnabled){
   const row=el('label',undefined,'cookie-choice');analytics=el('input');analytics.type='checkbox';analytics.checked=current('analytics')?.status==='granted';
   row.append(analytics,el('span',t('analytics')));settings.append(row);
  }
  if(marketingEnabled){
   const row=el('label',undefined,'cookie-choice');marketing=el('input');marketing.type='checkbox';marketing.checked=current('marketing')?.status==='granted';
   row.append(marketing,el('span',t('marketing')));settings.append(row);
  }
  const actions=el('div',undefined,'cookie-actions');
  const save=el('button',t('save'));save.type='button';save.onclick=()=>saveChoices(!!analytics?.checked,!!marketing?.checked);
  const reject=el('button',t('rejectOptional'));reject.type='button';reject.onclick=()=>saveChoices(false,false,'cookie_reject');
  actions.append(reject,save);settings.append(actions,policyLink());
  shell.querySelector('.cookie-card').replaceChildren(settings);
 }
 function renderBanner(force=false){
  if(shell)close();
  const optionalPending=(analyticsEnabled&&!decided('analytics',version))||(marketingEnabled&&!decided('marketing',version));
  const seen=store()?.read?.(NOTICE_KEY,null);
  if(!force&&!optionalPending&&seen?.version===version)return;
  shell=el('div',undefined,'cookie-layer');shell.setAttribute('role','dialog');shell.setAttribute('aria-modal','true');shell.setAttribute('aria-label',t('title'));
  const card=el('section',undefined,'cookie-card');
  card.append(el('strong',t('title')),el('p',optionalPending?t('introOptional'):t('introNecessary')));
  const actions=el('div',undefined,'cookie-actions');
  if(optionalPending){
   const reject=el('button',t('rejectOptional'));reject.type='button';reject.onclick=()=>saveChoices(false,false,'cookie_reject');
   const accept=el('button',t('acceptOptional'));accept.type='button';accept.onclick=()=>saveChoices(analyticsEnabled,marketingEnabled,'cookie_accept');
   const custom=el('button',t('customize'));custom.type='button';custom.onclick=renderSettings;
   actions.append(reject,accept,custom);
  }else{
   const ok=el('button',t('continueNecessary'));ok.type='button';ok.onclick=()=>{rememberNotice();close()};
   actions.append(ok);
  }
  card.append(actions,policyLink());shell.append(card);document.body.append(shell);
 }
 return Object.freeze({open:()=>{renderBanner(true);renderSettings()},render:()=>renderBanner(false),version});
}
async function init(){
 try{
  await g.__UV_I18N_READY__;
  const r=await fetch(CONFIG_URL,{cache:'no-cache'});if(!r.ok)return;
  const config=await r.json(),ui=create(config);if(!ui)return;
  g.UVCookieConsent=Object.freeze({open:ui.open,render:ui.render,version:ui.version});
  ui.render();
  const btn=document.getElementById('cookieSettingsBtn');if(btn)btn.onclick=ui.open;
 }catch(_){}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(typeof window!=='undefined'?window:globalThis);
