const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const seo=fs.readFileSync(path.join(root,'.github/workflows/deploy-seo-production.yml'),'utf8');
const app=fs.readFileSync(path.join(root,'.github/workflows/deploy-production.yml'),'utf8');

assert(/on:\s*\n\s+push:/m.test(seo),'SEO production release trigger missing');
assert(seo.includes('branches:\n      - main'),'SEO release push must be scoped to main');
assert(seo.includes('paths:\n      - .github/workflows/deploy-seo-production.yml'),'SEO release push must be scoped to the deploy workflow itself');
assert(seo.includes('workflow_dispatch:'),'SEO production deploy must remain manually dispatchable');
assert(seo.includes('REMOTE_PATH: /lamp0/web/vhosts/unlockvenice.com/htdocs'),'SEO deploy must target site root');
assert(seo.includes("Unexpected SEO deploy files"),'SEO deploy allowlist guard missing');
assert(seo.includes("trasporti/(?:luoghi|percorsi)"),'Italian SEO path allowlist missing');
assert(seo.includes("en/trasporti/(?:places|routes)"),'English SEO path allowlist missing');
assert(seo.includes("fr/trasporti/(?:lieux|itineraires)"),'French SEO path allowlist missing');
assert(seo.includes("de/trasporti/(?:orte|routen)"),'German SEO path allowlist missing');
assert(seo.includes('No ready SEO landing pages: refusing production deploy'),'ready-only deploy gate missing');
assert(seo.includes('<meta name="robots" content="index,follow">'),'post-deploy indexability check missing');
assert(seo.includes('sitemap-transport-places.xml')&&seo.includes('sitemap-transport-routes.xml'),'SEO sitemap deployment missing');

assert(app.includes('REMOTE_PATH: /lamp0/web/vhosts/unlockvenice.com/htdocs/trasporti'),'regular app deploy root changed unexpectedly');
assert(!app.includes('dist/seo-site'),'regular app deploy must stay isolated from site-root SEO deploy');

console.log('RESULT: SEO production deploy is ready-only, allowlisted and isolated; automatic release is restricted to main changes of the SEO deploy workflow and manual dispatch remains available.');
