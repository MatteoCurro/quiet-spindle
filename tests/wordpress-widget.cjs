const fs=require('fs'),path=require('path'),assert=require('assert'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const Builder=require(path.join(root,'scripts/build_wordpress_transport_artifact.cjs'));

const built=Builder.buildArtifact(root);
const committed=JSON.parse(fs.readFileSync(path.join(root,'wordpress/uv-transport-shortcodes/data/catalog.json'),'utf8'));
assert.deepEqual(committed,built,'committed WordPress catalog drifted from entity/route/locale sources');
assert.equal(committed.schemaVersion,1);
assert.deepEqual(committed.locales,['it','en','fr','de']);
assert(Object.keys(committed.entities).length>=40,'expected curated entity catalog');
assert(Object.keys(committed.routes).length>=5,'expected curated route catalog');
for(const [id,entity] of Object.entries(committed.entities)){
  assert.equal(entity.id,id);
  assert(entity.token&&!entity.token.includes(':'),id+' token must be stable path token');
  for(const lang of committed.locales)assert(entity.names[lang]?.trim(),id+' missing '+lang+' name');
}
for(const [id,route] of Object.entries(committed.routes)){
  assert.equal(route.id,id);
  assert(committed.entities[route.from],id+' unknown origin');
  assert(committed.entities[route.to],id+' unknown destination');
  for(const lang of committed.locales)assert(route.names[lang]?.trim(),id+' missing '+lang+' name');
}
for(const lang of committed.locales){
  const locale=JSON.parse(fs.readFileSync(path.join(root,'locales',lang+'.json'),'utf8'));
  assert.equal(committed.strings[lang].findRoute,locale['journey.find']);
  assert.equal(committed.strings[lang].destination,locale['journey.destination']);
  assert.equal(committed.strings[lang].route,locale['common.route']);
}

const phpFile=path.join(root,'wordpress/uv-transport-shortcodes/uv-transport-shortcodes.php');
const php=fs.readFileSync(phpFile,'utf8');
assert(php.includes("add_shortcode('uv_route'"),'uv_route registration missing');
assert(php.includes("add_shortcode('uv_transport_widget'"),'widget registration missing');
assert(php.includes("apply_filters('wpml_current_language'"),'WPML detection missing');
assert(php.includes("'ref' => 'wp_article'"),'wp_article attribution missing');
assert(php.includes("sanitize_title($slug)"),'article slug campaign missing');
assert(php.includes('esc_url($url)')&&php.includes('esc_attr($label)')&&php.includes('esc_html($label)'),'accessible/safe escaping missing');
assert(!/<script\b/i.test(php),'WordPress integration must not embed JavaScript');


const loader=fs.readFileSync(path.join(root,'wordpress/uv-transport-shortcodes/uv-transport-shortcodes-loader.php'),'utf8');
assert(loader.includes("WPMU_PLUGIN_DIR . '/uv-transport-shortcodes/uv-transport-shortcodes.php'"),'MU loader target mismatch');

const workflow=fs.readFileSync(path.join(root,'.github/workflows/deploy-wordpress-widget.yml'),'utf8');
assert(workflow.includes('branches:\n      - main'),'WordPress deployment must be scoped to main');
assert(workflow.includes('wordpress/uv-transport-shortcodes/**'),'WordPress deployment path trigger missing');
assert(workflow.includes('WP_CONTENT_PATH: /lamp0/web/vhosts/unlockvenice.com/htdocs/wp-content'),'WordPress deploy root mismatch');
assert(workflow.includes('wp-widget-deploy.sftp'),'WordPress SFTP allowlist guard missing');
assert(workflow.includes('uv-transport-shortcodes-loader.php'),'MU loader deployment missing');
assert(workflow.includes('/wp-json/uv-transport/v1/health'),'post-deploy health check missing');

const lint=spawnSync('php',['-l',phpFile],{encoding:'utf8'});
if(lint.error&&lint.error.code==='ENOENT'){
  console.log('NOTE: php executable unavailable; runtime smoke skipped locally.');
}else{
  assert.equal(lint.status,0,'PHP lint failed:\n'+lint.stdout+'\n'+lint.stderr);
  const smoke=spawnSync('php',[path.join(root,'tests/wordpress-widget-smoke.php')],{encoding:'utf8'});
  assert.equal(smoke.status,0,'WordPress shortcode smoke failed:\n'+smoke.stdout+'\n'+smoke.stderr);
  process.stdout.write(smoke.stdout);
}

console.log('RESULT: generated WordPress artifact stays in sync with U.Venice entities/routes/locales and plugin contract is valid.');
