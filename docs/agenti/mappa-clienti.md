# La mappa dei clienti da visitare

28/11/2026. Migrazione `999i`, pagina `/agente/clienti`, rotte `/api/agente/clienti` e `/api/agenzia/clienti-da-visitare`.

Nicola: «la mappa deve visualizzarsi in 2 modi: 1) sulla mappa, 2) una lista che si può ordinare, e un ordine è la priorità del cliente da contattare».

## Le scelte

- **Chi la vede.** Gli agenti attivi e l'admin, dentro `/agente` (la porta è sempre `lib/agenti/rotta.ts`). L'admin vede anche chi ha preso cosa, e può liberare un cliente o cambiargli lo stato.
- **Come si dividono i clienti.** Li prenota l'agente. Ognuno vede tutta la mappa. «Ci vado io» lo fa diventare suo; un collega lo vede «preso», senza sapere da chi. «Lascio» lo rimette libero. Nessuno assegna niente a mano.
- **Quanti.** Tutta la fila del lunedì, circa 650 attività entro 5 km da Pane Quotidiano. Il dossier dell’AD c’è sulle prime 30 della settimana (Nicola, 28/11 alle 02:25; flusso 16 con QUANTE_A_SETTIMANA = 30).
- **Due viste.** Mappa: un puntino per attività. Il colore dice prima l'esito della visita (sì o iscritta, no, visitata), poi la prenotazione (mia, di un altro, libera). Lista: di serie per priorità (il `punteggio` del flusso), poi per distanza da Pane Quotidiano, vicino a me, tipo, stato, «le mie per prime».
- **Mai messaggi automatici alle attività.** Dalla pagina si chiama col telefono o si va di persona (art. 130 Codice privacy).

## Una sola fonte di verità per lo stato: il sito

La tabella `clienti_da_visitare` (migrazione 999i) tiene la prenotazione e lo stato. Il browser non la legge: solo le rotte del sito, con la chiave di servizio.

- **n8n scrive i dati delle attività**, mai la prenotazione né lo stato: `POST /api/agenzia/clienti-da-visitare` chiama la funzione `ricevi_clienti_da_visitare`.
- **Il sito scrive prenotazione e stato**, solo per l'agente collegato (`/api/agente/clienti`).
- **Il flusso 16 rilegge gli stati il lunedì** (`GET` della stessa porta) prima di «Metti in fila». Con quegli stati decide chi è «già proposto» e fa il conto del messaggio.
- **La tabella n8n «Attività da visitare» resta l'archivio delle settimane.** Lo stato non si scrive più a mano lì. La prima volta che un'attività arriva al sito, lo stato scritto nella tabella entra come stato di partenza (`stato_tabella` → `stato_iniziale`). Dopo, conta solo il sito.
- **Se il sito non risponde**, il flusso usa la tabella n8n come prima e lo scrive nel messaggio. Telegram e la tabella non dipendono dal sito.

## La porta di n8n

`https://www.mycity-marketplace.com/api/agenzia/clienti-da-visitare`, intestazione `x-mycity-segreto: <N8N_CLIENTI_DA_VISITARE_SEGRETO>`. Senza segreto su Vercel la porta resta chiusa (503).

**GET** → `{ ok, data: { stati: [{ osm, proposta, presa, stato }], conti: { proposte, prese, visitate, si, iscritte, no, escluse } } }`

Lo stato `esclusa` (Nicola, 28/11 alle 02:45) vuol dire riga tolta, non visitata. Non si mostra agli agenti, non conta fra le visitate, e il flusso la tratta come già proposta. Arriva dalla tabella n8n o la mette l'admin; un agente non la sceglie. Forni e panetterie li toglie il flusso 16 dalla fila: quelli già arrivati al sito si spengono al giro dopo e spariscono dalla mappa, se nessuno ci ha lavorato.

**POST** `{ giro: "<ISO>", attivita: [ … ] }`. Ogni attività:

| campo | note |
|---|---|
| `osm` | `node/123`, `way/…`, `relation/…` (obbligatorio) |
| `nome` | obbligatorio |
| `tipo`, `segmento`, `indirizzo`, `telefono`, `sito`, `perche`, `offerta` | come in «Metti in fila» |
| `lat`, `lon` | la posizione (`pos` in «Metti in fila») |
| `distanza_m`, `punteggio` | numeri |
| `mappa` | solo link `https://www.google.com/maps/…` |
| `dossier` | testo del dossier (solo le prime 30). Vuoto = resta quello di prima |
| `settimana` | `AAAA-MM-GG`, il lunedì in cui è stata proposta. Resta la prima |
| `stato_tabella` | lo stato scritto a mano nella tabella n8n. Vale solo per un'attività nuova |

Le attività che in questo giro non ci sono si spengono (`in_fila = false`), non si cancellano. Una fila vuota viene rifiutata (400): la mappa resta com'era. Tetto: 2 MB, 5.000 attività.

## Cosa cambia nel flusso 16 (repo N8N, `flussi/16-attivita-da-visitare/`)

Da fare nel repo N8N partendo dal ramo della sessione «Dossier in tre giri da 10 e via i forni» (`claude/intelligent-albattani-h4rmpk`, o da main dopo la sua unione), così non si perdono i 30 dossier, i forni tolti e lo stato «esclusa». Con le sue prove (`flussi/test/16-attivita-da-visitare.test.mjs`). Si ripubblica su n8n solo dopo l'unione e con l'«ok ripubblica» di Nicola.

1. **Config.** Si aggiunge `SITO_URL = https://www.mycity-marketplace.com`.
2. **Credenziale.** Una «Header Auth» in n8n: nome `MyCity · clienti da visitare`, header `x-mycity-segreto`, valore uguale a `N8N_CLIENTI_DA_VISITARE_SEGRETO` su Vercel.
3. **Nodo nuovo «Leggi gli stati dal sito»** (HTTP GET `{{SITO_URL}}/api/agenzia/clienti-da-visitare`, con quella credenziale) fra «Leggi le attività già proposte» e «Metti in fila». Impostazioni: `executeOnce`, `onError: continueRegularOutput`, risposta completa con `neverError`, timeout 20 s, 2 tentativi.
4. **«Metti in fila».**
   - Legge il nodo nuovo. Se ha risposto 200 con `ok: true`, aggiunge a `proposte` ogni `osm` con `proposta || presa || stato !== 'da_visitare'`. `stati_finora` viene da `data.conti`, e `conti.stati_dal_sito = true`. Altrimenti resta tutto come oggi (stati dalla tabella n8n) e `stati_dal_sito = false`.
   - Ogni candidata porta anche `lat: pos.lat, lon: pos.lon`.
   - Un'attività scartata come «già proposta» non si butta via: entra in `gia_proposte` con gli stessi campi, la posizione, la `settimana` e lo `stato` della sua riga nella tabella n8n (da `ultimaRiga`).
   - Esce `{ letta, motivo, fila: candidate.slice(0, QUANTE), tutte: candidate, gia_proposte, conti }`.
5. **«Componi i messaggi».** Il conto usa gli stati del sito. Se il sito non ha risposto, una riga in corsivo lo dice: «Il conto viene dalla tabella n8n: il sito non ha risposto». La frase finale diventa: «Dopo la visita segna lo stato sulla mappa del sito, www.mycity-marketplace.com/agente/clienti: visitata, si, no o iscritta.»
6. **Ramo nuovo da «Componi i messaggi»**, accanto agli altri due:
   - «Fila per il sito» (Code, `executeOnce`). Solo con `MODALITA = vero` e `letta`; altrimenti restituisce `[]`. Il corpo è `{ giro: new Date().toISOString(), attivita }`, dove `attivita` è:
     - le attività di `tutte`. Quelle fra le prime QUANTE_A_SETTIMANA (oggi 30) hanno `settimana` = la settimana del messaggio e `dossier` = lo stesso testo di «Righe per la tabella»; le altre hanno `settimana: null` e `dossier: ''`;
     - più le attività di `gia_proposte`, con la loro `settimana` e `stato_tabella` = lo stato della riga n8n.
   - «Manda la fila al sito» (HTTP POST `{{SITO_URL}}/api/agenzia/clienti-da-visitare`, corpo JSON, stessa credenziale). Impostazioni: `onError: continueRegularOutput`, 2 tentativi, timeout 60 s. Se fallisce, Telegram e la tabella sono già andati.

Le prove da aggiungere nel repo N8N:

- con il sito che risponde, un'attività presa o visitata sul sito non torna fra le prime 30, e il conto viene dal sito;
- con il sito giù, il conto viene dalla tabella e il messaggio lo dice;
- le candidate portano `lat` e `lon`;
- le già proposte escono in `gia_proposte` con la posizione;
- «Fila per il sito» manda tutte più le già proposte, col dossier solo sulle prime 30;
- in prova o con la mappa non letta, al sito non parte niente.
