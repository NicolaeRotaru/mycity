---
tipo: istruzioni
per: le sessioni che riparano in una campagna della skill `riparazione` (R01…R12)
data: 2026-11-07 09:10
---

# Le regole di chi ripara

## In parole semplici

Questo è il foglio che ogni sessione riparatrice legge prima di cominciare. Dice cosa riparare, quali file
può toccare, come provare ogni riparazione e cosa non fare mai.

Un esempio: una riparazione conta solo se la sua prova diventa rossa quando la correzione si toglie. Un
altro: un file che appartiene a un'altra sessione non si tocca, si scrive cosa servirebbe e lo fa la
regista dopo.

## Cosa cambia per te

Niente da fare: il foglio lo leggono le sessioni. Serve perché le regole siano le stesse a ogni campagna,
invece di riscriverle ogni volta.

## Cosa devi fare

Niente. Le scelte le hai già fatte alla prima fermata della campagna.

## Cosa non ho verificato

Questo foglio nasce il 7/11 e nessuna sessione l'ha ancora usato in una campagna vera: la prima campagna
dirà dove è poco chiaro.

---

## Dettagli tecnici

### Chi sei e dove lavori

Sei il riparatore `RNN` di una campagna. La tua scheda è `<cartella>/schede/RNN.md` nel deposito
`ad-mycity`: dice la casa, il deposito, la base, il tuo ramo, le tue voci, i tuoi file, la tua fascia di
migrazioni e l'id della regista. **Nessuno risponde alle tue domande mentre lavori**: decidi dentro queste
regole, e scrivi i dubbi nel referto (`domande_per_nicola`).

- **Sito:** sei nel deposito `NicolaeRotaru/mycity` alla base della scheda. Le regole e la scheda stanno
  in `ad-mycity`, che cloni accanto, in sola lettura, al commit che ti ha dato la regista:
  `git clone --filter=blob:none https://github.com/NicolaeRotaru/ad-mycity ../ad-mycity && git -C ../ad-mycity checkout <SHA_REGISTA>`.
  Poi, una volta: `npm ci`.
- **Macchina:** sei già in `ad-mycity`. Leggi la skill `cantiere`, che dice come si ripara bene una scheda
  della macchina. Valgono le sue regole sulle prove, più queste.
- Spingi **solo** sul tuo ramo. Mai una PR, mai un'unione, mai `--force`, mai un altro ramo.

### Le regole delle sessioni (regola 11 di `cervello/sessioni-insieme.md`, Nicola 13/11 alle 13:30)

- Lo stop, la quota, la sicurezza e i soldi li mandi alla regista con `send_message` e `priority: "now"`. A un
  messaggio urgente rispondi subito, con una riga.
- Una decisione di Nicola che ti arriva la giri alla regista nello stesso turno. Se aspetti un suo clic, lo dici
  subito alla regista.
- Se `get_session` senza id mostra uso extra o un blocco della quota, lo scrivi subito alla regista.
- A 400 mila token di storia apri da te la tua sessione 2.0 (come nel punto 6 di «A lotti» qui sotto).
- Se la tua scheda ha un grave, un bloccante o tocca soldi, dati o permessi, lavori solo con ultracode acceso: se
  `get_session` non dice `is_ultracode_active: true`, non cominci e lo dici alla regista. Se la scheda è di soli
  minori, lavori senza ultracode (Nicola, 15/11: costava 4,16 $ per voce lavorata contro 2,22 $).
- Il costo lo leggi da `usage.cost_usd` di `get_session`, mai a stima.

### Prima il piano

Prima di toccare il codice scrivi il piano, **senza aprire il codice del sito**: lo ricavi dalla scheda e dal registro
compatto. Per ogni lotto: le voci, l'ordine (i gravi prima), e per ogni voce il file della scheda e il tipo di prova
che ti aspetti. Il dettaglio riga per riga lo scrive il subagente del lotto, prima di riparare, e lo trovi nel suo
rapporto. Manda il piano alla regista con `send_message` e **chiudi il turno**.
Riparti quando la regista risponde «approvato», o correggi come ti dice.

### A lotti, con la storia piccola (regola del 12/11 notte)

Il conto dell'onda 1: un riparatore è costato da 25 a 55 $ di listino, e tre quarti erano nel primo turno lungo.
La sua storia arrivava a 440-740 mila token, riletti per intero a ogni passo. Sei dollari su dieci dell'onda sono
andati in rilettura, non in lavoro. Quindi:

1. **Tu fai il capo squadra, leggero.** Non apri i file del sito per ripararli. Dividi le tue voci in **lotti da 5
   a 8**: i gravi prima, e un grave di soldi, dati o permessi sta da solo nel suo lotto.
2. **Ogni lotto lo ripara un subagente nuovo.** Gli dai: le voci (chiave, file, riga del registro compatto), il
   percorso di questo foglio da leggere, la tua fascia di migrazioni e il ramo. Ripara voce per voce col metodo qui
   sotto, fa le prove e la prova rimessa, un commit per voce, e ti restituisce solo le righe JSON del referto e i
   problemi in poche righe. Nel deposito del sito i tipi `tech` e `qa` non esistono: usa il subagente generico, con
   un mandato chiuso («ripara queste voci con queste regole» oppure «prova a smentire queste riparazioni»).
3. **Un lotto alla volta.** I lotti lavorano nella stessa copia del sito: due insieme si rubano i file a vicenda
   (il commit di uno cattura i file che la prova rimessa dell'altro ha riportato alla base, e la prova rimessa trova
   l'albero sporco). Il lotto dopo parte solo quando quello prima ha fatto i suoi commit.
   **Tu copi le righe nel referto**, lanci i controlli del lotto e passi al lotto dopo. Così la tua storia resta
   sotto i 150 mila token. Un giro di correzione chiesto dal collaudo lo fa un subagente nuovo, che riceve solo il
   referto, il diff della voce e il rapporto del collaudo.
4. **I rapporti sono corti:** il verdetto, più ogni difetto con file e riga. Le uscite lunghe (prove, log) restano in
   un file in `/tmp`, e nella storia entra solo il comando con l'esito. Le prove si lanciano con il reporter corto
   (`--reporter=dot`), non con quello che stampa ogni caso.
5. **Un turno, un esito.** Un comando lungo (`npm run verify`) si aspetta nello stesso turno: in primo piano fino a
   10 minuti, oltre in sottofondo con l'attesa sul comando. Non si chiude il turno con «verify in corso». Insieme, in
   primo piano e nello stesso messaggio, si lanciano solo i subagenti che **leggono** (i revisori di un lotto), così
   non ti svegliano uno alla volta. Quelli che riparano vanno uno alla volta (punto 3).
6. **A 400 mila token di storia apri tu la tua sessione 2.0** (Nicola, 13/11 alle 13:30; regola 7 di
   `cervello/sessioni-insieme.md`). Il numero lo leggi da te a fine di ogni lotto: `context_usage.used_tokens` di
   `get_session` senza id. Chiudi il lotto in corso e scrivi nel referto un campo `passaggio` (voci fatte, in corso,
   giri aperti, spesa). Copialo in `.riparazione/referto-RNN.json`, fai il commit e spingi. Poi `create_session` dalla
   **testa del tuo ramo** (mai dalla base), sullo stesso ramo, stessa etichetta, titolo «RNN secondo» (il numero dopo, in parole), modello
   grande, `effort: "xhigh"`, `permission_mode: "auto"`. Il primo messaggio porta questo foglio, la scheda, il
   passaggio e «riprendi solo le voci senza esito». Con `get_session` controlli che la 2.0 abbia ultracode acceso:
   se è spento, lo dici subito alla regista, che lo fa accendere a Nicola.
   Poi scrivi alla regista il suo id e lo SHA spinto, preso con `git rev-parse HEAD` nello stesso comando, e ti
   fermi. Se `create_session` ti è negato, la 2.0 la apre la regista.
7. **Al massimo 6 subagenti in tutto, 8 se la scheda ha un grave** (regole del 15/11; prima erano 12, e nell'onda 2
   quattro sessioni su dodici li hanno superati). **Mai lo strumento Workflow**: un lancio solo apre molti agenti.
   Niente revisori interni oltre a quelli che il tetto consente. Al tetto ti fermi e lo scrivi alla regista, con
   quante voci restano.
8. **Un lotto di soli minori, senza soldi, dati o permessi**, lo dai a un subagente col modello piccolo
   (`model: "sonnet"`). I gravi, e tutto quello che tocca soldi, dati o permessi, restano sul modello grande.

### Il metodo, voce per voce

1. Leggi la voce nella scheda. Il testo intero sta nel registro di `ad-mycity`: cercalo con grep nel
   registro compatto `<cartella>/registro-compatto.txt` (una riga per voce: chiave, gravità, stato, file,
   titolo), **mai** aprendo il registro intero. Le voci si trovano per **chiave**, mai per posizione.
2. Controlla che il difetto ci sia ancora sulla base. Se non c'è più: esito `gia_riparato_prima`, e nel
   campo `prova` la riga di codice o il comando che lo dimostra.
3. Se non è codice (una chiave su Vercel, un dato nel database vero, un'impostazione di Supabase o Stripe):
   `non_codice`, con cosa deve fare Nicola nella `nota`.
4. Se serve una scelta di Nicola (un prezzo, una soglia, una regola di business): `scelta_di_nicola`, con la
   domanda in una riga.
5. Se la cura sta in un file che non è tuo: `serve_file_altrui`, con l'elenco `{file, modifica}` esatto. Non
   toccare quel file. **È la regola che il 5/11 non c'era**: 89 file toccati fuori territorio, 16 ricuciti a mano.
6. Altrimenti ripara con **la modifica più piccola che chiude tutta la voce** così com'è scritta. Non
   riscrivere, non abbellire, non cambiare comportamenti che la voce non nomina. Se chiudi solo un pezzo,
   l'esito è `parziale` con `cosa_resta`.
7. **La prova.** Se cambia un comportamento (logica, date, soldi, dati, permessi, stati dell'ordine) scrivi
   una prova che fallisce senza la correzione e passa con la correzione. Per un testo, un'etichetta o uno
   stile basta una prova leggera. Un **grave** o un **bloccante** si chiude solo con una prova `comando`
   eseguita (l'asticella). Le date usano un orologio finto: una prova scritta per il «2 novembre» e
   controllata con l'orologio vero è diventata rossa da sola, il 5/11.
8. **La prova rimessa**, su ogni `riparato`, dopo il commit della voce (C):
   `timeout 540 node ../ad-mycity/cervello/prova-rimessa.mjs --repo . --base C^ --file <i file corretti> --prove <i file di prova> --json`
   (sulla macchina: `node cervello/prova-rimessa.mjs … --comando "node --test {prove}"`). Più file vanno separati
   da una **virgola**, senza spazi: `--file lib/a.ts,lib/b.ts`. L'albero deve essere **pulito**, a parte
   `node_modules`: per questo il referto non si tiene dentro l'albero mentre lavori (vedi «I commit»). Uscita 0 = regge. 1 = la prova non torna rossa togliendo la correzione: non
   è una riparazione. 3 = la prova è rossa per la struttura (un nome che manca), non per il comportamento:
   rimetti il difetto com'è scritto nella voce e guarda. 2 o 4 = condizione sbagliata: sistemala e riprova.
   **Se la correzione ha file nuovi** (una migrazione, un aiutante) mettili in `--file` insieme agli altri: la
   prova toglie tutti i file nuovi insieme, lascia corretti gli altri, e deve cadere sul comportamento. Una
   prova che nomina o importa il file nuovo dà 3: guarda il file, non quello che fa. **Una
   migrazione si prova con le prove SQL:** `--sql rNN_rimessa` al posto di `--comando` (ricostruisce il
   database dalle migrazioni sul disco, con e senza la tua; il nome deve dire «rimessa», «prova» o «test», e il
   Postgres deve essere locale). Senza `--sql` una migrazione nuova dà 3. Se la correzione ha più file nuovi, ognuno
   si toglie anche da solo: uno che da solo lascia la prova verde dà 1. Così anche una voce chiusa solo con una
   migrazione può essere `riparato`, non più `parziale` per forza (regola del 12/11 sera).
9. Scrivi la voce nel referto **appena finita**, non alla fine: nel file di lavoro `../referto-RNN.json`, fuori
   dall'albero.

### I tuoi file

- Tocchi solo **i tuoi file** (sezione «I miei file» della scheda). Un file nuovo lo puoi creare: se un
  altro ramo crea lo stesso file, la regista lo vede subito.
- **Le prove nuove** portano il tuo nome: `tests/unit/riparazione-rNN-<tema>.test.ts` (sito),
  `tests/sql/rls/riparazione-rNN-<tema>.test.sql` (prove SQL: `run.sh` e la CI leggono solo `tests/sql/rls/*.test.sql`;
  con un altro nome la guardia è rossa),
  `cervello/test/riparazione-rNN-<tema>.test.mjs` (macchina).
- **Una prova esistente** la modifichi solo se importa **o legge per nome** uno dei tuoi file (per esempio
  `readFileSync(join(ROOT, "app", "x", "page.tsx"))`), e lo dichiari. Un percorso scritto solo in un commento
  non conta. Se la prova usa anche file di altre sessioni dell'onda è comune: non la tocchi, scrivi
  `serve_file_altrui`. Mai spegnerla, saltarla (`.skip`) o indebolirla per farla passare.
- La guardia guarda **il risultato del ramo**: un file toccato per sbaglio e rimesso com'era non ti fa rosso,
  te lo elenca e basta. Un file altrui cambiato davvero resta rosso.
- **Le migrazioni:** mai modificare una migrazione esistente. Se serve, una nuova nella tua fascia
  (`migrations/<numero>_<nome>.sql`). Non si applicano: lo decide Nicola.
- **Macchina:** mai scrivere nei registri condivisi (`cantiere-difetti.json`, `mutanti.json`,
  `malattie.json`, `tetti-lotto.json`) né in `MANUALE-AD.md`, `COMANDI.md`, `CLAUDE.md`. Quello che ci
  andrebbe lo scrivi nel referto: lo riporta la regista.
- **Niente file temporanei** nel ramo: cartelle col punto (`.montati/`, `.prova-…/`), `*.tmp`, `*.bak`.
  Il 5/11 tre sessioni li hanno lasciati.

### I commit

- **Una voce per commit**, e il messaggio comincia con il suo id: `R03-007 il payout aspetta il giorno giusto`.
  Così ogni voce si prova da sola e, se rompe qualcosa, si toglie da sola. Due voci che vivono nella stessa
  riga vanno insieme solo dichiarandolo: `insieme_a` su tutte e due.
- I commit che non sono di una voce (formattazione, lint) portano `RNN-varie`.
- **Mai l'id di un'altra voce nel messaggio**, neanche come contesto («come R07-009»). Ogni codice fatto come
  `R07-009` che non è una voce del tuo lotto fa scattare `guardia-ramo` (`id_nel_commit`), anche in fondo al
  messaggio, e per chiudere serve una firma di Nicola: nell'onda 9 è successo
  quattro volte, e le chiusure sono rimaste ferme due giorni. Il contesto va nel referto, non nel commit.
- **Il referto.** Mentre lavori lo tieni in `../referto-RNN.json`, **fuori** dall'albero: la prova rimessa vuole
  l'albero pulito. Ogni 10 voci o ogni ora, quello che arriva prima, lo copi in `.riparazione/referto-RNN.json`,
  fai un commit con **solo** il referto (il messaggio è libero) e spingi, con `"finita": false`.

### Il controllo prima di dire «finito»

1. Un subagente diverso da chi ha riparato prova a smentire ogni gruppo di riparazioni (al massimo 6 voci per
   subagente, un grave da solo; nel sito il tipo `qa` non c'è, quindi il subagente generico con il mandato di smentire): rilancia la prova, cerca la variante scomoda, guarda se la correzione
   rompe qualcosa accanto. Nel dubbio la voce torna `parziale` o `non_fatto`. Scrivi chi l'ha guardata in
   `verificato_da`.
2. **Sito:** prima le prove dei file toccati e quelle che li importano, poi `npm run verify` verde sull'ultimo
   commit di codice, aspettato nello stesso turno. **Macchina:** `node cervello/cancello-lotto.mjs` verde.
3. Nel referto metti `"finita": true`, `testa` = il tuo **ultimo commit di codice** (quello dopo il quale ci sono
   solo commit del referto) e `verifica.testa` = lo SHA su cui è girato il verify, preso con `git rev-parse HEAD`
   nello stesso comando. Deve essere `testa`, oppure un commit dopo `testa` che tocca solo il referto: se no il
   programma è rosso (nell'onda 1 R07 ha spinto 8 commit con un verify lanciato e mai aspettato). Copia il referto in `.riparazione/`, fai il commit del solo
   referto, spingi.
4. Il controllo del programma sul tuo referto, dalla copia di `ad-mycity`:
   `node ../ad-mycity/cervello/riparazione-sessioni.mjs valida-referto .riparazione/referto-RNN.json --cartella ../ad-mycity/<cartella> --git . --ramo HEAD`
   (sulla macchina, senza `../ad-mycity/`). Deve essere **verde** (uscita 0). Nel sito questo comando e la prova
   rimessa hanno il permesso scritto in `.claude/settings.json`: nell'onda 1 R03 e R04 non li hanno potuti lanciare. Finché il referto non è finito il
   controllo esce ⚪ «in attesa» (uscita 3): è normale, ma non basta per dire «finito».
5. Manda alla regista con `send_message` una riga per esito («31 riparati, 4 parziali, 2 serve_file_altrui,
   1 scelta di Nicola»).

### Il referto `.riparazione/referto-RNN.json`

```json
{
  "sessione": "R03",
  "aggiornato": "2026-11-08 10:30",
  "finita": false,
  "testa": "<l'ultimo commit del ramo>",
  "verifica": { "comando": "npm run verify", "esito": "verde", "testa": "<lo SHA su cui è girato, uguale a testa>", "nota": "" },
  "voci": [
    { "id": "R03-001", "chiave": "<la chiave della scheda, uguale>", "esito": "riparato",
      "commit": "<sha>", "file_toccati": ["lib/…"], "prova_file": ["tests/unit/riparazione-r03-….test.ts"],
      "prova_comando": "npx vitest run tests/unit/riparazione-r03-….test.ts", "prova_tipo": "comando", "prova_eseguita": true,
      "rimessa": { "esito": "regge", "uscita": 0, "comando": "node …/prova-rimessa.mjs --repo . --base <sha>^ …" },
      "copre_tutta_la_voce": true, "cosa_ho_fatto": "una o due frasi", "verificato_da": "qa: cosa ha provato" },
    { "id": "R03-002", "chiave": "…", "esito": "serve_file_altrui",
      "serve_file_altrui": [{ "file": "app/…", "modifica": "cosa cambiare, esatto" }] },
    { "id": "R03-003", "chiave": "…", "esito": "parziale", "cosa_resta": "…" },
    { "id": "R03-004", "chiave": "…", "esito": "gia_riparato_prima", "prova": "lib/…:42 controlla già …" },
    { "id": "R03-005", "chiave": "…", "esito": "scelta_di_nicola", "domanda": "…" },
    { "id": "R03-006", "chiave": "…", "esito": "non_codice", "nota": "cosa deve fare Nicola" },
    { "id": "R03-007", "chiave": "…", "esito": "non_fatto", "nota": "perché" }
  ],
  "nuovi_difetti_visti": [
    { "titolo": "come lo diresti a voce", "dimensione": "una delle dimensioni del registro", "severita": "minore",
      "file": "percorso:riga", "descrizione": "…" }
  ],
  "domande_per_nicola": [],
  "conto": { "agenti": 0, "nota": "" }
}
```

A referto finito ogni voce della scheda deve comparire, anche quelle non fatte. Un difetto nuovo trovato
strada facendo non si ripara se è fuori dai tuoi file: va in `nuovi_difetti_visti`.

### Il deposito è pubblico

Una falla di sicurezza NUOVA (permessi, dati esposti, accessi, pagamenti aggirabili) non si descrive nel
referto né nei commit. Nel referto: `"riservato": true`, titolo generico «Falla di sicurezza da chiudere
(<area>): i dettagli restano fuori dal deposito pubblico finché non è chiusa», `"file": "(nel referto
privato)"`, nessuna descrizione. I dettagli li scrivi solo nel messaggio finale alla regista.

### Se qualcosa ti blocca

Se un permesso, un controllo della sessione o un accesso negato ti ferma (un comando rifiutato, `ad-mycity` che non
si legge, una richiesta di approvazione), non aspettare: nessuno la vede. Manda subito alla regista con `send_message`
l'errore esatto, e intanto vai avanti per un'altra strada. Un comando che non puoi lanciare lo lancia la regista. Il
12/11 una sessione è rimasta ferma quattro ore in attesa di un clic che nessuno poteva dare.

### Cosa non fai mai

Mettere il sito online, scrivere sul database vero, applicare migrazioni, cambiare prezzi o commissioni,
scrivere a clienti o negozi veri, leggere o stampare chiavi. **Interrogare il database vero, anche solo in lettura**
(gli strumenti Supabase, `psql` verso l'indirizzo vero): nell'onda 1 un subagente l'ha fatto. Le prove girano sul
Postgres locale. Nel sito gli strumenti che toccano il database vero, la messa online e Stripe sono bloccati da
`.claude/settings.json`; la regola vale anche dove il blocco non arriva, e la scrivi nel mandato di ogni subagente. Se una voce lo richiede, l'esito è
`non_codice` o `scelta_di_nicola`.
