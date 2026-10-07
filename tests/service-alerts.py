#!/usr/bin/env python3
import importlib.util
from pathlib import Path

root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("service_alerts",root/"server"/"build_service_alerts.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

telegram="""
<div class="tgme_widget_message js-widget_message" data-post="muoversivenezia/12001">
 <div class="tgme_widget_message_text js-message_text">🚌🚊 SERVIZIO INFOMOBILITÀ ⚠<br>Attivato servizio automobilistico sostitutivo TRAM per l'intera Linea T1 FAVARO - VENEZIA in entrambe le direzioni.</div>
 <time datetime="2026-09-24T17:21:00+00:00">19:21</time>
</div>
<div class="tgme_widget_message js-widget_message" data-post="muoversivenezia/12002">
 <div class="tgme_widget_message_text js-message_text">🚌🚊 SERVIZIO INFOMOBILITÀ ⚠<br>Linea T1 - il servizio torna progressivamente regolare in entrambe le direzioni.</div>
 <time datetime="2026-09-24T18:21:00+00:00">20:21</time>
</div>
<div class="tgme_widget_message js-widget_message" data-post="muoversivenezia/12003">
 <div class="tgme_widget_message_text js-message_text">⚠️ #muoversivenezia | Mirano<br>📆 dalle ore 8.30 di mercoledì 16 alle ore 20.00 di mercoledì 23 settembre 2026<br>🚍 in occasione della Fiera di San Matteo, gli autobus delle linee 7E, 7DE, 4E, 56E, 59E, 57E e 10E subiscono deviazione di percorso.</div>
 <time datetime="2026-09-15T08:32:00+00:00">10:32</time>
</div>
<div class="tgme_widget_message js-widget_message" data-post="muoversivenezia/12004">
 <div class="tgme_widget_message_text js-message_text">🚀 Al via il nuovo sistema di bigliettazione elettronica AVM/Actv!</div>
 <time datetime="2026-09-15T09:00:00+00:00">11:00</time>
</div>
"""
news="""
<h3><a href="/it/content/lido-percorso-linea-11">Lido: percorso linea 11</a></h3>
<a href="/it/content/lido-percorso-linea-11">Leggi tutto</a>
"""

items=m.parse_telegram(telegram)
news_items=m.parse_actv_news(news)
assert len(items)==4
assert news_items==[{"url":"https://actv.avmspa.it/it/content/lido-percorso-linea-11","text":"Lido: percorso linea 11"}]

feed=m.build_feed(items,"2026-09-24T20:00:00Z",news_items)
assert len(feed["alerts"])==4
assert feed["sourceHealth"]["telegram"]["latestPublishedAt"]=="2026-09-24T18:21:00+00:00"
assert feed["sourceHealth"]["actvNews"]["latestPublishedAt"] is None
replacement=next(x for x in feed["alerts"] if x["id"]=="avm-telegram-12001")
restored=next(x for x in feed["alerts"] if x["id"]=="avm-telegram-12002")
diversion=next(x for x in feed["alerts"] if x["id"]=="avm-telegram-12003")
news_event=next(x for x in feed["alerts"] if x["source"]["channel"]=="actv-news")
assert replacement["category"]=="replacement_service"
assert replacement["lifecycle"]=="resolved"
assert replacement["resolvedBy"]==restored["id"]
assert replacement["audience"]["pushEligible"] is False
assert "line:T1" in restored["audience"]["topics"]
assert diversion["category"]=="route_diversion"
assert diversion["planned"] is True
assert diversion["lifecycle"]=="resolved"
assert diversion["scope"]["areas"]==["Mirano"]
assert diversion["scope"]["lines"]==["10E","4E","56E","57E","59E","7DE","7E"]
assert "line:7E" in diversion["audience"]["topics"]
assert news_event["lifecycle"]=="planned"
assert news_event["scope"]["lines"]==["11"]
assert news_event["audience"]["pushEligible"] is False
assert all("bigliettazione" not in x["body"].lower() for x in feed["alerts"])

# Regression cases modelled on real AVM/Actv posts already published in 2026.
# They intentionally keep only the classification-bearing wording.
historical=[
    {"post":"muoversivenezia/13001","publishedAt":"2026-07-14T17:43:00+00:00","links":[],"text":"SERVIZIO INFOMOBILITÀ: causa alta marea il servizio di navigazione viene frazionato secondo il piano operativo."},
    {"post":"muoversivenezia/13002","publishedAt":"2026-07-14T20:00:00+00:00","links":[],"text":"SERVIZIO INFOMOBILITÀ: abbassato il livello di marea, il servizio di navigazione viene ripristinato e torna progressivamente regolare."},
    {"post":"muoversivenezia/13003","publishedAt":"2026-08-30T09:36:00+00:00","links":[],"text":"People Mover non operativo per problema elettrico. Servizio sostitutivo tramite navigazione linea 2 tra Tronchetto e P.le Roma."},
]
hf=m.build_feed(historical,"2026-08-30T10:00:00Z",[])
restriction=next(x for x in hf["alerts"] if x["id"]=="avm-telegram-13001")
restoration=next(x for x in hf["alerts"] if x["id"]=="avm-telegram-13002")
people=next(x for x in hf["alerts"] if x["id"]=="avm-telegram-13003")
assert restriction["category"]=="service_restriction"
assert restriction["cause"]=="weather"
assert restriction["lifecycle"]=="resolved"
assert restriction["resolvedBy"]==restoration["id"]
assert people["category"]=="replacement_service"
assert set(people["scope"]["networks"])=={"water","people_mover"}
assert people["scope"]["lines"]==["2"]
assert "line:2" in people["audience"]["topics"]

directional=[
    {"post":"muoversivenezia/14001","publishedAt":"2026-09-15T10:00:00+00:00","links":[],"text":"SERVIZIO INFOMOBILITÀ: attivato servizio sostitutivo TRAM Linea T1 nel tratto FAVARO - VENEZIA direzione Venezia."},
    {"post":"muoversivenezia/14002","publishedAt":"2026-09-15T10:01:00+00:00","links":[],"text":"SERVIZIO INFOMOBILITÀ: attivato servizio sostitutivo TRAM Linea T1 nel tratto VENEZIA - FAVARO direzione Favaro."},
    {"post":"muoversivenezia/14003","publishedAt":"2026-09-15T10:30:00+00:00","links":[],"text":"SERVIZIO INFOMOBILITÀ: Linea T1 nel tratto VENEZIA - FAVARO direzione Favaro, il servizio torna progressivamente regolare."},
]
df=m.build_feed(directional,"2026-09-15T10:31:00Z",[])
to_venice=next(x for x in df["alerts"] if x["id"]=="avm-telegram-14001")
to_favaro=next(x for x in df["alerts"] if x["id"]=="avm-telegram-14002")
assert to_venice["lifecycle"]=="active"
assert to_favaro["lifecycle"]=="resolved"
assert to_favaro["scope"]["directions"]==["Favaro"]
assert to_favaro["scope"]["segments"]==[{"from":"VENEZIA","to":"FAVARO"}]

real_patterns=[
    {"post":"muoversivenezia/15001","publishedAt":"2026-09-14T09:06:00+00:00","links":[],"text":"#muoversivenezia: causa avaria nave traghetto in linea 11, servizio temporaneamente interrotto tra Lido e Pellestrina."},
    {"post":"muoversivenezia/15002","publishedAt":"2026-09-16T04:30:00+00:00","links":[],"text":"#muoversivenezia navigazione. Dalle ore 10:00 alle 12:00: Lido SME A sospeso. Linea 5.1 in partenza da Lido SME B."},
    {"post":"muoversivenezia/15003","publishedAt":"2026-09-16T19:54:00+00:00","links":[],"text":"#muoversivenezia: per lavori viene attivata linea ST1, servizio automobilistico sostitutivo tram in linea T1, con deviazione per le linee in transito."},
]
rf=m.build_feed(real_patterns,"2026-09-16T20:00:00Z",[])
ferry=next(x for x in rf["alerts"] if x["id"]=="avm-telegram-15001")
lido=next(x for x in rf["alerts"] if x["id"]=="avm-telegram-15002")
st1=next(x for x in rf["alerts"] if x["id"]=="avm-telegram-15003")
assert ferry["category"]=="service_interruption" and ferry["cause"]=="breakdown"
assert ferry["scope"]["lines"]==["11"] and "network:ferry" in ferry["audience"]["topics"]
assert lido["category"]=="stop_change" and lido["lifecycle"]=="planned"
assert lido["scope"]["lines"]==["5.1"]
assert st1["category"]=="replacement_service" and st1["planned"] is True
assert {"replacement_service","route_diversion"}.issubset(set(st1["effects"]))
assert "effect:route_diversion" in st1["audience"]["topics"]


# Current ACTV-site patterns: article detail enriches title-only listing items.
article_html="""
<html><body><main>
<h1>Lido: percorso linea 11</h1>
<div>22 Settembre 2026</div>
<p>AVM/Actv informa che, fino a mercoledì 30 settembre 2026, per lavori il percorso della linea 11 SME - Pellestrina continua ad essere modificato.</p>
<p>Linea 11 SME - Pellestrina. Gli autobus percorrono via S. Gallo in deviazione.</p>
</main><footer>Azienda</footer></body></html>
"""
article=m.parse_actv_article(article_html)
assert "linea 11" in article.lower()
assert "Azienda" not in article
fallback_html="""
<html><body><div class="layout"><h1>Lido: percorso linea 11</h1><div>22 Settembre 2026</div>
<p>AVM/Actv informa che il percorso della linea 11 resta modificato fino al 30 settembre 2026.</p>
<div>Azienda</div><p>Società trasparente ACTV</p></div></body></html>
"""
fallback_article=m.parse_actv_article(fallback_html,title="Lido: percorso linea 11")
assert fallback_article.startswith("Lido: percorso linea 11")
assert "Società trasparente" not in fallback_article
pub=m.italian_date_iso(article)
assert pub.startswith("2026-09-22T00:00:00")
site_item={"url":"https://actv.avmspa.it/it/content/lido-percorso-linea-11","title":"Lido: percorso linea 11","text":"Lido: percorso linea 11\n"+article,"publishedAt":pub,"articleEnriched":True}
site_event=m.build_news_event(site_item,"2026-09-24T10:00:00+00:00")
assert site_event["scope"]["lines"]==["11"]
assert site_event["lifecycle"]=="active"
assert site_event["validity"]["endsAt"].startswith("2026-09-30T23:59")
assert site_event["source"]["articleEnriched"] is True
assert site_event["audience"]["pushEligible"] is False

marano_html="""
<html><body><main>
<h1>Marano: spostamento fermata</h1>
<div>22 Settembre 2026</div>
<p>AVM/Actv informa che, dalle ore 12.00 di lunedì 21 settembre 2026 e fino al termine dei lavori,
la fermata Marano sottopasso cod. 2443, direzione Marano Centro, viene posticipata di circa 150 metri.</p>
</main></body></html>
"""
marano_article=m.parse_actv_article(marano_html)
marano_pub=m.italian_date_iso(marano_article)
marano_event=m.build_news_event({"url":"https://actv.avmspa.it/it/content/marano-spostamento-fermata-0","text":"Marano: spostamento fermata\n"+marano_article,"publishedAt":marano_pub,"articleEnriched":True},"2026-09-24T10:00:00+00:00")
assert marano_event["category"]=="stop_change"
assert marano_event["lifecycle"]=="active"
assert marano_event["scope"]["stops"]

# A later explicit stop restoration closes the earlier problem instead of leaving both active.
stop_pair=[
 {"post":"muoversivenezia/16001","publishedAt":"2026-09-24T07:00:00+00:00","links":[],"text":"SERVIZIO INFOMOBILITÀ: fermata Marano sottopasso sospesa temporaneamente."},
 {"post":"muoversivenezia/16002","publishedAt":"2026-09-24T08:00:00+00:00","links":[],"text":"SERVIZIO INFOMOBILITÀ: fermata Marano sottopasso riattivata."},
]
sf=m.build_feed(stop_pair,"2026-09-24T08:01:00+00:00",[])
stopped=next(x for x in sf["alerts"] if x["id"]=="avm-telegram-16001")
assert stopped["lifecycle"]=="resolved"
assert stopped["resolvedBy"]=="avm-telegram-16002"

# ACTV date-window normalization: shorthand ranges and past event days.
sa_text="Linea SA - Salone dell'Alto Artigianato Italiano\n24 Settembre 2026\nAVM/Actv informa che, da giovedì 1 a domenica 4 ottobre 2026, verrà attivata la linea SA con il seguente orario."
sa_event=m.build_news_event({"url":"https://actv.avmspa.it/it/content/linea-sa","text":sa_text,"publishedAt":"2026-09-24T00:00:00+02:00","articleEnriched":True},"2026-09-24T10:00:00+00:00")
assert sa_event["scope"]["lines"]==["SA"]
assert sa_event["validity"]["startsAt"].startswith("2026-10-01T00:00")
assert sa_event["validity"]["endsAt"].startswith("2026-10-04T23:59")
assert sa_event["lifecycle"]=="planned"

past_text="Partita: modifiche al servizio di trasporto pubblico\n16 Settembre 2026\nAVM/Actv informa che, sabato 19 settembre 2026, vengono introdotte modifiche alle linee 2 e 7."
past_event=m.build_news_event({"url":"https://actv.avmspa.it/it/content/partita-test","text":past_text,"publishedAt":"2026-09-16T00:00:00+02:00","articleEnriched":True},"2026-09-24T10:00:00+00:00")
assert past_event["lifecycle"]=="resolved"
assert past_event["validity"]["endsAt"].startswith("2026-09-19T23:59")

# Stop identity: codes distinguish opposite/nearby physical stops.
assert m.extract_stop_refs("la fermata Marano sottopasso cod. 2443, direzione Marano Centro, viene posticipata.") == ["Marano sottopasso cod. 2443"]
assert m.stop_values_overlap(["Marano sottopasso cod. 2443"],["Marano sottopasso cod. 2443"])
assert not m.stop_values_overlap(["Marano sottopasso cod. 2443"],["Marano sottopasso cod. 2444"])
assert m.stop_values_overlap(["Marano sottopasso"],["Marano sottopasso cod. 2443"])

# Same incident from Telegram + ACTV article is one normalized alert with two official sources.
telegram_marano=[{"post":"muoversivenezia/17001","publishedAt":"2026-09-24T07:30:00+00:00","links":[],"text":"SERVIZIO INFOMOBILITÀ: fermata Marano sottopasso spostata, direzione Marano Centro."}]
site_marano={"url":"https://actv.avmspa.it/it/content/marano-spostamento-fermata-0","text":"Marano: spostamento fermata\n"+marano_article,"publishedAt":marano_pub,"articleEnriched":True}
merged=m.build_feed(telegram_marano,"2026-09-24T10:00:00+00:00",[site_marano])
marano_alerts=[x for x in merged["alerts"] if x["category"]=="stop_change"]
assert len(marano_alerts)==1
assert marano_alerts[0]["source"]["channel"]=="telegram"
assert any(x["channel"]=="actv-news" for x in marano_alerts[0]["source"].get("alternates",[]))
assert marano_alerts[0].get("officialDetail")

# Telegram windows also age out. A past event must not inflate the active badge.
regata_text="#muoversivenezia Regata di Burano | domenica 20 settembre 2026 | alcune corse delle linee 9, 12, 13 e 14 sono limitate o sospese."
regata=m.build_event({"post":"muoversivenezia/18001","publishedAt":"2026-09-18T14:30:19+00:00","links":["https://actv.avmspa.it/it/content/regata-di-burano-3"],"text":regata_text},"2026-09-24T10:00:00+00:00")
assert regata["category"]=="service_restriction"
assert regata["lifecycle"]=="resolved"

# One shared line is not enough to merge unrelated ACTV events.
serie_a=m.build_news_event({"url":"https://actv.avmspa.it/it/content/partita-test","text":"Partita Venezia-Lazio: modifiche al servizio\n16 Settembre 2026\nAVM/Actv informa che sabato 19 settembre 2026 le linee 9 e 2 subiscono modifiche.","publishedAt":"2026-09-16T00:00:00+02:00","articleEnriched":True},"2026-09-24T10:00:00+00:00")
assert not m.equivalent_cross_source(regata,serie_a)

# Exact ACTV URL is a strong cross-source identity signal.
regata_site=m.build_news_event({"url":"https://actv.avmspa.it/it/content/regata-di-burano-3","text":"Regata di Burano\n18 Settembre 2026\nAVM/Actv informa che domenica 20 settembre 2026 alcune corse delle linee 9, 12, 13 e 14 sono limitate o sospese.","publishedAt":"2026-09-18T00:00:00+02:00","articleEnriched":True},"2026-09-24T10:00:00+00:00")
assert m.equivalent_cross_source(regata,regata_site)

assert m.extract_areas("#muoversivenezia | Mestre - Miranese +++ AGGIORNAMENTO CANTIERE\nDeviazioni bus.")==["Mestre - Miranese"]
assert m.extract_directions("linea 2 direzione Lido SME delle 23:00 effettuerà fermata straordinaria")==["Lido SME"]

marcon=m.build_event({"post":"muoversivenezia/18002","publishedAt":"2026-09-16T08:00:00+00:00","links":[],"text":"#muoversivenezia | Marcon | dalle ore 7.00 alle 24.00 di domenica 20 settembre 2026 | i bus delle linee 9E e 27 subiscono deviazione di percorso."},"2026-09-24T10:00:00+00:00")
assert marcon["validity"]["startsAt"].startswith("2026-09-20T07:00")
assert marcon["validity"]["endsAt"].startswith("2026-09-21T00:00")
assert marcon["lifecycle"]=="resolved"

print("RESULT: service alert parser/classifier passed, including Telegram history and ACTV article detail.")

