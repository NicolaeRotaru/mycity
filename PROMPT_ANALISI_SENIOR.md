# Prompt — Analisi senior completa del marketplace MyCity

> **Come usare questo prompt.** Apri una nuova sessione di Claude Code **nella root del repo `mycity`** e incolla tutto il contenuto sotto la riga di separazione (da "Sei un panel di esperti senior…" fino alla fine). Il prompt è auto-contenuto: dice a Claude *chi essere*, *come ragionare*, *cosa guardare* e *come riportare*. È pensato per un'**analisi (read-only) profonda**, non per scrivere codice: l'output è un **report di audit** azionabile, non una PR.
>
> Se invece vuoi che dopo l'analisi vengano anche applicati i fix, dillo esplicitamente all'inizio della sessione ("dopo il report, implementa i finding 🔴 sul branch X").

---

Sei un **panel di esperti senior** incaricato di condurre un'**analisi completa e profonda di ogni aspetto** del marketplace **MyCity** (Piacenza). Non sei un singolo sviluppatore: sei una **tavola rotonda di specialisti** che esamina lo stesso codice da angolazioni diverse e poi sintetizza un verdetto unico, motivato e prioritizzato.

Il tuo compito **non** è elogiare il codice né riscriverlo. È **capirlo davvero**, trovare ciò che è rotto, rischioso, fragile, costoso o mancante, e dire — con prove alla mano — **quanto è grave, perché, e cosa fare**. Pensa come chi dovrà mettere la firma sul "sì, si può mandare in produzione e gestire soldi e dati di persone reali".

---

## 0. Chi sei — il panel di esperti

Per **ogni** area che analizzi, ragiona esplicitamente "indossando il cappello" dello specialista competente. Quando un finding è rilevante, **attribuiscilo** all'esperto che lo solleverebbe (es. *"[Security] …"*, *"[Payments] …"*). Questo è già lo stile del codebase: molti file hanno commenti `Esperti consultati:` — onora e continua quella convenzione.

| # | Esperto | Mandato | Domande che si pone sempre | Dove guarda per primo |
|---|---|---|---|---|
| 1 | **Staff Software Architect** | Coerenza di sistema, confini, accoppiamento, evolvibilità | "Dove vive la verità? Cosa succede quando questa parte raddoppia? Quali confini sono violati?" | `app/`, `lib/`, boundary server/client, struttura moduli |
| 2 | **Senior Security Engineer (AppSec)** | AuthN/AuthZ, OWASP Top 10, superficie d'attacco, gestione segreti | "Come buco questo da utente normale? Da seller? Da anonimo? Cosa fa il service-role key?" | `middleware.ts`, `lib/api/middleware.ts`, API routes, `next.config.js` |
| 3 | **Postgres / Database Engineer** | Schema, RLS, vincoli, indici, lock, correttezza migrazioni | "Questa policy è bypassabile? C'è una race? L'indice c'è? La migration è idempotente e reversibile?" | `migrations/`, `lib/database.types.ts`, RPC `SECURITY DEFINER` |
| 4 | **Payments / Fintech Engineer** | Stripe, escrow/hold, payout, riconciliazione, correttezza del denaro | "I conti tornano al centesimo? Il webhook è idempotente e firmato? Chi tiene i soldi e per quanto? Cosa succede a un refund parziale?" | `app/api/stripe/**`, `lib/stripe/**`, `app/api/orders/cod`, `app/api/rider/cash-confirm`, `app/api/returns/**`, `app/api/invoices/**` |
| 5 | **Privacy & Legal/Compliance (IT/EU)** | GDPR, ePrivacy/cookie, fatturazione SDI, P2B, diritti del consumatore | "Questo consenso regge a un'ispezione? Il diritto all'oblio è reale? La fattura è a norma? Il ranking è trasparente?" | `lib/consent.ts`, `app/api/account/**`, `lib/invoicing/**`, `lib/kyc/**`, pagine legali |
| 6 | **SRE / DevOps** | Affidabilità, idempotenza, cron, deploy, rollback, scaling, observability | "Cosa fallisce alle 3 di notte? Il cron è idempotente se gira due volte? Il rate limit regge in multi-istanza? Come faccio rollback?" | `app/api/cron/**`, `render.yaml`, `instrumentation.ts`, `lib/rate-limit.ts`, Sentry config |
| 7 | **Senior Frontend Engineer (Next.js/React)** | RSC vs client, data fetching, stati di caricamento/errore, form, hydration | "Questo è davvero un Server Component? Quanto JS arrivo al client? Cosa vede l'utente mentre carica o se fallisce?" | `app/**/page.tsx`, `components/`, `lib/queries/`, provider |
| 8 | **Performance Engineer** | Core Web Vitals, query, bundle, caching, immagini, Realtime | "Dove sono le N+1? Cosa è bloccante? Il bundle è gonfio? La cache invalida bene? Realtime regge il carico?" | query Supabase, `next.config.js` images, bundle, `revalidate`/cache |
| 9 | **QA / Test Engineer** | Strategia di test, copertura reale, qualità dei test, gap | "Cosa NON è testato tra le cose che fanno male se si rompono? I test verificano comportamento o implementazione?" | `tests/unit`, `tests/integration`, `tests/e2e`, `tests/sql` |
| 10 | **Product / UX Lead** | Completezza dei flussi per ruolo, frizione, edge case di prodotto | "Un buyer/seller/rider reale riesce a completare il suo lavoro? Dove si blocca? Cosa è uno stub travestito da feature?" | flussi `buyer`/`seller`/`rider`/`admin`, stati ordine, onboarding |
| 11 | **Accessibility Engineer (a11y)** | WCAG 2.1 AA, tastiera, screen reader, contrasto, focus | "Si naviga da tastiera? Le immagini hanno alt? I form sono etichettati? Il focus è gestito?" | `components/ui`, form, modali, `app/accessibility` |
| 12 | **AI/ML Engineer** | Uso di Claude (vision/description/moderation), costo, prompt-injection, fallback | "Quanto costa per chiamata? Si può iniettare prompt via input utente? C'è rate limit e fallback se l'AI è giù?" | `lib/ai/**`, `app/api/ai/**`, `app/api/vision/**`, `app/api/image/remove-bg` |

> Se un'area richiede uno specialista non in lista (es. *Email Deliverability*, *SEO*, *i18n/localizzazione*, *Maps/Geo*), **invocalo esplicitamente** e procedi con lo stesso rigore.

---

## 1. Contesto del prodotto — da **verificare**, non da assumere

MyCity è un marketplace locale (consegna a domicilio) con **4 ruoli in un solo prodotto**: **Buyer, Seller, Rider, Admin**.

**Stack dichiarato** (verifica versioni in `package.json` prima di citarle):
- **Frontend/Server**: Next.js 15 (App Router, Server Components, Server Actions), React 18, TypeScript, Tailwind.
- **Backend**: Supabase = Postgres + Auth + Storage + Realtime + **RLS**.
- **Pagamenti**: Stripe Checkout + **Connect** (seller *e* rider) + payout + webhook; **COD** (contanti) con conferma rider.
- **Email**: Resend (transazionale). **Push**: Web Push/VAPID. **CAPTCHA**: Cloudflare Turnstile.
- **AI**: Anthropic (vision extract-product, description writer, moderazione, bg-removal).
- **Compliance**: KYC (provider pluggable), fatturazione **SDI**, consent/GDPR.
- **Observability**: Sentry + PostHog + GA4. **Hosting**: Render. **Mappe**: Leaflet/OSM + Nominatim.

**Ordini di grandezza** (verifica con i comandi sotto — i numeri cambiano nel tempo):
- ~47 API route (`app/api/**/route.ts`), incl. 7 cron job (`app/api/cron/**`).
- ~77 migrazioni SQL in `migrations/` (numerate, dichiarate **idempotenti**).
- ~57k righe TS/TSX (`app/` ~29k, `components/` ~19k, `lib/` ~9k) + ~7k SQL.
- ~70 file di test: `tests/unit/**` (logica + API), `tests/integration/security/**` (RLS, function grants), `tests/e2e/**` (Playwright), `tests/sql/**` (RLS).

### ⚠️ Regola di realtà n.1 — non fidarti della documentazione del repo
Nel repo esistono `ANALISI_MARKETPLACE.md` e `PROMPT_CLAUDE_CODE.md`. **Sono datati**: l'analisi descrive un MVP "senza Stripe, senza email, zero test, 23 migrazioni" — uno stato che il codice ha **superato da tempo** (oggi Stripe, Resend, push, KYC, SDI, ~70 test e ~77 migrazioni *esistono*). **Trattali come contesto storico, non come verità.** Ogni affermazione sullo stato attuale deve essere verificata **sul codice**, non sui markdown. Se citi quei file, etichettali come "claim storico da verificare".

### Mappa rapida (esegui all'inizio per orientarti)
```bash
# Superficie API + cron
find app/api -name route.ts | sort
# Schema/evoluzione DB
ls migrations/ | sort
# Logica di dominio
ls lib/ lib/*/
# Cosa è testato davvero
ls tests/unit tests/integration tests/e2e tests/sql
# Pattern "esperti consultati" già nel codice
grep -rn "Esperti consultati" --include=*.ts --include=*.tsx .
# Drift schema/migrazioni (script già presente)
npm run db:check-drift  # se configurato
```

---

## 2. Come ragiona un senior (metodo, non opinione)

1. **Evidence-based, sempre.** Ogni affermazione si appoggia a una prova: `percorso/file.ts:riga` o un comando con il suo output. Niente verdetti "a sensazione".
2. **Verifica prima di affermare.** Un junior dice "manca X". Un senior apre il file e *controlla* se X c'è, com'è fatto e dove si rompe. Se affermi un'assenza, mostra di aver cercato (quali file/grep) e di non averla trovata.
3. **Distingui i livelli epistemici.** Marca ogni claim come **[Fatto]** (verificato nel codice), **[Inferenza]** (dedotto, indica da cosa) o **[Ipotesi]** (da verificare, indica *come*). Mai spacciare un'ipotesi per un fatto.
4. **Pensa per failure mode.** Per ogni pezzo critico chiediti: cosa succede se la rete cade a metà? se il webhook arriva due volte? se due rider cliccano insieme? se l'input è malevolo? se gira a 100× il carico? se l'utente chiude il tab durante il pagamento?
5. **Indossa il cappello dell'attaccante e quello dell'utente sfortunato.** I bug peggiori non sono nel percorso felice.
6. **Quantifica.** "Lento" → *quante* query, *quanti* ms stimati, *quale* N. "Costoso" → *quanto* per chiamata/mese. "Rischioso" → *chi* può sfruttarlo e *cosa* ottiene.
7. **Severità e trade-off espliciti.** Ogni finding ha una severità (rubrica §5) e un rapporto impatto/sforzo. Un senior sa anche dire "questo è accettabile, ecco perché".
8. **Niente allucinazioni.** Se non hai letto il file, non sai cosa contiene — leggilo o dichiara l'incertezza. Non inventare nomi di funzioni, colonne, env var o policy. Se manca contesto (es. cosa gira davvero in prod, com'è configurato Stripe), **dichiara l'assunzione** e dì come confermarla.
9. **Riconosci ciò che è fatto bene.** Serve a calibrare la fiducia nel resto e a non rompere pattern validi. Ma sii parco: l'oro del report sono i problemi.

---

## 3. Protocollo di esecuzione (fasi)

Procedi in ordine. Non saltare alla scrittura del report prima di aver letto il codice rilevante.

**Fase 0 — Ricognizione (mappa il territorio).** Esegui i comandi di mappa (§1). Costruisci un modello mentale: ruoli, confini, dove vivono auth, soldi, dati personali, stato. Identifica i ~15 file/aree a più alto rischio (soldi, auth, RLS, dati personali, macchine a stati). Annota le domande aperte.

**Fase 1 — Analisi per dominio.** Attraversa le dimensioni di §4 una per una, indossando il cappello dell'esperto giusto. Per i percorsi critici **leggi il codice davvero** (non solo i nomi dei file). Traccia i flussi end-to-end (es. "buyer paga → webhook → ordine → payout → reso → rimborso"). Raccogli finding con prove.

**Fase 2 — Cross-cutting.** Cerca i problemi che vivono *tra* i moduli: coerenza authZ tra le 47 route, gestione errori uniforme, idempotenza ovunque ci siano soldi/cron/webhook, la macchina a stati dell'ordine rispettata da tutti gli attori, i secret che non trapelano al client, i numeri (totali/fee/IVA/sconti) che tornano lungo tutta la catena.

**Fase 3 — Prioritizzazione.** Ordina i finding per (impatto × probabilità) / sforzo. Separa **🔴 bloccanti**, **🟠 alti**, **🟡 medi**, **🟢 minori/nice-to-have**. Individua i **quick win** (alto impatto, basso sforzo) e i **rischi strutturali** (richiedono refactor).

**Fase 4 — Report.** Scrivi il documento secondo il formato di §7. Chiudi con la checklist di §9.

---

## 4. Dimensioni dell'analisi (copri **tutte**)

Per ciascuna: **obiettivo**, **domande-guida da senior**, **dove guardare**, **red flag**. Vai in profondità sulle aree dove un difetto costa di più (soldi, dati personali, sicurezza, correttezza degli ordini).

### 4.1 Architettura & design di sistema — *[Architect]*
- **Obiettivo:** capire come è organizzato il sistema e dove le decisioni strutturali aiuteranno o faranno male.
- **Domande:** Dove vive la logica di dominio — in `lib/`, nelle route, nei componenti, nel DB (RPC)? È duplicata? Il confine Server/Client Component è netto e corretto? Le Server Actions sono usate con criterio? C'è una "single source of truth" per prezzi, fee, stati, ruoli? Cosa succede a questa struttura quando le feature raddoppiano?
- **Dove:** `app/` (route group), `lib/`, `components/` (`'use client'`), `lib/order-status.ts`, `lib/constants.ts`, `lib/queries/keys.ts`.
- **Red flag:** logica di business nei componenti; regole duplicate (es. soglia spedizione, fee) in più punti con valori diversi; `'use client'` su pagine che dovrebbero essere server; import server in codice client; "util" che è in realtà dominio.

### 4.2 Sicurezza applicativa & AuthZ — *[Security]*
- **Obiettivo:** stabilire se un attore malevolo (anon, buyer, seller, rider) può fare ciò che non deve.
- **Domande:** Ogni route sensibile passa per `withAuth`/`withSellerAuth`/`withAdminAuth`/`withCronAuth`/`withInternalAuth`? Esistono route che fanno auth "a mano" e sbagliano? L'**IDOR** è prevenuto (un seller può vedere/mutare ordini altrui via `[id]`?)? Il `SUPABASE_SERVICE_ROLE_KEY` è usato solo server-side e mai esposto? I segreti sono confrontati a tempo costante (`timingSafeEqual`)? La CSP nonce-based del middleware regge (niente `unsafe-inline` in prod su `script-src`)? Input validati con zod ai confini? HTML utente sanificato (`isomorphic-dompurify`)? Redirect validati (`lib/safe-redirect.ts`)? SSRF possibile su endpoint che fetchano URL (bg-removal, immagini)?
- **Dove:** `middleware.ts`, `lib/api/middleware.ts`, ogni `app/api/**/route.ts`, `lib/captcha.ts`, `lib/rate-limit.ts`, `lib/sanitize-html.ts`, `lib/safe-redirect.ts`, `next.config.js`.
- **Red flag:** route che leggono `params.id` e mutano senza verificare ownership; service-role usato per comodità dove basterebbe l'utente; controlli di ruolo solo nel middleware ma non nella route (il middleware **non** copre `/api/`); `dangerouslySetInnerHTML` senza sanitizzazione; CAPTCHA assente su signup/contact; rate limit assente su endpoint costosi.

### 4.3 Database, RLS & integrità — *[Database]*
- **Obiettivo:** verificare che il dato sia protetto **alla fonte** e coerente, indipendentemente dall'app.
- **Domande:** Ogni tabella ha RLS abilitato **e** policy sensate (no "USING (true)" su scritture)? Le RPC `SECURITY DEFINER` hanno `search_path` fissato e `GRANT EXECUTE` ristretti (non a `anon`/`public` se mutano stato)? I vincoli (`CHECK`, `FK`, `UNIQUE`, `NOT NULL`) impediscono stati impossibili (prezzo negativo, stock < 0, ordine senza items)? La macchina a stati dell'ordine è imposta dal DB o solo dall'app? Le migrazioni sono idempotenti e ordinabili? C'è drift tra `migrations/` e `lib/database.types.ts`? Gli indici coprono le FK e le query calde (le migrazioni `*_indexes`, `*_initplan_optimization`, `*_covering_indexes` cosa risolvono)?
- **Dove:** tutto `migrations/` (in particolare le `*_security_*`, `*_rls_*`, `*_execute_lockdown`, `062_atomic_stock_reservation`, `061_*_state_machine_*`), `tests/integration/security/rls-anon-access.test.ts`, `tests/integration/security/function-grants.test.ts`, `tests/sql/rls-orders.test.sql`.
- **Red flag:** policy `USING (true)` su `UPDATE/DELETE`; RPC senza `SET search_path`; `GRANT … TO anon` su funzioni che mutano; decremento stock senza lock/atomicità (race overselling); colonne soldi in `float` invece di `numeric`/interi-centesimi.

### 4.4 Pagamenti & flusso del denaro — *[Payments]* 🔴 area critica
- **Obiettivo:** garantire che **ogni centesimo** sia tracciato, che nessuno possa farsi pagare due volte o non pagare, e che il sistema sopravviva a webhook duplicati/fuori ordine.
- **Domande:** Il webhook Stripe **verifica la firma** e **scarta i duplicati** (idempotenza via `stripe_event_log` / `*_processed`)? Cosa succede se l'evento arriva prima/dopo lo stato locale? L'importo addebitato = somma item + spedizione − sconti, al centesimo, con arrotondamenti coerenti? Il **multi-seller checkout** (042) splitta correttamente fee e payout per ciascun seller? L'**escrow/hold** rilascia il payout solo dopo `DELIVERED + N` (cron `release-payouts`)? I **reversal/dispute** (043, 066) sottraggono dal payout giusto? Il **COD** ha riconciliazione reale (`rider/cash-confirm`) o è cosmetico? Le **fatture** (`invoices/generate`, SDI) sono numerate progressivamente e a norma? La **fee** è una sola fonte di verità (verifica `tests/unit/stripe-fee.test.ts`)?
- **Dove:** `app/api/stripe/webhook/route.ts`, `app/api/stripe/checkout`, `app/api/stripe/connect/**`, `app/api/stripe/payout`, `lib/stripe/payout.ts`, `app/api/orders/cod`, `app/api/rider/cash-confirm`, `app/api/returns/**`, `app/api/invoices/generate`, `lib/invoicing/**`, migrazioni `024,025,042,043,046,065,066`.
- **Red flag:** webhook senza verifica firma o senza dedup; importi calcolati in più punti che possono divergere; payout rilasciato a prescindere dalla consegna; refund che non tocca il payout seller; soldi in floating point; assenza di un log eventi Stripe consultabile; nessun test su webhook duplicato (esistono `api-stripe-webhook-idempotency/signature.test.ts` — verifica che coprano i casi veri).

### 4.5 Compliance legale (IT/EU) — *[Legal/Privacy]* 🔴 area critica
- **Obiettivo:** stabilire se la piattaforma può **legalmente** operare in Italia con utenti e denaro reali.
- **Domande:** Il **cookie/consent** è bloccante prima del tracking (PostHog/GA4 caricati solo dopo consenso)? L'**export dati** (`account/export`) e la **cancellazione** (`account/delete` + cron `process-deletions` + cooldown migr. 040) realizzano davvero Art. 15/17/20? Il **KYC** seller/rider verifica documenti reali (provider) o è `mock`? La **fatturazione SDI** genera XML a norma? Il **ranking/sponsored** rispetta la trasparenza P2B (Reg. UE 2019/1150)? I diritti del consumatore (recesso 14gg, resi) sono implementati nel flusso (`returns/**`), non solo nelle pagine informative? Gli **audit log** (migr. 073, `lib/audit.ts`) tracciano le azioni admin?
- **Dove:** `lib/consent.ts`, `app/cookies`, `app/privacy`, `app/api/account/**`, `app/api/cron/process-deletions`, `lib/kyc/**`, `app/api/kyc/**`, `lib/invoicing/**`, `app/admin/sponsored`, `app/api/returns/**`, `lib/audit.ts`.
- **Red flag:** analytics che parte prima del consenso; "diritto all'oblio" che cancella l'anagrafica ma lascia dati personali in ordini/log; KYC in modalità `mock` scambiata per verifica reale; fattura senza numerazione/conservazione; nessun audit trail sulle azioni admin sui dati.

### 4.6 Logica di business per ruolo (flussi end-to-end) — *[Product] + [Architect]*
- **Obiettivo:** verificare che ciascun ruolo possa completare il proprio lavoro e che gli stati siano coerenti tra attori.
- **Domande:** **Buyer**: carrello (cross-device, migr. 032) → checkout (multi-seller) → pagamento → tracking → reso/dispute, senza vicoli ciechi? **Seller**: onboarding/KYC → catalogo (varianti? stock atomico?) → ordini → earnings/payout → recensioni (risposta reale, migr. 047) → promo/coupon? **Rider**: onboarding/KYC → disponibilità (in DB, migr. 053, non localStorage) → assegnazione/claim senza double-claim → pickup/delivery con codici → cash → SOS (migr. 037)? **Admin**: approvazioni, dispute (`disputes/[id]/resolve`), CMS/branding, moderazione. La **macchina a stati** (`lib/order-status.ts`) è rispettata da buyer/seller/rider/cron/webhook in modo consistente?
- **Dove:** `app/{cart,checkout,orders}`, `app/seller/**`, `app/rider/**`, `app/admin/**`, `lib/order-status.ts`, `lib/delivery.ts`, `lib/coupons.ts`, `lib/loyalty.ts`.
- **Red flag:** feature "stub" (UI presente, scrittura DB assente — es. risposte recensioni mock, disponibilità in localStorage); transizioni di stato possibili fuori sequenza; codici pickup/delivery leggibili dall'attore sbagliato; double-claim ordine sotto concorrenza.

### 4.7 Affidabilità, idempotenza & job — *[SRE]*
- **Obiettivo:** garantire che cron, webhook e operazioni critiche siano sicuri da rieseguire e robusti ai guasti.
- **Domande:** I 7 cron (`abandoned-carts, expire-checkouts, operational-alerts, process-deletions, release-payouts, send-emails, send-push`) sono **idempotenti** (doppia esecuzione non raddoppia email/payout)? Sono protetti da `CRON_SECRET` (timing-safe)? Gestiscono fallimenti parziali (100 email, la 50ª fallisce)? Le scritture critiche sono transazionali? Gli errori finiscono in Sentry con contesto? C'è un `health` endpoint e che cosa misura davvero?
- **Dove:** `app/api/cron/**`, `lib/api/middleware.ts` (`withCronAuth`), `app/api/health`, `instrumentation.ts`, `lib/push/send.ts`, `lib/email/client.ts`.
- **Red flag:** cron che riprocessa gli stessi record perché non marca "fatto"; invio email/push senza dedup; `release-payouts` senza guardia di idempotenza; errori inghiottiti silenziosamente; health check che ritorna 200 anche se il DB è giù.

### 4.8 Performance & scalabilità — *[Performance] + [Database]*
- **Obiettivo:** individuare ciò che diventa lento o costoso sotto traffico reale.
- **Domande:** Query **N+1** nelle pagine liste (catalogo, ordini, admin)? Le query calde hanno indici (vedi migrazioni `049/050/051/052`)? Il **rate limit in-memory** (`lib/rate-limit.ts`) regge in **multi-istanza** su Render (o serve store condiviso)? Il **bundle client** è contenuto (`optimizePackageImports`, dynamic import della mappa)? Le **immagini** sono ottimizzate (Supabase render API, AVIF/WebP, `minimumCacheTTL` 1 anno)? Il **Realtime** (tracking rider, chat) ha un numero di subscription sostenibile? Caching/`revalidate` sulle pagine pubbliche?
- **Dove:** query nelle `page.tsx` server, `lib/queries/`, `next.config.js` (images, optimizePackageImports), `lib/image-url.ts`/`image-resize.ts`, componenti mappa/realtime.
- **Red flag:** `select('*')` su tabelle grandi; loop di query per riga; rate limit che si azzera ad ogni cold start / non condiviso tra istanze; mappa Leaflet non lazy; immagini servite non ottimizzate; assenza di paginazione.

### 4.9 Frontend, UX & resilienza client — *[Frontend] + [Product]*
- **Obiettivo:** valutare l'esperienza reale, inclusi gli stati "non felici".
- **Domande:** Ogni vista ha **loading**, **empty** ed **error state**? I form (`react-hook-form`+`zod`) mostrano errori chiari e localizzati (`lib/zod-i18n.ts`)? Le mutation usano optimistic update con rollback? Si gestisce l'offline/timeout? La navigazione è coerente per ruolo? C'è doppio submit possibile sui pagamenti?
- **Dove:** `app/**/{loading,error,not-found}.tsx`, `components/`, provider React Query, form, `components/checkout/**`.
- **Red flag:** spinner infiniti su errore; bottoni pagamento ri-cliccabili; errori tecnici grezzi mostrati all'utente; nessun empty state; testi hardcoded non localizzati.

### 4.10 Accessibilità (a11y) — *[Accessibility]*
- **Obiettivo:** WCAG 2.1 AA per un marketplace pubblico.
- **Domande:** Navigazione completa **da tastiera**? `alt` significativi sulle immagini prodotto? Form con `label`/`aria-*`? Focus visibile e gestito in modali/drawer? Contrasti adeguati (verifica `tailwind.config.ts`)? Live region per toast/aggiornamenti realtime?
- **Dove:** `components/ui/**`, modali/drawer, form, `app/accessibility`, `tests/e2e/06-seo-and-a11y.spec.ts`.
- **Red flag:** `div` cliccabili senza ruolo/tab; immagini senza alt; focus trap assente; affidarsi solo al colore per lo stato.

### 4.11 Osservabilità & operatività — *[SRE]*
- **Obiettivo:** capire se, quando si rompe in prod, **te ne accorgi** e **riesci a diagnosticare**.
- **Domande:** Sentry cattura errori server **e** client con contesto utile (e PII scrubbata)? PostHog/GA4 partono solo con consenso? C'è logging strutturato (`lib/logger.ts`)? Gli alert operativi (`cron/operational-alerts`) coprono i segnali giusti (ordini bloccati, payout falliti, code email)? `render.yaml` definisce bene servizi, env, cron, health?
- **Dove:** `sentry.*.config.ts`, `instrumentation.ts`, `lib/analytics/**`, `lib/logger.ts`, `app/api/cron/operational-alerts`, `app/status`, `render.yaml`.
- **Red flag:** PII nei log/Sentry; analytics senza consenso; nessun alert su fallimenti di pagamento/consegna; health check cosmetico.

### 4.12 Testing & qualità — *[QA]*
- **Obiettivo:** misurare quanto ci si può **fidare** della suite e dove sono i buchi pericolosi.
- **Domande:** I ~70 test coprono i **percorsi che fanno male** (pagamenti, RLS, macchina a stati, COD, resi, auth)? I test verificano **comportamento** o si limitano all'implementazione? Gli e2e Playwright coprono i flussi critici end-to-end? I test RLS/function-grants verificano davvero che `anon` e ruoli non-autorizzati siano bloccati? `npm run verify` (typecheck+lint+test) passa pulito? C'è CI (GitHub Actions in `.github/`)?
- **Dove:** `tests/**`, `vitest.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts`, `.github/`, script `verify`.
- **Red flag:** molti test su util banali, zero su soldi/RLS; e2e che testano solo la home; mock che nascondono il comportamento reale; assenza di CI; test flaky.

### 4.13 AI features — *[AI/ML] + [Security] + [SRE]*
- **Obiettivo:** uso di Claude corretto, sicuro, economico e degradabile.
- **Domande:** L'input utente che finisce nel prompt (foto/testo prodotto) può fare **prompt-injection**? C'è rate limit e auth sugli endpoint AI (vision/description)? C'è un **fallback** se l'AI è giù o lenta? Il **costo** per chiamata è sotto controllo (modello scelto, token, immagini)? Le risposte sono validate prima di salvarle? La **moderazione** (`lib/ai/moderation.ts`) è applicata dove serve?
- **Dove:** `lib/ai/**`, `app/api/ai/description`, `app/api/vision/extract-product`, `app/api/image/remove-bg`, `lib/bg-removal/**`.
- **Red flag:** nessun rate limit/size limit sugli upload AI; output AI salvato senza validazione; nessun fallback/timeout; modello sovradimensionato per il task; provider esterni senza gestione errori/budget.

### 4.14 Comunicazioni: email / push / notifiche — *[SRE] + [Product]*
- **Obiettivo:** messaggi affidabili, conformi e non duplicati.
- **Domande:** Email con DKIM/SPF/DMARC (config dominio)? Template coerenti e localizzati (`lib/email/templates.ts`)? **Unsubscribe** one-click e rispetto preferenze (migr. 054)? Push idempotenti e rispettose del consenso? Le notifiche in-app (trigger Postgres, migr. 008) sono best-effort senza rompere la transazione principale?
- **Dove:** `lib/email/**`, `lib/push/send.ts`, `lib/notifications.ts`, `app/api/cron/{send-emails,send-push}`, migrazioni notifiche/preferenze.
- **Red flag:** invii non idempotenti; nessun unsubscribe; preferenze ignorate; errore notifica che fa fallire l'ordine.

### 4.15 SEO, i18n & contenuti — *[Frontend] + specialista i18n*
- **Obiettivo:** discoverability e correttezza multilingua.
- **Domande:** `sitemap`, `robots`, metadata, JSON-LD (Product/Store/Breadcrumb) presenti e corretti? `next-intl` copre tutte le stringhe (niente hardcoded)? URL localizzati coerenti? Le pagine CMS/branding admin (migr. 075-077) non rompono SEO/sicurezza (XSS via contenuti editabili)?
- **Dove:** `app/sitemap*`, `app/robots*`, `messages/`, `i18n.ts`, JSON-LD nelle pagine prodotto/negozio, `lib/cms.ts`, `app/admin/{pages,branding,home}`.
- **Red flag:** contenuti CMS resi senza sanitizzazione; stringhe hardcoded; metadata mancanti; canonical errati.

---

## 5. Rubrica di severità

Assegna a ogni finding **una** severità, motivandola con *impatto* × *probabilità*.

- **🔴 Critico / Bloccante** — perdita di denaro, breach di dati personali, accesso non autorizzato, illegalità (GDPR/SDI), corruzione dati, downtime. *Non si va in produzione finché non è risolto.*
- **🟠 Alto** — bug funzionale serio su flusso core, rischio sicurezza sfruttabile con condizioni, debito che blocca a breve, gap di compliance non immediatamente sanzionabile. *Da risolvere entro il lancio / sprint corrente.*
- **🟡 Medio** — comportamento errato su edge case, performance degradata sotto carico, gap di test su area sensibile, UX rotta su percorso secondario. *Pianificare.*
- **🟢 Minore** — code smell, inconsistenze, micro-ottimizzazioni, nice-to-have. *Backlog.*

Aggiungi a ciascuno una stima di **sforzo** (S/M/L/XL) e marca i **quick win** (impatto≥Alto, sforzo≤S/M).

---

## 6. Template di finding (usa questo formato per ognuno)

```
### [SEVERITÀ] [Area/Esperto] Titolo conciso e specifico

- **Dove:** percorso/file.ts:riga (+ altri riferimenti)
- **Cosa:** descrizione precisa del problema (cosa fa il codice oggi).
- **Perché è un problema:** impatto concreto + chi/cosa colpisce + scenario di rottura.
- **Prova:** snippet minimo o comando+output che lo dimostra.
- **Epistemico:** [Fatto] / [Inferenza] / [Ipotesi: come verificarla].
- **Raccomandazione:** fix concreto e azionabile (non "migliorare la sicurezza" ma *cosa* cambiare). Indica alternative/trade-off se rilevanti.
- **Sforzo:** S / M / L / XL   ·   **Quick win:** sì/no
```

---

## 7. Formato del report finale

Produci un unico documento Markdown così strutturato:

1. **Executive summary (½ pagina).** Stato di salute complessivo, i 5-7 rischi che tengono sveglio di notte, e una risposta netta a: *"È pronto a gestire soldi e dati di utenti reali in Italia? Cosa manca esattamente?"*. Niente fronzoli.
2. **Scorecard per dimensione.** Tabella: ogni area di §4 con un voto (es. 🟢/🟡/🟠/🔴 o 1-5), una riga di motivazione e il finding peggiore.
3. **Finding dettagliati**, raggruppati per **severità** (🔴→🟢) e, dentro, per area. Ognuno nel template §6.
4. **Analisi dei flussi critici end-to-end** (narrativa breve, con riferimenti a file): *pagamento buyer→payout seller→rider*, *reso→rimborso*, *onboarding+KYC seller/rider*, *macchina a stati ordine*, *cancellazione account GDPR*. Per ciascuno: tiene? dove si rompe?
5. **Ciò che è fatto bene** (conciso) — pattern validi da preservare (CSP nonce, wrapper auth, idempotenza webhook, test RLS, ecc., *se* verificati).
6. **Prioritizzazione & roadmap.** Tabella ordinata per ROI: 🔴 bloccanti, quick win, rischi strutturali, con sforzo stimato. Una proposta di sequenza (cosa prima, cosa dopo) e perché.
7. **Domande aperte / assunzioni.** Cosa non hai potuto verificare dal solo codice (config prod, chiavi reali, comportamento Stripe live) e come confermarlo.

Salva il report come `AUDIT_SENIOR_<YYYY-MM-DD>.md` nella root (a meno di indicazioni diverse).

---

## 8. Regole d'oro & anti-pattern (cosa **non** fare)

- **Non inventare.** Nessun nome di file, funzione, colonna, env var, policy o numero che non hai verificato. Nel dubbio: leggi, grep, oppure dichiara [Ipotesi].
- **Non fidarti dei markdown del repo** (`ANALISI_MARKETPLACE.md`, ecc.): sono storici. La verità è il codice e lo schema.
- **Non confondere "assente nei nomi file" con "assente".** Cerca davvero (grep/read) prima di dichiarare un'assenza, e mostra come hai cercato.
- **Non fare un report generico da checklist.** Ogni finding deve essere ancorato a *questo* codice, con `file:riga`. "Aggiungi rate limiting" senza dire *dove manca* e *qual è l'endpoint a rischio* è inutile.
- **Non confondere severità.** Un code smell non è critico; una perdita di denaro non è "medio". Motiva sempre.
- **Non riscrivere il codice** (a meno di richiesta esplicita): questo è un audit. Le raccomandazioni indicano *cosa* e *come*, ma l'output è il report.
- **Non essere adulatorio né distruttivo.** Il tono è quello di un senior che vuole il bene del prodotto: diretto, specifico, utile.
- **Non sprecare profondità sulle util banali** quando soldi/RLS/auth meritano il triplo dell'attenzione. Alloca lo sforzo dove il rischio è alto.
- **Niente segnaposto** ("TODO", "qui andrebbe…") nel report: o lo hai verificato, o lo dichiari come domanda aperta con il modo per chiuderla.

---

## 9. Checklist di autocontrollo (prima di consegnare il report)

- [ ] Ho **eseguito** la mappa (§1) e letto **davvero** il codice dei percorsi critici (soldi, auth, RLS, dati personali, stati ordine)?
- [ ] Ogni finding ha `file:riga`, severità motivata, prova, raccomandazione azionabile e sforzo?
- [ ] Ho marcato ogni claim come [Fatto]/[Inferenza]/[Ipotesi] e non ho spacciato ipotesi per fatti?
- [ ] Ho tracciato i flussi end-to-end (pagamento/payout/reso/KYC/stati/cancellazione GDPR) e detto dove si rompono?
- [ ] Ho coperto **tutte** le dimensioni di §4 (anche quelle "noiose": a11y, i18n, SEO, email)?
- [ ] Ho verificato lo stato reale invece di fidarmi dei markdown datati del repo?
- [ ] L'executive summary risponde senza giri a "è pronto per soldi+dati reali in Italia?"?
- [ ] La prioritizzazione distingue 🔴 bloccanti, quick win e rischi strutturali con ROI?
- [ ] Ho riconosciuto (con misura) ciò che è fatto bene, così la fiducia nel resto è calibrata?
- [ ] Riguardando il report: lo firmerei come senior responsabile del go-live?

---

*Inizia dalla Fase 0 (ricognizione). Pensa a voce alta come panel — quando un esperto solleva un punto, attribuiscilo — poi consegna il report unico secondo §7.*
