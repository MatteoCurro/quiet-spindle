const fs=require('fs'),assert=require('assert');
const proxy=fs.readFileSync(__dirname+'/../api/actv-realtime.php','utf8');
const archive=fs.readFileSync(__dirname+'/../api/lib/transit-archive.php','utf8');
const staging=fs.readFileSync(__dirname+'/../.github/workflows/deploy-staging.yml','utf8');
const production=fs.readFileSync(__dirname+'/../.github/workflows/deploy-production.yml','utf8');
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}

check('raw archive helper is loaded by ACTV proxy',()=>{
 assert(proxy.includes("require_once __DIR__ . '/lib/transit-archive.php'"));
 assert(proxy.includes('uvActvArchiveMaybe('));
});
check('archive happens only on freshly fetched temporary payload',()=>{
 const fetch=proxy.indexOf('fetchToFile($url, $tmp)');
 const archiveCall=proxy.indexOf('uvActvArchiveMaybe($tmp');
 const publish=proxy.indexOf('rename($tmp, $cachePath)');
 assert(fetch>=0&&archiveCall>fetch&&publish>archiveCall);
});
check('cache and stale serving remain independent from archive',()=>{
 assert(proxy.indexOf('serveFile($cachePath, false')<proxy.indexOf('fetchToFile($url, $tmp)'));
 assert(proxy.includes('serveStaleOrFail($cachePath'));
});
check('archive is fail-open by contract',()=>{
 assert(archive.includes("return ['status' => 'error'"));
 assert(archive.includes('catch (Throwable $e)'));
 assert(!archive.includes('throw new RuntimeException'));
});
check('archive sampling defaults to 30 seconds',()=>assert(archive.includes("'UV_ACTV_ARCHIVE_INTERVAL_SEC', 30")));
check('raw retention defaults to six hours',()=>assert(archive.includes("'UV_ACTV_ARCHIVE_RETENTION_SEC', 21600")));
check('archive file count is bounded',()=>assert(archive.includes("'UV_ACTV_ARCHIVE_MAX_FILES', 720")));
check('archive defaults outside public runtime-data under proxy cache temp tree',()=>{
 assert(archive.includes("DIRECTORY_SEPARATOR . 'archive'"));
 assert(!archive.includes('runtime-data'));
});
check('archive supports compressed protobuf with raw fallback',()=>{
 assert(archive.includes("gzencode($raw, 6)"));
 assert(archive.includes("'.pb.gz' : '.pb'"));
});
check('archive names include feed scope timestamp and content hash',()=>{
 assert(archive.includes("gmdate('Ymd\\THis\\Z', $now)"));
 assert(archive.includes("substr($hash, 0, 12)"));
});
check('pruning applies both age and max-files bounds',()=>{
 assert(archive.includes("($now - $mtime) > $retention"));
 assert(archive.includes('$excess = count($kept) - $maxFiles'));
});
check('environment can disable or relocate archive without code change',()=>{
 assert(archive.includes("getenv('UV_ACTV_ARCHIVE_ENABLED')"));
 assert(archive.includes("getenv('UV_ACTV_ARCHIVE_DIR')"));
});
check('nested api/lib archive helper is included by staging and production payloads',()=>{
 assert(/cp -a .*\bapi\b/.test(staging));
 assert(/cp -a .*\bapi\b/.test(production));
});
console.log('RESULT: '+n+' raw feed archive contract checks passed.');
