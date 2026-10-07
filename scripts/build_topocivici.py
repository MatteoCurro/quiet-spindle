#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ARCGIS = 'https://arcgis-prd.comune.venezia.it/server/rest/services/MAPPE_BASE/InstantSearch_TopoCivici/MapServer/4/query'
PROXY = 'https://geoportale.comune.venezia.it/Html5Viewer/proxy.ashx?'
PAGE_SIZE = 2000
SHARD_SIZE = 128
USER_AGENT = 'u-venice-transport-address-builder/1.0'
SMALL_WORDS = {'a','al','alla','alle','allo','ai','agli','da','dal','dalla','dalle','dallo','de','del','della','delle','dello','dei','degli','di','e','in','nel','nella','nelle','nello','nei','negli'}


def normalize(value):
    text = unicodedata.normalize('NFD', str(value or ''))
    text = ''.join(ch for ch in text if unicodedata.category(ch) != 'Mn')
    text = text.lower().replace('’', "'")
    text = re.sub(r"[^a-z0-9']+", ' ', text)
    return re.sub(r'\s+', ' ', text).strip()


def street_core(value):
    text = normalize(value)
    return re.sub(r'^(?:via|viale|piazza|piazzale|corso|calle|campo|fondamenta|riva|strada|salizada|rio tera)\s+', '', text).strip()


def humanize_street(value):
    words = re.split(r'(\s+)', str(value or '').strip())
    out = []
    token_index = 0
    for token in words:
        if token.isspace():
            out.append(token)
            continue
        low = token.lower()
        if token_index and low in SMALL_WORDS:
            out.append(low)
        else:
            pieces = token.split('-')
            fixed = []
            for piece in pieces:
                if not piece:
                    fixed.append(piece)
                else:
                    fixed.append(piece[:1].upper() + piece[1:].lower())
            out.append('-'.join(fixed))
        token_index += 1
    return ''.join(out)


def request_json(params, attempts=4):
    target = ARCGIS + '?' + urllib.parse.urlencode({**params, 'f': 'json'})
    url = PROXY + target
    last = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': USER_AGENT,
                'Referer': 'https://geoportale.comune.venezia.it/'
            })
            with urllib.request.urlopen(req, timeout=45) as response:
                data = json.load(response)
            if data.get('error'):
                raise RuntimeError(data['error'])
            return data
        except Exception as exc:
            last = exc
            if attempt + 1 < attempts:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f'TopoCivici request failed: {last}')


def geometry_center(geometry):
    if not geometry:
        return None
    if isinstance(geometry.get('x'), (int, float)) and isinstance(geometry.get('y'), (int, float)):
        return float(geometry['y']), float(geometry['x'])
    points = []
    for key in ('points', 'paths', 'rings'):
        value = geometry.get(key) or []
        sequences = [value] if key == 'points' else value
        for seq in sequences:
            for point in seq or []:
                if isinstance(point, (list, tuple)) and len(point) >= 2:
                    x, y = point[0], point[1]
                    if isinstance(x, (int, float)) and isinstance(y, (int, float)):
                        points.append((float(y), float(x)))
    if not points:
        return None
    return (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))


def clean_sub(value):
    sub = str(value or '').strip()
    return '' if sub in {'', '_', '-'} else sub.upper()


def civic_label(num, sub):
    num = str(num or '').strip()
    if not num:
        return ''
    sub = clean_sub(sub)
    return f'{num}/{sub}' if sub else num


def derive_street(attrs):
    """INDIRIZZO is the canonical searchable label in TopoCivici.

    DENOMINAZIONE_X_VIA is not consistently a plain street name across the
    dataset, so derive the street deterministically by removing the separate
    civic fields from the end of INDIRIZZO. This also preserves numeric street
    names such as VIA 20 SETTEMBRE.
    """
    address = str(attrs.get('INDIRIZZO') or '').strip()
    raw_num = str(attrs.get('CIVICO_NUM') or '').strip()
    sub = clean_sub(attrs.get('CIVICO_SUB'))
    if address and raw_num:
        num = re.escape(raw_num)
        if sub:
            pattern = rf'\s+{num}\s*(?:/\s*)?{re.escape(sub)}\s*$'
            stripped = re.sub(pattern, '', address, flags=re.I)
            if stripped != address:
                return stripped.strip()
        stripped = re.sub(rf'\s+{num}\s*$', '', address, flags=re.I)
        if stripped != address:
            return stripped.strip()
    direct = str(attrs.get('DENOMINAZIONE_X_VIA') or '').strip()
    return direct


def natural_house_key(value):
    text = str(value or '').upper().replace(' ', '')
    m = re.match(r'^(\d+)(?:[/.-]?([A-Z0-9]+))?$', text)
    if not m:
        return (10**9, text)
    return (int(m.group(1)), m.group(2) or '')


def fetch_features():
    count_data = request_json({'where': '1=1', 'returnCountOnly': 'true'})
    expected = int(count_data.get('count') or 0)
    if expected < 80000:
        raise RuntimeError(f'Unexpected TopoCivici count: {expected}')
    features = []
    fields = 'OBJECTID,CIVICO_NUM,CIVICO_SUB,INDIRIZZO,DENOMINAZIONE_X_VIA,DENOMINAZIONE_X_SESTIERE'
    for offset in range(0, expected, PAGE_SIZE):
        page = request_json({
            'where': '1=1',
            'outFields': fields,
            'returnGeometry': 'true',
            'outSR': '4326',
            'resultOffset': str(offset),
            'resultRecordCount': str(PAGE_SIZE),
            'orderByFields': 'OBJECTID',
        })
        rows = page.get('features') or []
        if not rows:
            raise RuntimeError(f'Empty page at offset {offset}')
        features.extend(rows)
        print(f'TopoCivici {min(offset + len(rows), expected)}/{expected}', flush=True)
    ids = {int((f.get('attributes') or {}).get('OBJECTID')) for f in features if (f.get('attributes') or {}).get('OBJECTID') is not None}
    if len(ids) < expected * 0.995:
        raise RuntimeError(f'Incomplete/duplicated dataset: expected {expected}, unique {len(ids)}')
    return expected, features


def build(output):
    expected, features = fetch_features()
    grouped = defaultdict(lambda: {'raw_names': defaultdict(int), 'houses': defaultdict(list), 'zone': defaultdict(int)})
    skipped = 0
    for feature in features:
        attrs = feature.get('attributes') or {}
        house = civic_label(attrs.get('CIVICO_NUM'), attrs.get('CIVICO_SUB'))
        street_raw = derive_street(attrs)
        center = geometry_center(feature.get('geometry') or {})
        if not house or not street_raw or not center:
            skipped += 1
            continue
        key = normalize(street_raw)
        if not key:
            skipped += 1
            continue
        group = grouped[key]
        group['raw_names'][street_raw] += 1
        zone = str(attrs.get('DENOMINAZIONE_X_SESTIERE') or '').strip()
        if zone:
            group['zone'][zone] += 1
        group['houses'][house.upper().replace(' ', '')].append(center)

    if len(grouped) < 1000:
        sample = [name for name in sorted(grouped)[:20]]
        raise RuntimeError(f'Too few streets produced: {len(grouped)} sample={sample}')

    streets_payload = []
    shard_payloads = defaultdict(dict)
    indexed_civics = 0
    sorted_groups = sorted(grouped.items(), key=lambda item: item[0])
    for street_id, (key, group) in enumerate(sorted_groups):
        raw_name = max(group['raw_names'].items(), key=lambda item: (item[1], len(item[0])))[0]
        name = humanize_street(raw_name)
        civics = []
        lat_sum = lon_sum = 0.0
        for house_key, coords in sorted(group['houses'].items(), key=lambda item: natural_house_key(item[0])):
            lat = round(sum(p[0] for p in coords) / len(coords), 6)
            lon = round(sum(p[1] for p in coords) / len(coords), 6)
            house = house_key.replace('-', '/').replace('.', '/')
            civics.append([house, lat, lon])
            lat_sum += lat
            lon_sum += lon
        if not civics:
            continue
        indexed_civics += len(civics)
        shard = street_id // SHARD_SIZE
        zone = max(group['zone'].items(), key=lambda item: item[1])[0] if group['zone'] else ''
        streets_payload.append({
            'id': street_id,
            'name': name,
            'key': key,
            'core': street_core(raw_name),
            'lat': round(lat_sum / len(civics), 6),
            'lon': round(lon_sum / len(civics), 6),
            'shard': shard,
            'count': len(civics),
            'zone': humanize_street(zone) if zone else ''
        })
        shard_payloads[shard][str(street_id)] = civics

    if indexed_civics < 70000:
        raise RuntimeError(f'Too few civics produced: {indexed_civics}')

    digest_source = json.dumps([[s['key'], s['count']] for s in streets_payload], ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    digest = hashlib.sha256(digest_source).hexdigest()[:10]
    now = datetime.now(timezone.utc)
    generated = now.replace(microsecond=0).isoformat().replace('+00:00', 'Z')
    version = now.strftime('%Y%m%dT%H%M%SZ') + '-' + digest
    root = Path(output)
    version_dir = root / version
    shards_dir = version_dir / 'shards'
    shards_dir.mkdir(parents=True, exist_ok=True)

    streets_doc = {'schema': 1, 'version': version, 'streets': streets_payload}
    (version_dir / 'streets.json').write_text(json.dumps(streets_doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    for shard, data in sorted(shard_payloads.items()):
        doc = {'schema': 1, 'version': version, 'streets': data}
        (shards_dir / f'{shard:03d}.json').write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    manifest = {
        'schema': 1,
        'provider': 'Comune di Venezia - TopoCivici',
        'generated_at': generated,
        'version': version,
        'source_records': expected,
        'indexed_civics': indexed_civics,
        'streets': len(streets_payload),
        'shards': len(shard_payloads),
        'index': f'{version}/streets.json',
        'shard_base': f'{version}/shards/'
    }
    (root / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    smoke = next((s for s in streets_payload if s['core'] == 'torino'), None)
    if not smoke:
        candidates = [s['name'] for s in streets_payload if 'torino' in s['key']][:20]
        raise RuntimeError(f'Smoke street Via Torino not found; candidates={candidates}')
    smoke_shard = shard_payloads[smoke['shard']][str(smoke['id'])]
    if not any(row[0] == '155' for row in smoke_shard):
        raise RuntimeError('Smoke civic Via Torino 155 not found')

    total_bytes = sum(p.stat().st_size for p in root.rglob('*.json'))
    print(json.dumps({**manifest, 'bytes': total_bytes, 'skipped': skipped}, ensure_ascii=False, indent=2))
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='address-dist')
    args = parser.parse_args()
    build(args.output)


if __name__ == '__main__':
    main()
