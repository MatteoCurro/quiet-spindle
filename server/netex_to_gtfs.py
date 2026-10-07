#!/usr/bin/env python3
"""Minimal Italian NeTEx -> GTFS bridge for U.Venice Transport.

Scope is intentionally narrow: timetable entities required by the existing
runtime builder (stops/routes/trips/stop_times/calendar_dates/shapes).
Python stdlib only; no AGPL/EUPL converter dependency is bundled.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import io
from pathlib import Path
import re
import shutil
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from zoneinfo import ZoneInfo

CONVERTER_VERSION = "1.0.0-it-netex-minimal"

TARGET_TAGS = {
    "ScheduledStopPoint","Line","DestinationDisplay","ServiceJourneyPattern",
    "ServiceJourney","DayTypeAssignment","UicOperatingPeriod","OperatingPeriod"
}
TIMEZONE = "Europe/Rome"

def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag

def first_desc(elem, name: str):
    for node in elem.iter():
        if local(node.tag) == name:
            return node
    return None

def desc_text(elem, name: str, default: str = "") -> str:
    node = first_desc(elem, name)
    return (node.text or "").strip() if node is not None and node.text else default

def first_ref(elem, names) -> str:
    wanted = set(names if isinstance(names, (list,tuple,set)) else [names])
    for node in elem.iter():
        if local(node.tag) in wanted and node.get("ref"):
            return node.get("ref", "").strip()
    return ""

def clean_date(value: str) -> str:
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", value or "")
    return "".join(m.groups()) if m else re.sub(r"\D", "", value or "")[:8]

def parse_time(value: str):
    if not value: return None
    parts = value.strip().split(":")
    if len(parts) < 2: return None
    try:
        h,m = int(parts[0]), int(parts[1])
        s = int(float(parts[2])) if len(parts) > 2 else 0
    except ValueError:
        return None
    if h < 0 or m < 0 or m > 59 or s < 0 or s > 59: return None
    return h*3600+m*60+s

def gtfs_time(seconds: int) -> str:
    seconds=max(0,int(seconds))
    return f"{seconds//3600:02d}:{(seconds%3600)//60:02d}:{seconds%60:02d}"

def truth(value: str, default=True) -> bool:
    if value is None or value == "": return default
    return value.strip().lower() not in {"false","0","no"}

def target_dates(now=None, before=2, after=14):
    zone=ZoneInfo(TIMEZONE)
    base=(now or dt.datetime.now(zone))
    if base.tzinfo is None: base=base.replace(tzinfo=zone)
    day=base.astimezone(zone).date()
    return [(day+dt.timedelta(days=o)).strftime("%Y%m%d") for o in range(-before,after+1)]

def prepare_xml(source: Path, work: Path) -> Path:
    head=source.open("rb").read(4)
    if head[:2] == b"\x1f\x8b":
        out=work/"source.xml"
        with gzip.open(source,"rb") as src,out.open("wb") as dst: shutil.copyfileobj(src,dst,1024*1024)
        return out
    if head[:2] == b"PK":
        with zipfile.ZipFile(source) as zf:
            xmls=[x for x in zf.namelist() if x.lower().endswith(".xml")]
            if not xmls: raise RuntimeError("NeTEx ZIP senza XML")
            xmls.sort(key=lambda n: zf.getinfo(n).file_size, reverse=True)
            out=work/"source.xml"
            with zf.open(xmls[0]) as src,out.open("wb") as dst: shutil.copyfileobj(src,dst,1024*1024)
            return out
    return source

class NetexModel:
    def __init__(self):
        self.stops={}
        self.lines={}
        self.displays={}
        self.patterns={}
        self.stop_refs={}
        self.journeys=[]
        self.assignments={}
        self.periods={}

    def parse_stop(self,e):
        sid=e.get("id","").strip()
        if not sid:return
        lat=desc_text(e,"Latitude");lon=desc_text(e,"Longitude")
        try: latf,lonf=float(lat),float(lon)
        except ValueError:return
        self.stops[sid]={
            "id":sid,"name":desc_text(e,"Name",desc_text(e,"ShortName",sid)),
            "code":desc_text(e,"PrivateCode",""),"lat":latf,"lon":lonf
        }

    def parse_line(self,e):
        lid=e.get("id","").strip()
        if not lid:return
        mode=desc_text(e,"TransportMode","rail").lower()
        rtype={"tram":0,"metro":1,"rail":2,"train":2,"bus":3,"ferry":4}.get(mode,2)
        self.lines[lid]={"id":lid,"short":desc_text(e,"ShortName",""),"long":desc_text(e,"Name",lid),"type":rtype}

    def parse_display(self,e):
        did=e.get("id","").strip()
        if did:self.displays[did]=desc_text(e,"FrontText",desc_text(e,"Name",""))

    def parse_pattern(self,e):
        pid=e.get("id","").strip()
        if not pid:return
        line_id=first_ref(e,("LineRef","RouteRef"))
        points=[]
        for node in e.iter():
            if local(node.tag)!="StopPointInJourneyPattern":continue
            spid=node.get("id","").strip()
            try:order=int(node.get("order","0"))
            except ValueError:order=0
            stop=first_ref(node,"ScheduledStopPointRef")
            if not stop:continue
            board=truth(desc_text(node,"ForBoarding",""),True)
            alight=truth(desc_text(node,"ForAlighting",""),True)
            points.append((order,spid,stop,board,alight))
            if spid:self.stop_refs[spid]=(pid,order,stop,board,alight)
        points.sort(key=lambda x:x[0])
        self.patterns[pid]={"id":pid,"line":line_id,"points":points}

    def parse_journey(self,e):
        jid=e.get("id","").strip()
        if not jid:return
        pid=first_ref(e,("ServiceJourneyPatternRef","JourneyPatternRef"))
        day_type=first_ref(e,"DayTypeRef")
        display=first_ref(e,"DestinationDisplayRef")
        line_id=first_ref(e,"LineRef")
        times=[]
        for pt in e.iter():
            if local(pt.tag)!="TimetabledPassingTime":continue
            spref=first_ref(pt,"StopPointInJourneyPatternRef")
            if not spref:continue
            arr=desc_text(pt,"ArrivalTime","");dep=desc_text(pt,"DepartureTime","")
            try:ao=int(desc_text(pt,"ArrivalDayOffset","") or 0)
            except ValueError:ao=0
            try:do=int(desc_text(pt,"DepartureDayOffset","") or 0)
            except ValueError:do=0
            times.append([spref,arr,dep,ao,do])
        self.journeys.append({
            "id":jid,"pattern":pid,"dayType":day_type,"display":display,"line":line_id,
            "name":desc_text(e,"Name",""),"times":times
        })

    def parse_assignment(self,e):
        day=first_ref(e,"DayTypeRef")
        if not day:return
        op=first_ref(e,"OperatingPeriodRef")
        date=clean_date(desc_text(e,"Date",""))
        bucket=self.assignments.setdefault(day,[])
        if op:bucket.append(("period",op))
        if date:bucket.append(("date",date))

    def parse_period(self,e):
        pid=e.get("id","").strip()
        if not pid:return
        start=clean_date(desc_text(e,"FromDate",""))
        end=clean_date(desc_text(e,"ToDate","")) or start
        bits=re.sub(r"\s+","",desc_text(e,"ValidDayBits",""))
        self.periods[pid]=(start,end,bits)

def parse_netex(xml_path: Path) -> NetexModel:
    model=NetexModel()
    active_targets=[]
    depth=0
    for event,elem in ET.iterparse(xml_path,events=("start","end")):
        if event=="start":
            depth+=1
            if local(elem.tag) in TARGET_TAGS: active_targets.append(depth)
            continue
        tag=local(elem.tag)
        if tag in TARGET_TAGS:
            if tag=="ScheduledStopPoint":model.parse_stop(elem)
            elif tag=="Line":model.parse_line(elem)
            elif tag=="DestinationDisplay":model.parse_display(elem)
            elif tag=="ServiceJourneyPattern":model.parse_pattern(elem)
            elif tag=="ServiceJourney":model.parse_journey(elem)
            elif tag=="DayTypeAssignment":model.parse_assignment(elem)
            elif tag in ("UicOperatingPeriod","OperatingPeriod"):model.parse_period(elem)
            elem.clear()
            if active_targets and active_targets[-1]==depth:active_targets.pop()
        elif not active_targets:
            elem.clear()
        depth-=1
    return model

def active_dates_by_daytype(model: NetexModel, days):
    wanted=set(days);out={}
    for day,assignments in model.assignments.items():
        dates=set()
        for kind,value in assignments:
            if kind=="date":
                if value in wanted:dates.add(value)
                continue
            start,end,bits=model.periods.get(value,("","",""))
            if not start or not bits:continue
            try:base=dt.datetime.strptime(start,"%Y%m%d").date()
            except ValueError:continue
            for key in wanted:
                if end and key>end:continue
                try:d=dt.datetime.strptime(key,"%Y%m%d").date()
                except ValueError:continue
                idx=(d-base).days
                if 0<=idx<len(bits) and bits[idx]=="1":dates.add(key)
        if dates:out[day]=sorted(dates)
    return out

def normalize_times(raw):
    result=[];last=-1;day=0
    for spref,arr,dep,ao,do in raw:
        a=parse_time(arr);d=parse_time(dep)
        if a is None and d is None:continue
        if a is None:a=d
        if d is None:d=a
        # Explicit offsets win; otherwise infer midnight rollover.
        if ao:
            aday=ao;day=max(day,ao)
        else:
            if last>=0 and a<last and last-a>10800:day+=1
            aday=day
        a+=aday*86400;last=a%86400
        if do:
            dday=do;day=max(day,do)
        else:
            dday=aday
            raw_d=d%86400
            raw_a=a%86400
            if raw_d<raw_a and raw_a-raw_d>10800:dday=aday+1
        d=(d%86400)+dday*86400;day=max(day,dday);last=d%86400
        result.append((spref,a,d))
    return result

def write_csv(path: Path, headers, rows):
    with path.open("w",encoding="utf-8",newline="") as fh:
        w=csv.DictWriter(fh,fieldnames=headers,extrasaction="ignore")
        w.writeheader();w.writerows(rows)

def convert_netex_to_gtfs(source: Path, target: Path, *, now=None, agency_id="TI",
                           agency_name="Trenitalia", agency_url="https://www.trenitalia.com/"):
    source=Path(source);target=Path(target)
    days=target_dates(now)
    with tempfile.TemporaryDirectory(prefix="uv-netex-") as td:
        work=Path(td);xml_path=prepare_xml(source,work);model=parse_netex(xml_path)
        active=active_dates_by_daytype(model,days)

        routes={}
        trips=[];stop_times=[];used_stops=set();shape_rows=[];used_shapes=set()
        for journey in model.journeys:
            if journey["dayType"] not in active:continue
            pattern=model.patterns.get(journey["pattern"])
            if not pattern or len(pattern["points"])<2:continue
            line_id=journey["line"] or pattern["line"] or ("rail:"+journey["pattern"])
            line=model.lines.get(line_id,{"id":line_id,"short":"","long":"Servizio ferroviario","type":2})
            routes[line_id]=line

            normalized=normalize_times(journey["times"])
            rows=[]
            for seq,(spref,arr,dep) in enumerate(normalized,1):
                ref=model.stop_refs.get(spref)
                if not ref:continue
                _,_,stop_id,board,alight=ref
                stop=model.stops.get(stop_id)
                if not stop:continue
                rows.append({
                    "trip_id":journey["id"],"arrival_time":gtfs_time(arr),"departure_time":gtfs_time(dep),
                    "stop_id":stop_id,"stop_sequence":seq,
                    "pickup_type":"0" if board else "1","drop_off_type":"0" if alight else "1"
                })
                used_stops.add(stop_id)
            if len(rows)<2:continue

            shape_id=journey["pattern"]
            if shape_id not in used_shapes:
                used_shapes.add(shape_id)
                seq=1
                for _,_,stop_id,_,_ in pattern["points"]:
                    stop=model.stops.get(stop_id)
                    if not stop:continue
                    shape_rows.append({"shape_id":shape_id,"shape_pt_lat":stop["lat"],"shape_pt_lon":stop["lon"],"shape_pt_sequence":seq})
                    seq+=1

            headsign=model.displays.get(journey["display"],"")
            if not headsign:
                last_stop=model.stops.get(rows[-1]["stop_id"])
                headsign=(last_stop or {}).get("name","")
            trips.append({
                "route_id":line_id,"service_id":journey["dayType"],"trip_id":journey["id"],
                "trip_headsign":headsign,"trip_short_name":journey["name"],"shape_id":shape_id
            })
            stop_times.extend(rows)

        if not trips:raise RuntimeError("NeTEx: nessuna corsa attiva convertibile nella finestra runtime")

        out=work/"gtfs";out.mkdir()
        write_csv(out/"agency.txt",["agency_id","agency_name","agency_url","agency_timezone","agency_lang"],[
            {"agency_id":agency_id,"agency_name":agency_name,"agency_url":agency_url,"agency_timezone":TIMEZONE,"agency_lang":"it"}
        ])
        write_csv(out/"stops.txt",["stop_id","stop_code","stop_name","stop_lat","stop_lon"],[
            {"stop_id":s["id"],"stop_code":s["code"],"stop_name":s["name"],"stop_lat":s["lat"],"stop_lon":s["lon"]}
            for sid,s in sorted(model.stops.items()) if sid in used_stops
        ])
        write_csv(out/"routes.txt",["route_id","agency_id","route_short_name","route_long_name","route_type"],[
            {"route_id":r["id"],"agency_id":agency_id,"route_short_name":r["short"],"route_long_name":r["long"],"route_type":r["type"]}
            for _,r in sorted(routes.items())
        ])
        write_csv(out/"trips.txt",["route_id","service_id","trip_id","trip_headsign","trip_short_name","shape_id"],trips)
        write_csv(out/"stop_times.txt",["trip_id","arrival_time","departure_time","stop_id","stop_sequence","pickup_type","drop_off_type"],stop_times)
        cal=[]
        used_services={x["service_id"] for x in trips}
        for service in sorted(used_services):
            for day in active.get(service,[]):cal.append({"service_id":service,"date":day,"exception_type":1})
        write_csv(out/"calendar_dates.txt",["service_id","date","exception_type"],cal)
        if shape_rows:write_csv(out/"shapes.txt",["shape_id","shape_pt_lat","shape_pt_lon","shape_pt_sequence"],shape_rows)
        write_csv(out/"feed_info.txt",["feed_publisher_name","feed_publisher_url","feed_lang"],[
            {"feed_publisher_name":"U.Venice Transport / Trenitalia NAP bridge","feed_publisher_url":"https://www.cciss.it/","feed_lang":"it"}
        ])

        target.parent.mkdir(parents=True,exist_ok=True)
        tmp=target.with_suffix(target.suffix+".tmp")
        with zipfile.ZipFile(tmp,"w",zipfile.ZIP_DEFLATED) as zf:
            for path in sorted(out.iterdir()):zf.write(path,path.name)
        tmp.replace(target)
        return {
            "trips":len(trips),"stopTimes":len(stop_times),"stops":len(used_stops),
            "routes":len(routes),"calendarDates":len(cal),"shapes":len(used_shapes)
        }

def main(argv=None):
    p=argparse.ArgumentParser(description="Convert Italian NeTEx timetable data to minimal GTFS")
    p.add_argument("source");p.add_argument("target")
    p.add_argument("--agency-id",default="TI");p.add_argument("--agency-name",default="Trenitalia")
    p.add_argument("--agency-url",default="https://www.trenitalia.com/")
    a=p.parse_args(argv)
    stats=convert_netex_to_gtfs(Path(a.source),Path(a.target),agency_id=a.agency_id,agency_name=a.agency_name,agency_url=a.agency_url)
    print(stats);return 0

if __name__=="__main__":raise SystemExit(main())
