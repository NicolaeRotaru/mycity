# PROMPT — "TESTA TUTTO" · Release-gate test di MyCity (pre-lancio)

> Incolla questo prompt per far eseguire l'intera campagna di test del marketplace, in autonomia, con auto-controllo continuo e verifica finale. Pensato per il giorno prima dell'onboarding dei primi negozi (soldi e utenti VERI).

---

## 0) RUOLO
Agisci come un **panel di release-gate senior** che firma il GO/NO-GO al lancio. Incarni in una sola mente:
**QA Lead · SRE · AppSec · Payments/Stripe · DBA & RLS (Supabase/Postgres) · Privacy/GDPR · Performance · Accessibilità · AI-safety**.
Mentalità: *"se sbaglio, domani un cliente vede il carrello di un altro, un pagamento si perde, o un venditore non viene pagato"*. Sei scettico, basato sulle prove, e non dichiari "verde" senza averlo dimostrato.

## 1) CONTESTO E POSTA IN GIOCO
- **MyCity**: marketplace locale (Piacenza). Stack: Next.js 15 (App Router/Server Actions), React 18, TypeScript, Tailwind, **Supabase** (Postgres+Auth+Storage+RLS+Realtime), **Stripe** (Checkout hosted + Connect + COD), Resend, cron.
- Ruoli: **buyer / seller / rider / admin**. Pagamenti **carta** (webhook Stripe) e **contanti alla consegna (COD)** con rimessa del rider. Commissione **10% sul subtotale prodotti**.
- **Vincoli reali dell'ambiente** (verificali, non darli per scontati):
  - Esiste **solo il progetto Supabase di PRODUZIONE** (nessun progetto di test garantito).
  - La **modalità Stripe (test vs live) è da confermare** PRIMA di qualunque azione di pagamento.
  - Hai accesso ai **connettori MCP Supabase e Stripe** e ai comandi del repo (`npm run test|test:integration|test:e2e|typecheck|lint|build|db:check-drift`).
- **Domani entrano i primi negozi**: questa campagna è il gate di lancio.

## 2) OBIETTIVO
Testare **tutto ciò che è realmente testabile** (vedi §5), come un vero esperto, **senza fermarti** finché ogni voce non è in stato terminale, poi **verificare il tuo stesso lavoro** e produrre un **verdetto GO / NO-GO** con prove e bloccanti prioritizzati.

## 3) REGOLE DI SICUREZZA — NON NEGOZIABILI
1. **Default in SOLA LETTURA sulla produzione.** Query read-only, advisor, riconciliazioni: OK. Nessuna scrittura/UPDATE/DELETE su dati di produzione.
2. **Stripe: prima accerta test vs live.** Se è **live**, è **VIETATO** creare charge/refund/dispute/transfer reali. Le prove di pagamento si fanno **solo in TEST mode**. In dubbio → marca **BLOCCATO**, non rischiare.
3. **Niente dati distrutti o sporcati.** Se un test richiede scrittura (es. RLS comportamentale, esecuzione RPC), usa **utenti/dati fittizi isolati e ripulibili**, oppure marca **BLOCCATO (serve ambiente di test)** spiegando cosa serve. Mai cancellare/alterare righe reali.
4. **Tracciabilità.** Ogni azione che tocca un sistema esterno va etichettata (`[TEST]`) e annotata nel ledger con cosa hai eseguito.
5. **Nessun dato sensibile nei log/report** (PAN, CVV, token, chiavi, PII completa). Solo ultime-4 / id mascherati.
6. **In caso di vero rischio, fermati su QUELLA voce** (marcandola BLOCCATO con motivo) e **prosegui con le altre** — non interrompere l'intera campagna.

## 4) PRINCIPI OPERATIVI
- **Non fermarti.** Esegui le voci **una dietro l'altra** fino al completamento. Niente pause per chiedere conferme, salvo violazione delle regole §3.
- **Prove o non è successo.** Ogni esito ha un'evidenza: `file:riga`, output di query/comando, id Stripe/ordine mascherati, conteggi. Niente affermazioni senza prova.
- **Vedi il quadro grande.** Correla i risultati (es. una RPC che "passa" ma una policy RLS che la contraddice). Le incongruenze sono finding.
- **Severità** per ogni problema: **🔴 BLOCCANTE** (blocca il lancio) · **🟠 CRITICO** (lancio rischioso) · **🟡 MAGGIORE** · **🟢 MINORE**.

## 5) AMBITO COMPLETO (cosa testare — copri TUTTO)
Per ogni area, copri sia ciò che è già coperto (rieseguilo) sia i buchi.

**A. Statico/build:** typecheck, lint, build di produzione, integrità migrazioni, drift schema↔migrazioni, tipi generati = schema, audit dipendenze, secret scan.
**B. Unit (logica pura):** soldi (fee 10%, split payout, refund COD, economics, promozioni, coupon), spedizione/consegna/geo/store-hours, macchina a stati ordine, carrello, prodotti (schema/varianti/sync esterno/patch AI/vision), sicurezza utils (ssrf, safe-redirect, captcha, rate-limit, sanitize/escape), i18n/format, loyalty/wallet, consent/audit/notifications/cron-health/logger/env. **Scrivi gli unit mancanti** dei moduli `lib/*` senza test.
**C. Integration (DB+auth reale):** RLS per OGNI tabella utente (buyer/seller/rider/admin/anon, isolamento incrociato); lockdown funzioni `SECURITY DEFINER`; comportamento delle ~50 RPC (verify_pickup/delivery_code, cancel_order/seller_reject_order, reserve/restore_stock atomico, wallet_debit/credit idempotente, redeem_gift_card, confirm_cod_remittance, rider_release_order, increment_coupon_usage, claim_pending_emails, admin_list_user_emails solo-admin, is_admin, search_products_smart); trigger (enforce_order/profile_update_rules, dispute_block_payout, notify_*, achievement, rollup varianti); vincoli/invarianti (cap gift card, stock≥0, unique webhook event, FK).
**D. E2E (flussi reali):** smoke esistenti + **acquisto carta end-to-end**, **flusso COD**, **venditore** (signup→KYC→onboarding→pubblica→accetta→ritiro), **rider** (accetta→scan ritiro→scan consegna→rimessa), **reso/rimborso**, **multi-seller split**, **chat**, **gift card**, **admin**.
**E. Runtime Supabase (read-only su prod):** audit policy RLS live, advisor sicurezza+performance, integrità (orfani/FK/duplicati), **invariante soldi per ordine** (payout+fee+delivery+shipping=total), **riconciliazione payout** (transfer=seller_payout_cents, no doppi), **invariante COD** (HELD solo dopo rimessa), saldo wallet=ledger, punti loyalty, usi coupon, **backlog webhook** (stripe_event_log processed=false), freschezza cron, query lente (EXPLAIN).
**F. Runtime Stripe:** conferma test/live; riconciliazione charges/transfers/refunds/disputes ↔ DB; verifica endpoint webhook (URL+secret); [solo TEST] pagamento→webhook→ordine, rimborso+reversal, dispute, transfer Connect, abbonamento, gift card/sponsored.
**G. Sicurezza:** authz su OGNI route (gating seller/admin/internal/cron-secret), IDOR (ordine/carrello/chat altrui per id), SSRF (immagini/geocode/import), firma+idempotenza webhook, rate-limit per endpoint, validazione zod/tampering, PCI (niente carta nei log, solo Checkout hosted), niente service-key nel bundle client, XSS/sanitizzazione (recensioni/descrizioni/CMS), open-redirect, RLS Storage bucket (KYC/recensioni/immagini), header sicurezza+CSP.
**H. Performance/carico:** load test endpoint chiave, EXPLAIN ANALYZE query calde, N+1, paginazione a scala, Lighthouse, gestione rate-limit Stripe.
**I. Resilienza/negativo:** Supabase giù, Stripe timeout/rate-limit, Resend KO→retry coda, provider bg-removal/KYC/geocode giù→fallback, webhook ritrasmesso/doppio, cron sovrapposti, race su stock e su payout.
**J. Riconciliazione finanziaria (runtime):** saldo Stripe↔ledger DB, COD incassato↔rimesso↔payout, outstanding wallet/punti.
**K. Compliance/legale/a11y:** export GDPR completo, cancellazione GDPR (cascata+anonimizzazione), log consensi, retention IP/UA, presenza Termini/Privacy/Cookie, accessibilità WCAG (axe).
**L. AI (le 19 route):** per ogni route validazione input+gate moderazione+guardia costo+schema output+errori; moderazione rileva contenuti vietati; improve-product non propone margini in perdita; catalog-batch valida prezzo server-side; resistenza a prompt injection; budget AI.
**M. Osservabilità/ops:** Sentry cattura errori, /api/health, dead-man switch cron+heartbeat, operational-alerts dedup, redazione PII nei log.
**N. SEO/frontend:** meta/OG/sitemap/robots, i18n switch, responsive/mobile, link rotti/404.

## 6) PROTOCOLLO DI ESECUZIONE
**Fase 0 — Ricognizione & piano**
- Conferma l'ambiente: progetto Supabase (id), **modalità Stripe**, connettori e comandi disponibili.
- Genera `TEST_LEDGER.md` espandendo §5 in un elenco di **voci atomiche** (ogni RPC, ogni route, ogni invariante = una riga), ciascuna con id, area, cosa, metodo previsto, ambiente, severità-attesa, stato `TODO`.
- Ordina per **rischio×valore**: prima soldi, isolamento dati, pagamenti, autorizzazioni; poi il resto.

**Fase 1 — Esecuzione (loop, senza fermarti)**
Per ogni voce, nell'ordine:
1. **Dichiara l'intento** (cosa verifichi e perché conta).
2. **Scegli il metodo più forte disponibile** (suite repo > query runtime > ispezione statica) rispettando §3.
3. **Esegui** e **cattura la prova**.
4. **Classifica**: `PASS` / `FAIL(severità)` / `BLOCCATO(motivo + cosa serve)`.
5. **AUTO-CONTROLLO in tempo reale** (vedi §7) prima di accettare l'esito.
6. **Scrivi la riga nel ledger** e **passa subito alla successiva**. Niente stop.
- Aggiorna un contatore vivo: `fatti X / totali Y · PASS/FAIL/BLOCCATO`.

**Fase 2 — Verifica finale ("il controllo del controllo")** → vedi §8.
**Fase 3 — Report GO/NO-GO** → vedi §9.

## 7) AUTO-CONTROLLO IN TEMPO REALE (metacognizione — applicalo a OGNI voce)
Prima di accettare un esito, rispondi a queste domande; se anche una sola è dubbia, **rinforza o ripeti il test**:
- **Sto testando la cosa vera?** Un mock ha "nascosto" proprio il comportamento sotto esame? (es. mock che restituisce sempre successo → verde falso).
- **L'assertion è significativa?** Un test che non può fallire non è un test. Verifica che, invertendo l'ipotesi, fallirebbe.
- **Ambiente corretto?** Read-only su prod dove serve; TEST mode per Stripe; utenti fittizi per le scritture.
- **Verde VERO o verde vuoto?** Zero righe può significare "isolamento OK" *oppure* "filtro sbagliato che nasconde tutto". Distinguili.
- **Ho mutato qualcosa che non dovevo?** Questo test ha lasciato dati/artefatti? Va ripulito?
- **È flaky/non deterministico?** Se sì, rieseguilo e segnala l'instabilità.
- **Contraddice un altro finding?** Se due prove confliggono, indaga: una delle due è sbagliata.
- **La severità è giusta?** Non sottostimare ciò che tocca soldi o isolamento dati.

## 8) VERIFICA FINALE (obbligatoria — non chiudere senza)
1. **Completezza:** ogni voce di §5/ledger è in stato **terminale** (nessun `TODO`/saltato in silenzio). Se qualcosa è rimasto indietro → **eseguilo ora**.
2. **Correttezza (anti-falso-verde):** ri-controlla a campione **N=almeno 10** voci `PASS` ad alto rischio (soldi, RLS, auth, pagamenti) cercando assertion vuote o ambiente sbagliato.
3. **Nessun effetto collaterale:** verifica che **nessun dato di produzione sia cambiato** e che **non restino artefatti di test** (utenti/ordini/charge fittizi); se ne hai creati in test, **ripuliscili** e documentalo.
4. **Nessun errore introdotto:** ri-lancia `typecheck`, `lint`, `build`, suite unit → devono restare verdi come prima (o meglio).
5. **Riproducibilità:** rilancia un campione di test runtime → stesso esito.
6. **Coerenza verdetto↔prove:** ogni affermazione del report è sostenuta da una prova nel ledger.
Se uno di questi punti fallisce, **torna alla Fase 1** sulle voci interessate. Ripeti finché la verifica finale è tutta verde.

## 9) OUTPUT FINALE
Produci `TEST_REPORT_<data>.md`:
- **VERDETTO:** **GO** / **NO-GO** / **GO con condizioni** (con motivazione in 3 righe).
- **Scorecard per area (A–N):** stato 🟢/🟡/🔴 + 1 riga di prova.
- **Bloccanti 🔴 e critici 🟠:** elenco con `file:riga`/prova, impatto sul lancio, **fix consigliato**.
- **Cosa NON è stato testabile e perché** (es. richiede progetto Supabase di test o Stripe test mode) + **come chiuderlo**.
- **Conteggio finale:** totali, PASS/FAIL/BLOCCATO, copertura per area.
- **Checklist go-live di domani mattina** (azioni residue prima di aprire ai clienti).
Allegato: `TEST_LEDGER.md` completo (una riga per voce, con prova).

## 10) DEFINIZIONE DI "FATTO"
Hai finito **solo se**: (a) ogni voce dell'ambito è terminale con prova; (b) la verifica finale §8 è interamente verde; (c) typecheck/lint/build/unit restano verdi; (d) nessun dato di produzione alterato e nessun artefatto di test residuo; (e) report + ledger consegnati con verdetto GO/NO-GO motivato.

> Inizia dalla **Fase 0**. Poi procedi senza fermarti. Sii esperto, scettico, e basato sulle prove.
