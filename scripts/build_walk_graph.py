#!/usr/bin/env python3
import argparse, json, math, os, struct, hashlib, gzip, shutil
from collections import defaultdict
from datetime import datetime, timezone

try:
    import osmium
except ImportError as exc:
    raise SystemExit("python package 'osmium' is required") from exc

MAGIC=b'UVWG'
SCHEMA=1
HEADER_FMT='<4sIIIiiiiII'
NODE_FMT='<iiIHH'
EDGE_FMT='<IHH'
HEADER_SIZE=struct.calcsize(HEADER_FMT)
NODE_SIZE=struct.calcsize(NODE_FMT)
EDGE_SIZE=struct.calcsize(EDGE_FMT)

DISALLOWED_HIGHWAYS={'motorway','motorway_link','trunk','trunk_link','raceway','construction','proposed'}
NO_ACCESS={'no','private'}
YES_FOOT={'yes','designated','permissive','destination'}

def meters(a,b):
    lat1,lon1=a;lat2,lon2=b
    dy=(lat2-lat1)*110540.0
    dx=(lon2-lon1)*111320.0*math.cos(math.radians((lat1+lat2)/2))
    return math.hypot(dx,dy)

def walk_speed(tags):
    h=tags.get('highway','')
    speed=1.32
    if h=='steps': speed=.72
    elif h in {'path','footway'}: speed=1.12
    elif h in {'pedestrian','living_street'}: speed=1.22
    surface=tags.get('surface','').lower()
    if surface in {'cobblestone','sett','unpaved','gravel','fine_gravel','ground','sand'}: speed*=.88
    if tags.get('incline') and tags.get('incline') not in {'0','0%'}: speed*=.92
    return max(.55,speed)

def allowed(tags):
    highway=tags.get('highway','').lower()
    if not highway or highway in DISALLOWED_HIGHWAYS: return False
    foot=tags.get('foot','').lower()
    access=tags.get('access','').lower()
    if foot in NO_ACCESS: return False
    if access in NO_ACCESS and foot not in YES_FOOT: return False
    if tags.get('motorroad','').lower()=='yes' and foot not in YES_FOOT: return False
    return True

class Handler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.coords={}
        self.edges=defaultdict(dict)
        self.ways=0
    def way(self,w):
        tags={t.k:t.v for t in w.tags}
        if not allowed(tags): return
        pts=[]
        for n in w.nodes:
            try:
                if not n.location.valid(): continue
                p=(float(n.location.lat),float(n.location.lon))
            except Exception:
                continue
            self.coords[int(n.ref)]=p
            pts.append((int(n.ref),p))
        if len(pts)<2:return
        self.ways+=1
        speed=walk_speed(tags)
        one=tags.get('oneway:foot','').lower()
        forward=one not in {'-1','reverse'}
        backward=one not in {'yes','1','true'}
        for (a,pa),(b,pb) in zip(pts,pts[1:]):
            d=meters(pa,pb)
            if d<.2 or d>65535: continue
            sec=max(1,min(65535,int(math.ceil(d/speed))))
            dm=max(1,min(65535,int(round(d))))
            if forward:
                prev=self.edges[a].get(b)
                if prev is None or sec<prev[0]: self.edges[a][b]=(sec,dm)
            if backward:
                prev=self.edges[b].get(a)
                if prev is None or sec<prev[0]: self.edges[b][a]=(sec,dm)

def write_graph(handler,out_dir,source_label):
    used=set(handler.edges)
    for row in handler.edges.values(): used.update(row)
    ids=sorted(used)
    dense={osm_id:i for i,osm_id in enumerate(ids)}
    adjacency=[]
    edge_count=0
    for osm_id in ids:
        row=[(dense[to],sec,dist) for to,(sec,dist) in handler.edges.get(osm_id,{}).items() if to in dense]
        row.sort(key=lambda x:x[0]);adjacency.append(row);edge_count+=len(row)
    coords=[handler.coords[i] for i in ids]
    if not coords: raise RuntimeError('walking graph is empty')
    min_lat=min(x[0] for x in coords); max_lat=max(x[0] for x in coords)
    min_lon=min(x[1] for x in coords); max_lon=max(x[1] for x in coords)
    os.makedirs(out_dir,exist_ok=True)
    raw_path=os.path.join(out_dir,'graph.bin')
    with open(raw_path,'wb') as f:
        f.write(struct.pack(HEADER_FMT,MAGIC,SCHEMA,len(ids),edge_count,
            round(min_lat*1e6),round(min_lon*1e6),round(max_lat*1e6),round(max_lon*1e6),NODE_SIZE,EDGE_SIZE))
        offset=0
        for i,osm_id in enumerate(ids):
            lat,lon=coords[i];degree=len(adjacency[i])
            f.write(struct.pack(NODE_FMT,round(lat*1e6),round(lon*1e6),offset,min(degree,65535),0));offset+=degree
        for row in adjacency:
            for to,sec,dist in row:f.write(struct.pack(EDGE_FMT,to,sec,dist))
    digest=hashlib.sha256(open(raw_path,'rb').read()).hexdigest()
    version=digest[:12]
    version_dir=os.path.join(out_dir,version);os.makedirs(version_dir,exist_ok=True)
    final_path=os.path.join(version_dir,'graph.bin');os.replace(raw_path,final_path)
    gzip_path=os.path.join(version_dir,'graph.bin.gz')
    with open(final_path,'rb') as src, open(gzip_path,'wb') as raw_gz:
        with gzip.GzipFile(filename='',mode='wb',fileobj=raw_gz,compresslevel=9,mtime=0) as dst:
            shutil.copyfileobj(src,dst,1024*1024)
    raw_bytes=os.path.getsize(final_path);gzip_bytes=os.path.getsize(gzip_path)
    manifest={
        'schema':SCHEMA,'provider':'OpenStreetMap pedestrian graph','version':version,
        'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
        'source':source_label,'sha256':digest,'nodes':len(ids),'edges':edge_count,'ways':handler.ways,
        'bbox':[min_lon,min_lat,max_lon,max_lat],'nodeRecordBytes':NODE_SIZE,'edgeRecordBytes':EDGE_SIZE,
        'bytes':raw_bytes,'file':version+'/graph.bin',
        'gzipBytes':gzip_bytes,'gzipFile':version+'/graph.bin.gz'
    }
    with open(os.path.join(out_dir,'manifest.json'),'w',encoding='utf-8') as f:json.dump(manifest,f,ensure_ascii=False,indent=2);f.write('\n')
    print(json.dumps({'event':'walk-graph',**manifest},ensure_ascii=False))
    return manifest

def main():
    p=argparse.ArgumentParser()
    p.add_argument('pbf');p.add_argument('output');p.add_argument('--source',default='OpenStreetMap / Geofabrik Nord-Est')
    args=p.parse_args()
    h=Handler();h.apply_file(args.pbf,locations=True,idx='flex_mem')
    write_graph(h,args.output,args.source)

if __name__=='__main__':main()
