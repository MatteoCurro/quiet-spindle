#!/usr/bin/env python3
"""Unlock Venice Transit 8.8 - standalone GTFS runtime-data builder.

Python 3 stdlib only. Designed for shared hosting: the schedule stage never
materializes stop_times.txt or the complete timetable in RAM. It partitions
stop-times into small on-disk buckets, then streams immutable per-day chunks.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
from typing import Dict, Iterable, List, Mapping, MutableMapping, Optional, Tuple
import urllib.error
import urllib.request
import zipfile

from netex_to_gtfs import CONVERTER_VERSION as NETEX_CONVERTER_VERSION, convert_netex_to_gtfs
from zoneinfo import ZoneInfo
import zlib

BUILDER_VERSION = "8.8.1-p5.3-service-date"
DEFAULT_CONFIG = "builder-config.json"
REQUIRED_NETWORK_FILES = ("routes.txt", "trips.txt", "stops.txt")
CORE_FILES = ("agency.txt", "routes.txt", "trips.txt", "stops.txt")
SHAPE_FILES = ("shapes.txt",)
SCHEDULE_FILES = (
    "agency.txt", "routes.txt", "stops.txt", "calendar.txt",
    "calendar_dates.txt", "trips.txt", "frequencies.txt", "transfers.txt",
    "stop_times.txt",
)
SCHEDULE_BUCKETS = 64
SCHEDULE_DAY_OFFSETS = tuple(range(-1, 7))  # legacy engine window: yesterday .. +6


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def stable_json_bytes(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")


def atomic_write(path: Path, data: bytes, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as fh:
            os.fchmod(fh.fileno(), mode)
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def atomic_publish_file(source: Path, target: Path, mode: int = 0o644) -> None:
    """Copy a potentially large prepared file atomically without read_bytes()."""
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.chmod(mode)
        return
    fd, temp_name = tempfile.mkstemp(prefix=target.name + ".", suffix=".tmp", dir=str(target.parent))
    try:
        with os.fdopen(fd, "wb") as out, source.open("rb") as src:
            os.fchmod(out.fileno(), mode)
            shutil.copyfileobj(src, out, length=1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp_name, target)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def load_json(path: Path, default):
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def csv_rows(data: bytes):
    text = data.decode("utf-8-sig", errors="replace")
    yield from csv.DictReader(io.StringIO(text))


def zip_csv_rows(zf: zipfile.ZipFile, name: str):
    try:
        raw = zf.open(name, "r")
    except KeyError:
        return
    with raw, io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace", newline="") as text:
        yield from csv.DictReader(text)


def float_or_none(value: Optional[str]):
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def int_or_none(value: Optional[str]):
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def gtfs_time_seconds(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    parts = value.split(":")
    if len(parts) != 3:
        return None
    try:
        h, m, sec = (int(x) for x in parts)
    except ValueError:
        return None
    if h < 0 or m < 0 or m > 59 or sec < 0 or sec > 59:
        return None
    return h * 3600 + m * 60 + sec


def validate_zip(zip_path: Path) -> None:
    with zipfile.ZipFile(zip_path, "r") as zf:
        names = set(zf.namelist())
        for required in REQUIRED_NETWORK_FILES:
            if required not in names:
                raise RuntimeError(f"GTFS non valido: manca {required}")


def read_zip_selected(zip_path: Path, wanted: Iterable[str]) -> Dict[str, bytes]:
    out: Dict[str, bytes] = {}
    with zipfile.ZipFile(zip_path, "r") as zf:
        names = set(zf.namelist())
        for name in wanted:
            if name in names:
                out[name] = zf.read(name)
    return out


def component_hash_from_zip(zip_path: Path, names: Iterable[str]) -> str:
    """Same hash contract as the old builder, but streams each member."""
    h = hashlib.sha256()
    found = False
    with zipfile.ZipFile(zip_path, "r") as zf:
        available = set(zf.namelist())
        for name in names:
            if name not in available:
                continue
            found = True
            member_hash = hashlib.sha256()
            with zf.open(name, "r") as fh:
                while True:
                    chunk = fh.read(1024 * 1024)
                    if not chunk:
                        break
                    member_hash.update(chunk)
            h.update(name.encode("utf-8"))
            h.update(b"\0")
            h.update(member_hash.digest())
            h.update(b"\0")
    return h.hexdigest() if found else ""


def augment_core_route_stops(zip_path: Path, core: MutableMapping) -> None:
    """Attach a compact static route -> stop index without materializing stop_times.txt.

    This is intentionally independent from the active 8-day schedule window:
    map stop visibility must not depend on whether a realtime TripUpdate happens
    to mention a stop right now.
    """
    trip_route = {str(t.get("id") or ""): str(t.get("routeId") or "") for t in core.get("trips", []) if t.get("id") and t.get("routeId")}
    route_stops: Dict[str, set] = {}
    with zipfile.ZipFile(zip_path, "r") as zf:
        for row in zip_csv_rows(zf, "stop_times.txt"):
            tid, sid = row.get("trip_id") or "", row.get("stop_id") or ""
            rid = trip_route.get(tid)
            if rid and sid:
                route_stops.setdefault(rid, set()).add(sid)
    core["routeStops"] = {rid: sorted(ids) for rid, ids in sorted(route_stops.items())}


def route_stops_hash_from_zip(zip_path: Path) -> str:
    """Hash only the trip/stop topology used by core.routeStops, not timetable values."""
    h = hashlib.sha256()
    with zipfile.ZipFile(zip_path, "r") as zf:
        for row in zip_csv_rows(zf, "stop_times.txt"):
            tid, sid = row.get("trip_id") or "", row.get("stop_id") or ""
            if not tid or not sid:
                continue
            h.update(tid.encode("utf-8")); h.update(b"\0")
            h.update(sid.encode("utf-8")); h.update(b"\n")
    return h.hexdigest()


def normalize_core(files: Mapping[str, bytes], network: str) -> Dict:
    agencies = []
    if files.get("agency.txt"):
        for r in csv_rows(files["agency.txt"]):
            agencies.append({"id": r.get("agency_id") or "", "name": r.get("agency_name") or "", "url": r.get("agency_url") or "", "timezone": r.get("agency_timezone") or ""})
    routes = []
    for r in csv_rows(files["routes.txt"]):
        routes.append({
            "id": r.get("route_id") or "", "agencyId": r.get("agency_id") or "",
            "short": r.get("route_short_name") or "", "long": r.get("route_long_name") or "",
            "desc": r.get("route_desc") or "", "type": int_or_none(r.get("route_type")),
            "color": r.get("route_color") or "", "textColor": r.get("route_text_color") or "",
            "sortOrder": int_or_none(r.get("route_sort_order")),
        })
    trips = []
    route_shapes: Dict[str, set] = {}
    for r in csv_rows(files["trips.txt"]):
        route_id, shape_id = r.get("route_id") or "", r.get("shape_id") or ""
        trips.append({
            "id": r.get("trip_id") or "", "routeId": route_id, "serviceId": r.get("service_id") or "",
            "headsign": r.get("trip_headsign") or "", "shortName": r.get("trip_short_name") or "",
            "directionId": r.get("direction_id") if r.get("direction_id") not in (None, "") else None,
            "blockId": r.get("block_id") or "", "shapeId": shape_id,
            "wheelchairAccessible": int_or_none(r.get("wheelchair_accessible")),
            "bikesAllowed": int_or_none(r.get("bikes_allowed")),
        })
        if shape_id:
            route_shapes.setdefault(route_id, set()).add(shape_id)
    stops = []
    for r in csv_rows(files["stops.txt"]):
        stops.append({
            "id": r.get("stop_id") or "", "code": r.get("stop_code") or "", "name": r.get("stop_name") or "",
            "desc": r.get("stop_desc") or "", "lat": float_or_none(r.get("stop_lat")), "lon": float_or_none(r.get("stop_lon")),
            "locationType": int_or_none(r.get("location_type")), "parentStation": r.get("parent_station") or "",
            "platformCode": r.get("platform_code") or "", "wheelchairBoarding": int_or_none(r.get("wheelchair_boarding")),
        })
    routes.sort(key=lambda x: (x["short"], x["id"])); trips.sort(key=lambda x: x["id"]); stops.sort(key=lambda x: x["id"])
    return {"schema": 1, "network": network, "agencies": agencies, "routes": routes, "trips": trips, "stops": stops,
            "routeShapes": {k: sorted(v) for k, v in sorted(route_shapes.items())}}


def normalize_shapes(files: Mapping[str, bytes], network: str) -> Dict:
    grouped: Dict[str, List[Tuple[int, float, float, Optional[float]]]] = {}
    data = files.get("shapes.txt")
    if not data:
        return {"schema": 1, "network": network, "shapes": {}}
    for r in csv_rows(data):
        sid = r.get("shape_id") or ""
        lat, lon = float_or_none(r.get("shape_pt_lat")), float_or_none(r.get("shape_pt_lon"))
        if not sid or lat is None or lon is None:
            continue
        grouped.setdefault(sid, []).append((int_or_none(r.get("shape_pt_sequence")) or 0, lat, lon, float_or_none(r.get("shape_dist_traveled"))))
    shapes = {}
    for sid, pts in grouped.items():
        pts.sort(key=lambda p: p[0])
        shapes[sid] = [[p[1], p[2], p[3]] for p in pts] if any(p[3] is not None for p in pts) else [[p[1], p[2]] for p in pts]
    return {"schema": 1, "network": network, "shapes": dict(sorted(shapes.items()))}


def schedule_timezone_from_zip(zip_path: Path) -> str:
    with zipfile.ZipFile(zip_path, "r") as zf:
        for row in zip_csv_rows(zf, "agency.txt"):
            value = row.get("agency_timezone") or ""
            if value:
                try:
                    ZoneInfo(value)
                    return value
                except Exception:
                    pass
    return "Europe/Rome"


def schedule_build_day_from_zip(zip_path: Path) -> str:
    timezone = schedule_timezone_from_zip(zip_path)
    return dt.datetime.now(ZoneInfo(timezone)).strftime("%Y%m%d")


def current_rss_mb() -> Optional[float]:
    try:
        with open("/proc/self/status", "r", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) / 1024.0
    except Exception:
        return None
    return None


def maybe_yield(counter: int, cfg: Mapping) -> None:
    every = max(0, int(cfg.get("yieldEveryRows", 5000)))
    if every and counter and counter % every == 0:
        max_rss = float(cfg.get("maxRssMb", 0) or 0)
        rss = current_rss_mb()
        if max_rss and rss is not None and rss > max_rss:
            raise RuntimeError(f"Memoria builder oltre limite configurato: {rss:.0f} MB > {max_rss:.0f} MB")
        pause = float(cfg.get("yieldSleepSeconds", 0.02) or 0)
        if pause > 0:
            time.sleep(pause)


class DayChunkWriter:
    def __init__(self, path: Path, network: str, day: str):
        self.path = path
        self.network = network
        self.day = day
        self.count = 0
        self._fh = path.open("w", encoding="utf-8", newline="")
        self._fh.write(json.dumps({"schema": 2, "network": network, "day": day}, ensure_ascii=False, separators=(",", ":"))[:-1])
        self._fh.write(',"trips":[')
        self._first = True

    def append(self, payload) -> None:
        if not self._first:
            self._fh.write(",")
        self._first = False
        self._fh.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        self.count += 1

    def close(self) -> None:
        if self._fh.closed:
            return
        self._fh.write("]}\n")
        self._fh.flush(); os.fsync(self._fh.fileno()); self._fh.close()


def schedule_bundle_exists(output_dir: Path, schedule_name: str) -> bool:
    if not schedule_name:
        return False
    path = output_dir / schedule_name
    index = load_json(path, None)
    if not index or index.get("schema") != 2 or not isinstance(index.get("chunks"), dict):
        return False
    return all((output_dir / info.get("file", "")).exists() for info in index["chunks"].values())


def schedule_service_dates(output_dir: Path, schedule_name: str) -> List[str]:
    index = load_json(output_dir / schedule_name, {})
    days = []
    for day in index.get("days", []):
        meta = index.get("chunks", {}).get(day, {})
        if int(meta.get("trips", 0) or 0) > 0:
            days.append(day)
    return days


def snapshot_bundle_usable(output_dir: Path, snapshot: Mapping) -> bool:
    core_file = snapshot.get("core", {}).get("file", "")
    schedule_file = snapshot.get("schedule", {}).get("file", "")
    shapes_file = (snapshot.get("shapes") or {}).get("file", "")
    if not core_file or not (output_dir / core_file).exists():
        return False
    if shapes_file and not (output_dir / shapes_file).exists():
        return False
    return schedule_bundle_exists(output_dir, schedule_file)


def legacy_snapshot_from_entry(entry: Mapping, output_dir: Path) -> Optional[Dict]:
    if not entry or not entry.get("core", {}).get("file") or not entry.get("schedule", {}).get("file"):
        return None
    source_hash = entry.get("sourceZipSha256") or entry.get("scheduleSourceSha256") or entry["schedule"]["file"]
    schedule_file = entry["schedule"]["file"]
    index = load_json(output_dir / schedule_file, {})
    days = [d for d in index.get("days", []) if int(index.get("chunks", {}).get(d, {}).get("trips", 0) or 0) > 0]
    window = index.get("days", [])
    snapshot = {
        "id": f"legacy-{str(source_hash)[:16]}",
        "sourceZipSha256": entry.get("sourceZipSha256", ""),
        "core": entry["core"],
        "shapes": entry.get("shapes"),
        "schedule": entry["schedule"],
        "serviceDates": days,
        "window": {"from": window[0], "to": window[-1]} if window else None,
    }
    return snapshot if snapshot_bundle_usable(output_dir, snapshot) else None


def runtime_window_days(zip_path: Path) -> List[str]:
    timezone = schedule_timezone_from_zip(zip_path)
    today = dt.datetime.now(ZoneInfo(timezone)).date()
    return [(today + dt.timedelta(days=o)).strftime("%Y%m%d") for o in SCHEDULE_DAY_OFFSETS]


def calendar_active_days(zip_path: Path, days: Iterable[str]) -> List[str]:
    days = list(days)
    if not days:
        return []
    with zipfile.ZipFile(zip_path, "r") as zf:
        used_services = {row.get("service_id") or "" for row in zip_csv_rows(zf, "trips.txt") if row.get("service_id")}
        calendar = {row.get("service_id") or "": row for row in zip_csv_rows(zf, "calendar.txt") if row.get("service_id")}
        exceptions = {}
        for row in zip_csv_rows(zf, "calendar_dates.txt"):
            sid, day_key = row.get("service_id") or "", row.get("date") or ""
            etype = int_or_none(row.get("exception_type"))
            if sid and day_key and etype is not None:
                exceptions[(sid, day_key)] = etype
    weekday_fields = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
    parsed = {d: dt.datetime.strptime(d, "%Y%m%d").date() for d in days}
    active_days = []
    for day_key in days:
        active = False
        for service_id in used_services:
            ex = exceptions.get((service_id, day_key))
            row = calendar.get(service_id)
            if ex is not None:
                service_active = ex == 1
            elif not row or day_key < (row.get("start_date") or "") or day_key > (row.get("end_date") or ""):
                service_active = False
            else:
                service_active = row.get(weekday_fields[parsed[day_key].weekday()]) == "1"
            if service_active:
                active = True; break
        if active:
            active_days.append(day_key)
    return active_days


def refresh_runtime_snapshot(snapshot: Mapping, network: str, output_dir: Path, work_dir: Path,
                             cfg: Mapping) -> Tuple[Dict, bool]:
    snapshot = dict(snapshot)
    source_hash = snapshot.get("sourceZipSha256") or ""
    archive = work_dir / "snapshots" / network / f"{source_hash}.zip"
    if not source_hash or not archive.exists():
        return snapshot, False
    wanted_days = runtime_window_days(archive)
    if not calendar_active_days(archive, wanted_days):
        return snapshot, False
    schedule_day = schedule_build_day_from_zip(archive)
    if snapshot.get("schedule", {}).get("day") == schedule_day and snapshot_bundle_usable(output_dir, snapshot):
        return snapshot, False
    schedule_hash = component_hash_from_zip(archive, SCHEDULE_FILES)
    schedule_name, schedule_data_hash, _files, _stats = build_schedule_bundle(
        archive, network, output_dir, work_dir, schedule_hash, cfg)
    index = load_json(output_dir / schedule_name, {})
    index_days = index.get("days", [])
    snapshot["schedule"] = {"file": schedule_name, "sha256": schedule_data_hash, "day": schedule_day, "schema": 2}
    snapshot["serviceDates"] = schedule_service_dates(output_dir, schedule_name)
    snapshot["window"] = {"from": index_days[0], "to": index_days[-1]} if index_days else None
    return snapshot, True


def retain_runtime_snapshots(previous_entry: Mapping, current_snapshot: Dict, output_dir: Path,
                             work_dir: Path, network: str, cfg: Mapping, keep: int) -> Tuple[List[Dict], bool]:
    previous = list(previous_entry.get("snapshots", [])) if isinstance(previous_entry.get("snapshots"), list) else []
    if not previous:
        legacy = legacy_snapshot_from_entry(previous_entry, output_dir)
        if legacy:
            previous = [legacy]
    rows, seen, refreshed = [], set(), False
    current_key = current_snapshot.get("sourceZipSha256") or current_snapshot.get("id") or current_snapshot.get("schedule", {}).get("file")
    for snapshot in [current_snapshot] + previous:
        key = snapshot.get("sourceZipSha256") or snapshot.get("id") or snapshot.get("schedule", {}).get("file")
        if not key or key in seen:
            continue
        if key != current_key:
            snapshot, changed = refresh_runtime_snapshot(snapshot, network, output_dir, work_dir, cfg)
            refreshed = refreshed or changed
        if not snapshot_bundle_usable(output_dir, snapshot):
            continue
        seen.add(key); rows.append(snapshot)
        if len(rows) >= max(2, keep):
            break
    return rows, refreshed


def runtime_snapshot_files(snapshot: Mapping, output_dir: Path) -> List[str]:
    names = []
    for component in ("core", "shapes", "schedule"):
        file_name = (snapshot.get(component) or {}).get("file", "")
        if file_name:
            names.append(file_name)
    schedule_name = (snapshot.get("schedule") or {}).get("file", "")
    index = load_json(output_dir / schedule_name, {}) if schedule_name else {}
    names.extend(meta.get("file", "") for meta in index.get("chunks", {}).values() if meta.get("file"))
    return names


def archive_gtfs_snapshot(zip_path: Path, work_dir: Path, network: str, source_hash: str, keep: int) -> None:
    target_dir = work_dir / "snapshots" / network
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{source_hash}.zip"
    if not target.exists():
        shutil.copyfile(zip_path, target)
    files = sorted(target_dir.glob("*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in files[max(2, keep):]:
        old.unlink(missing_ok=True)


def build_schedule_bundle(zip_path: Path, network: str, output_dir: Path, work_dir: Path,
                          schedule_source_hash: str, cfg: Mapping) -> Tuple[str, str, List[str], Dict]:
    """Build a small index plus per-day trip chunks with bounded RAM usage."""
    started = time.time()
    timezone = schedule_timezone_from_zip(zip_path)
    zone = ZoneInfo(timezone)
    today = dt.datetime.now(zone).date()
    days = [(today + dt.timedelta(days=o)).strftime("%Y%m%d") for o in SCHEDULE_DAY_OFFSETS]

    with tempfile.TemporaryDirectory(prefix=f"{network}-schedule-", dir=str(work_dir)) as tmp_name:
        tmp = Path(tmp_name)
        bucket_dir = tmp / "buckets"; bucket_dir.mkdir()
        day_dir = tmp / "days"; day_dir.mkdir()

        with zipfile.ZipFile(zip_path, "r") as zf:
            calendar: Dict[str, Dict[str, str]] = {}
            for row in zip_csv_rows(zf, "calendar.txt"):
                sid = row.get("service_id") or ""
                if sid:
                    calendar[sid] = row
            exceptions: Dict[Tuple[str, str], int] = {}
            for row in zip_csv_rows(zf, "calendar_dates.txt"):
                sid, day_key = row.get("service_id") or "", row.get("date") or ""
                etype = int_or_none(row.get("exception_type"))
                if sid and day_key and etype is not None:
                    exceptions[(sid, day_key)] = etype
            if not calendar and not exceptions:
                raise RuntimeError(f"GTFS {network}: calendario di servizio assente")

            weekday_fields = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
            parsed_days = {d: dt.datetime.strptime(d, "%Y%m%d").date() for d in days}
            service_cache: Dict[str, List[str]] = {}
            def active_dates(service_id: str) -> List[str]:
                if service_id in service_cache:
                    return service_cache[service_id]
                result = []
                row = calendar.get(service_id)
                for day_key in days:
                    ex = exceptions.get((service_id, day_key))
                    if ex is not None:
                        active = ex == 1
                    elif not row or day_key < (row.get("start_date") or "") or day_key > (row.get("end_date") or ""):
                        active = False
                    else:
                        active = row.get(weekday_fields[parsed_days[day_key].weekday()]) == "1"
                    if active:
                        result.append(day_key)
                service_cache[service_id] = result
                return result

            routes: Dict[str, List] = {}
            for row in zip_csv_rows(zf, "routes.txt"):
                rid = row.get("route_id") or ""
                if rid:
                    routes[rid] = [rid, row.get("route_short_name") or row.get("route_long_name") or rid, int_or_none(row.get("route_type"))]

            frequency_trips = {row.get("trip_id") or "" for row in zip_csv_rows(zf, "frequencies.txt") if row.get("trip_id")}
            trips: Dict[str, Tuple[str, str, str, Tuple[str, ...]]] = {}
            for row in zip_csv_rows(zf, "trips.txt"):
                tid, rid, service = row.get("trip_id") or "", row.get("route_id") or "", row.get("service_id") or ""
                if not tid or tid in frequency_trips or rid not in routes:
                    continue
                active = active_dates(service)
                if active:
                    trips[tid] = (rid, row.get("trip_headsign") or "", row.get("shape_id") or "", tuple(active))

            stops: Dict[str, List] = {}
            for row in zip_csv_rows(zf, "stops.txt"):
                sid = row.get("stop_id") or ""
                lat, lon = float_or_none(row.get("stop_lat")), float_or_none(row.get("stop_lon"))
                if sid and lat is not None and lon is not None:
                    stops[sid] = [sid, row.get("stop_name") or sid, lat, lon, row.get("parent_station") or ""]

            # Partition stop_times to disk. Only active trips enter the spools.
            bucket_handles = []
            bucket_writers = []
            try:
                for i in range(SCHEDULE_BUCKETS):
                    fh = (bucket_dir / f"{i:02d}.tsv").open("w", encoding="utf-8", newline="")
                    bucket_handles.append(fh)
                    bucket_writers.append(csv.writer(fh, delimiter="\t", lineterminator="\n"))
                seen_rows = kept_rows = 0
                for row in zip_csv_rows(zf, "stop_times.txt"):
                    seen_rows += 1
                    tid, sid = row.get("trip_id") or "", row.get("stop_id") or ""
                    if tid not in trips or sid not in stops:
                        maybe_yield(seen_rows, cfg); continue
                    arr, dep = gtfs_time_seconds(row.get("arrival_time")), gtfs_time_seconds(row.get("departure_time"))
                    arr = dep if arr is None else arr; dep = arr if dep is None else dep
                    seq = int_or_none(row.get("stop_sequence"))
                    if arr is None or dep is None or seq is None:
                        maybe_yield(seen_rows, cfg); continue
                    bucket = zlib.crc32(tid.encode("utf-8")) % SCHEDULE_BUCKETS
                    bucket_writers[bucket].writerow([tid, sid, seq, arr, dep,
                                                     1 if row.get("pickup_type") in (None, "", "0") else 0,
                                                     1 if row.get("drop_off_type") in (None, "", "0") else 0])
                    kept_rows += 1
                    maybe_yield(seen_rows, cfg)
            finally:
                for fh in bucket_handles:
                    fh.close()

            day_writers = {day: DayChunkWriter(day_dir / f"{day}.json", network, day) for day in days}
            used_stops, used_routes = set(), set()
            valid_trips = 0
            try:
                for i in range(SCHEDULE_BUCKETS):
                    grouped: Dict[str, List[List[int | str]]] = {}
                    path = bucket_dir / f"{i:02d}.tsv"
                    with path.open("r", encoding="utf-8", newline="") as fh:
                        for row in csv.reader(fh, delimiter="\t"):
                            if len(row) != 7:
                                continue
                            tid, sid = row[0], row[1]
                            grouped.setdefault(tid, []).append([sid, int(row[2]), int(row[3]), int(row[4]), int(row[5]), int(row[6])])
                    for tid, stop_rows in grouped.items():
                        stop_rows.sort(key=lambda x: x[1])
                        if len(stop_rows) < 2:
                            continue
                        trip = trips.get(tid)
                        if not trip:
                            continue
                        rid, headsign, shape_id, active = trip
                        payload = [tid, rid, headsign, shape_id, stop_rows]
                        for day in active:
                            day_writers[day].append(payload)
                        used_routes.add(rid); used_stops.update(s[0] for s in stop_rows); valid_trips += 1
                    grouped.clear()
                    path.unlink(missing_ok=True)
                    maybe_yield((i + 1) * 25000, cfg)
            finally:
                for writer in day_writers.values():
                    writer.close()

            if not valid_trips:
                raise RuntimeError(f"GTFS {network}: nessuna corsa valida nella finestra runtime")

            transfers = []
            transfer_rules = []
            for row in zip_csv_rows(zf, "transfers.txt"):
                transfer_rules.append({k: row.get(k, "") for k in ("from_stop_id", "to_stop_id", "from_trip_id", "to_trip_id", "from_route_id", "to_route_id", "transfer_type", "min_transfer_time")})
                sid = row.get("from_stop_id") or ""
                if sid != (row.get("to_stop_id") or "") or sid not in used_stops:
                    continue
                if any(row.get(k) for k in ("from_trip_id", "to_trip_id", "from_route_id", "to_route_id")):
                    continue
                seconds = 10**12 if row.get("transfer_type") == "3" else max(120, int_or_none(row.get("min_transfer_time")) or 0)
                transfers.append([sid, seconds])

        chunk_entries = {}
        published_names = []
        for day, writer in day_writers.items():
            src = writer.path
            digest = sha256_file(src)
            name = f"{network}-schedule-day-{day}.{digest[:12]}.json"
            atomic_publish_file(src, output_dir / name, 0o644)
            chunk_entries[day] = {"file": name, "sha256": digest, "trips": writer.count}
            published_names.append(name)

        index = {
            "schema": 2, "network": network, "timezone": timezone,
            "buildDay": today.strftime("%Y%m%d"), "days": days,
            "routes": sorted((routes[r] for r in used_routes), key=lambda x: (x[1], x[0])),
            "stops": sorted((stops[s] for s in used_stops), key=lambda x: x[0]),
            "transfers": sorted(transfers, key=lambda x: x[0]),
            "transferRules": transfer_rules,
            "chunks": chunk_entries, "sourceHash": schedule_source_hash,
        }
        index_bytes = stable_json_bytes(index)
        index_hash = sha256_bytes(index_bytes)
        index_name = f"{network}-schedule.{index_hash[:12]}.json"
        atomic_write(output_dir / index_name, index_bytes, 0o644)
        published_names.append(index_name)
        stats = {
            "sourceStopTimes": seen_rows, "keptStopTimes": kept_rows, "validTrips": valid_trips,
            "days": len(days), "seconds": round(time.time() - started, 2), "rssMb": current_rss_mb(),
        }
        return index_name, index_hash, published_names, stats


def _copy_local_source(source: str, target: Path) -> Tuple[bool, Dict[str, str]]:
    src = Path(source[7:]) if source.startswith("file://") else Path(source)
    if not src.exists():
        raise RuntimeError(f"Sorgente GTFS locale non trovata: {src}")
    target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(src, target)
    return True, {}


def download_gtfs(source: str, target: Path, previous: Mapping, timeout: int = 60) -> Tuple[bool, Dict[str, str]]:
    if source.startswith("file://") or ("://" not in source and Path(source).exists()):
        return _copy_local_source(source, target)
    headers = {"User-Agent": "U.VeniceTransport/ACTV-direct"}
    if previous.get("etag"): headers["If-None-Match"] = previous["etag"]
    if previous.get("lastModified"): headers["If-Modified-Since"] = previous["lastModified"]
    request = urllib.request.Request(source, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, temp_name = tempfile.mkstemp(prefix=target.name + ".", suffix=".tmp", dir=str(target.parent))
            try:
                with os.fdopen(fd, "wb") as fh:
                    shutil.copyfileobj(response, fh); fh.flush(); os.fsync(fh.fileno())
                os.replace(temp_name, target)
            except Exception:
                try: os.unlink(temp_name)
                except OSError: pass
                raise
            return True, {"etag": response.headers.get("ETag") or "", "lastModified": response.headers.get("Last-Modified") or ""}
    except urllib.error.HTTPError as exc:
        if exc.code == 304 and target.exists():
            return False, {"etag": previous.get("etag", ""), "lastModified": previous.get("lastModified", "")}
        raise


def acquire_lock(path: Path, stale_seconds: int = 7200):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        age = time.time() - path.stat().st_mtime
        if age > stale_seconds: path.unlink(missing_ok=True)
        else: raise RuntimeError(f"Builder già in esecuzione: {path}")
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    os.write(fd, f"pid={os.getpid()} started={utc_now()}\n".encode("utf-8")); os.close(fd)


def ensure_public_file_modes(output_dir: Path) -> None:
    for path in output_dir.glob("*.json"):
        try: path.chmod(0o644)
        except FileNotFoundError: pass


def clean_old_versioned_files(output_dir: Path, network: str, current_names: Iterable[str], keep: int = 2) -> None:
    current = set(current_names)
    for component in ("core", "shapes", "schedule"):
        files = sorted(output_dir.glob(f"{network}-{component}.*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        retained = 0
        for path in files:
            if path.name in current: retained += 1; continue
            if retained < keep: retained += 1; continue
            path.unlink(missing_ok=True)
    per_day: Dict[str, List[Path]] = {}
    rx = re.compile(rf"^{re.escape(network)}-schedule-day-(\d{{8}})\.[^.]+\.json$")
    for path in output_dir.glob(f"{network}-schedule-day-*.json"):
        m = rx.match(path.name)
        if m: per_day.setdefault(m.group(1), []).append(path)
    for paths in per_day.values():
        paths.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        retained = 0
        for path in paths:
            if path.name in current: retained += 1; continue
            if retained < keep: retained += 1; continue
            path.unlink(missing_ok=True)


def network_source(cfg: Mapping) -> Optional[str]:
    env_name = str(cfg.get("envUrl", "") or "").strip()
    if env_name:
        value = str(os.environ.get(env_name, "") or "").strip()
        if value:
            return value
    value = str(cfg.get("url", "") or "").strip()
    return value or None


def build_network(network: str, cfg: Mapping, output_dir: Path, work_dir: Path, state: MutableMapping,
                  previous_entry: Optional[Mapping] = None, force: bool = False) -> Tuple[Dict, bool]:
    source = network_source(cfg)
    if not source:
        raise RuntimeError(f"Sorgente GTFS non configurata per {network}")
    net_state = state.setdefault("networks", {}).setdefault(network, {})
    source_format = str(cfg.get("format", "gtfs") or "gtfs").strip().lower()
    if source_format not in ("gtfs", "netex"):
        raise RuntimeError(f"Formato sorgente non supportato per {network}: {source_format}")
    cache_zip = work_dir / f"{network}.gtfs.zip"
    source_cache = cache_zip if source_format == "gtfs" else work_dir / f"{network}.netex.source"
    downloaded, response_headers = download_gtfs(source, source_cache, net_state, int(cfg.get("timeoutSeconds", 60)))
    source_asset_hash = sha256_file(source_cache)

    conversion_key = ""
    if source_format == "netex":
        conversion_key = hashlib.sha256((
            source_asset_hash + "\0" + NETEX_CONVERTER_VERSION + "\0" +
            str(cfg.get("agencyId", "")) + "\0" + str(cfg.get("agencyName", "")) + "\0" +
            str(cfg.get("agencyUrl", ""))
        ).encode("utf-8")).hexdigest()
        if force or conversion_key != net_state.get("conversionKey") or not cache_zip.exists():
            stats = convert_netex_to_gtfs(
                source_cache, cache_zip,
                agency_id=str(cfg.get("agencyId", "TI") or "TI"),
                agency_name=str(cfg.get("agencyName", "Trenitalia") or "Trenitalia"),
                agency_url=str(cfg.get("agencyUrl", "https://www.trenitalia.com/") or "https://www.trenitalia.com/")
            )
            print(f"{network}: NeTEx -> GTFS {stats['trips']} corse / {stats['stops']} fermate")
    validate_zip(cache_zip)

    zip_hash = sha256_file(cache_zip)
    snapshot_retention = max(2, int(cfg.get("snapshotRetention", 6) or 6))
    archive_gtfs_snapshot(cache_zip, work_dir, network, zip_hash, snapshot_retention)
    core_base_hash = component_hash_from_zip(cache_zip, CORE_FILES)
    route_stops_hash = route_stops_hash_from_zip(cache_zip)
    core_hash = hashlib.sha256((core_base_hash + "\0" + route_stops_hash).encode("ascii")).hexdigest()
    shapes_hash = component_hash_from_zip(cache_zip, SHAPE_FILES)
    schedule_hash = component_hash_from_zip(cache_zip, SCHEDULE_FILES)
    schedule_day = schedule_build_day_from_zip(cache_zip)

    current = net_state.get("current", {})
    core_name, shapes_name, schedule_name = current.get("core", ""), current.get("shapes", ""), current.get("schedule", "")
    schedule_data_hash = net_state.get("scheduleDataHash", "")
    changed_public = False

    if force or core_hash != net_state.get("coreHash") or not core_name or not (output_dir / core_name).exists():
        core_files = read_zip_selected(cache_zip, CORE_FILES)
        core = normalize_core(core_files, network)
        augment_core_route_stops(cache_zip, core)
        core["sourceHash"] = core_hash
        core_name = f"{network}-core.{core_hash[:12]}.json"
        atomic_write(output_dir / core_name, stable_json_bytes(core), 0o644)
        del core, core_files
        changed_public = True

    if shapes_hash:
        if force or shapes_hash != net_state.get("shapesHash") or not shapes_name or not (output_dir / shapes_name).exists():
            shape_files = read_zip_selected(cache_zip, SHAPE_FILES)
            shapes = normalize_shapes(shape_files, network); shapes["sourceHash"] = shapes_hash
            shapes_name = f"{network}-shapes.{shapes_hash[:12]}.json"
            atomic_write(output_dir / shapes_name, stable_json_bytes(shapes), 0o644)
            del shapes, shape_files
            changed_public = True
    else:
        shapes_name = ""

    schedule_files_current: List[str] = []
    if (force or schedule_hash != net_state.get("scheduleSourceHash") or schedule_day != net_state.get("scheduleDay") or
            not schedule_data_hash or not schedule_bundle_exists(output_dir, schedule_name)):
        schedule_name, schedule_data_hash, schedule_files_current, stats = build_schedule_bundle(
            cache_zip, network, output_dir, work_dir, schedule_hash, cfg)
        changed_public = True
        rss_text = f", RSS {stats['rssMb']:.0f} MB" if stats.get("rssMb") is not None else ""
        print(f"{network}: schedule {stats['validTrips']} corse / {stats['keptStopTimes']} stop_times in {stats['seconds']}s{rss_text}")
    else:
        existing = load_json(output_dir / schedule_name, {})
        schedule_files_current = [schedule_name] + [v.get("file", "") for v in existing.get("chunks", {}).values() if v.get("file")]

    net_state.update({
        "url": source, "etag": response_headers.get("etag", net_state.get("etag", "")),
        "lastModified": response_headers.get("lastModified", net_state.get("lastModified", "")),
        "sourceFormat": source_format, "sourceAssetHash": source_asset_hash, "conversionKey": conversion_key,
        "sourceZipHash": zip_hash, "coreHash": core_hash, "shapesHash": shapes_hash,
        "scheduleSourceHash": schedule_hash, "scheduleDataHash": schedule_data_hash, "scheduleDay": schedule_day,
        "current": {"core": core_name, "shapes": shapes_name, "schedule": schedule_name},
        "lastCheckedAt": utc_now(), "downloaded": bool(downloaded),
    })
    schedule_meta = {"file": schedule_name, "sha256": schedule_data_hash, "day": schedule_day, "schema": 2}
    index = load_json(output_dir / schedule_name, {})
    active_service_dates = schedule_service_dates(output_dir, schedule_name)
    index_days = index.get("days", [])
    current_snapshot = {
        "id": zip_hash[:16],
        "sourceZipSha256": zip_hash,
        "core": {"file": core_name, "sha256": core_hash},
        "shapes": {"file": shapes_name, "sha256": shapes_hash} if shapes_name else None,
        "schedule": schedule_meta,
        "serviceDates": active_service_dates,
        "window": {"from": index_days[0], "to": index_days[-1]} if index_days else None,
    }
    snapshots, refreshed_snapshots = retain_runtime_snapshots(
        previous_entry or {}, current_snapshot, output_dir, work_dir, network, cfg, snapshot_retention)
    changed_public = changed_public or refreshed_snapshots
    entry = {
        "source": source, "sourceFormat": source_format,
        "sourceAssetSha256": source_asset_hash, "sourceZipSha256": zip_hash,
        "core": current_snapshot["core"],
        "shapes": current_snapshot["shapes"],
        "schedule": schedule_meta,
        "scheduleSourceSha256": schedule_hash,
        "snapshots": snapshots,
    }
    current_names = []
    for snapshot in snapshots:
        current_names.extend(runtime_snapshot_files(snapshot, output_dir))
    clean_old_versioned_files(output_dir, network, current_names)
    return entry, changed_public


def build(config_path: Path, only_network: str = "all", force: bool = False, dry_run: bool = False) -> int:
    config = load_json(config_path, None)
    if not config: raise RuntimeError(f"Configurazione non valida: {config_path}")
    try:
        nice = int(config.get("nice", 15))
        if nice > 0: os.nice(nice)
    except (AttributeError, OSError, ValueError):
        pass

    base = config_path.parent.resolve()
    output_dir = (base / config.get("outputDir", "../runtime-data")).resolve()
    work_dir = (base / config.get("workDir", "./.builder-cache")).resolve()
    state_path, lock_path = work_dir / "state.json", work_dir / "builder.lock"
    output_dir.mkdir(parents=True, exist_ok=True); work_dir.mkdir(parents=True, exist_ok=True)
    acquire_lock(lock_path)
    try:
        state = load_json(state_path, {"schema": 1, "builderVersion": BUILDER_VERSION, "networks": {}})
        state["builderVersion"] = BUILDER_VERSION
        previous_manifest = load_json(output_dir / "manifest.json", {})
        requested = list(config.get("networks", {}).keys())
        if only_network != "all":
            if only_network not in requested: raise RuntimeError(f"Rete sconosciuta: {only_network}")
            requested = [only_network]
        manifest_networks = dict(previous_manifest.get("networks", {})); public_changed = False
        for network in requested:
            network_cfg = config["networks"][network]
            if not network_source(network_cfg) and bool(network_cfg.get("optional", False)):
                if only_network == network:
                    raise RuntimeError(f"Rete opzionale {network} non configurata")
                print(f"{network}: sorgente opzionale non configurata, skip")
                continue
            entry, changed = build_network(
                network, network_cfg, output_dir, work_dir, state,
                previous_entry=previous_manifest.get("networks", {}).get(network, {}), force=force)
            manifest_networks[network] = entry; public_changed = public_changed or changed
        candidate = {"schema": 1, "builderVersion": BUILDER_VERSION, "networks": manifest_networks}
        comparable_previous = {k: previous_manifest.get(k) for k in ("schema", "builderVersion", "networks")}
        manifest_changed = candidate != comparable_previous
        state["lastRunAt"] = utc_now(); atomic_write(state_path, stable_json_bytes(state))
        if dry_run:
            print(json.dumps({"dryRun": True, "manifestChanged": manifest_changed, "publicChanged": public_changed}, indent=2)); return 0
        if manifest_changed:
            candidate["publishedAt"] = utc_now(); atomic_write(output_dir / "manifest.json", stable_json_bytes(candidate), 0o644)
            print(f"manifest aggiornato: {output_dir / 'manifest.json'}")
        else:
            print("nessun cambiamento pubblico: manifest invariato")
        ensure_public_file_modes(output_dir); return 0
    finally:
        lock_path.unlink(missing_ok=True)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Build static runtime datasets for Unlock Venice Transit")
    parser.add_argument("--config", default=DEFAULT_CONFIG, help="Path to builder-config.json")
    parser.add_argument("--network", default="all", help="Configured network key or all")
    parser.add_argument("--force", action="store_true", help="Regenerate versioned files even if component hashes are unchanged")
    parser.add_argument("--dry-run", action="store_true", help="Build state/data but do not publish manifest")
    args = parser.parse_args(argv)
    try:
        return build(Path(args.config).resolve(), args.network, args.force, args.dry_run)
    except Exception as exc:
        print(f"ERRORE: {exc}", file=sys.stderr); return 1


if __name__ == "__main__":
    raise SystemExit(main())
