# Unlock Venice Transit 8.8 — builder statico su Gandi Web Hosting

Questo pacchetto è configurato per l'hosting Gandi reale di `unlockvenice.com`.
Non usa WordPress e non usa WP-Cron. Il builder usa solo Python 3 standard library.

## Percorsi verificati

### Emergency Console
- Python: `/usr/bin/python3` (verificato: Python 3.11.2)
- builder privato: `/srv/data/home/transit-builder`
- output pubblico: `/srv/data/web/vhosts/unlockvenice.com/htdocs/trasporti/runtime-data`
- anacrontab: `/srv/data/etc/cron/anacrontab`

### SFTP
Gandi espone `/srv/data` come `/lamp0`.
- builder privato: `/lamp0/home/transit-builder`
- output pubblico: `/lamp0/web/vhosts/unlockvenice.com/htdocs/trasporti/runtime-data`
- anacrontab: `/lamp0/etc/cron/anacrontab`

## File da caricare

Caricare dentro `/lamp0/home/transit-builder/`:

- `build_transit_data.py`
- `builder-config.json`
- `README-GANDI.md` (facoltativo, solo documentazione)

Non serve creare `.builder-cache`: il builder la crea automaticamente.
Non caricare nulla manualmente in `runtime-data` oltre a creare la directory: i dataset verranno generati dal builder.

## Prima esecuzione manuale

Dalla Emergency Console:

```bash
cd /srv/data/home/transit-builder
/usr/bin/python3 build_transit_data.py --config builder-config.json
```

Poi verificare:

```bash
ls -lah /srv/data/web/vhosts/unlockvenice.com/htdocs/trasporti/runtime-data
```

Dovrebbero comparire almeno:

- `manifest.json`
- `aut-core.<hash>.json`
- `aut-shapes.<hash>.json`
- `aut-schedule.<hash>.json` + 8 `aut-schedule-day-YYYYMMDD.<hash>.json`
- `nav-core.<hash>.json`
- `nav-shapes.<hash>.json`
- `nav-schedule.<hash>.json` + 8 `nav-schedule-day-YYYYMMDD.<hash>.json`

Verifica HTTP:

`https://unlockvenice.com/trasporti/runtime-data/manifest.json`

## Configurazione Anacron Gandi

Gandi non usa il cron Unix standard. Il file è:

- SFTP: `/lamp0/etc/cron/anacrontab`
- Emergency Console: `/srv/data/etc/cron/anacrontab`

Aggiungere questa riga:

```text
@daily 0 unlock_transit_build cd /srv/data/home/transit-builder && /usr/bin/python3 /srv/data/home/transit-builder/build_transit_data.py --config /srv/data/home/transit-builder/builder-config.json >> /srv/data/home/transit-builder/builder.log 2>&1
```

`@daily` significa una volta al giorno, non a un'ora precisa. Gandi controlla circa ogni ora i task scaduti.

## Log e controllo

Log:

```bash
tail -n 100 /srv/data/home/transit-builder/builder.log
```

Esecuzione manuale di controllo:

```bash
cd /srv/data/home/transit-builder
/usr/bin/python3 build_transit_data.py --config builder-config.json
```

Se non ci sono modifiche ai feed, il builder lascia invariato il manifest e i bundle pubblici.

## Separazione dati

- `.builder-cache`: privata, fuori dal web root.
- `runtime-data`: pubblica, letta dall'app.
- VehiclePositions e TripUpdates continueranno a essere realtime.
- Core rete, shapes e schedule sono versionati separatamente: una modifica degli orari non forza la rigenerazione delle geometrie.
- Il schedule è chunked per giorno: indice leggero + 8 giorni (ieri .. +6). `stop_times` viene processato con bucket temporanei su disco per contenere la RAM.
- Il builder p5.1-lite usa priorità `nice` ridotta e yield periodici per convivere con Apache sul shared hosting.
- Dopo il 503 del prototipo monolitico, Anacron deve restare commentato finché il frontend chunked non è validato in browser; poi può essere riattivato.
- Tutti gli asset pubblici sono `0644`; `.builder-cache` resta privata.
- `manifest.json` viene pubblicato per ultimo in modo atomico.
