#!/usr/bin/env python3
import json,subprocess,sys,tempfile,hashlib
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts'/'seed_runtime_snapshot.py'

def write_json(path,value):
    raw=(json.dumps(value,separators=(',',':'))+'\n').encode()
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()

def main():
    with tempfile.TemporaryDirectory() as td:
        base=Path(td);src=base/'src';dst=base/'dst';src.mkdir()
        core={"schema":1,"network":"aut"};write_json(src/'core.aaaaaaaaaaaa.json',core)
        shapes={"schema":1,"network":"aut","shapes":{}};write_json(src/'shapes.bbbbbbbbbbbb.json',shapes)
        day={"schema":2,"network":"aut","day":"20261002","trips":[["T"]]}
        day_sha=write_json(src/'day.ccc.json',day)
        schedule={"schema":2,"network":"aut","days":["20261002"],"chunks":{"20261002":{"file":"day.ccc.json","sha256":day_sha,"trips":1}}}
        schedule_sha=write_json(src/'schedule.ddd.json',schedule)
        manifest={"schema":1,"networks":{"aut":{
          "core":{"file":"core.aaaaaaaaaaaa.json","sha256":"aaaaaaaaaaaa-source-hash"},
          "shapes":{"file":"shapes.bbbbbbbbbbbb.json","sha256":"bbbbbbbbbbbb-source-hash"},
          "schedule":{"file":"schedule.ddd.json","sha256":schedule_sha,"schema":2},
          "snapshots":[{
            "id":"old","sourceZipSha256":"oldhash",
            "core":{"file":"core.aaaaaaaaaaaa.json","sha256":"aaaaaaaaaaaa-source-hash"},
            "shapes":{"file":"shapes.bbbbbbbbbbbb.json","sha256":"bbbbbbbbbbbb-source-hash"},
            "schedule":{"file":"schedule.ddd.json","sha256":schedule_sha,"schema":2},
            "serviceDates":["20261002"]
          }]
        }}}
        write_json(src/'manifest.json',manifest)
        url=src.resolve().as_uri()+'/'
        p=subprocess.run([sys.executable,str(SCRIPT),'--base-url',url,'--output-dir',str(dst)],text=True,capture_output=True)
        assert p.returncode==0,(p.stdout,p.stderr)
        result=json.loads(p.stdout.strip())
        assert result["files"]==5
        assert result["coverage"]["aut"]==["20261002"]
        assert json.loads((dst/'manifest.json').read_text())==manifest
        assert json.loads((dst/'day.ccc.json').read_text())==day

        bad=json.loads(json.dumps(manifest))
        bad["networks"]["aut"]["schedule"]["sha256"]="0"*64
        write_json(src/'manifest.json',bad)
        p=subprocess.run([sys.executable,str(SCRIPT),'--base-url',url,'--output-dir',str(base/'broken')],text=True,capture_output=True)
        assert p.returncode!=0
    print('6/6 runtime seed checks passed')

if __name__=='__main__':main()
