# SEO placeholder resolution contract

I placeholder del copy **non generano HTML direttamente**. Vengono risolti in payload strutturati; il template HTML, nella milestone successiva, sarà l'unico responsabile del markup.

## `{{journey_cta ...}}`

Formati ammessi:

```text
{{journey_cta route="uv_mestre_station_san_marco" label="Calcola il percorso"}}
{{journey_cta to="poi:uv_venice_san_marco" from="current" label="Portami a San Marco"}}
```

Per una route stabile il resolver produce un href del tipo:

```text
/trasporti/go/r/uv_mestre_station_san_marco?lang=it&ref=seo_landing&campaign=seo-route-mestre-san-marco
```

Per una destinazione stabile:

```text
/trasporti/go/p/uv_venice_san_marco?from=current&lang=it&ref=seo_landing&campaign=seo-place-san-marco
```

`appBase` è configurabile: produzione `/trasporti`, staging `/t-sand`. Non vengono salvati domini assoluti nel copy.

## `{{related_transport}}`

Il resolver restituisce da 2 a 4 landing transport correlate nella stessa lingua.

Ordine di preferenza:

1. endpoint del percorso;
2. route che condividono origine/destinazione;
3. luoghi collegati da quelle route;
4. luoghi curati geograficamente vicini solo come fallback.

In **produzione** sono candidabili soltanto pagine `enabled && contentState === "ready"`. La modalità preview può includere `planned` e `draft`, ma deve essere richiesta esplicitamente.

Ogni item contiene almeno:

```json
{
  "pageId": "seo-place-san-marco",
  "kind": "place",
  "href": "/trasporti/luoghi/piazza-san-marco/",
  "label": "Piazza San Marco",
  "reason": "route-endpoint"
}
```

Gli href sono sempre localizzati; gli anchor sono descrittivi e derivano da nomi di entità/route, non da stringhe generiche.

## `{{related_reading}}`

Per una landing **luogo**, usa il motore M5.4 sull'entità della pagina.

Per una landing **percorso**, esegue il ranking sui due endpoint, unisce i risultati per URL e assegna un piccolo bonus agli articoli pertinenti a entrambi. Questo evita che il blocco venga dominato esclusivamente dalla destinazione più famosa.

Il payload contiene 3–6 articoli stessa lingua, con URL, titolo, score e motivazione. Gli override manuali M5.4B continuano ad applicarsi.

## Fail-fast

Il resolver deve fallire su:

- placeholder sconosciuto;
- attributo non previsto;
- route/entity inesistente;
- lingua non supportata;
- page ID non presente nel manifest;
- combinazioni ambigue come `route` insieme a `to`.

Un blocco obbligatorio vuoto non rende automaticamente pubblicabile una landing: il quality gate successivo deciderà se la pagina può passare a `ready`.
