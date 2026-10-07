#!/usr/bin/env python3
"""Build normalized AVM/Actv service alerts for Unlock Venice.

Stdlib-only collector. The public Telegram channel is the low-latency source.
The output is a delivery-neutral event feed suitable for web UI today and
native APNs/FCM fan-out later.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import tempfile
import urllib.request
from zoneinfo import ZoneInfo
from typing import Iterable, Optional

SCHEMA_VERSION = 1
TELEGRAM_URL = "https://t.me/s/muoversivenezia"
ACTV_NEWS_URL = "https://actv.avmspa.it/it/rss-news-feed"
USER_AGENT = "UnlockVeniceTransit/8.12 (+https://www.unlockvenice.com/)"

CATEGORY_LABELS = {
    "service_interruption": "Interruzione del servizio",
    "service_restriction": "Servizio limitato",
    "replacement_service": "Servizio sostitutivo",
    "service_restored": "Servizio ripristinato",
    "route_diversion": "Deviazione",
    "stop_change": "Fermata o approdo",
    "schedule_change": "Modifica orari",
    "planned_service_change": "Modifica programmata",
    "service_enhancement": "Potenziamento del servizio",
    "general_service_info": "Informazione di servizio",
}

OPERATIONAL_TERMS = (
    "servizio", "linea", "linee", "fermata", "approdo", "capolinea", "tram",
    "autobus", "bus", "navigazione", "vaporet", "traghetto", "people mover",
    "devia", "sospes", "interrott", "ripristin", "regolare", "orario",
    "corse", "trasporto pubblico", "frazionat", "non operativo", "non è operativo",
    "alta marea", "spostat", "riattiv", "modific",
)

ROUTE_TOKEN = re.compile(
    r"(?<![A-Z0-9])(?:T[12]|ST1|SA|N(?:LN|MU|1|2)?|HE|"
    r"\d{1,2}(?:\.[12]|/|[A-Z]{1,3})?)(?![A-Z0-9])",
    re.I,
)


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def clean_text(value: str) -> str:
    value = html.unescape(value or "").replace("\xa0", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\s*\n\s*", "\n", value)
    return value.strip()


def slug(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


class TelegramParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items = []
        self.current = None
        self.depth = 0
        self.text_depth = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = set((attrs.get("class") or "").split())
        if tag == "div" and "tgme_widget_message" in classes and attrs.get("data-post"):
            self.current = {"post": attrs["data-post"], "text_parts": [], "links": [], "publishedAt": None}
            self.depth = 1
            self.text_depth = None
            return
        if not self.current:
            return
        if tag == "div":
            self.depth += 1
            if "tgme_widget_message_text" in classes:
                self.text_depth = self.depth
        if tag == "br" and self.text_depth is not None:
            self.current["text_parts"].append("\n")
        if tag == "a":
            href = attrs.get("href")
            if href and self.text_depth is not None:
                self.current["links"].append(href)
        if tag == "time" and attrs.get("datetime"):
            self.current["publishedAt"] = attrs["datetime"]

    def handle_data(self, data):
        if self.current and self.text_depth is not None:
            self.current["text_parts"].append(data)

    def handle_endtag(self, tag):
        if not self.current:
            return
        if tag == "div":
            if self.text_depth == self.depth:
                self.text_depth = None
            self.depth -= 1
            if self.depth == 0:
                text = clean_text("".join(self.current.pop("text_parts")))
                if text:
                    self.current["text"] = text
                    self.items.append(self.current)
                self.current = None


def parse_telegram(html_text: str) -> list[dict]:
    parser = TelegramParser()
    parser.feed(html_text)
    return parser.items


class ActvNewsParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag != "a":
            return
        href = attrs.get("href") or ""
        if "/it/content/" not in href:
            return
        if href.startswith("/"):
            href = "https://actv.avmspa.it" + href
        elif href.startswith("http://actv.avmspa.it/"):
            href = "https://" + href[len("http://"):]
        self.current = {"url": href, "text": []}

    def handle_data(self, data):
        if self.current:
            self.current["text"].append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self.current:
            title = clean_text("".join(self.current["text"]))
            if title and title.lower() not in ("leggi tutto", "read more"):
                self.items.append({"url": self.current["url"], "text": title})
            self.current = None


def parse_actv_news(html_text: str) -> list[dict]:
    parser = ActvNewsParser()
    parser.feed(html_text)
    unique = {}
    for item in parser.items:
        unique.setdefault(item["url"], item)
    return list(unique.values())


MONTHS_IT = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}
ROME = ZoneInfo("Europe/Rome")


class ActvArticleParser(HTMLParser):
    BLOCKS = {"p","li","h1","h2","h3","h4","br","tr","div"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root_tag = None
        self.in_root = False
        self.parts = []
        self.all_parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script","style","noscript","svg"):
            self.skip += 1
            return
        if not self.in_root and tag in ("main","article"):
            self.root_tag = tag
            self.in_root = True
        if not self.skip and tag in self.BLOCKS:
            self.all_parts.append("\n")
            if self.in_root:
                self.parts.append("\n")

    def handle_startendtag(self, tag, attrs):
        if not self.skip and tag in self.BLOCKS:
            self.all_parts.append("\n")
            if self.in_root:
                self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script","style","noscript","svg") and self.skip:
            self.skip -= 1
            return
        if not self.skip and tag in self.BLOCKS:
            self.all_parts.append("\n")
            if self.in_root:
                self.parts.append("\n")
        if self.in_root and tag == self.root_tag and not self.skip:
            self.in_root = False

    def handle_data(self, data):
        if self.skip:
            return
        self.all_parts.append(data)
        if self.in_root:
            self.parts.append(data)

def parse_actv_article(html_text: str, title: Optional[str] = None) -> str:
    parser = ActvArticleParser()
    parser.feed(html_text)
    preferred = parser.parts if any(clean_text(x) for x in parser.parts) else parser.all_parts
    text = clean_text(" ".join(preferred))
    if title:
        # ACTV repeats the page title in <title>/navigation and again as the
        # actual article heading. The last occurrence is the editorial body.
        pos = text.lower().rfind(clean_text(title).lower())
        if pos >= 0:
            text = text[pos:]
    for marker in ("\nAzienda\n", "\nServizi\n", "\nPrivacy Policy"):
        if marker in text:
            text = text.split(marker, 1)[0].strip()
    return text[:12000]


def actv_article_has_operational_detail(article: str, title: str) -> bool:
    text = clean_text(article)
    low = text.lower()
    title_low = clean_text(title).lower()
    if not text or len(text) < len(title_low) + 60:
        return False
    if any(x in low for x in ("toggle navigation", "form di ricerca", "salta al contenuto principale")):
        return False
    has_date = bool(italian_date_iso(text))
    has_detail = any(x in low for x in (
        "avm/actv informa", "linea ", "linee ", "fermata", "approdo",
        "deviazione", "percorso", "servizio", "sospes", "spostat",
    ))
    return has_date and has_detail


def italian_date_iso(text: str) -> Optional[str]:
    m = re.search(
        r"(?<!\d)(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(20\d{2})(?!\d)",
        text, flags=re.I
    )
    if not m:
        return None
    day, month, year = int(m.group(1)), MONTHS_IT[m.group(2).lower()], int(m.group(3))
    value = dt.datetime(year, month, day, 0, 0, tzinfo=ROME)
    return value.isoformat()


def transport_news_hint(text: str) -> bool:
    cleaned = clean_text(text)
    low = cleaned.lower()
    headline = low.split("\n", 1)[0]
    # Editorial/navigation exclusions apply to the listing title only: an
    # operational ACTV page can legitimately contain Privacy/Cookies in its footer.
    if any(x in headline for x in (
        "iat", "bigliettazione", "abbonament", "candidati", "selezione del personale",
        "condizioni generali di trasporto", "società trasparente", "privacy", "cookie",
    )):
        return False
    return bool(re.search(
        r"\bline(?:a|e)\b|\bbus\b|\btram\b|navigazione|vaporet|traghetto|ferry|"
        r"fermata|approdo|capolinea|trasporto|servizio|deviaz|sospens|spostamento|percorso|"
        r"regata|partita|fiera|manifestazione|maratona|evento",
        low
    ))


def enrich_actv_news(items: list[dict], max_articles: int = 8) -> list[dict]:
    out = []
    fetched = 0
    for item in items:
        enriched = dict(item)
        enriched["articleEnriched"] = False
        title = clean_text(item.get("text", ""))
        if fetched < max_articles and transport_news_hint(title):
            try:
                article = parse_actv_article(fetch_text(item["url"], timeout=15), title=title)
                if actv_article_has_operational_detail(article, title):
                    enriched["title"] = title
                    enriched["text"] = clean_text(article)
                    enriched["publishedAt"] = italian_date_iso(article)
                    enriched["articleEnriched"] = True
                    fetched += 1
            except Exception as exc:
                enriched["articleError"] = str(exc)
        out.append(enriched)
    return out


def iso_dt(value: Optional[str]) -> Optional[dt.datetime]:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=ROME)
    except Exception:
        return None


def italian_point(text: str, prefix: str, end_of_day: bool = False) -> Optional[str]:
    pattern = (
        prefix +
        r"[^\n]{0,55}?(?:(\d{1,2})[.:](\d{2})[^\n]{0,35}?)?"
        r"(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(20\d{2})"
    )
    m = re.search(pattern, text, flags=re.I)
    if not m:
        return None
    hour = int(m.group(1)) if m.group(1) is not None else (23 if end_of_day else 0)
    minute = int(m.group(2)) if m.group(2) is not None else (59 if end_of_day else 0)
    day, month, year = int(m.group(3)), MONTHS_IT[m.group(4).lower()], int(m.group(5))
    if hour == 24:
        value = dt.datetime(year, month, day, 0, minute, tzinfo=ROME) + dt.timedelta(days=1)
    else:
        value = dt.datetime(year, month, day, hour, minute, tzinfo=ROME)
    return value.isoformat()


def extract_validity(text: str, published_at: Optional[str] = None) -> dict:
    label = extract_validity_label(text)
    range_start, range_end = explicit_date_window(text)
    start = range_start or italian_point(text, r"(?:dalle\s+ore|da\s+inizio\s+servizi|a\s+partire\s+da)")
    if not start:
        start = italian_point(text, r"(?:da|dal|dalla)\s+(?:luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)?\s*")
    end = range_end or italian_point(text, r"(?:fino\s+(?:al|a)|\balle(?:\s+ore)?)", end_of_day=True)
    if not start and end and published_at:
        start = published_at
    return {"startsAt": start, "endsAt": end, "label": label}


def lifecycle_for_window(lifecycle: str, validity: dict, now_iso: str) -> str:
    if lifecycle == "resolved":
        return "resolved"
    now = iso_dt(now_iso)
    start = iso_dt(validity.get("startsAt"))
    end = iso_dt(validity.get("endsAt"))
    if not now:
        return lifecycle
    if end and now > end:
        return "resolved"
    if start and now >= start and (not end or now <= end):
        return "active"
    if start and now < start:
        return "planned"
    return lifecycle


def fetch_text(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def is_relevant(text: str) -> bool:
    low = text.lower()
    promotional = ("bigliettazione", "abbonamento", "sconto", "candidati", "promozione")
    strong = (
        "sostitutiv", "ripristin", "torna progressivamente regolare", "deviaz",
        "sospes", "interrott", "non operativo", "non è operativo", "frazionat",
        "spostat", "riattiv", "alta marea", "chiusura al traffico", "modifiche ai servizi", "variazion",
    )
    if any(term in low for term in promotional) and not any(term in low for term in strong):
        return False
    return any(term in low for term in OPERATIONAL_TERMS) and (
        "#muoversivenezia" in low
        or "servizio infomobilità" in low
        or any(term in low for term in strong)
    )


def detect_networks(text: str) -> list[str]:
    low = text.lower()
    out = []
    def add(x):
        if x not in out:
            out.append(x)
    if re.search(r"\btram\b|\btranvi\w*|\bt1\b|\bt2\b|\bst1\b", low):
        add("tram")
    if any(x in low for x in ("navigazione", "vaporet", "approdo", "motonave", "⛴", "🛳")):
        add("water")
    if "nave traghetto" in low or re.search(r"\bferry\b", low):
        add("ferry")
    if re.search(r"\bautobus\b|\bbus\b|\bautomobilistic\w*", low) or "🚍" in low or "🚌" in low:
        add("bus")
    if "people mover" in low:
        add("people_mover")
    return out or ["transit"]


def extract_lines(text: str) -> list[str]:
    lines = set()
    for match in re.finditer(r"\bline(?:a|e)\b", text, flags=re.I):
        segment = text[match.end():match.end()+190]
        segment = re.split(r"[\n;:]|(?<!\d)\.(?!\d)", segment, maxsplit=1)[0]
        for token in ROUTE_TOKEN.findall(segment):
            token = token.upper()
            if token == "N":
                continue
            lines.add(token)
    for token in re.findall(r"\b(?:T1|T2|ST1)\b", text, flags=re.I):
        lines.add(token.upper())
    return sorted(lines, key=lambda x: (not x.startswith("T"), x))


def planned_hint(low: str) -> bool:
    return any(w in low for w in (
        "dalle ore", "alle ore", "da lun", "da mart", "da merc", "da giov",
        "da vener", "da sab", "da domen", "da inizio servizi", "fino a ",
        "nelle notti", "per lavori", "manutenzione", "ordinanza",
        "programm", "in occasione", "a partire da",
    ))


def extract_directions(text: str) -> list[str]:
    low = text.lower()
    if "entrambe le direzioni" in low:
        return ["both"]
    out = []
    for match in re.finditer(r"\bdirezione\s+([^\n,.;]+)", text, flags=re.I):
        value = clean_text(match.group(1))
        value = re.split(r"\s+(?:il|con|per|e)\s+", value, maxsplit=1, flags=re.I)[0].strip(" -")
        value = re.split(r"\s+(?:delle|dalle|alle|ore)\s+\d{1,2}", value, maxsplit=1, flags=re.I)[0].strip(" -")
        if value and len(value) <= 40:
            out.append(value)
    return list(dict.fromkeys(out))


def extract_stop_refs(text: str) -> list[str]:
    out = []

    # Strong ACTV form with numeric stop code. Preserve the code: opposite
    # directions often have different codes even when the stop name is equal.
    coded = re.compile(
        r"\bfermat(?:a|e)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ0-9.'’/ -]{1,55}?)\s+cod\.?\s*(\d+)"
        r"(?:[^\n.;]{0,80}?\be\s+(\d+)\s+direzione\b)?",
        flags=re.I,
    )
    for m in coded.finditer(text):
        base = clean_text(m.group(1)).strip(" -–—\"“”")
        for code in (m.group(2), m.group(3)):
            if code:
                value = f"{base} cod. {code}"
                if value not in out:
                    out.append(value)

    patterns = (
        r"\b(?:fermata|approdo|capolinea)\s+(?:di\s+)?(.{1,90}?)(?=,\s*(?:direzione|viene|sarà|sono|sospes|spostat|posticipat|anticipat|ripristinat|riattivat)|[.;]|$)",
        r"\b([A-ZÀ-Ý][A-Za-zÀ-ÿ.'’/-]*(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ.'’/-]*){0,4}\s+[\"“]?[A-Z][\"”]?)\s+sospes[oa]\b",
    )
    for pattern in patterns:
        for m in re.finditer(pattern, text, flags=re.I):
            value = clean_text(m.group(1))
            value = re.split(r"\s+(?:per|dalle|dal|da|fino|direzione|viene|sarà|sono|sospes\w*|spostat\w*|posticipat\w*|anticipat\w*|ripristinat\w*|riattivat\w*)\b", value, maxsplit=1, flags=re.I)[0]
            value = value.strip(" -–—\"“”")
            if re.search(r"\bcod\.?\s*\d+\b", value, flags=re.I) or re.search(r"\bcod\.?$", value, flags=re.I):
                continue
            if 2 <= len(value) <= 70 and value not in out:
                out.append(value)
    return out[:12]


def extract_segments(text: str) -> list[dict]:
    out = []
    patterns = (
        r"\bnel tratto\s+([^\n,.;]+?)\s+-\s+([^\n,.;]+?)(?=\s+direzione|\s+in entrambe|[\n,.;]|$)",
        r"\bLinea\s+(?:T1|T2)\s+(?!nel tratto\b)([^\n,.;]+?)\s+-\s+([^\n,.;]+?)(?=\s+direzione|\s+in entrambe|[\n,.;]|$)",
    )
    for pattern in patterns:
        for match in re.finditer(pattern, text, flags=re.I):
            a, b = clean_text(match.group(1)).strip(" -"), clean_text(match.group(2)).strip(" -")
            if a and b and len(a) <= 60 and len(b) <= 60:
                item = {"from": a, "to": b}
                if item not in out:
                    out.append(item)
    return out


def detect_category(text: str) -> tuple[str, str, str, bool]:
    low = text.lower()
    planned = planned_hint(low)
    stop_words = ("fermata", "fermate", "approdo", "approdi", "capolinea")
    implicit_stop = bool(re.search(r"\b(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ.'’/-]*\s+){1,5}[\"“]?[A-Z][\"”]?\s+sospes[oa]\b", text))
    stop_context = any(w in low for w in stop_words) or implicit_stop

    if stop_context and any(w in low for w in (
        "sospes", "spostat", "posticipat", "anticipat", "ripristin", "riattiv",
    )):
        if "ripristin" in low or "riattiv" in low:
            return "stop_change", "resolved", "info", False
        return "stop_change", "planned" if planned else "active", "minor", planned

    if re.search(r"torna(?:no)?(?: progressivamente)? regolar|ripristinat|riprende(?:no)? il regolare", low):
        return "service_restored", "resolved", "info", False

    if "sostitutiv" in low:
        return "replacement_service", "planned" if planned else "active", "major", planned

    if any(w in low for w in (
        "frazionat", "servizio limitat", "servizio ridott", "corse limitate",
        "non garantito", "sospeso il transito", "sospensione del transito",
    )) or re.search(r"\bcorse?\b.{0,60}\b(?:limitat\w*|sospes\w*)", low, flags=re.S):
        return "service_restriction", "planned" if planned else "active", "major", planned

    if re.search(
        r"servizio.{0,55}(?:interrott|sospes)|temporaneamente interrott|"
        r"(?:impianto|servizio).{0,45}non (?:è )?operativ",
        low, flags=re.S
    ):
        return "service_interruption", "planned" if planned else "active", "major", planned

    if "deviaz" in low:
        return "route_diversion", "planned" if planned else "active", "minor", planned

    if "orario" in low or "orari" in low:
        return "schedule_change", "planned", "info", True

    if "modifiche" in low or "modifica" in low or "variazion" in low:
        return "planned_service_change", "planned" if planned else "informational", "info", planned

    if "potenzi" in low or "rinforzo" in low:
        return "service_enhancement", "planned", "info", True

    return "general_service_info", "informational", "info", False

def detect_cause(text: str) -> str:
    low = text.lower()
    for key, terms in (
        ("breakdown", ("avaria", "guasto")),
        ("maintenance", ("manutenzione", "lavori", "cantiere", "asfaltatura")),
        ("road_closure", ("chiusura al traffico", "chiusura di via", "chiusura del centro")),
        ("event", ("manifestazione", "fiera", "mercato", "partita", "regata")),
        ("weather", ("nebbia", "vento", "maltempo", "acqua alta", "alta marea", "marea")),
        ("strike", ("sciopero",)),
        ("operational", ("infomobilità", "servizio sostitutivo")),
    ):
        if any(term in low for term in terms):
            return key
    return "unspecified"



def detect_effects(text: str, primary: str) -> list[str]:
    low = text.lower()
    out = [primary]
    def add(value):
        if value not in out:
            out.append(value)
    if "sostitutiv" in low:
        add("replacement_service")
    if "deviaz" in low:
        add("route_diversion")
    if any(w in low for w in ("fermata", "approdo", "capolinea")) or re.search(r"\b(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ.'’/-]*\s+){1,5}[\"“]?[A-Z][\"”]?\s+sospes[oa]\b", text):
        if any(w in low for w in ("sospes", "spostat", "posticipat", "anticipat", "ripristin", "riattiv")):
            add("stop_change")
    if any(w in low for w in ("frazionat", "servizio limitat", "servizio ridott", "sospeso il transito", "sospensione del transito")) or re.search(r"\bcorse?\b.{0,60}\b(?:limitat\w*|sospes\w*)", low, flags=re.S):
        add("service_restriction")
    if re.search(r"servizio.{0,55}(?:interrott|sospes)|temporaneamente interrott", low, flags=re.S):
        add("service_interruption")
    if "orario" in low or "orari" in low:
        add("schedule_change")
    if "modific" in low or "variazion" in low:
        add("planned_service_change")
    return out

def extract_validity_label(text: str) -> Optional[str]:
    month = r"(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)"
    weekday = r"(?:luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)"
    patterns = (
        rf"\bda\s+{weekday}\s+\d{{1,2}}(?:°)?\s+a\s+{weekday}\s+\d{{1,2}}(?:°)?\s+{month}\s+20\d{{2}}",
        rf"\bdalle\s+ore\s+\d{{1,2}}[.:]\d{{2}}(?:\s+di)?\s+{weekday}\s+\d{{1,2}}(?:°)?\s+{month}\s+20\d{{2}}(?:\s+e\s+fino\s+al\s+termine\s+dei\s+lavori)?",
        rf"\bfino\s+a\s+{weekday}\s+\d{{1,2}}(?:°)?\s+{month}\s+20\d{{2}}",
        rf"\b{weekday}\s+\d{{1,2}}(?:°)?\s+{month}\s+20\d{{2}}",
    )
    low = text.lower()
    for pattern in patterns:
        m = re.search(pattern, low, flags=re.I)
        if m:
            return clean_text(text[m.start():m.end()])
    for line in text.splitlines():
        low_line = line.lower()
        if any(x in low_line for x in ("dalle ore", "fino al termine", "da inizio servizi")):
            return clean_text(line)[:140]
    return None


def explicit_date_window(text: str) -> tuple[Optional[str], Optional[str]]:
    weekday = r"(?:luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)"
    month = r"(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)"

    # Italian shorthand: "da giovedì 1 a domenica 4 ottobre 2026".
    m = re.search(
        rf"\bda\s+{weekday}\s+(\d{{1,2}})(?:°)?\s+a\s+{weekday}\s+(\d{{1,2}})(?:°)?\s+{month}\s+(20\d{{2}})",
        text, flags=re.I
    )
    if m:
        first, last, month_name, year = int(m.group(1)), int(m.group(2)), m.group(3).lower(), int(m.group(4))
        start = dt.datetime(year, MONTHS_IT[month_name], first, 0, 0, tzinfo=ROME)
        end = dt.datetime(year, MONTHS_IT[month_name], last, 23, 59, tzinfo=ROME)
        return start.isoformat(), end.isoformat()

    # A weekday-qualified single date is normally the operating/event day,
    # unlike the bare publication date at the top of ACTV articles.
    m = re.search(
        rf"\b{weekday}\s+(\d{{1,2}})(?:°)?\s+{month}\s+(20\d{{2}})",
        text, flags=re.I
    )
    if m:
        prefix = text[max(0, m.start()-70):m.start()].lower()
        # "fino a mercoledì..." is an end boundary, while
        # "dalle ore ... di lunedì..." / "da lunedì..." is a start boundary.
        # Those are handled by italian_point and must not become one-day events.
        if not re.search(r"(?:fino\s+a|dalle\s+ore[^\n]{0,35}|\bda)\s*$", prefix):
            day, month_name, year = int(m.group(1)), m.group(2).lower(), int(m.group(3))
            start = dt.datetime(year, MONTHS_IT[month_name], day, 0, 0, tzinfo=ROME)
            end = dt.datetime(year, MONTHS_IT[month_name], day, 23, 59, tzinfo=ROME)
            return start.isoformat(), end.isoformat()

    return None, None

def extract_areas(text: str) -> list[str]:
    areas = []
    for line in text.splitlines()[:2]:
        m = re.search(r"\|\s*([^\n]+)$", line)
        if m:
            value = clean_text(m.group(1))
            value = re.sub(r"\s*\+{2,}.*$", "", value).strip()
            value = re.sub(r"\s+[-–—]?\s*(?:AGGIORNAMENTO|UPDATE)\b.*$", "", value, flags=re.I).strip()
            if 1 < len(value) <= 60 and value.lower() not in ("orario autunnale servizio di navigazione",):
                areas.append(value)
    if not areas:
        m = re.search(r"#muoversivenezia[^\n]*?\b(Venezia|Mestre|Marghera|Mirano|Lido|Murano|Pellestrina|Chioggia)\b", text, re.I)
        if m:
            areas.append(m.group(1).title())
    return list(dict.fromkeys(areas))


def canonical_url(links: Iterable[str], fallback: str) -> str:
    links = [x for x in links if x.startswith(("http://", "https://"))]
    for link in links:
        if "actv.avmspa.it/" in link or "avm.avmspa.it/" in link:
            return link
    return links[0] if links else fallback


def build_event(item: dict, fetched_at: str) -> Optional[dict]:
    text = clean_text(item.get("text", ""))
    if not is_relevant(text):
        return None
    post = item.get("post") or ""
    source_id = post.rsplit("/", 1)[-1] if "/" in post else post
    message_url = f"https://t.me/{post}" if post else TELEGRAM_URL
    category, lifecycle, severity, planned = detect_category(text)
    networks = detect_networks(text)
    lines = extract_lines(text)
    areas = extract_areas(text)
    published_at = item.get("publishedAt") or fetched_at
    source_url = canonical_url(item.get("links", []), message_url)
    validity = extract_validity(text, published_at)
    if not validity.get("startsAt") and not planned:
        validity["startsAt"] = published_at
    lifecycle = lifecycle_for_window(lifecycle, validity, fetched_at)
    title = CATEGORY_LABELS[category]
    if lines:
        title += " · " + ", ".join(lines[:8])
    version = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    event_id = f"avm-telegram-{source_id or version}"
    effects = detect_effects(text, category)
    topics = sorted(set(
        ["alerts:all", f"category:{category}", f"severity:{severity}"] + [f"effect:{x}" for x in effects]
        + [f"network:{x}" for x in networks]
        + [f"line:{x}" for x in lines]
        + [f"area:{slug(x)}" for x in areas if slug(x)]
    ))
    push_eligible = severity in ("minor", "major", "critical") and lifecycle in ("active", "planned")
    return {
        "id": event_id,
        "version": version,
        "provider": "AVM/Actv",
        "source": {
            "channel": "telegram",
            "sourceId": source_id,
            "messageUrl": message_url,
            "url": source_url,
            "publishedAt": published_at,
            "fetchedAt": fetched_at,
        },
        "category": category,
        "cause": detect_cause(text),
        "lifecycle": lifecycle,
        "severity": severity,
        "planned": planned,
        "impact": "full" if category in ("service_interruption", "replacement_service") else "partial",
        "scope": {"networks": networks, "lines": lines, "stops": extract_stop_refs(text) if category == "stop_change" else [], "areas": areas, "directions": extract_directions(text), "segments": extract_segments(text)},
        "validity": validity,
        "title": title,
        "body": text,
        "effects": effects,
        "tags": sorted(set(effects + [detect_cause(text), lifecycle] + networks)),
        "audience": {"topics": topics, "pushEligible": push_eligible},
    }


def build_news_event(item: dict, fetched_at: str) -> Optional[dict]:
    if item.get("articleEnriched") is False:
        return None
    text = clean_text(item.get("text", ""))
    if not transport_news_hint(text):
        return None
    category, lifecycle, severity, planned = detect_category(text)
    if category == "general_service_info":
        category, lifecycle, severity, planned = "planned_service_change", "planned", "info", True
    url = item.get("url") or ACTV_NEWS_URL
    source_id = hashlib.sha256(url.encode("utf-8")).hexdigest()[:12]
    lines = extract_lines(text)
    networks = detect_networks(text)
    areas = extract_areas(text)
    effects = detect_effects(text, category)
    headline = clean_text(item.get("title") or text.split("\n",1)[0]).lower()
    if ("modific" in headline or "integraz" in headline) and len(effects) > 1:
        category = "planned_service_change"
        if category not in effects:
            effects.insert(0, category)
    published_at = item.get("publishedAt")
    validity = extract_validity(text, published_at)
    lifecycle = lifecycle_for_window(lifecycle, validity, fetched_at)
    if lifecycle == "active" and severity == "info" and category in ("route_diversion","stop_change","planned_service_change"):
        severity = "minor"
    topics = sorted(set(
        ["alerts:all", f"category:{category}", f"severity:{severity}"] + [f"effect:{x}" for x in effects]
        + [f"network:{x}" for x in networks]
        + [f"line:{x}" for x in lines]
        + [f"area:{slug(x)}" for x in areas if slug(x)]
    ))
    return {
        "id": f"actv-news-{source_id}",
        "version": hashlib.sha256(text.encode("utf-8")).hexdigest()[:16],
        "provider": "AVM/Actv",
        "source": {
            "channel": "actv-news",
            "sourceId": source_id,
            "messageUrl": url,
            "url": url,
            "publishedAt": published_at,
            "fetchedAt": fetched_at,
            "articleEnriched": bool(item.get("articleEnriched")),
        },
        "category": category,
        "cause": detect_cause(text),
        "lifecycle": lifecycle,
        "severity": severity,
        "planned": planned,
        "impact": "partial",
        "scope": {"networks": networks, "lines": lines, "stops": extract_stop_refs(text) if category == "stop_change" else [], "areas": areas, "directions": extract_directions(text), "segments": extract_segments(text)},
        "validity": validity,
        "title": CATEGORY_LABELS[category] + ((" · " + ", ".join(lines[:8])) if lines else ""),
        "body": text,
        "effects": effects,
        "tags": sorted(set(effects + [detect_cause(text), lifecycle] + networks)),
        "audience": {"topics": topics, "pushEligible": False},
    }

def resolve_superseded(events: list[dict]) -> None:
    events.sort(key=lambda x: x["source"]["publishedAt"] or "")
    open_events = []

    def same_scope(current: dict, previous: dict) -> bool:
        cs, ps = current["scope"], previous["scope"]
        for key in ("lines","stops","areas"):
            a, b = set(cs.get(key) or []), set(ps.get(key) or [])
            if a and b and a & b:
                return True
        a, b = set(cs.get("networks") or []), set(ps.get("networks") or [])
        return bool(a and b and a & b and not (cs.get("lines") or ps.get("lines")))

    for event in events:
        closes = None
        allowed = ()
        if event["category"] == "service_restored":
            closes = "service"
            allowed = ("replacement_service", "service_interruption", "service_restriction")
        elif event["category"] == "stop_change" and event["lifecycle"] == "resolved":
            closes = "stop"
            allowed = ("stop_change",)

        if closes:
            for previous in reversed(open_events):
                if previous["lifecycle"] != "active" or previous["category"] not in allowed:
                    continue
                if not same_scope(event, previous):
                    continue
                event_dirs = set(event.get("scope", {}).get("directions") or [])
                previous_dirs = set(previous.get("scope", {}).get("directions") or [])
                if event_dirs and "both" not in event_dirs and previous_dirs and "both" not in previous_dirs and not (event_dirs & previous_dirs):
                    continue
                previous["lifecycle"] = "resolved"
                previous["resolvedBy"] = event["id"]
                previous["audience"]["pushEligible"] = False
                previous["tags"] = sorted((set(previous["tags"]) - {"active"}) | {"resolved"})
                if event.get("scope", {}).get("lines") and event_dirs and "both" not in event_dirs:
                    break
            continue

        if event["lifecycle"] == "active":
            open_events.append(event)

def norm_scope_value(value: str) -> str:
    value = clean_text(value).lower()
    return re.sub(r"[^a-z0-9à-ÿ]+", " ", value).strip()


def stop_code(value: str) -> Optional[str]:
    m = re.search(r"\bcod\.?\s*(\d+)\b", value, flags=re.I)
    return m.group(1) if m else None


def norm_stop_name(value: str) -> str:
    value = re.sub(r"\bcod\.?\s*\d+\b", "", clean_text(value), flags=re.I)
    return norm_scope_value(value)


def stop_values_overlap(a: Iterable[str], b: Iterable[str]) -> bool:
    for left in a:
        for right in b:
            lc, rc = stop_code(left), stop_code(right)
            if lc and rc:
                if lc == rc:
                    return True
                continue
            ln, rn = norm_stop_name(left), norm_stop_name(right)
            if ln and rn and (ln == rn or (len(ln) >= 6 and ln in rn) or (len(rn) >= 6 and rn in ln)):
                return True
    return False


def scope_values_overlap(a: Iterable[str], b: Iterable[str]) -> bool:
    left = [norm_scope_value(x) for x in a if norm_scope_value(x)]
    right = [norm_scope_value(x) for x in b if norm_scope_value(x)]
    for x in left:
        for y in right:
            if x == y or (len(x) >= 6 and x in y) or (len(y) >= 6 and y in x):
                return True
    return False


def canonical_event_url(event: dict) -> str:
    url = str(event.get("source", {}).get("url") or "").strip()
    if not url or "actv.avmspa.it/" not in url:
        return ""
    return url.split("#", 1)[0].split("?", 1)[0].rstrip("/").lower()


def events_close_in_time(a: dict, b: dict, max_days: int = 4) -> bool:
    left = iso_dt(a.get("source", {}).get("publishedAt"))
    right = iso_dt(b.get("source", {}).get("publishedAt"))
    if not left or not right:
        return False
    return abs((left.astimezone(dt.timezone.utc) - right.astimezone(dt.timezone.utc)).total_seconds()) <= max_days * 86400


def equivalent_cross_source(a: dict, b: dict) -> bool:
    if a["source"]["channel"] == b["source"]["channel"]:
        return False

    # Best signal: Telegram already links the exact ACTV article.
    ua, ub = canonical_event_url(a), canonical_event_url(b)
    if ua and ub and ua == ub:
        return True

    categories = {a["category"], b["category"]}
    effects_a, effects_b = set(a.get("effects") or []), set(b.get("effects") or [])
    category_match = (
        a["category"] == b["category"]
        or a["category"] in effects_b
        or b["category"] in effects_a
        or "planned_service_change" in categories
    )
    if not category_match or not events_close_in_time(a, b):
        return False

    sa, sb = a.get("scope", {}), b.get("scope", {})
    stop_overlap = stop_values_overlap(sa.get("stops") or [], sb.get("stops") or [])
    line_overlap = scope_values_overlap(sa.get("lines") or [], sb.get("lines") or [])
    area_overlap = scope_values_overlap(sa.get("areas") or [], sb.get("areas") or [])

    # A single shared line is not enough: unrelated events often touch the same line.
    if not (stop_overlap or (line_overlap and area_overlap)):
        return False

    da, db = set(sa.get("directions") or []), set(sb.get("directions") or [])
    if da and db and "both" not in da and "both" not in db and not (da & db):
        return False
    return True

def merge_cross_source_duplicates(events: list[dict]) -> list[dict]:
    merged = []
    for event in events:
        match = next((x for x in merged if equivalent_cross_source(x, event)), None)
        if not match:
            merged.append(event)
            continue

        # Prefer Telegram as the operational event. The ACTV article becomes official detail.
        primary, secondary = (match, event)
        if event["source"]["channel"] == "telegram" and match["source"]["channel"] != "telegram":
            primary, secondary = event, match
            merged[merged.index(match)] = primary

        alt = {
            "channel": secondary["source"]["channel"],
            "url": secondary["source"].get("url"),
            "publishedAt": secondary["source"].get("publishedAt"),
        }
        primary["source"].setdefault("alternates", [])
        if alt not in primary["source"]["alternates"]:
            primary["source"]["alternates"].append(alt)

        if secondary["source"]["channel"] == "actv-news" and secondary["source"].get("articleEnriched") and secondary.get("body"):
            primary["officialDetail"] = secondary["body"]

        for key in ("lines","stops","areas","directions","segments"):
            current = primary["scope"].setdefault(key, [])
            for value in secondary.get("scope", {}).get(key, []) or []:
                if value not in current:
                    current.append(value)

        secondary_is_site = secondary["source"]["channel"] == "actv-news" and secondary["source"].get("articleEnriched")
        for key in ("startsAt","endsAt","label"):
            if secondary.get("validity", {}).get(key) and (secondary_is_site or not primary.get("validity", {}).get(key)):
                primary["validity"][key] = secondary["validity"][key]

        primary["effects"] = list(dict.fromkeys((primary.get("effects") or []) + (secondary.get("effects") or [])))
        primary["tags"] = sorted(set((primary.get("tags") or []) + (secondary.get("tags") or [])))
        primary["audience"]["topics"] = sorted(set((primary["audience"].get("topics") or []) + (secondary.get("audience", {}).get("topics") or [])))

        if primary["lifecycle"] != "active" and secondary["lifecycle"] == "active":
            primary["lifecycle"] = "active"
        if secondary.get("resolvedBy") and not primary.get("resolvedBy"):
            primary["resolvedBy"] = secondary["resolvedBy"]
    return merged


def build_feed(items: list[dict], fetched_at: Optional[str] = None, news_items: Optional[list[dict]] = None, news_status: str = "ok") -> dict:
    fetched_at = fetched_at or utc_now()

    def latest_published(rows: list[dict]) -> Optional[str]:
        values = [row.get("publishedAt") for row in rows if row.get("publishedAt")]
        if not values:
            return None
        floor = dt.datetime.min.replace(tzinfo=dt.timezone.utc)
        return max(values, key=lambda value: iso_dt(value) or floor)

    events = []
    for item in items:
        event = build_event(item, fetched_at)
        if event:
            events.append(event)
    for item in news_items or []:
        event = build_news_event(item, fetched_at)
        if event:
            events.append(event)
    resolve_superseded(events)
    events = merge_cross_source_duplicates(events)
    events.sort(key=lambda x: x["source"]["publishedAt"] or "", reverse=True)
    payload_for_revision = json.dumps(events, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    revision = hashlib.sha256(payload_for_revision.encode("utf-8")).hexdigest()[:16]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": fetched_at,
        "revision": revision,
        "sourceHealth": {
            "telegram": {
                "provider": "AVM/Actv",
                "url": TELEGRAM_URL,
                "status": "ok",
                "messagesParsed": len(items),
                "latestPublishedAt": latest_published(items),
                "alertsPublished": sum(1 for x in events if x["source"]["channel"] == "telegram"),
            },
            "actvNews": {
                "provider": "AVM/Actv",
                "url": ACTV_NEWS_URL,
                "status": news_status,
                "messagesParsed": len(news_items or []),
                "latestPublishedAt": latest_published(news_items or []),
                "articlesEnriched": sum(1 for x in (news_items or []) if x.get("articleEnriched")),
                "alertsPublished": sum(
                    1 for x in events
                    if x["source"]["channel"] == "actv-news"
                    or any(a.get("channel") == "actv-news" for a in x["source"].get("alternates", []))
                ),
            },
        },
        "alerts": events,
    }


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    with tempfile.NamedTemporaryFile(prefix=path.name + ".", suffix=".tmp", dir=path.parent, delete=False) as fh:
        fh.write(data)
        temp = Path(fh.name)
    temp.replace(path)
    path.chmod(0o644)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default="current.json")
    ap.add_argument("--telegram-html", help="Use a local Telegram HTML fixture instead of the live source")
    ap.add_argument("--actv-html", help="Use a local ACTV news HTML fixture instead of the live source")
    ap.add_argument("--now", help="Override generatedAt for deterministic tests")
    args = ap.parse_args()

    fetched_at = args.now or utc_now()
    if args.telegram_html:
        raw = Path(args.telegram_html).read_text(encoding="utf-8")
    else:
        raw = fetch_text(TELEGRAM_URL)
    items = parse_telegram(raw)
    if not items:
        raise SystemExit("No Telegram messages parsed; refusing to publish an empty alert feed")
    news_status = "ok"
    try:
        if args.actv_html:
            news_raw = Path(args.actv_html).read_text(encoding="utf-8")
        else:
            news_raw = fetch_text(ACTV_NEWS_URL)
        news_items = parse_actv_news(news_raw)
        if not args.actv_html:
            preferred = {
                canonical_url(item.get("links", []), "")
                for item in items
                if canonical_url(item.get("links", []), "").startswith("https://actv.avmspa.it/")
            }
            news_items.sort(key=lambda item: (item.get("url") not in preferred,))
            news_items = enrich_actv_news(news_items)
    except Exception as exc:
        print(f"ACTV news fallback unavailable: {exc}", file=sys.stderr)
        news_items = []
        news_status = "error"
    feed = build_feed(items, fetched_at, news_items, news_status=news_status)
    atomic_json(Path(args.output), feed)
    print(json.dumps({
        "output": args.output,
        "revision": feed["revision"],
        "messagesParsed": len(items),
        "alertsPublished": len(feed["alerts"]),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
