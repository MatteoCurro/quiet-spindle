# T-Sand Auth checkpoint

Configurazione corrente per il collaudo M10.

## Flusso Auth
La UX primaria è ora quella convenzionale:
1. registrazione con email + password;
2. link di conferma email;
3. ritorno a T-Sand e consumo automatico della sessione dal callback;
4. presa visione privacy versionata server-side se non ancora registrata;
5. onboarding opzionale;
6. login successivi con email + password.

Il precedente OTP-first non è più usato dalla UI. L'adapter conserva le primitive OTP solo per compatibilità e possibili alternative future.

## SMTP
SMTP custom Resend operativo con dominio autenticato `unlockvenice.com`.
- From dedicato auth sul dominio verificato, mai `curromatteo.it`;
- nessun contenuto marketing nelle email di autenticazione;
- SPF/DKIM/DMARC configurati/verificati;
- rate limit da mantenere conservativo finché il traffico è minimo.

## URL
T-Sand:
- Site URL: `https://www.unlockvenice.com/t-sand/`;
- Redirect URL consentito: `https://www.unlockvenice.com/t-sand/**`.

La registrazione e il password recovery passano esplicitamente l'URL corrente come redirect. Il client Supabase abilita il rilevamento URL solo quando trova parametri/hash Auth, così la normale navigazione guest continua a non inizializzare una sessione remota.

## Diagnosi del primo test reale — 7 ottobre 2026
Il link ricevuto dall'utente non era un errore SMTP. I log Supabase mostrano richiesta email, `/verify` conclusa con 303 ed evento `user_signedup`/login implicit. Il problema era frontend: `detectSessionInUrl:false` impediva di adottare la sessione restituita dal link. Questo è stato corretto insieme al passaggio a password-first.

## Deploy
Il repository mantiene `config/account.json.enabled=false`.
Il workflow staging abilita account solo nella copia `dist/config/account.json`.
La produzione resta chiusa finché non esiste un progetto/config produzione e finché il gate M10 non viene chiuso.

## Checkpoint browser aggiornato
1. schermata registrazione dedicata visibile nel Profilo;
2. email + password + conferma password + privacy obbligatoria;
3. invio conferma email;
4. click link → ritorno a T-Sand e sessione adottata;
5. presa visione privacy server-side se necessaria;
6. onboarding opzionale e consensi marketing/profilazione separati;
7. salvataggio route/stop/place/journey nel cloud;
8. logout, login email/password e password recovery;
9. export JSON e delete-account;
10. Safari/iPhone e accessibilità visuale.

Il gate automatico non invia email né crea account reali: verifica asset, endpoint Auth, UI guest, blocco nuovi salvataggi guest, cookie/privacy, layout mobile e assenza di richieste Supabase durante la normale navigazione guest. I punti autenticati restano checkpoint manuale.
