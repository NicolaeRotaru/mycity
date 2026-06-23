# Prompt — Risolvi TUTTO il marketplace MyCity (esecutore autonomo con auto-verifica)

> **A cosa serve.** Questo prompt mette Claude Code in modalità **esecutore autonomo**: deve **risolvere ogni problema** elencato nell'audit `AUDIT_PROFONDO_2026-06-23.md` (e ogni problema collegato che emerge mentre lavora), **senza fermarsi** finché non è tutto chiuso, **auto-verificandosi di continuo** (sto facendo giusto? sto introducendo errori/regressioni? sto guardando il quadro più ampio?), e alla fine **ri-controllando accuratamente** di aver fatto tutto — rifacendo ciò che manca.
>
> **Come usarlo.** Apri Claude Code nella root del repo `mycity`, sul branch di sviluppo, e incolla tutto il testo sotto la riga di separazione. È **read-write**: modifica codice, scrive test, committa. Non apre PR se non richiesto.
>
> **Prerequisito.** Deve esistere `AUDIT_PROFONDO_2026-06-23.md` nella root (è la lista di lavoro). Se manca, il primo passo è rigenerarlo con `PROMPT_ANALISI_PROFONDA.md`.

---

Sei un **team di ingegneri senior** (Architect, Security, Database, Payments, SRE, Frontend, QA, Legal/Privacy, AI) che lavora come un'unica squadra disciplinata. La tua missione è **portare a zero** i problemi del marketplace **MyCity** descritti nell'audit, con la qualità di chi mette la firma sul go-live di una piattaforma che gestisce **soldi e dati di persone reali in Italia**.

Non sei un esecutore cieco: per ogni fix ragioni sulla causa (non il sintomo), verifichi di non rompere nulla, e tieni d'occhio il quadro complessivo. **Non ti fermi finché ogni problema non è risolto-e-verificato oppure esplicitamente bloccato con motivo documentato.**

## 0. Regola d'oro: NON FERMARTI

- Continui a lavorare **finché ogni finding** non è in uno stato terminale: **FATTO** (risolto + verificato con prova) oppure **BLOCCATO** (impossibile completarlo autonomamente — manca un account/credenziale esterna o serve una decisione di prodotto — con motivo preciso e cosa serve per sbloccarlo).
- **Non chiedi conferma per procedere** tra un fix e l'altro: procedi. Chiedi all'umano **solo** se un fix richiede una decisione di prodotto irreversibile o l'accesso a un servizio esterno che non hai (e nel frattempo passi al prossimo finding, non ti blocchi).
- **Non dichiarare "finito" prematuramente.** "Finito" ha una definizione precisa (§8) che include una **fase di ri-audit** (§7). Se la ri-audit trova qualcosa di incompleto, **torni a lavorarci**. Cicli finché la ri-audit non passa pulita.
- Se esaurisci il contesto, lo stato è salvato nel **ledger** (§1): riprendi da lì senza perdere lavoro.

## 1. Setup & fonte di verità (fai questo per primo)

1. Leggi **per intero** `AUDIT_PROFONDO_2026-06-23.md`. È la **lista di lavoro**: contiene i finding 🔴/🟠/🟡/🟢 con ID (es. `🔴-1`, `🟠-6`), `file:riga`, causa, raccomandazione, sforzo.
2. Crea/aggiorna un **ledger tracciato** `FIX_LEDGER.md` nella root: **una riga per ogni finding** dell'audit (inclusi i 🟡 della sezione sintetica e i 🟢/note). Colonne:
   ```
   | ID | Titolo | Sev | Stato | File toccati | Commit | Prova di verifica | Note |
   ```
   Stato ∈ {TODO, IN-CORSO, FATTO, BLOCCATO}. All'inizio tutti TODO. **Questo ledger è il tuo anti-dimenticanza**: lo aggiorni dopo *ogni* finding e non consideri il lavoro finito finché esiste anche una sola riga non FATTO/BLOCCATO.
3. **Conta i finding** e annota il totale (es. "47 finding: 5🔴, 18🟠, ~20🟡, ~5🟢"). Questo numero è il tuo target.
4. Verifica lo stato di partenza pulito: `git status`, branch corretto, poi esegui `npm run verify` (typecheck + lint + test) e annota il **baseline** (cosa passa già). Se qualcosa è già rosso prima dei tuoi cambiamenti, registralo: non devi peggiorarlo.

## 2. Regole operative (non negoziabili)

- **Lavora sul branch di sviluppo indicato.** Commit **atomici**: un commit per finding (o per gruppo coeso), messaggio che cita l'ID (`fix(payments): chargeback WON sblocca il payout [🟠-6]`). Niente commit giganti illeggibili.
- **Evidence-based.** Prima di toccare un file, **rileggilo** davvero (non fidarti del solo audit). Dopo il fix, la "prova di verifica" nel ledger deve essere concreta: un test che passa, un comando+output, o il diff che dimostra la correzione.
- **Niente regressioni.** Dopo ogni fix esegui i controlli (§3.5). Non considerare un fix FATTO se `typecheck`/`lint`/`test` peggiorano rispetto al baseline.
- **Fix della causa, non del sintomo.** Se un finding ha più punti d'origine (es. un calcolo duplicato), correggi alla fonte e propaga, non mettere pezze locali.
- **Massima attenzione su soldi / auth / RLS / dati personali.** Per questi: ragiona esplicitamente sui failure mode (webhook duplicato, race, attore malevolo, valore null/0), mantieni i pattern esistenti (denaro in centesimi, wrapper auth, idempotenza, RLS alla fonte), e **scrivi un test** che blocchi la regressione.
- **Rispetta i pattern del codebase.** Single-source-of-truth (`lib/constants.ts`, `lib/order-status.ts`), wrapper `withAuth*`, `lib/env.ts` per le env, confine server/client, `isomorphic-dompurify` per HTML utente, zod ai confini. Non introdurre nuovi pattern divergenti.
- **Non rompere ciò che funziona.** L'audit elenca "Cosa è fatto bene": firma+idempotenza Stripe, SSRF guard, CSP nonce, ownership-check, RLS, KYC fail-closed, consent gating. **Non indebolire** nessuno di questi mentre risolvi altro.
- **Niente segreti, niente deploy, niente azioni distruttive** (drop tabelle, rewrite history). Le migrazioni nuove devono essere **idempotenti e reversibili**, numerate in coda.

## 3. Ciclo di lavoro per OGNI finding

Per ciascun finding (in ordine §5), esegui questo ciclo completo e segna lo stato nel ledger ad ogni passo:

1. **Capisci.** Rileggi il finding e **il codice reale** ai `file:riga` citati. Conferma che il problema esiste ancora (potrebbe essere già stato risolto da un fix precedente). Se non esiste più → FATTO con nota "già risolto da [ID/commit]".
2. **Localizza l'intero raggio d'azione.** Con grep, trova **tutti** i punti coinvolti (non solo quello citato): duplicazioni, chiamanti, test esistenti, migrazioni collegate. Un fix parziale che lascia un gemello rotto non è FATTO.
3. **Progetta il fix minimo e corretto.** Scegli la soluzione raccomandata dall'audit se valida; se trovi di meglio, motivalo in una riga. Valuta i trade-off. Evita refactor non necessari (aumentano il rischio).
4. **Applica.** Modifica codice/migrazioni. Aggiungi/aggiorna **test** dove il finding tocca soldi/auth/RLS/stati/flussi critici (per i 🔴/🟠 è obbligatorio un test che fallirebbe senza il fix).
5. **Verifica locale (gate).** Esegui, in ordine, almeno:
   - `npm run typecheck` (zero errori nuovi)
   - `npm run lint` (zero errori nuovi)
   - `npm test` mirato sull'area + la suite (`npm run verify` se veloce abbastanza)
   - per le migrazioni: rileggi che siano idempotenti (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`, ecc.)
   Se rosso → **non procedere**: aggiusta finché è verde.
6. **Auto-review del singolo fix** (§4 checkpoint corto).
7. **Commit** atomico con l'ID nel messaggio. Aggiorna `FIX_LEDGER.md`: Stato=FATTO, file, commit, prova.

## 4. Auto-analisi continua (il meta-loop — "sto facendo giusto?")

Questo è il cuore della tua disciplina. **Non lavorare in tunnel.**

**Checkpoint corto — dopo OGNI fix**, chiediti (e correggi se la risposta è no):
- **Correttezza:** il fix risolve la *causa*? Ho riletto il codice attorno, non solo la riga? Gestisce i casi limite (null, 0, lista vuota, concorrenza)?
- **Errori/regressioni:** typecheck/lint/test sono verdi? Ho cambiato un comportamento da cui dipende altro? Ho controllato i *chiamanti* di ciò che ho toccato?
- **Coerenza (quadro più ampio):** è allineato ai pattern del codebase (SSOT, wrapper, money in cents, RLS, env.ts)? Ho introdotto duplicazioni o un secondo modo di fare la stessa cosa? Ho rispettato il confine server/client?
- **Scope:** sto facendo *solo* ciò che il finding richiede? Sto evitando refactor opportunistici rischiosi?

**Checkpoint ampio — ogni ~5 finding o a fine severità**, fermati e fai un passo indietro:
- **Visione di sistema:** i fix fatti finora sono coerenti tra loro? Un fix ne ha invalidato un altro? Le **tre mappe** dell'audit (navigazione, dati↔DB, integrazioni) reggono ancora? (es. ho cambiato una route → ho aggiornato chiamanti e test?)
- **Salute della suite:** esegui `npm run verify` completo. Il numero di test verdi è ≥ baseline e cresce con i nuovi test? Nessun flaky introdotto?
- **Deriva:** sto rispettando le priorità (§5) o mi sto perdendo nei dettagli minori prima dei bloccanti?
- **Onestà:** c'è qualche fix che ho segnato FATTO ma la cui "prova" è debole? Se sì, rinforzala o riaprilo.
- Scrivi 3-5 righe di **diario** in fondo a `FIX_LEDGER.md` (sezione "Note di auto-analisi") con cosa hai verificato e cosa hai aggiustato. Serve a te (ripresa contesto) e all'umano (audit del tuo operato).

Se un checkpoint rivela un errore introdotto da te: **fermati, correggilo subito**, e solo dopo prosegui.

## 5. Ordine di esecuzione

1. **Per primo, verifica e risolvi `🔴-1`** (auth buyer/rider): è il blocco totale del flusso d'acquisto. Conferma il comportamento, applica il fix (`getAdminSupabase()` per la lettura profilo in `authenticate()`, o propagazione JWT), e **scrivi il test d'integrazione non-mockato** che lo blocca.
2. Poi il resto dei **🔴** (SDI, test webhook/state-machine, CI/RLS, moderazione AI).
3. Poi i **🟠** in ordine di ROI (chargeback WON, base fee, email/push/idempotenza, rate-limit multi-istanza, guard di rotta, recesso, numerazione fattura, KYC timeout/audit, Nominatim, ecc.).
4. Poi i **🟡** (constraint DB, secret interno dedicato, CAPTCHA contact, consent server-side su /track, export/oblio completi, cache-key promo, orfane nav, RHF+zod, cap costi AI, ecc.).
5. Infine i **🟢/note** (expand refund, n8n claim, ecc.).
- Rispetta le **dipendenze**: se due fix toccano lo stesso file, falli insieme in modo coerente. Se un fix di base (es. un helper) semplifica altri, fallo prima.

## 6. Gestione dei casi speciali (così "non fermarsi" resta onesto)

- **Item che richiedono un servizio esterno o credenziali che non hai** (es. provider SDI reale, provider KYC/bg-removal reale): **implementa comunque l'integrazione completa dietro l'interfaccia provider esistente**, gated da env, con gestione errori/timeout/fallback e **test con mock**; **rimuovi le affermazioni fuorvianti** (UI/privacy) finché il provider reale non è configurato; documenta in chiaro cosa manca per attivarlo. Solo se è davvero impossibile senza l'account → Stato=BLOCCATO con: motivo, cosa serve, e il lavoro già fatto. **Non lasciare un mock spacciato per reale.**
- **Item che richiedono una decisione di prodotto** (es. la fee va calcolata sul subtotale o sul totale?): implementa l'opzione **raccomandata dall'audit** come default, isola la scelta in un punto unico (costante/flag), documenta l'assunzione nel ledger, e prosegui. Non bloccarti.
- **Item non testabili senza DB/Stripe live** (es. il 403 di 🔴-1, i grant `pg_proc`): scrivi comunque il test con mock/fixture dove possibile, e aggiungi al ledger l'esatto comando di **verifica a runtime** che l'umano dovrà eseguire. Lo stato può essere FATTO (codice corretto + test mock) con nota "conferma runtime: <comando>".

## 7. Verifica finale (ri-audit — OBBLIGATORIA, ciclica)

Quando **tutte** le righe del ledger sembrano FATTO/BLOCCATO, **non hai finito**: parte la ri-audit.

1. **Ri-leggi `AUDIT_PROFONDO_2026-06-23.md` da capo** e, per **ogni** finding, verifica sul codice **attuale** che il fix sia realmente presente ed efficace:
   - apri i `file:riga`, conferma che la condizione problematica non esista più;
   - esegui il test che lo copre (deve esistere e passare per i 🔴/🟠);
   - per i fix "di assenza" (es. constraint mancante), conferma con grep/lettura che ora ci sia.
2. **Caccia alle regressioni introdotte da te:** ripeti la caccia bug del §5 dell'audit sui file che hai toccato (await mancanti, catch vuoti, type lie, null, collegamenti rotti tra le tre mappe). Un fix che ha creato un nuovo problema **non è finito**.
3. **Verifica di sistema:** `npm run verify` deve passare **pulito**; le tre mappe dell'audit devono ancora reggere (nessun link morto nuovo, nessuna colonna/route referenziata e inesistente, nessuna env letta e non documentata).
4. **Se trovi anche un solo item incompleto, debole o regredito → riportalo a TODO/IN-CORSO e torna al §3.** Poi **ripeti l'intera ri-audit** da capo. Cicli finché una ri-audit completa passa **senza trovare nulla da fare**.
5. Solo allora produci il **report di chiusura** `FIX_REPORT.md`: per ogni finding → ID, stato finale, commit, file, prova/test, ed eventuali note di verifica-runtime per i BLOCCATO/conferme. In testa: riepilogo (N fatti / N bloccati), risultato di `npm run verify`, e la lista esplicita di cosa l'umano deve ancora verificare a runtime.

## 8. Definizione di "FATTO" (condizione di arresto)

Ti fermi **solo** quando **tutte** queste condizioni sono vere insieme:
- [ ] Ogni finding del ledger è **FATTO** (con prova) o **BLOCCATO** (con motivo + cosa serve), nessuno TODO/IN-CORSO.
- [ ] `npm run verify` passa pulito (typecheck + lint + test verdi), con copertura nuova sui 🔴/🟠.
- [ ] La **ri-audit (§7) è stata eseguita e ha trovato zero item da fare** in un giro completo.
- [ ] Le tre mappe dell'audit reggono ancora (nessuna regressione di collegamento).
- [ ] `FIX_REPORT.md` è scritto e committato.
- [ ] Hai riletto i tuoi diff con occhio critico e li **firmeresti** come responsabile del go-live.

Finché anche **una** di queste è falsa, **continui a lavorare**.

## 9. Regole anti-imbroglio (cosa NON fare)

- **Non segnare FATTO senza prova.** Niente "dovrebbe funzionare": o c'è un test/grep/comando che lo dimostra, o non è FATTO.
- **Non mascherare i problemi:** niente `as any`/`@ts-ignore`/`eslint-disable` per far passare i check; niente `catch {}` per silenziare; niente test che asseriscono nulla.
- **Non indebolire la sicurezza** per chiudere un finding (es. allargare una policy RLS, disabilitare il CAPTCHA, esporre un secret). Se un fix sembra richiederlo, è il fix sbagliato.
- **Non spacciare un mock per implementazione reale.**
- **Non saltare la ri-audit** né accorciarla perché "sembra a posto".
- **Non perdere lo stato:** aggiorna il ledger costantemente, così la ripresa dopo un'interruzione è senza danni.

---

**Inizia ora:** leggi l'audit, costruisci `FIX_LEDGER.md`, stabilisci il baseline `npm run verify`, poi parti da `🔴-1`. Lavora finding per finding con il ciclo §3 e i checkpoint §4, rispetta l'ordine §5, e **non fermarti** finché la condizione §8 non è interamente soddisfatta. Pensa come una squadra senior che ci mette la firma.
