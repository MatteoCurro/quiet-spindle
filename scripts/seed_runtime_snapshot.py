#!/usr/bin/env python3
"""Seed ephemeral staging runtime from the persistent published runtime."""
from __future__ import annotations
import argparse, hashlib, json, os, re, tempfile, time
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from urllib.error import URLError

SAFE_NAME=re.compile(r"^[A-Za-z0-9._-]+$")

def safe_name(value):
    value=str(value or "")
    if not value or not SAFE_NAME.fullmatch(value) or Path(value).name!=value:
        raise RuntimeError(f"Runtime filename non sicuro: {value!r}")
    return value

def fetch_bytes(base_url,name,timeout,retries=3):
    name=safe_name(name)
    url=urljoin(base_url,name)
    last_error=None
    for attempt in range(max(1,int(retries))):
        req=Request(url,headers={"User-Agent":"U.Venice-Transit-Staging-Seed/1"})
        try:
            with urlopen(req,timeout=timeout) as response:
                return response.read()
        except (TimeoutError,URLError,OSError) as exc:
            last_error=exc
            if attempt+1>=max(1,int(retries)):break
            time.sleep(min(4,2**attempt))
    raise RuntimeError(f"Runtime seed fetch fallito dopo {retries} tentativi per {name}: {last_error}") from last_error

def verify_content(data,expected,name):
    if expected:
        actual=hashlib.sha256(data).hexdigest()
        if actual.lower()!=str(expected).lower():
            raise RuntimeError(f"SHA256 contenuto non valido per {name}: {actual} != {expected}")

def verify_versioned_name(expected,name):
    if expected and str(expected)[:12] not in name:
        raise RuntimeError(f"Versione runtime non coerente per {name}: atteso {str(expected)[:12]}")

def atomic_write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix=path.name+".",suffix=".tmp",dir=str(path.parent))
    try:
        with os.fdopen(fd,"wb") as fh:
            fh.write(data);fh.flush();os.fsync(fh.fileno())
        os.replace(tmp,path)
    except Exception:
        try: os.unlink(tmp)
        except OSError: pass
        raise

def seed_runtime(base_url,output_dir,timeout=30,retries=3):
    if not base_url.endswith("/"):base_url+="/"
    manifest_raw=fetch_bytes(base_url,"manifest.json",timeout,retries)
    manifest=json.loads(manifest_raw.decode("utf-8"))
    if manifest.get("schema")!=1 or not isinstance(manifest.get("networks"),dict):
        raise RuntimeError("Manifest runtime seed non valido")
    output_dir.mkdir(parents=True,exist_ok=True)
    downloaded=set();schedule_indexes={}

    def copy_file(meta,content_hash=False):
        if not isinstance(meta,dict) or not meta.get("file"):return None
        name=safe_name(meta["file"])
        if name in downloaded:return output_dir/name
        data=fetch_bytes(base_url,name,timeout,retries)
        if content_hash:verify_content(data,meta.get("sha256",""),name)
        else:verify_versioned_name(meta.get("sha256",""),name)
        atomic_write(output_dir/name,data);downloaded.add(name)
        return output_dir/name

    def copy_schedule(meta):
        path=copy_file(meta,content_hash=True)
        if path is None or path.name in schedule_indexes:return
        index=json.loads(path.read_text(encoding="utf-8"))
        if int(index.get("schema",0))!=2 or not isinstance(index.get("chunks"),dict):
            raise RuntimeError(f"Schedule runtime seed non valido: {path.name}")
        schedule_indexes[path.name]=index
        for chunk in index["chunks"].values():copy_file(chunk,content_hash=True)

    for entry in manifest["networks"].values():
        if not isinstance(entry,dict):continue
        for component in ("core","shapes"):copy_file(entry.get(component))
        copy_schedule(entry.get("schedule"))
        for snap in entry.get("snapshots") or []:
            if not isinstance(snap,dict):continue
            for component in ("core","shapes"):copy_file(snap.get(component))
            copy_schedule(snap.get("schedule"))

    atomic_write(output_dir/"manifest.json",manifest_raw)
    coverage={
        net:sorted({d for snap in (entry.get("snapshots") or []) for d in (snap.get("serviceDates") or [])})
        for net,entry in manifest["networks"].items() if isinstance(entry,dict)
    }
    return {"files":len(downloaded)+1,"networks":sorted(manifest["networks"]),"coverage":coverage}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--base-url",required=True)
    p.add_argument("--output-dir",required=True)
    p.add_argument("--timeout",type=int,default=30)
    p.add_argument("--retries",type=int,default=3)
    args=p.parse_args()
    print(json.dumps(seed_runtime(args.base_url,Path(args.output_dir),args.timeout,args.retries),sort_keys=True))

if __name__=="__main__":main()
