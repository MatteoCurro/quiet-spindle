#!/usr/bin/env python3
import csv, io, json, os, subprocess, sys, tempfile, time, zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
BUILDER=ROOT/'server'/'build_transit_data.py'

def text(rows, fields):
    out=io.StringIO(newline=''); w=csv.DictWriter(out,fieldnames=fields,lineterminator='\n');w.writeheader();w.writerows(rows);return out.getvalue()

def make_zip(path, shape_offset=0.0, stop_time='08:10:00', unsorted=False, no_calendar=False):
    st=[
      {'trip_id':'T1','arrival_time':'08:00:00','departure_time':'08:00:00','stop_id':'A','stop_sequence':'1'},
      {'trip_id':'T2','arrival_time':'09:00:00','departure_time':'09:00:00','stop_id':'A','stop_sequence':'1'},
      {'trip_id':'T1','arrival_time':stop_time,'departure_time':stop_time,'stop_id':'B','stop_sequence':'2'},
      {'trip_id':'T2','arrival_time':'09:10:00','departure_time':'09:10:00','stop_id':'B','stop_sequence':'2'},
    ]
    if not unsorted: st.sort(key=lambda r:(r['trip_id'],int(r['stop_sequence'])))
    files={
      'agency.txt': text([{'agency_id':'A','agency_name':'ACTV','agency_url':'https://example.test','agency_timezone':'Europe/Rome'}],['agency_id','agency_name','agency_url','agency_timezone']),
      'routes.txt': text([{'route_id':'R1','agency_id':'A','route_short_name':'1','route_long_name':'Test','route_type':'4','route_color':'B6174B'}],['route_id','agency_id','route_short_name','route_long_name','route_type','route_color']),
      'trips.txt': text([
        {'route_id':'R1','service_id':'WK','trip_id':'T1','trip_headsign':'B','direction_id':'0','shape_id':'S1'},
        {'route_id':'R1','service_id':'WK','trip_id':'T2','trip_headsign':'B','direction_id':'1','shape_id':'S1'}],['route_id','service_id','trip_id','trip_headsign','direction_id','shape_id']),
      'stops.txt': text([{'stop_id':'A','stop_name':'Alpha','stop_lat':'45.0','stop_lon':'12.0'},{'stop_id':'B','stop_name':'Beta','stop_lat':'45.1','stop_lon':'12.1'}],['stop_id','stop_name','stop_lat','stop_lon']),
      'shapes.txt': text([{'shape_id':'S1','shape_pt_lat':str(45.0+shape_offset),'shape_pt_lon':'12.0','shape_pt_sequence':'1'},{'shape_id':'S1','shape_pt_lat':str(45.1+shape_offset),'shape_pt_lon':'12.1','shape_pt_sequence':'2'}],['shape_id','shape_pt_lat','shape_pt_lon','shape_pt_sequence']),
      'calendar_dates.txt':'service_id,date,exception_type\n',
      'stop_times.txt': text(st,['trip_id','arrival_time','departure_time','stop_id','stop_sequence'])
    }
    if not no_calendar:
      files['calendar.txt']=text([{'service_id':'WK','monday':'1','tuesday':'1','wednesday':'1','thursday':'1','friday':'1','saturday':'1','sunday':'1','start_date':'20260101','end_date':'20261231'}],['service_id','monday','tuesday','wednesday','thursday','friday','saturday','sunday','start_date','end_date'])
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
      for n,d in files.items(): z.writestr(n,d)

def run(cfg,*args):
    p=subprocess.run([sys.executable,str(BUILDER),'--config',str(cfg),*args],text=True,capture_output=True)
    if p.returncode: raise AssertionError(p.stderr or p.stdout)
    return p.stdout

def main():
  checks=0
  with tempfile.TemporaryDirectory() as td:
    base=Path(td); out=base/'runtime';work=base/'work';aut=base/'aut.zip';nav=base/'nav.zip';ali=base/'ali.zip';make_zip(aut,unsorted=True);make_zip(nav);make_zip(ali)
    cfg=base/'config.json';cfg.write_text(json.dumps({'outputDir':str(out),'workDir':str(work),'nice':0,'yieldEveryRows':0,'networks':{'aut':{'url':str(aut)},'nav':{'url':str(nav)},'ali':{'url':str(ali)}}}))
    run(cfg)
    m1b=(out/'manifest.json').read_bytes();m1=json.loads(m1b);checks+=1;assert m1['builderVersion']=='8.8.1-p5.3-service-date'
    checks+=1;assert m1['networks']['aut']['schedule']['schema']==2
    checks+=1;assert m1['networks']['ali']['schedule']['schema']==2
    ali_idx=json.loads((out/m1['networks']['ali']['schedule']['file']).read_text());checks+=1;assert ali_idx['network']=='ali'
    idxname=m1['networks']['aut']['schedule']['file'];idx=json.loads((out/idxname).read_text());checks+=1;assert idx['schema']==2 and len(idx['chunks'])==8
    checks+=1;assert len(idx['days'])==8 and idx['days'][0] < idx['days'][1]
    for info in idx['chunks'].values():
      p=out/info['file']; checks+=1; assert p.exists() and (p.stat().st_mode & 0o777)==0o644
      ch=json.loads(p.read_text());assert ch['schema']==2 and ch['network']=='aut' and len(ch['trips'])==2
    checks+=1;assert (out/'manifest.json').stat().st_mode & 0o777 == 0o644
    checks+=1;assert not (work/'builder.lock').exists()
    mt=(out/'manifest.json').stat().st_mtime_ns;time.sleep(.02);s=run(cfg);checks+=1;assert 'manifest invariato' in s
    checks+=1;assert (out/'manifest.json').read_bytes()==m1b and (out/'manifest.json').stat().st_mtime_ns==mt
    core=m1['networks']['aut']['core']['file'];shapes=m1['networks']['aut']['shapes']['file'];sched=idxname
    core_data=json.loads((out/core).read_text());checks+=1;assert core_data['routeStops']=={'R1':['A','B']}
    make_zip(aut,stop_time='08:12:00',unsorted=True);time.sleep(.02);run(cfg,'--network','aut');m2=json.loads((out/'manifest.json').read_text())
    checks+=1;assert m2['networks']['aut']['core']['file']==core
    checks+=1;assert m2['networks']['aut']['shapes']['file']==shapes
    checks+=1;assert m2['networks']['aut']['schedule']['file']!=sched
    sched2=m2['networks']['aut']['schedule']['file'];make_zip(aut,shape_offset=.001,stop_time='08:12:00',unsorted=True);time.sleep(.02);run(cfg,'--network','aut');m3=json.loads((out/'manifest.json').read_text())
    checks+=1;assert m3['networks']['aut']['core']['file']==core
    checks+=1;assert m3['networks']['aut']['shapes']['file']!=shapes
    checks+=1;assert m3['networks']['aut']['schedule']['file']==sched2
    s=run(cfg,'--network','ali');checks+=1;assert 'ali:' in s or 'manifest invariato' in s
    # Missing calendar must fail, and lock must still be cleaned.
    bad=base/'bad.zip';make_zip(bad,no_calendar=True);badcfg=base/'badcfg.json';badcfg.write_text(json.dumps({'outputDir':str(base/'badout'),'workDir':str(base/'badwork'),'nice':0,'networks':{'aut':{'url':str(bad)}}}))
    p=subprocess.run([sys.executable,str(BUILDER),'--config',str(badcfg)],text=True,capture_output=True)
    checks+=1;assert p.returncode==1 and 'calendario di servizio assente' in p.stderr
    checks+=1;assert not (base/'badwork'/'builder.lock').exists()
  print(f'{checks}/{checks} checks passed')
if __name__=='__main__':main()
