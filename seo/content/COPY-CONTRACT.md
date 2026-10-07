# Landing copy contract — U.Venice Transport 9.0

Questo documento traduce il contratto machine-readable `COPY-CONTRACT.json` in regole editoriali operative.

## Obiettivo

Le landing non sono mini-articoli turistici e non devono duplicare Unlock Venice. Devono risolvere un intento di mobilità reale, essere leggibili senza JavaScript e creare collegamenti utili tra app, landing transport e corpus editoriale.

La struttura deve aiutare sia il lettore sia i sistemi di ricerca a individuare rapidamente la risposta principale. Non scriviamo però contenuti artificialmente “per l'AI”: risposta diretta, struttura chiara, entità esplicite e sezioni autosufficienti sono utili prima di tutto all'utente.

## Struttura SEO

Ogni landing deve avere un solo H1, un title e una meta description unici. La risposta all'intento principale compare nelle prime righe, senza preamboli generici su Venezia.

Le opzioni comparabili vanno preferibilmente rese come elenco puntato o tabella compatta. Gli heading H2/H3 devono descrivere una decisione o una domanda reale, non essere una sequenza di keyword.

Le quantità di parole nel JSON sono guardrail editoriali, non obiettivi di ranking. Se la risposta completa richiede meno testo, non va allungata artificialmente.

## Domande e risposte

Ogni pagina luogo contiene indicativamente 3–5 domande; una pagina percorso 4–6. Le domande devono coprire intenti distinti, per esempio:

- Qual è la fermata più comoda per Piazza San Marco?
- Posso arrivare al Ponte di Rialto senza vaporetto?
- Dove arrivo a Venezia se parto dalla Stazione Mestre?
- Con valigie è più semplice partire da Piazzale Roma o Santa Lucia?

La prima frase della risposta deve già contenere la conclusione utile. La risposta deve essere comprensibile anche se letta da sola.

Non creiamo varianti quasi identiche della stessa domanda per coprire keyword diverse. Il contenuto Q&A è visibile nel body; non dipende da FAQ rich results o markup speciale.

## Internal linking

Le landing devono creare un grafo, non una griglia indiscriminata.

Ogni pagina include normalmente **2–4 link verso altre landing transport**. I target vengono scelti perché utili nel viaggio:

- una landing luogo può linkare i percorsi che partono/arrivano lì;
- una stazione/hub può linkare luoghi immediatamente connessi;
- una landing percorso linka le pagine dei due endpoint;
- può essere aggiunta al massimo qualche alternativa realmente utile.

Gli anchor devono descrivere la destinazione, ad esempio **“da Santa Lucia a Piazza San Marco”** o **“come arrivare a Piazzale Roma”**, non “scopri di più”.

Non colleghiamo automaticamente tutte le landing tra loro, tutte le pagine della stessa categoria o decine di destinazioni in un footer SEO.

Separatamente, il blocco **related reading** porta a 3–6 articoli Unlock Venice della stessa lingua scelti dal motore editoriale M5.4.

## Dati dinamici

Orari real-time, frequenze, interruzioni, chiusure temporanee e prezzi soggetti a variazione non vengono fissati nel copy statico. Quando servono, il template li mostra attraverso dati/runtime componenti e il testo resta valido nel tempo.

## Multilingua

Ogni lingua è una landing editoriale completa, non una semplice sostituzione di keyword. Entity ID e route ID sono condivisi; title, H1, testo, domande, anchor e meta description sono localizzati naturalmente.

Una lingua non può attingere automaticamente a related article o landing di un'altra lingua.
