#!/usr/bin/env python3
import csv, datetime as dt, io, json, subprocess, sys, tempfile, zipfile
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
BUILDER=ROOT/'server'/'build_transit_data.py'

def ymd(d): return d.strftime('%Y%m%d')

def text(rows,fields):
    out=io.StringIO(newline='')
    w=csv.DictWriter(out,fieldnames=fields,lineterminator='\n')
    w.writeheader();w.writerows(rows)
    return out.getvalue()

def make_zip(path,trip_id,start,end):
    files={
      'agency.txt':text([{'agency_id':'A','agency_name':'ACTV','agency_url':'https://example.test','agency_timezone':'Europe/Rome'}],['agency_id','agency_name','agency_url','agency_timezone']),
      'routes.txt':text([{'route_id':'R','agency_id':'A','route_short_name':'1','route_long_name':'Test','route_type':'3'}],['route_id','agency_id','route_short_name','route_long_name','route_type']),
      'trips.txt':text([{'route_id':'R','service_id':'S','trip_id':trip_id,'trip_headsign':'Beta','direction_id':'0','shape_id':'SH'}],['route_id','service_id','trip_id','trip_headsign','direction_id','shape_id']),
      'stops.txt':text([{'stop_id':'A','stop_name':'Alpha','stop_lat':'45.0','stop_lon':'12.0'},{'stop_id':'B','stop_name':'Beta','stop_lat':'45.1','stop_lon':'12.1'}],['stop_id','stop_name','stop_lat','stop_lon']),
      'shapes.txt':text([{'shape_id':'SH','shape_pt_lat':'45.0','shape_pt_lon':'12.0','shape_pt_sequence':'1'},{'shape_id':'SH','shape_pt_lat':'45.1','shape_pt_lon':'12.1','shape_pt_sequence':'2'}],['shape_id','shape_pt_lat','shape_pt_lon','shape_pt_sequence']),
      'calendar.txt':text([{'service_id':'S','monday':'1','tuesday':'1','wednesday':'1','thursday':'1','friday':'1','saturday':'1','sunday':'1','start_date':ymd(start),'end_date':ymd(end)}],['service_id','monday','tuesday','wednesday','thursday','friday','saturday','sunday','start_date','end_date']),
      'calendar_dates.txt':'service_id,date,exception_type\n',
      'stop_times.txt':text([
        {'trip_id':trip_id,'arrival_time':'08:00:00','departure_time':'08:00:00','stop_id':'A','stop_sequence':'1'},
        {'trip_id':trip_id,'arrival_time':'08:10:00','departure_time':'08:10:00','stop_id':'B','stop_sequence':'2'}],['trip_id','arrival_time','departure_time','stop_id','stop_sequence'])
    }
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
      for name,data in files.items(): z.writestr(name,data)

def run(cfg):
    p=subprocess.run([sys.executable,str(BUILDER),'--config',str(cfg)],text=True,capture_output=True)
    if p.returncode: raise AssertionError(p.stderr or p.stdout)

def main():
    today=dt.datetime.now(ZoneInfo('Europe/Rome')).date()
    with tempfile.TemporaryDirectory() as td:
      base=Path(td);out=base/'runtime';work=base/'work';source=base/'actv.zip'
      make_zip(source,'OLD',today-dt.timedelta(days=3),today+dt.timedelta(days=3))
      cfg=base/'config.json'
      cfg.write_text(json.dumps({'outputDir':str(out),'workDir':str(work),'nice':0,'yieldEveryRows':0,'networks':{'aut':{'url':str(source),'snapshotRetention':4}}}))
      run(cfg)
      first=json.loads((out/'manifest.json').read_text())
      old=first['networks']['aut']['snapshots'][0]
      assert ymd(today) in old['serviceDates']
      old_schedule=old['schedule']['file']

      # Force the retained snapshot metadata stale: the next build must refresh
      # its rolling day window from the archived raw GTFS before publishing.
      first['networks']['aut']['snapshots'][0]['schedule']['day']='19000101'
      (out/'manifest.json').write_text(json.dumps(first))

      make_zip(source,'NEW',today+dt.timedelta(days=1),today+dt.timedelta(days=30))
      run(cfg)
      second=json.loads((out/'manifest.json').read_text())
      rows=second['networks']['aut']['snapshots']
      assert len(rows)>=2
      newest,previous=rows[0],rows[1]
      assert newest['sourceZipSha256']!=previous['sourceZipSha256']
      assert ymd(today) not in newest['serviceDates']
      assert ymd(today) in previous['serviceDates']
      assert previous['schedule']['file']==old_schedule
      assert previous['schedule']['day']==ymd(today)
      assert (out/previous['schedule']['file']).exists()
      assert len(list((work/'snapshots'/'aut').glob('*.zip')))>=2
    print('9/9 service-date builder snapshot checks passed')

if __name__=='__main__': main()
