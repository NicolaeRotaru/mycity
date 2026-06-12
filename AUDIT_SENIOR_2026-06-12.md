# AUDIT SENIOR — MyCity Marketplace · 2026-06-12

> Audit **read-only** condotto come panel di esperti senior (Architect, AppSec, DBA, Payments, Legal/Privacy, SRE, Frontend, Performance, QA, Product, a11y, AI). Ogni finding è ancorato a `file:riga` ed etichettato **[Fatto]** (verificato nel codice), **[Inferenza]** (dedotto) o **[Ipotesi]** (da confermare). Scope: codice del repo allo stato del branch corrente. Non sono state toccate né la produzione né la configurazione live.

---

## 1. Executive summary

MyCity **non è un MVP**: è un marketplace 4-ruoli con un'ingegneria di base sorprendentemente matura. La macchina a stati degli ordini è imposta dal **DB con trigger** (non solo dall'app), lo stock è riservato **atomicamente**, il webhook Stripe ha **idempotenza a 3 livelli** + claim atomico sui payout + Stripe idempotency-key, il checkout **ricalcola tutti gli importi server-side** (chiude il price-tampering), il KYC in produzione è **fail-closed**, e analytics/cookie sono **gated sul consenso**. Questo è lavoro da team esperto.

**Ma non è pronto a gestire soldi e dati di utenti reali in Italia.** Cinque cose lo bloccano:

1. 🔴 **Esposizione di dati personali/finanziari dei venditori a chiunque (anche anonimo).** La policy RLS "Anyone can view approved seller profiles" rende leggibile *l'intera riga* `profiles` dei venditori approvati, e su quella stessa tabella vivono `billing_iban`, `legal_fiscal_code` (codice fiscale), `legal_birth_date`, `legal_residence_addr`. Nessuna protezione a livello di colonna. → **Data breach GDPR + dati bancari esposti.**
2. 🔴 **Fatturazione non operativa e fiscalmente errata.** Il generatore fattura non è chiamato da nessun cron/trigger (mai emesse automaticamente), e quando viene invocato calcola l'IVA *sopra* il prezzo lordo già incassato (totale fattura ≠ totale pagato), ignora spedizione/sconti e tratta i clienti B2B come privati. → **Nessuna fatturazione a norma.**
3. 🟠→🔴 **Flusso del denaro: la spedizione è pagata quasi due volte.** Il payout al venditore è l'92% di `(subtotale + spedizione − sconti)`, ma il rider riceve *anche* il 100% della spedizione. Su molti ordini la piattaforma va in perdita e il venditore incassa una spedizione che non ha effettuato.
4. 🟠 **Diritto all'oblio incompleto.** La cancellazione account anonimizza solo `profiles`; nome/telefono/indirizzo/coordinate del cliente restano in chiaro in `orders` (e altrove).
5. 🟠 **CI che dà falsa sicurezza.** I test RLS/grant si auto-skippano "verdi" senza secret, gli e2e non girano mai, e l'intero modulo payout/refund + il webhook `checkout.session.completed` + il COD hanno **zero test**. Una migration che ri-esponesse una funzione ad `anon` (vedi punto 1) non verrebbe intercettata.

A contorno: rate-limit in-memory bypassabile in multi-istanza, COD senza meccanismo di rendicontazione contanti→piattaforma→venditore, moderazione AI scritta ma mai cablata, dashboard che scaricano tabelle intere lato client, e dashboard seller/rider/admin senza `error.tsx` (schermata bianca al primo errore).

**Verdetto:** fondamenta da senior, ma i blocker 🔴 sono di tipo *legale/finanziario* (PII, fisco, denaro) — esattamente la categoria su cui un go-live non si negozia. Stima: i 🔴 sono risolvibili in **1–2 settimane** mirate; nessuno richiede re-architetture.

---

## 2. Scorecard per dimensione

| # | Dimensione | Voto | Motivazione (1 riga) | Finding peggiore |
|---|---|:--:|---|---|
| 4.1 | Architettura & design | 🟢 | Confini netti, single-source-of-truth per fee/stati/shipping, dominio in `lib/` | logica fee/shipping split incoerente (§F3) |
| 4.2 | Sicurezza & AuthZ | 🟠 | Wrapper auth solidi, CSP nonce, timing-safe; ma profile-fetch via anon client | **PII venditori leggibile da anon (§F1)** |
| 4.3 | Database, RLS & integrità | 🟠 | State-machine a trigger e stock atomico eccellenti; ma RLS profiles troppo larga | esposizione colonne sensibili (§F1) |
| 4.4 | Pagamenti & denaro | 🟠 | Idempotenza e claim atomici di alto livello; ma split spedizione e COD | shipping doppio + COD non rendicontato (§F3, §F5) |
| 4.5 | Compliance legale (IT/EU) | 🔴 | Consent ok, KYC fail-closed; ma fatturazione assente/errata e oblio parziale | **fatture mai emesse + IVA su lordo (§F2)** |
| 4.6 | Logica per ruolo (flussi) | 🟢 | Flussi completi e coerenti, OTP pickup/delivery, no double-claim | order_items non transazionali (§F4) |
| 4.7 | Affidabilità, idempotenza, job | 🟠 | Payout/email-claim idempotenti; ma push e fallback email no | double-send push/email (§F12) |
| 4.8 | Performance & scalabilità | 🟠 | Immagini/mappa ottimizzate; ma dashboard O(N) e rate-limit per-istanza | dashboard scaricano tabelle intere (§F11) |
| 4.9 | Frontend & resilienza | 🟠 | Pay button anti-doppio-submit ok; ma niente error boundary su dashboard | white-screen su seller/rider/admin (§F13) |
| 4.10 | Accessibilità (a11y) | 🟡 | Modal con focus-trap; ma lightbox e form recensione no | lightbox senza focus-trap (§F16) |
| 4.11 | Osservabilità & operatività | 🟢 | Sentry + PostHog gated, logger strutturato, operational-alerts | health check da verificare (§Q) |
| 4.12 | Testing & qualità | 🔴 | Unit esistenti buoni; ma CI auto-verde su RLS/e2e e payout untested | CI falsa-sicurezza (§F8) |
| 4.13 | AI features | 🟠 | Auth ovunque, input segregati, modelli economici; ma moderazione dead-code | moderazione mai cablata + no timeout (§F9, §F10) |
| 4.14 | Comunicazioni | 🟠 | email-queue claim atomico (085); ma push e fallback no, no List-Unsubscribe | double-send (§F12) |
| 4.15 | SEO, i18n & contenuti | 🟢 | Canonical, noindex, CMS sanitizzato (DOMPurify); ma JSON-LD non escapa `<` | JSON-LD `<` (§F14) |

---

## 3. Finding dettagliati

### 🔴 CRITICI — bloccanti go-live

#### F1 · [Security/Privacy] `profiles` espone IBAN, codice fiscale, data di nascita e residenza dei venditori a chiunque
- **Dove:** `migrations/006_public_seller_profiles.sql:15-20` e `migrations/018_fix_orders_user_fk.sql:36-38` (policy `"Anyone can view approved seller profiles" USING (is_approved = true AND store_name IS NOT NULL)`); colonne sensibili in `migrations/021_seller_kyc_and_approval.sql:20-89` (`legal_fiscal_code`, `legal_residence_addr`, `billing_iban`, ecc.); meccanismo in `lib/api/middleware.ts:66-74`.
- **Cosa:** La RLS è *row-level*: la policy rende leggibile **l'intera riga** dei venditori approvati. Su quella stessa tabella `profiles` vivono `billing_iban`, `legal_fiscal_code`, `legal_birth_date`, `legal_residence_addr/city/zip`, `business_vat_number`. Un `grep` su tutte le 86 migrazioni **non trova alcun `GRANT SELECT (colonne)` / `REVOKE` a livello di colonna**: con i grant Supabase di default, `anon` può `SELECT` ogni colonna.
- **Perché è un problema:** Una semplice `GET /rest/v1/profiles?is_approved=eq.true&select=billing_iban,legal_fiscal_code,legal_birth_date,legal_residence_addr` da client anonimo restituisce IBAN, codice fiscale, data di nascita e indirizzo di residenza di **tutti** i venditori. È un data breach GDPR (art. 32–34) + esposizione di dati bancari. Indizio che la tabella sia largamente leggibile: `authenticate()` legge `profiles` con il **client anon** (non service-role, nonostante il commento "via admin") e l'app funziona.
- **Prova:** policy senza filtro di colonna + `migrations/021` aggiunge i campi sensibili sulla stessa tabella + nessun column-grant nel repo.
- **Epistemico:** [Inferenza — alta confidenza]. Conferma in 30s: `get_advisors(type:security)` su Supabase, oppure come `anon`: `select billing_iban, legal_fiscal_code from profiles where is_approved limit 1;` (se ritorna dati → confermato).
- **Raccomandazione:** (a) Spostare i campi KYC/fiscali/bancari in una tabella separata `seller_private` con RLS *owner + admin only*, **oppure** `REVOKE SELECT` di quelle colonne da `anon, authenticated` ed esporre i campi pubblici via una `VIEW`/policy column-safe. (b) In parallelo, far leggere il profilo in `authenticate()` con `getAdminSupabase()` (contesto server fidato) così la lettura non dipende più dalla leggibilità pubblica e si può stringere la policy senza rompere l'auth.
- **Sforzo:** M · **Quick win:** sì (REVOKE colonne) → poi M per la separazione tabella.

#### F2 · [Legal/Fiscal] Fatture mai emesse automaticamente + IVA calcolata sul lordo + B2B trattato come privato
- **Dove:** `app/api/invoices/generate/route.ts` (unico chiamante di `next_invoice_number` e `renderInvoicePdf`); `lib/invoicing/pdf.ts:55-83`. `next_invoice_number` definita in `migrations/024_...:159` e ristretta a `service_role` (059/063). Nessun cron in `app/api/cron/**`, nessun trigger/`pg_net` la invoca (verificato via grep su `app/`, `lib/` e `migrations/`).
- **Cosa:** Tre difetti fiscali distinti:
  1. **Mai generata:** l'endpoint richiede `withInternalAuth` ma **nessun** cron/trigger lo chiama su `DELIVERED`. In pratica non viene emessa alcuna fattura/ricevuta.
  2. **IVA sul lordo:** `pdf.ts` tratta `unit_price` (prezzo già incassato, IVA inclusa in B2C) come imponibile e ci somma il 22% → `grandTotal = prezzo × 1,22`, diverso dall'importo realmente addebitato al buyer.
  3. **B2B ignorato + voci mancanti:** il documento usa `delivery_*` e fissa `sdiCode '0000000'` (privato) anche quando esiste `business_orders` con P.IVA/SDI; non include riga spedizione né sconti.
- **Perché è un problema:** Vendere a consumatori/imprese in Italia senza documento fiscale corretto è una non-conformità diretta; le fatture B2B raccolte al checkout non vengono onorate; gli importi non quadrano con l'incassato.
- **Prova:** grep "next_invoice_number|pg_net|invoice.*DELIVERED" → solo definizione + lockdown + la route; `pdf.ts:58-60` `lineVat = lineNet * (vatRate/100)` con `lineNet = unitPrice*qty`.
- **Epistemico:** [Fatto] per il calcolo IVA e l'assenza di chiamante; [Ipotesi] su *chi* è il cedente fiscale (se i venditori emettono in proprio fuori piattaforma, cambia l'impianto — da chiarire col commercialista).
- **Raccomandazione:** Cablare la generazione su transizione `DELIVERED` (trigger→cron interno o chiamata da `verify_delivery_code`); trattare `unit_price` come lordo e **scorporare** l'IVA (`imponibile = lordo/1,22`); includere spedizione e sconti; popolare il cliente da `business_orders` quando presente. Definire prima il modello fiscale (chi fattura).
- **Sforzo:** L · **Quick win:** no.

### 🟠 ALTI — da chiudere prima/entro il lancio

#### F3 · [Payments] La spedizione è pagata ~due volte: 92% al venditore *e* 100% al rider
- **Dove:** `app/api/stripe/webhook/route.ts:230-231` (`feeCents = 8% di g.totalCents`; `payoutCents = g.totalCents − feeCents`) dove `g.totalCents = subtotale + spedizione − sconti` (`app/api/stripe/checkout/route.ts:284`); `lib/stripe/payout.ts:161,195` (rider riceve `shipping_cost` intero).
- **Cosa:** Il payout venditore è calcolato sul totale **comprensivo di spedizione**; il rider riceve poi il 100% della stessa spedizione. Esempio (subtotale €20, spedizione €4,90): piattaforma incassa €24,90, trattiene 8% = €1,99, paga rider €4,90 → **margine piattaforma −€2,91**, e il venditore incassa €22,91 (di cui €4,51 di spedizione non sua).
- **Perché è un problema:** Perdita su ogni consegna con rider + venditore sovra-pagato. Unit economics negative.
- **Epistemico:** [Inferenza — alta confidenza]. Confermare l'intento economico in `docs/unit-economics.md`.
- **Raccomandazione:** Calcolare il payout venditore su `(subtotale − sconti)`; far finanziare il rider e la fee dalla quota spedizione. Aggiungere un test che verifichi `payout_seller + payout_rider + fee_platform = totale_incassato` al centesimo.
- **Sforzo:** M · **Quick win:** sì.

#### F4 · [Payments/Data] Fallimento insert `order_items` ingoiato → ordini PAID senza righe; ordine e items non transazionali
- **Dove:** `app/api/stripe/webhook/route.ts:286-289` e `app/api/orders/cod/route.ts:283-286` (`itemsErr` solo loggato, esecuzione prosegue); nessuna transazione ordine+items.
- **Cosa:** Si inserisce `orders`, poi `order_items` con call separata; se la seconda fallisce, l'errore è loggato ma l'ordine resta PAID/creato, `pending` marcato COMPLETED ed evento `processed=true`. Il retry Stripe colpisce l'unique `(session, seller)` e fa `continue` → gli items non vengono mai reinseriti.
- **Perché è un problema:** Ordine pagato senza articoli; il venditore non sa cosa preparare; lo stock è già stato decrementato.
- **Epistemico:** [Inferenza — alta confidenza dalla lettura].
- **Raccomandazione:** RPC transazionale `create_order_with_items(...)` (ordine+items in un'unica transazione, idempotente sull'unique). In COD, rollback degli ordini già creati se un gruppo fallisce a metà loop.
- **Sforzo:** M.

#### F5 · [Payments] COD: nessuna rendicontazione contanti → piattaforma → venditore (solo tracking ammanchi)
- **Dove:** `app/api/rider/cash-confirm/route.ts` + `upsertReconciliation` (solo `cod_reconciliations` expected/collected). `lib/stripe/payout.ts:157` esclude esplicitamente il COD dai transfer.
- **Cosa:** Per il COD il rider incassa l'intero `total_price` in contanti. Esiste la riconciliazione expected-vs-collected (ottima, include i consegnati-non-confermati), **ma manca il flusso**: come il rider versa i contanti alla piattaforma, come la piattaforma incassa l'8% di fee sul COD, come il venditore riceve la sua quota COD.
- **Perché è un problema:** Sul canale "pagamento alla consegna" (uno dei value-prop in home) il denaro resta fisicamente al rider senza settlement definito.
- **Epistemico:** [Inferenza]. Confermare se esiste un processo offline non in codice.
- **Raccomandazione:** Definire e implementare il settlement COD (debito rider, fee piattaforma, payout venditore) o documentare il processo manuale e i controlli.
- **Sforzo:** L.

#### F6 · [Legal/Privacy] Diritto all'oblio incompleto: PII del cliente resta in `orders`
- **Dove:** `app/api/cron/process-deletions/route.ts:29-109` (anonimizza solo `profiles` poi `auth.users.delete`); PII in `orders` (`delivery_full_name/phone/address/city/zip/lat/lng/notes`), più `notifications`, `messages`, `returns`, `cod_reconciliations`.
- **Cosa:** La pipeline di cancellazione tocca solo la riga `profiles`. Nome, telefono, indirizzo e coordinate del cliente restano in chiaro negli ordini (FK `orders.user_id` è `ON DELETE SET NULL`, `migrations/018:24` — bene per la retention fiscale, ma la PII di consegna resta).
- **Perché è un problema:** Art. 17 GDPR non soddisfatto: i dati personali sopravvivono alla "cancellazione".
- **Epistemico:** [Inferenza — alta confidenza].
- **Raccomandazione:** Anonimizzare/pseudonimizzare i campi `delivery_*` (e le altre tabelle con PII) negli ordini chiusi che non hanno più necessità fiscale; documentare la base di retention per ciò che resta.
- **Sforzo:** M.

#### F7 · [SRE/Security] Rate limit in-memory per-istanza: bypassabile in multi-istanza / reset al cold start
- **Dove:** `lib/rate-limit.ts:22` (`const buckets = new Map(...)`); usato (sync `rateLimit`) in ~11 punti critici (`app/api/auth/signin`, `signup`, `ai/*`, `chat/messages`, `stripe/checkout`, `orders/cod`, `account/delete`…). `rateLimitAsync()` con fallback Upstash esiste (`:131`) ma **non è usato da nessuna route**.
- **Cosa:** Su Render con >1 istanza ogni processo ha la sua `Map`; il limite reale è `N_istanze × max`, e si azzera ad ogni restart/cold-start. È l'unico rate-limit su auth, AI (costo $) e checkout.
- **Epistemico:** [Fatto].
- **Raccomandazione:** Usare `rateLimitAsync` (Upstash) sugli endpoint critici e configurare `UPSTASH_*` in prod; mantenere il fallback in-memory.
- **Sforzo:** S–M · **Quick win:** sì.

#### F8 · [QA] CI dà falsa sicurezza: test RLS/grant auto-skip "verdi", e2e mai eseguiti, payout/COD/webhook senza test
- **Dove:** `.github/workflows/ci.yml` (job lint+build, unit, integration; nessun job Playwright); `tests/integration/security/rls-anon-access.test.ts:17` e `function-grants.test.ts:28` (`describe.skipIf(!hasEnv)` → skip se mancano i secret); `playwright.config.ts:43` (`webServer: process.env.CI ? undefined`); zero test su `lib/stripe/payout.ts`, su `handleCheckoutCompleted` (`webhook:169-367`), su COD; `tests/sql/rls-orders.test.sql` mai eseguito.
- **Cosa:** I test che proteggono RLS e function-grant si auto-skippano se i secret non sono in GitHub → il job resta verde senza eseguirli. Gli e2e non hanno job in CI. Il modulo soldi (payout/refund/reversal, 374 righe) e il handler che crea gli ordini non hanno alcun test.
- **Perché è un problema:** Una regressione tipo §F1 (RLS che ri-espone dati) passerebbe la CI inosservata. Il "verde" non dimostra nulla sui percorsi che fanno male.
- **Epistemico:** [Fatto].
- **Raccomandazione:** Rendere i test RLS/grant **obbligatori** in CI (secret presenti o fallisci); aggiungere job Playwright con webServer in CI; test su payout-math, webhook `checkout.session.completed` (duplicato), COD e cash-reconciliation.
- **Sforzo:** M.

#### F9 · [AI/T&S] La moderazione contenuti è codice morto (mai cablata)
- **Dove:** `lib/ai/moderation.ts` (`assertSafeText`/`classifyProductPolicy` non importati in nessuna route — confermato da grep); il docstring stesso dice "Da cablare nelle route in PR successive".
- **Cosa:** Nomi/descrizioni prodotto, messaggi chat e foto caricate dai venditori arrivano a Claude e al DB **senza alcun gate T&S**.
- **Perché è un problema:** Contenuti illegali/abusivi pubblicabili; rischio legale e reputazionale su marketplace pubblico.
- **Epistemico:** [Fatto].
- **Raccomandazione:** Cablare `assertSafeText` su create/update prodotto, recensioni e chat; `classifyProductPolicy` sul listing. Decidere blocco vs review.
- **Sforzo:** M.

#### F10 · [AI/SRE] Nessun timeout SDK su Anthropic + prompt-injection residuo in product-chat
- **Dove:** `lib/ai/run.ts:136-146` e `lib/ai/client.ts:96` (`messages.create` senza `AbortSignal`/timeout); `app/api/ai/product-chat/route.ts:207-214` (`JSON.stringify(body.product)` non sanificato nel turno utente).
- **Cosa:** Uno spike di latenza Anthropic appende la funzione serverless fino al kill di piattaforma (nessun fallback); inoltre i valori di `body.product` finiscono verbatim nel prompt (boundary di sistema regge, ma i dati restano manipolabili e senza cap di dimensione globale).
- **Epistemico:** [Fatto].
- **Raccomandazione:** `timeout`/`AbortSignal` sul client AI + risposta di fallback; cap e sanitizzazione dei campi prodotto serializzati; validazione Zod dell'output vision (`vision/extract-product` usa `as TInput` senza schema, `run.ts:155`).
- **Sforzo:** S–M · **Quick win:** sì (timeout).

#### F11 · [Performance] Dashboard scaricano tabelle intere lato client (O(N) non paginato)
- **Dove:** `app/admin/page.tsx:31-32` (tutti gli `orders`+`products`, `refetchInterval` 30s); `app/admin/orders/page.tsx:38-45`; `app/seller/dashboard/page.tsx:65-67` (tutti gli `order_items` del seller, nessun filtro data); `app/profile/settings/page.tsx:183` (`select('*')` su tutti gli ordini); `app/admin/users/page.tsx:86-148` (2 query sequenziali, no paginazione).
- **Cosa:** Le viste aggregate caricano ogni riga e filtrano in JS nel browser. A 10k ordini sono ~1–2 MB per load, ogni 30s sulla dashboard admin.
- **Epistemico:** [Fatto].
- **Raccomandazione:** Aggregazioni server-side (RPC/`count`/`sum` con filtri data) e paginazione; proiezione colonne (no `select('*')`).
- **Sforzo:** M.

#### F12 · [Comms/SRE] Double-send: push cron senza claim atomico + fallback email senza lock
- **Dove:** `app/api/cron/send-push/route.ts:35-53` (`SELECT ... WHERE pushed_at IS NULL` senza claim); `app/api/cron/send-emails/route.ts:78-92` (se `claim_pending_emails` fallisce → fallback `SELECT ... sent_at IS NULL` senza lock). Il claim atomico corretto esiste in `migrations/085_email_queue_real_claim.sql:27-40` (`FOR UPDATE SKIP LOCKED`).
- **Cosa:** Due run cron sovrapposti inviano due volte lo stesso push; il path di fallback email re-introduce il bug pre-085.
- **Epistemico:** [Fatto].
- **Raccomandazione:** Claim atomico anche per i push (`claim_pending_pushes` o colonna `claimed_at`); rimuovere il fallback no-lock (meglio fallire e ritentare che doppio-inviare).
- **Sforzo:** S–M.

#### F13 · [Frontend] Dashboard seller/rider/admin senza `error.tsx`/`loading.tsx` → schermata bianca all'errore
- **Dove:** alberi `app/seller/**`, `app/rider/**`, `app/admin/**` (20+ route) privi di `error.tsx`/`loading.tsx`; anche `app/cart`, `app/search`, `app/orders` (lista) senza `loading.tsx`. Root boundary presente ma generico.
- **Cosa:** Un errore di rete/Supabase in una dashboard cade fino al root error → pagina vuota senza recovery contestuale.
- **Epistemico:** [Fatto].
- **Raccomandazione:** Aggiungere `error.tsx`+`loading.tsx` ai segment group `seller/rider/admin` e ai principali flussi buyer.
- **Sforzo:** S · **Quick win:** sì.

### 🟡 MEDI — pianificare

- **F14 · [Security/SEO] JSON-LD non escapa `<`.** `app/product/[id]/page.tsx:248-276`, `app/store/[id]:38-75`: `JSON.stringify(schema)` con `name`/`description` dal DB senza `<`. Mitigato da pagina client-side + CSP nonce/strict-dynamic, ma struttura dati malformabile e fragile se mai resa SSR. Fix: `.replace(/</g,'\\u003c')`. [Fatto]
- **F15 · [Payments] Refund parziali fuori-banda (Dashboard Stripe) non riconciliati.** `webhook:386-390` ignora `charge.refunded` parziale (delega a `refundOrder`); un rimborso parziale fatto a mano in Stripe non aggiorna il DB → ordine resta PAID, payout pieno. [Inferenza]
- **F16 · [a11y] Lightbox prodotto senza focus-trap.** `app/product/[id]/page.tsx:363-421` (div con `role=dialog` ma niente trap/Esc/restore-focus; viola WCAG 2.1.2/2.4.3). Textarea recensione senza label (`:723-729`); rating a stelle senza `aria-label` (`:468-469,757`). `Modal.tsx` invece è corretto. [Fatto]
- **F17 · [Payments] `cash-confirm` non verifica `delivery_status`.** `app/api/rider/cash-confirm/route.ts:50-65` controlla rider/method/già-confermato ma **non** lo stato consegna, nonostante il commento lo dichiari. [Fatto]
- **F18 · [Frontend] Mutation senza onError/optimistic rollback.** `components/hooks/useFavorites.ts:24` (sitewide, fallisce in silenzio) + varie admin/lists. [Fatto]
- **F19 · [Frontend] Form auth/checkout/contact non usano zod+RHF.** `app/sign-up/page.tsx` (solo toast/HTML5), `app/checkout/page.tsx:521-529` (validazione hand-rolled), `app/contact/page.tsx` (toast catch-all). `lib/zod-i18n.ts` esiste ma non sfruttato qui. [Fatto]
- **F20 · [i18n/SEO] Stringhe IT hardcoded fuori da `messages/`** (`components/Navbar.tsx:99,101,175`, `Footer.tsx:105`, `ProductCard.tsx:81`); nessun `alternates.languages` (hreflang). [Fatto]
- **F21 · [Payments] HOLD_HOURS=1 vs recesso 14gg.** `app/api/cron/release-payouts/route.ts:10`: payout 1h dopo DELIVERED → la maggior parte di resi/recessi cade *dopo* il payout, richiede claw-back e rischia saldo Connect negativo del venditore. Trade-off dichiarato nel commento; valutare hold più lungo o riserva. [Fatto]
- **F22 · [Comms] Niente `List-Unsubscribe` (RFC 8058)** sulle email marketing (`lib/email/client.ts:47-55`): nessun bottone nativo Gmail/Apple → deliverability/reputazione. [Fatto]
- **F23 · [Performance] `<img>` non ottimizzati** su admin/order detail (`app/admin/products/page.tsx:106`, `app/orders/[id]/page.tsx:463-465`) servono immagini full-res; il resto usa correttamente `sizedImage()`. [Fatto]

### 🟢 MINORI
- `'use client';;` (doppio `;`) in `app/category/[slug]/page.tsx:1`, `app/seller/orders/[id]/page.tsx:1`. [Fatto]
- Pagine quasi-statiche come client component (`app/faq`, `app/cookies`, `app/promozioni`). [Fatto]
- `optimizePackageImports` copre solo 3 pacchetti (`next.config.js:57`). [Inferenza]
- Canale realtime con suffix `Date.now()` (`useMessagesUnread.ts:67`) — innocuo in prod (StrictMode off). [Inferenza]

---

## 4. Analisi dei flussi critici end-to-end

- **Pagamento carta → payout venditore/rider.** Tiene fino al payout: checkout ricalcola tutto server-side, riserva stock atomico, webhook idempotente a 3 livelli, payout con claim atomico + idempotency-key. **Si rompe** su: (a) split spedizione (§F3 — il venditore incassa la spedizione, il rider la incassa di nuovo), (b) `order_items` non transazionali (§F4).
- **Reso → rimborso.** Solido: `returns/[id]/decide` ha guard di stato atomico anti-doppio-click, `refundOrder` clampa al totale ordine (multi-seller safe), restituisce la fee, fa claw-back proporzionale con idempotency-key. **Gap:** refund parziali iniziati da Dashboard Stripe non riconciliati (§F15).
- **Onboarding + KYC seller/rider.** Ben fatto: in prod fail-closed (`ManualReviewKycProvider` → PENDING, mai auto-APPROVED), Onfido reale, VAT via VIES. Da verificare l'esistenza di una coda di review admin per i PENDING.
- **Macchina a stati ordine.** Eccellente e imposta dal DB (`migrations/061`): trigger che congela ~35 colonne sensibili e consente solo transizioni legittime per ruolo; PICKED_UP/DELIVERED solo via RPC OTP (`verify_pickup_code`/`verify_delivery_code`); claim rider atomico (no double-claim). Questo è il punto più forte del sistema.
- **Cancellazione account GDPR.** Soft-delete + cooldown 7gg + hard-delete cron: il *meccanismo* è corretto, ma l'**ambito** è incompleto — resta PII negli ordini (§F6).
- **Fatturazione.** **Non tiene:** mai innescata e fiscalmente errata (§F2).
- **COD.** Creazione/riconciliazione ok, ma manca il settlement contanti (§F5).

---

## 5. Ciò che è fatto bene (preservare)
- **State-machine ordini a livello DB** con freeze colonne + transizioni per-ruolo + OTP pickup/delivery (`migrations/061`). Raro e ben fatto.
- **Stock atomico** anti-overselling (`migrations/062`, guard `stock>=qty` + `ROW_COUNT`).
- **Webhook Stripe**: firma + idempotenza event/order/checkout + reprocess-on-failure (`webhook:54-130`).
- **Payout**: claim atomico `HELD→PROCESSING` + Stripe idempotency-key; refund con clamp multi-seller e claw-back proporzionale (`lib/stripe/payout.ts`).
- **Anti price-tampering**: ricalcolo server-side di prezzi/spedizione/sconti/coupon in checkout e COD.
- **CSP nonce + strict-dynamic** (`middleware.ts`), header statici, HSTS preload; confronto secret timing-safe.
- **KYC prod fail-closed**; **consent gating** analytics (PostHog opt-out default + masking, GA4 Consent Mode v2); **CMS sanitizzato** (DOMPurify allowlist stretta); **storage hardening** (070).
- **Reconciliation COD reale** (include consegnati-non-confermati, alert admin su mismatch, prova obbligatoria >€50).
- **Pay button** anti doppio-submit; unit test esistenti (fee, anti-tampering, returns) behavior-focused.

---

## 6. Prioritizzazione & roadmap (per ROI)

**Sprint 1 — sblocco go-live (1–2 settimane)**
1. F1 — REVOKE colonne sensibili da `anon`/`authenticated` + `authenticate()` su service-role *(quick win, poi separazione tabella)*.
2. F2 — modello fiscale + cablare generazione fattura + scorporo IVA + B2B.
3. F3 — correggere split spedizione (+ test di quadratura al centesimo) *(quick win)*.
4. F7 — `rateLimitAsync`/Upstash sugli endpoint critici *(quick win)*.
5. F13 — `error.tsx`/`loading.tsx` su dashboard *(quick win)*.

**Sprint 2 — robustezza & compliance**
6. F4 — RPC transazionale ordine+items. 7. F6 — anonimizzazione PII ordini. 8. F8 — CI obbligatoria RLS+e2e+payout. 9. F9 — cablare moderazione. 10. F10 — timeout AI *(quick win)* + Zod vision. 11. F12 — claim atomico push.

**Sprint 3 — scala & rifinitura**
12. F5 — settlement COD. 13. F11 — dashboard O(N)→aggregati. 14. F14–F23 (a11y, JSON-LD, i18n, deliverability, recesso/hold, img).

---

## 7. Domande aperte / assunzioni (da confermare fuori dal codice)
1. **F1** — confermare l'esposizione colonne con `get_advisors(security)` o query `anon` su `profiles` (posso eseguirla read-only su Supabase se autorizzi).
2. **F2** — chi è il cedente fiscale (piattaforma vs singoli venditori)? Determina l'intero impianto fatturazione.
3. **F3** — l'economia "venditore incassa la spedizione" è voluta? Verificare `docs/unit-economics.md`.
4. **F5** — esiste un processo COD offline (versamento contanti) non rappresentato in codice?
5. **Config prod** — `UPSTASH_*`, `CRON_SECRET`, schedulazione reale dei 7 cron, provider KYC attivo, segreti CI: non verificabili dal solo repo.
6. **health check** (`app/api/health`) — verificare che misuri davvero DB/dipendenze e non ritorni 200 a vuoto.

*Audit read-only. Nessuna modifica al codice applicata. Raccomandazioni azionabili sopra; nessuna richiede re-architettura.*
