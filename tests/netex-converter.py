#!/usr/bin/env python3
import csv, datetime as dt, gzip, io, json, subprocess, sys, tempfile, zipfile
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"server"))
from netex_to_gtfs import convert_netex_to_gtfs

today=dt.datetime.now(ZoneInfo("Europe/Rome")).date()
start=today-dt.timedelta(days=2)
bits="1"*20
xml=f'''<?xml version="1.0" encoding="UTF-8"?>
<PublicationDelivery xmlns="http://www.netex.org.uk/netex">
  <dataObjects><CompositeFrame id="CF">
    <frames>
      <ServiceFrame id="SF">
        <lines>
          <Line id="L1"><Name>Venezia Mestre - Venezia S. Lucia</Name><ShortName>R</ShortName><TransportMode>rail</TransportMode></Line>
        </lines>
        <scheduledStopPoints>
          <ScheduledStopPoint id="M"><Name>Venezia Mestre</Name><PrivateCode>301000</PrivateCode><Location><Longitude>12.231</Longitude><Latitude>45.482</Latitude></Location></ScheduledStopPoint>
          <ScheduledStopPoint id="S"><Name>Venezia Santa Lucia</Name><PrivateCode>301001</PrivateCode><Location><Longitude>12.322</Longitude><Latitude>45.441</Latitude></Location></ScheduledStopPoint>
        </scheduledStopPoints>
        <destinationDisplays><DestinationDisplay id="D1"><FrontText>Venezia Santa Lucia</FrontText></DestinationDisplay></destinationDisplays>
        <journeyPatterns>
          <ServiceJourneyPattern id="P1">
            <RouteView><LineRef ref="L1"/></RouteView>
            <pointsInSequence>
              <StopPointInJourneyPattern id="P1-1" order="1"><ScheduledStopPointRef ref="M"/><ForBoarding>true</ForBoarding><ForAlighting>false</ForAlighting></StopPointInJourneyPattern>
              <StopPointInJourneyPattern id="P1-2" order="2"><ScheduledStopPointRef ref="S"/><ForBoarding>false</ForBoarding><ForAlighting>true</ForAlighting></StopPointInJourneyPattern>
            </pointsInSequence>
          </ServiceJourneyPattern>
        </journeyPatterns>
      </ServiceFrame>
      <ServiceCalendarFrame id="SC">
        <UicOperatingPeriod id="OP1"><FromDate>{start.isoformat()}</FromDate><ToDate>{(start+dt.timedelta(days=19)).isoformat()}</ToDate><ValidDayBits>{bits}</ValidDayBits></UicOperatingPeriod>
        <DayTypeAssignment id="A1"><DayTypeRef ref="DT1"/><OperatingPeriodRef ref="OP1"/></DayTypeAssignment>
      </ServiceCalendarFrame>
      <TimetableFrame id="TF">
        <vehicleJourneys>
          <ServiceJourney id="J1">
            <Name>1234</Name><JourneyPatternRef ref="P1"/><DestinationDisplayRef ref="D1"/>
            <dayTypes><DayTypeRef ref="DT1"/></dayTypes>
            <passingTimes>
              <TimetabledPassingTime><StopPointInJourneyPatternRef ref="P1-1"/><ArrivalTime>23:55:00</ArrivalTime><DepartureTime>23:55:00</DepartureTime></TimetabledPassingTime>
              <TimetabledPassingTime><StopPointInJourneyPatternRef ref="P1-2"/><ArrivalTime>00:10:00</ArrivalTime><DepartureTime>00:10:00</DepartureTime></TimetabledPassingTime>
            </passingTimes>
          </ServiceJourney>
        </vehicleJourneys>
      </TimetableFrame>
    </frames>
  </CompositeFrame></dataObjects>
</PublicationDelivery>'''

def rows(zf,name):
    with zf.open(name) as fh:return list(csv.DictReader(io.TextIOWrapper(fh,encoding="utf-8")))

with tempfile.TemporaryDirectory() as td:
    base=Path(td);src=base/"rail.xml.gz";gtfs=base/"rail.gtfs.zip"
    with gzip.open(src,"wb") as f:f.write(xml.encode())
    stats=convert_netex_to_gtfs(src,gtfs)
    assert stats["trips"]==1 and stats["stops"]==2 and stats["routes"]==1
    with zipfile.ZipFile(gtfs) as zf:
        assert {"agency.txt","stops.txt","routes.txt","trips.txt","stop_times.txt","calendar_dates.txt","shapes.txt"}<=set(zf.namelist())
        trip=rows(zf,"trips.txt")[0]; assert trip["trip_short_name"]=="1234" and trip["shape_id"]=="P1"
        st=rows(zf,"stop_times.txt"); assert st[0]["drop_off_type"]=="1" and st[1]["pickup_type"]=="1"
        assert st[1]["arrival_time"]=="24:10:00",st
        assert rows(zf,"stops.txt")[0]["stop_code"] in {"301000","301001"}
        assert rows(zf,"calendar_dates.txt")

    cfg={"outputDir":"runtime","workDir":"work","nice":0,"yieldEveryRows":0,"networks":{"rail":{
        "url":"file://"+str(src),"format":"netex","timeoutSeconds":20,"snapshotRetention":2,
        "agencyId":"TI","agencyName":"Trenitalia","agencyUrl":"https://www.trenitalia.com/"
    }}}
    cfgp=base/"builder-config.json";cfgp.write_text(json.dumps(cfg),encoding="utf-8")
    cp=subprocess.run([sys.executable,str(ROOT/"server/build_transit_data.py"),"--config",str(cfgp),"--network","rail"],capture_output=True,text=True)
    assert cp.returncode==0,(cp.stdout,cp.stderr)
    manifest=json.loads((base/"runtime/manifest.json").read_text())
    rail=manifest["networks"]["rail"];assert rail["sourceFormat"]=="netex"
    core=json.loads((base/"runtime"/rail["core"]["file"]).read_text())
    assert core["network"]=="rail" and core["routes"][0]["type"]==2 and core["trips"][0]["serviceId"]=="DT1"
    sched=json.loads((base/"runtime"/rail["schedule"]["file"]).read_text())
    chunk=json.loads((base/"runtime"/sched["chunks"][today.strftime("%Y%m%d")]["file"]).read_text())
    assert len(chunk["trips"])==1 and chunk["trips"][0][0]=="J1"
    print("RESULT: 14 NeTEx -> GTFS -> runtime rail checks passed.")
