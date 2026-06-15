# I problemi del marketplace, spiegati semplice 🔴🟠

> Lista completa dei problemi **rossi** (gravi, bloccano la partenza) e **arancioni** (seri, da chiudere prima di crescere) trovati nell'audit del 15/06/2026.
> Qui sono scritti **in parole povere**, per capire *cosa succede* e *cosa rischi* senza gergo tecnico. Il dettaglio tecnico con `file:riga` è nella scheda corrispondente di `AUDIT_SENIOR_AMAZON_EBAY_GLOVO_2026-06-15.md`.

**Come leggere:** 🔴 = ci perdi soldi, infrangi la legge o lasci entrare chi non deve → **da sistemare prima di aprire ai clienti veri**. 🟠 = serio, ti fa male appena cresci → **da chiudere subito dopo**.

---

## 🔴 I 8 problemi ROSSI (da risolvere per primi)

### 🔴 1 — Sugli ordini in contanti non guadagni la tua provvigione
**In parole povere:** quando un cliente paga in **contanti alla consegna**, il sistema non calcola mai la tua percentuale (l'8%) e l'ordine resta segnato come "non pagato" per sempre. È come avere un negozio dove, ogni volta che qualcuno paga cash, la cassa dimentica di registrare il tuo guadagno.
**Cosa rischi:** su **ogni** ordine in contanti incassi **zero** commissione, e non sai mai quali ordini sono davvero saldati. I conti non torneranno mai.
<sub>Scheda 🔴-1 · `app/api/orders/cod/route.ts`</sub>

### 🔴 2 — Paghi la consegna due volte
**In parole povere:** il costo di spedizione che il cliente ti paga **una volta**, tu lo giri **due volte**: un po' al negoziante (nascosto nel suo pagamento) e un po' al fattorino. 
**Cosa rischi:** ci rimetti di tasca tua un pezzo di spedizione a **ogni singolo ordine** con corriere. Più vendi, più perdi. *(Da confermare con un ordine di prova, ma il flusso dei dati lo indica chiaramente.)*
<sub>Scheda 🔴-2 · `webhook/route.ts`, `lib/stripe/payout.ts`</sub>

### 🔴 3 — Il fattorino può "confermare l'incasso" due volte sullo stesso ordine
**In parole povere:** non c'è un blocco che impedisca di registrare due volte gli stessi contanti. Se il fattorino tocca due volte il pulsante (o ci prova apposta), i conti dei contanti si falsano.
**Cosa rischi:** ammanchi di cassa nascosti e riconciliazione dei contanti inaffidabile.
<sub>Scheda 🔴-3 · `app/api/rider/cash-confirm/route.ts`</sub>

### 🔴 4 — Un venditore può usare il tuo server come "passepartout" (SSRF)
**In parole povere:** quando un venditore importa le foto da un link, il tuo server va a scaricare quel link **senza controllare dove punta**. Un malintenzionato può farlo puntare a indirizzi **interni e segreti** del tuo sistema — come consegnargli le chiavi del retrobottega.
**Cosa rischi:** furto di chiavi/credenziali interne e scansione della tua rete privata dall'interno.
<sub>Scheda 🔴-4 · `lib/products/rehostImages.ts`</sub>

### 🔴 5 — "Cancella i miei dati" non cancella davvero (GDPR)
**In parole povere:** quando un cliente chiede di essere dimenticato, il sistema nasconde il profilo ma **lascia nome, telefono e indirizzo di casa in chiaro** dentro i vecchi ordini, le chat e i log.
**Cosa rischi:** è una violazione del diritto all'oblio → possibile **sanzione GDPR** e dati personali esposti per sempre.
<sub>Scheda 🔴-5 · `app/api/cron/process-deletions/route.ts`</sub>

### 🔴 6 — La fattura elettronica non viene mai emessa (SDI)
**In parole povere:** raccogli i dati per la fattura B2B (codice SDI / PEC) ma **non generi e non invii nessuna fattura** al Sistema di Interscambio.
**Cosa rischi:** la fattura elettronica per le aziende è **obbligo di legge** in Italia: oggi non lo stai rispettando.
<sub>Scheda 🔴-6 · manca del tutto la generazione fattura</sub>

### 🔴 7 — Le difese contro gli abusi sono solo "finte chiuse"
**In parole povere:** i limiti che dovrebbero fermare chi prova mille password o chi abusa delle funzioni AI (che costano soldi veri) **non funzionano davvero** una volta online: si azzerano a ogni riavvio e non valgono su più server contemporaneamente.
**Cosa rischi:** attacchi a forza bruta sugli accessi e **bollette AI gonfiate** da chi spamma le funzioni.
<sub>Scheda 🔴-7 · `lib/rate-limit.ts`</sub>

### 🔴 8 — La lista email dei clienti potrebbe essere scaricabile da chiunque sia registrato
**In parole povere:** c'è una funzione "elenco email utenti" che, sul database live, risulta **richiamabile da qualsiasi utente loggato**, non solo dagli admin. Va verificato se ha un controllo interno; se non ce l'ha, chiunque ha un account può scaricare tutte le email.
**Cosa rischi:** fuga di dati di tutti i clienti → materiale per phishing e violazione privacy.
<sub>Scheda 🔴-8 · funzione `admin_list_user_emails` (verificato sul DB live)</sub>

---

## 🟠 I 18 problemi ARANCIONI (da chiudere subito dopo)

### 🔒 Accessi & sicurezza

**🟠 9 — Il controllo d'accesso è scritto in modo sbagliato → i clienti normali rischiano "accesso negato"**
*In parole povere:* per come è fatto il controllo, un cliente normale può ricevere un errore "profilo non trovato" su funzioni base (es. ordinare, pagare, scrivere in chat). I venditori funzionano per caso, i compratori no. *(Confermato guardando le regole del database live.)* 
*Cosa rischi:* funzioni fondamentali che non vanno per i compratori.
<sub>Scheda 🟠-9 · `lib/api/middleware.ts`</sub>

**🟠 13 — "Invita un amico" imbrogliabile + funzioni interne troppo aperte**
*In parole povere:* niente impedisce di **invitare sé stessi** con un secondo account e incassare il premio (€5) all'infinito; e alcune funzioni interne del database sono richiamabili da utenti anonimi.
*Cosa rischi:* credito regalo prosciugato da furbi e superficie d'attacco più ampia.
<sub>Scheda 🟠-13 · regole referral + funzioni DB esposte</sub>

### 💰 Soldi & conti

**🟠 10 — I codici sconto si possono usare più volte del dovuto**
*In parole povere:* il controllo "quante volte è stato usato" non è a prova di clic simultanei: con più ordini in parallelo, lo stesso coupon "usa una volta" passa più volte; alcuni coupon sono pure riutilizzabili all'infinito dallo stesso cliente.
*Cosa rischi:* sconti regalati oltre il limite che hai deciso.
<sub>Scheda 🟠-10 · `lib/coupons.ts`</sub>

**🟠 18 — Un reso pagato in contanti viene "approvato" ma il cliente non riceve indietro nulla**
*In parole povere:* per i resi di ordini in contanti il sistema segna "approvato" ma non restituisce i soldi né registra un debito verso il cliente.
*Cosa rischi:* clienti arrabbiati e nessuna traccia di quanto devi rendere.
<sub>Scheda 🟠-18 · `app/api/returns/[id]/decide/route.ts`</sub>

**🟠 19 — I soldi sono salvati con la virgola (e non in centesimi interi)**
*In parole povere:* gli importi vengono salvati in euro "con la virgola" e poi riconvertiti più volte: è il modo classico per accumulare errori da 1 centesimo.
*Cosa rischi:* piccoli scarti nei rimborsi e nelle riconciliazioni che fanno saltare i conti al centesimo.
<sub>Scheda 🟠-19 · vari punti del flusso pagamenti</sub>

**🟠 20 — Sul contante il fattorino non viene pagato per la consegna**
*In parole povere:* negli ordini in contanti non è previsto il compenso del fattorino: o se lo tiene "scalandolo" dai contanti (creando un ammanco), o lavora gratis.
*Cosa rischi:* conti dei contanti che non quadrano e fattorini scontenti.
<sub>Scheda 🟠-20 · `lib/stripe/payout.ts`</sub>

### 🕵️ Frodi & fiducia

**🟠 11 — Un venditore può mettersi le stelline da solo**
*In parole povere:* il filtro anti-contenuti è scritto ma **non è collegato a niente**, e nulla vieta a un venditore di comprare il proprio prodotto e lasciarsi una recensione 5★ "acquisto verificato".
*Cosa rischi:* recensioni gonfiate → i clienti si fidano di voti falsi e perdi credibilità.
<sub>Scheda 🟠-11 · regole recensioni + `lib/ai/moderation.ts`</sub>

**🟠 12 — Venditori e fattorini sono attivi subito, senza verifica documenti vera**
*In parole povere:* chi si registra come fattorino o venditore è operativo all'istante; la verifica identità (KYC) non blocca niente. Un fattorino non identificato arriva a casa dei clienti e maneggia contanti.
*Cosa rischi:* problema di **sicurezza fisica** dei clienti e rischio riciclaggio sui contanti.
<sub>Scheda 🟠-12 · registrazione + KYC</sub>

**🟠 23 — Nelle contestazioni il venditore non può difendersi e i soldi partono lo stesso**
*In parole povere:* quando un cliente apre una contestazione, il venditore non ha modo di replicare e il pagamento al venditore può partire comunque mentre la disputa è aperta.
*Cosa rischi:* venditori onesti penalizzati e soldi difficili da recuperare dopo.
<sub>Scheda 🟠-23 · tabella `disputes`</sub>

### 🛵 Consegna & magazzino

**🟠 14 — Se un admin annulla un ordine, il prodotto non torna in magazzino**
*In parole povere:* quando il cliente o il venditore annullano, la scorta torna disponibile; quando lo fa l'**admin**, no. Il prodotto resta segnato "esaurito" pur essendo lì.
*Cosa rischi:* vendite perse silenziose, soprattutto su artigiani con pochi pezzi.
<sub>Scheda 🟠-14 · `app/api/admin/orders/[id]/cancel/route.ts`</sub>

**🟠 15 — Quando un carrello abbandonato scade, la scorta della "taglia/colore" non torna giusta**
*In parole povere:* due strade diverse gestiscono lo stesso evento (carrello scaduto) in modo diverso: una rimette a posto la scorta della variante, l'altra no.
*Cosa rischi:* vendere più pezzi di quanti ne hai di una certa taglia/colore.
<sub>Scheda 🟠-15 · `app/api/cron/expire-checkouts/route.ts`</sub>

**🟠 16 — Se nessun fattorino accetta, l'ordine resta "appeso" all'infinito**
*In parole povere:* un ordine pronto che nessun fattorino prende non ha né un tempo limite, né un avviso, né un "nessun rider disponibile" per il cliente. Resta lì.
*Cosa rischi:* cliente che ha pagato e aspetta nel vuoto → reclami e rimborsi.
<sub>Scheda 🟠-16 · gestione dispatch</sub>

**🟠 17 — Si può ordinare a un negozio chiuso**
*In parole povere:* il sistema non controlla gli orari di apertura: un cliente può ordinare alle 3 di notte a una panetteria chiusa (e con carta viene pure addebitato).
*Cosa rischi:* ordini impossibili da evadere, rimborsi e clienti delusi.
<sub>Scheda 🟠-17 · checkout COD e carta</sub>

### ⚖️ Legge & privacy

**🟠 24 — Si tracciano i prodotti visti anche da chi ha rifiutato i cookie**
*In parole povere:* la cronologia "prodotti visti" viene salvata anche se l'utente ha detto "no" al tracciamento (le altre analytics invece rispettano la scelta).
*Cosa rischi:* violazione del consenso (ePrivacy/GDPR).
<sub>Scheda 🟠-24 · `components/ProductViewTracker.tsx`</sub>

### 🛠️ Affidabilità tecnica

**🟠 21 — Email e notifiche possono partire doppie**
*In parole povere:* se due esecuzioni si sovrappongono, la stessa email/notifica può essere inviata due volte.
*Cosa rischi:* clienti spammati e reputazione del mittente danneggiata (le email finiscono in spam).
<sub>Scheda 🟠-21 · cron `send-emails` e `send-push`</sub>

**🟠 22 — Le pagine "tutti gli ordini" caricano l'intero archivio ogni 30 secondi**
*In parole povere:* le liste ordini di admin e venditori scaricano **tutti** gli ordini ogni mezzo minuto, invece di una pagina per volta.
*Cosa rischi:* col crescere degli ordini le pagine diventano lentissime e pesano sul database.
<sub>Scheda 🟠-22 · `app/admin/orders`, `app/seller/orders`</sub>

**🟠 25 — I lavori automatici dipendono da un servizio esterno gratuito, senza rete di sicurezza**
*In parole povere:* pagamenti ai venditori, cancellazioni GDPR e allarmi girano solo se un servizio esterno (gratuito) li attiva. Se quello smette, si ferma tutto **in silenzio** — e perfino l'allarme che dovrebbe avvisarti è uno di quei lavori.
*Cosa rischi:* soldi bloccati e obblighi legali non eseguiti senza che nessuno se ne accorga.
<sub>Scheda 🟠-25 · `render.yaml` (cron esterni)</sub>

**🟠 26 — Il sistema di "scatola nera" parte troppo tardi**
*In parole povere:* lo strumento che registra gli errori nel browser si avvia in ritardo, quindi i crash nel momento più delicato (caricamento pagina, checkout) **non vengono registrati**.
*Cosa rischi:* errori che colpiscono i clienti senza che tu li veda mai.
<sub>Scheda 🟠-26 · configurazione Sentry client</sub>

---

## In sintesi

- **8 rossi** + **18 arancioni** = 26 problemi da chiudere prima di scalare.
- I rossi si concentrano su **soldi** (contanti senza commissione, spedizione doppia), **legge** (GDPR, fattura SDI) e **sicurezza** (SSRF, difese anti-abuso, email esposte).
- La buona notizia: le fondamenta sono **solide** (niente vendite doppie, niente furti tra venditori, pagamenti carta a prova di doppione). Si tratta di **chiudere fori precisi**, non di rifare tutto.
- Ordine consigliato di intervento: vedi la **roadmap §7** dell'audit (prima i quick win, poi i blocchi strutturali su soldi e legge).
