# Prompt — Analisi PROFONDA, completa e di sistema del marketplace MyCity

> **A cosa serve.** Questo prompt guida l'analisi **più profonda e completa possibile** di *tutto* MyCity: **codice**, **funzionalità**, **collegamenti** (tra pagine, con il database, con le app esterne), **bug** ed **errori**. A differenza di `PROMPT_ANALISI_SENIOR.md` (che è un audit di rischio per severità), qui il cuore è la **tracciabilità end-to-end e la mappa del sistema**: ogni pagina, ogni route, ogni tabella, ogni servizio esterno — *come sono cablati tra loro* e *dove il cablaggio è rotto, mancante o incoerente*.
>
> **Come usarlo.** Apri una sessione di Claude Code **nella root del repo `mycity`** e incolla tutto il testo sotto la riga di separazione. È **read-only**: l'output è un **report-mappa** (`AUDIT_PROFONDO_<YYYY-MM-DD>.md`), non una PR. Se vuoi anche i fix, dillo all'inizio ("dopo il report, correggi i 🔴 sul branch X").
>
> **Relazione con gli altri documenti.** Usa il metodo, la rubrica di severità e il template di finding di `PROMPT_ANALISI_SENIOR.md` come fondamento; questo prompt **aggiunge** le sezioni di mappatura dei collegamenti e di integrità del cablaggio. Ignora come "verità" i markdown storici (`ANALISI_MARKETPLACE.md`, `PROMPT_CLAUDE_CODE.md`, lo stesso README): sono **datati** — verifica sempre sul codice.

---

Sei un **panel di esperti senior** + un **system cartographer** (cartografo di sistema) incaricato dell'**analisi più profonda, completa e complessa possibile** del marketplace **MyCity** (Piacenza). Non ti fermi a "trovare bug": **ricostruisci l'intera rete del sistema** — cosa è collegato a cosa, in che direzione scorrono i dati, quali nodi sono orfani o rotti — e poi giudichi codice, funzionalità e affidabilità con prove alla mano.

Il prodotto è un marketplace locale con consegna a domicilio e **4 ruoli in un solo prodotto**: **Buyer, Seller, Rider, Admin**. Il tuo verdetto deve poter rispondere a: *"Capisco esattamente come è fatto questo sistema, dove ogni pezzo si collega agli altri, e dove quel collegamento è rotto, fragile, mancante o pericoloso?"*

## 0. Chi sei — panel di esperti (indossa il cappello giusto per ogni finding)

Attribuisci ogni finding all'esperto che lo solleverebbe (es. `[Database]`, `[Payments]`, `[Frontend]`). Il codebase usa già commenti `Esperti consultati:` — onora quella convenzione.

| Esperto | Mandato in questa analisi |
|---|---|
| **System Architect / Cartographer** | Costruisce la mappa: route, pagine, moduli, confini server/client, grafo delle dipendenze. |
| **Frontend / Navigation** | Grafo di navigazione tra pagine: link, redirect, route group, layout, `<Link>`/`router.push`, link morti/orfani. |
| **Database Engineer** | Mappa codice↔DB: quali route/pagine leggono/scrivono quali tabelle/RPC; RLS; colonne referenziate ma inesistenti; drift schema↔tipi. |
| **Integrations Engineer** | Mappa codice↔app esterne: ogni SDK/HTTP verso Stripe, Supabase, Resend, Anthropic, Turnstile, SDI, KYC, bg-removal, Sentry, PostHog, GA4, Web Push, Upstash, Maps/Nominatim, n8n. |
| **Security / AppSec** | AuthN/AuthZ su ogni nodo, IDOR, segreti, superficie d'attacco dei collegamenti esterni (SSRF, webhook firma). |
| **Payments / Fintech** | Correttezza del denaro lungo tutta la catena pagamento→payout→reso. |
| **SRE / DevOps** | Idempotenza, cron, webhook, env-var wiring, failure mode dei collegamenti esterni. |
| **QA / Test** | Quali collegamenti e flussi sono davvero coperti da test. |
| **Product / UX** | Completezza funzionale per ruolo: cosa è feature vera vs stub/mock. |
| **Performance** | N+1, query calde senza indice, bundle, Realtime, costo delle chiamate esterne. |
| **Bug Hunter** | Caccia attiva a bug/errori reali: race, off-by-one, null/undefined, await mancanti, error swallowing, type lie. |

> Se serve uno specialista non in lista (a11y, i18n/SEO, Legal/GDPR, Email deliverability, AI/prompt-injection, Geo/Maps), **invocalo** con lo stesso rigore.

## 1. Lo stack reale (verifica, non assumere)

**Stack** (controlla le versioni in `package.json` prima di citarle): Next.js 15 (App Router, RSC, Server Actions), React 18, TypeScript, Tailwind. Backend = **Supabase** (Postgres + Auth + Storage + Realtime + **RLS**). Pagamenti = **Stripe** (Checkout + Connect seller *e* rider + payout/escrow + webhook) + **COD** (contanti, conferma rider). Hosting **Render**.

**App esterne collegate** (dal `.env.example` — verifica ciascuna nel codice):

| Servizio | Scopo dichiarato | Variabili chiave | Dove cercarlo nel codice |
|---|---|---|---|
| **Supabase** | DB/Auth/Storage/Realtime/RLS | `NEXT_PUBLIC_SUPABASE_URL`, `…ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase/**`, ovunque `createClient` |
| **Stripe** | Checkout, Connect, payout, webhook | `STRIPE_SECRET_KEY`, `…WEBHOOK_SECRET`, `…CONNECT_CLIENT_ID`, `NEXT_PUBLIC_…PUBLISHABLE_KEY` | `app/api/stripe/**`, `lib/stripe/**` |
| **Anthropic (Claude)** | AI vision/descrizioni/moderazione | `ANTHROPIC_API_KEY` | `lib/ai/**`, `app/api/ai/**`, `app/api/vision/**` |
| **Resend** | Email transazionale | `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO` | `lib/email/**`, `app/api/cron/send-emails` |
| **Cloudflare Turnstile** | CAPTCHA | `…TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | `lib/captcha.ts` |
| **SDI (fatturazione)** | Fattura elettronica IT | `SDI_PROVIDER` (fattureincloud/aruba/mock), `SDI_API_KEY`, `SDI_COMPANY_ID` | `lib/invoicing/**`, `app/api/invoices/**` |
| **KYC** | Verifica documento+face | `KYC_PROVIDER` (onfido/jumio/veriff/mock), `KYC_API_KEY` | `lib/kyc/**`, `app/api/kyc/**` |
| **Background removal** | Scontorno foto prodotto | `BG_REMOVAL_PROVIDER` (removebg/photoroom/mock), `REMOVE_BG_API_KEY`, `PHOTOROOM_API_KEY` | `lib/bg-removal/**`, `app/api/image/remove-bg` |
| **Sentry** | Error tracking | `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | `sentry.*.config.ts`, `instrumentation.ts` |
| **PostHog** | Analytics + replay | `NEXT_PUBLIC_POSTHOG_KEY`, `…HOST` | `lib/analytics/**` |
| **Google Analytics 4** | Analytics | `NEXT_PUBLIC_GA_MEASUREMENT_ID` | `lib/analytics/**` |
| **Web Push (VAPID)** | Notifiche push | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `lib/push/**`, `app/api/cron/send-push` |
| **Upstash Redis** | Rate limit multi-istanza | `UPSTASH_REDIS_REST_URL`, `…TOKEN` | `lib/rate-limit.ts`, `lib/net/**` |
| **WhatsApp Business** | Link contatto | `NEXT_PUBLIC_WHATSAPP_NUMBER` | grep `WHATSAPP` |
| **Maps/Geo** | Mappe + geocoding | (OSM tiles, Nominatim — no key) | `lib/geo.ts`, componenti mappa Leaflet |
| **Cron esterno** | Trigger `/api/cron/*` | `CRON_SECRET` | `app/api/cron/**`, `lib/api/middleware.ts` |
| **n8n** | (Automazioni — verifica se/come è collegato) | grep `n8n`, webhook in/out | cerca webhook, `app/api/**`, integrazioni |

**Ordini di grandezza al momento della scrittura** (ri-conta — cambiano): ~78 route in `app/api/**/route.ts` (inclusi i cron in `app/api/cron/**`), ~102 migrazioni in `migrations/`, ~112 pagine `app/**/page.tsx`. **Conta tu i numeri reali** all'inizio e usali nel report.

### ⚠️ Regola di realtà
README e i markdown storici sono **datati** (il README dice "Next.js 14", il package.json dice un'altra versione; l'analisi storica parla di "no Stripe, no test"). **La verità è il codice, lo schema SQL e i tipi.** Ogni claim sullo stato attuale va verificato lì.

## 2. Metodo (come ragiona un senior)

1. **Evidence-based, sempre.** Ogni affermazione ha una prova: `percorso/file.ts:riga` o un comando con output. Mai "a sensazione".
2. **Verifica prima di affermare un'assenza.** Mostra *come* hai cercato (grep/read) prima di dire "manca X".
3. **Livelli epistemici.** Marca ogni claim come **[Fatto]** (visto nel codice), **[Inferenza]** (dedotto, da cosa) o **[Ipotesi]** (da verificare, *come*). Mai spacciare ipotesi per fatti.
4. **Pensa per failure mode.** Per ogni collegamento: cosa succede se l'altro lato è giù/lento/risponde male? se l'evento arriva due volte o fuori ordine? se l'input è malevolo? a 100× il carico?
5. **Quantifica.** "Lento" → quante query / quale N. "Costoso" → quanto per chiamata. "Rischioso" → chi lo sfrutta e cosa ottiene.
6. **Niente allucinazioni.** Non inventare nomi di file, funzioni, colonne, env var, tabelle, policy o route. Se non l'hai letto, leggilo o dichiara l'incertezza.

## 3. Protocollo di esecuzione (fasi — non saltare alla scrittura prima di aver mappato e letto)

### Fase 0 — Inventario (conta e cataloga *tutto*)
Esegui e salva gli output:
```bash
# Pagine (nodi di navigazione)
find app -name "page.tsx" | sort
# API routes (nodi di backend) + cron
find app/api -name route.ts | sort
# Server Actions (mutazioni nascoste nelle pagine/componenti)
grep -rln "'use server'" app components lib
# Layout, loading, error, not-found (resilienza per route)
find app -name "layout.tsx" -o -name "loading.tsx" -o -name "error.tsx" -o -name "not-found.tsx" | sort
# Logica di dominio
ls lib lib/*/
# Schema/evoluzione DB
ls migrations | sort
# Tipi DB (per il drift)
wc -l lib/database.types.ts
# Convenzione "esperti consultati"
grep -rn "Esperti consultati" --include=*.ts --include=*.tsx .
# Drift schema/migrazioni (se lo script esiste)
npm run db:check-drift 2>/dev/null || echo "script assente/non configurato"
```

### Fase 1 — Le tre mappe (il cuore di questa analisi)
Costruisci **tre mappe esplicite** e mettile nel report (tabelle e/o diagrammi Mermaid):

**1.1 — Mappa di NAVIGAZIONE (pagina ↔ pagina).**
Traccia il grafo dei collegamenti tra pagine. Per ogni pagina: a quali altre pagine punta (`<Link href>`, `redirect()`, `router.push/replace`, `<a href>` interni, voci di menu in `lib/account-menu.ts` / navbar) e da quali è raggiunta. Cerca:
- **Pagine orfane** (esistono ma nessuno le linka).
- **Link morti** (puntano a route inesistenti — confronta gli `href` con l'inventario pagine).
- **Redirect/guard per ruolo** coerenti (buyer non entra in `/seller/**` o `/admin/**`?). Verifica `middleware.ts` + guard nelle pagine/layout.
- **Route group e layout**: chi eredita quale layout/auth.
- **Slug dinamici** (`[id]`, `[slug]`, `[handle]`) — chi li genera, chi li consuma, cosa succede con id inesistente (404 vs crash).
```bash
grep -rno "href=[\"'][^\"']*[\"']" app components | sort -u
grep -rn "router\.\(push\|replace\)\|redirect(" app components
```

**1.2 — Mappa DATI (codice ↔ database).**
Per ogni **API route** e ogni **pagina/Server Action** che tocca il DB, elenca: tabelle e RPC usate, operazione (select/insert/update/delete/rpc), e se passa per `createClient` utente (RLS attivo) o per il **service-role** (RLS bypassato). Poi verifica:
- Ogni tabella scritta ha **RLS** e policy sensate? (incrocia con `migrations/*_rls_*`, `*_security_*`).
- **Colonne/tabelle referenziate nel codice ma inesistenti nello schema/tipi** (errore a runtime). Incrocia `.from('x').select('a,b')` con `lib/database.types.ts` e le migrazioni.
- **RPC `SECURITY DEFINER`**: `search_path` fissato? `GRANT EXECUTE` ristretti?
- **Drift**: lo schema delle migrazioni combacia con `lib/database.types.ts`?
```bash
grep -rno "\.from(['\"][a-z_]*['\"])" app lib | sort | uniq -c | sort -rn
grep -rno "\.rpc(['\"][a-z_]*['\"])" app lib | sort | uniq -c | sort -rn
grep -rln "SERVICE_ROLE\|service_role\|supabaseAdmin\|createAdminClient" app lib
```

**1.3 — Mappa INTEGRAZIONI (codice ↔ app esterne).**
Per ogni servizio della tabella §1, elenca **ogni punto di chiamata** (file:riga), cosa invia/riceve, e verifica per ciascuno:
- **Wiring env**: tutte le variabili lette esistono in `lib/env.ts` / `.env.example`? Ci sono env lette ma non documentate, o documentate ma non usate?
- **Failure mode**: timeout, retry, fallback se il servizio è giù? Errore gestito o swallowed?
- **Sicurezza**: webhook con verifica firma? endpoint che fetchano URL esterni → SSRF? segreti mai esposti al client (niente non-`NEXT_PUBLIC_` nel bundle)?
- **`mock` vs reale**: KYC/SDI/bg-removal hanno modalità `mock`. Verifica che in prod non si scambi un mock per verifica reale (e che il fallback a 503/errore sia corretto).
- **Costo/idempotenza**: chiamate AI (token/modello), email/push (dedup), payout (idempotenza).
```bash
grep -rln "stripe\|anthropic\|resend\|turnstile\|posthog\|sentry\|web-push\|upstash\|nominatim\|n8n" app lib | sort
grep -rn "process\.env\." app lib | grep -o "process\.env\.[A-Z_]*" | sort -u
```

### Fase 2 — Analisi profonda per dominio (leggi il codice, non solo i nomi)
Attraversa tutte le dimensioni qui sotto (§4), **leggendo davvero** i percorsi critici. Per ogni flusso critico, **tracciane la rotta completa** attraverso le tre mappe (UI → route/action → DB → servizio esterno → ritorno → UI).

### Fase 3 — Caccia a bug ed errori (attiva, non passiva)
Non aspettare che i bug saltino fuori: **cercali**. Vedi §5 per la checklist del Bug Hunter. Per ogni bug: riproducibilità, scenario, severità, fix.

### Fase 4 — Prioritizzazione e report
Ordina per (impatto × probabilità) / sforzo. Separa 🔴/🟠/🟡/🟢, marca i **quick win**. Scrivi il report (§7).

## 4. Dimensioni dell'analisi (copri TUTTE)

> Per ogni dimensione: obiettivo, domande-guida, dove guardare, red flag. Approfondisci dove un difetto costa di più (soldi, dati personali, sicurezza, correttezza ordini, collegamenti rotti).

### 4.1 Codice & architettura — *[Architect]*
Dove vive la logica di dominio (lib/route/componente/DB)? È duplicata (prezzi, fee, soglie, stati, ruoli in più punti con valori diversi)? Confine server/client netto (`'use client'` corretto, niente import server nel client)? Single source of truth per stati ordine (`lib/order-status.ts`), costanti (`lib/constants.ts`), query keys (`lib/queries/keys.ts`)?
*Red flag:* business logic nei componenti; regole duplicate divergenti; "util" che è dominio; `'use client'` su pagine che dovrebbero essere server.

### 4.2 Funzionalità per ruolo (completezza end-to-end) — *[Product]*
Ogni ruolo completa il suo lavoro senza vicoli ciechi? **Buyer**: catalogo→carrello (cross-device)→checkout (multi-seller)→pagamento→tracking→reso/dispute. **Seller**: onboarding/KYC→catalogo (varianti, stock atomico)→ordini→earnings/payout→recensioni→promo/coupon→sito vetrina. **Rider**: onboarding/KYC→disponibilità (in DB)→claim senza double-claim→pickup/delivery con codici→cash→SOS. **Admin**: approvazioni, dispute, payout, CMS/branding, moderazione, support.
*Red flag:* **stub travestiti da feature** (UI presente, scrittura DB assente); provider in `mock` scambiati per reali; transizioni di stato fuori sequenza; feature linkate ma non implementate.

### 4.3 Collegamenti tra pagine (navigazione) — *[Frontend/Navigation]*
(Vedi mappa 1.1.) Link morti, pagine orfane, guard per ruolo, gestione 404 su slug dinamici, coerenza menu/navbar/breadcrumb, deep-link che reggono (es. `/orders/[id]` aperto direttamente).
*Red flag:* `href` verso route inesistenti; pagina protetta raggiungibile senza guard; `[id]` inesistente che crasha invece di 404.

### 4.4 Collegamenti con il database — *[Database]*
(Vedi mappa 1.2.) RLS su ogni tabella scritta; policy non `USING (true)` su write; RPC `SECURITY DEFINER` con `search_path` + grant ristretti; vincoli (`CHECK/FK/UNIQUE/NOT NULL`) che impediscono stati impossibili (prezzo<0, stock<0, ordine senza items); soldi in `numeric`/centesimi (mai `float`); indici su FK e query calde; **colonne referenziate ma inesistenti**; drift schema↔tipi; macchina a stati imposta dal DB o solo dall'app.
*Red flag:* `USING (true)` su update/delete; `GRANT … TO anon` su funzioni che mutano; decremento stock senza lock (overselling); `select('*')` su tabelle grandi.

### 4.5 Collegamenti con app esterne — *[Integrations] + [Security] + [SRE]*
(Vedi mappa 1.3.) Per ciascun servizio: chiamata gestita (timeout/retry/fallback), errori non swallowed, segreti server-only, webhook firmati e idempotenti, SSRF sui fetch di URL, env wiring completo, `mock` non scambiato per reale in prod, costo/idempotenza sotto controllo. Verifica esplicitamente se **n8n** è collegato (webhook in/out) e con quale superficie di sicurezza.
*Red flag:* servizio esterno senza timeout/fallback (cascata di fallimenti); webhook senza firma/dedup; chiave server in un componente client; provider mock attivo in prod senza guardia; nessuna gestione budget/rate per AI.

### 4.6 Pagamenti & flusso del denaro — *[Payments]* 🔴
Webhook Stripe verifica firma e scarta duplicati (idempotenza)? Importo addebitato = item + spedizione − sconti, al centesimo? Multi-seller checkout splitta fee/payout per seller? Escrow rilascia payout solo dopo `DELIVERED + N` (cron `release-payouts`)? Reversal/dispute sottraggono dal payout giusto? COD ha riconciliazione reale (`rider/cash-confirm`)? Fatture numerate progressivamente e a norma? Fee = una sola fonte di verità?
*Red flag:* webhook senza firma/dedup; importi calcolati in più punti divergenti; payout a prescindere dalla consegna; refund che non tocca il payout; soldi in float.

### 4.7 Sicurezza & AuthZ — *[Security]*
Ogni route sensibile passa per `withAuth`/`withSellerAuth`/`withAdminAuth`/`withCronAuth`/`withInternalAuth`? IDOR su `[id]` (un seller muta ordini altrui)? Service-role solo server-side? Segreti confrontati a tempo costante? CSP del middleware regge (niente `unsafe-inline` su `script-src` in prod)? Input validati con zod ai confini? HTML utente sanificato? Redirect validati (`lib/safe-redirect.ts`)? **Nota:** il middleware **non** copre `/api/` — il controllo ruolo deve stare *anche* nella route.
*Red flag:* route che mutano `params.id` senza verificare ownership; auth "a mano" sbagliata; CAPTCHA/rate-limit assenti su endpoint costosi/pubblici.

### 4.8 Affidabilità, idempotenza & cron — *[SRE]*
I cron (`abandoned-carts, expire-checkouts, operational-alerts, process-deletions, release-payouts, send-emails, send-push`, + altri presenti) sono **idempotenti** e protetti da `CRON_SECRET` timing-safe? Gestiscono fallimenti parziali (100 invii, il 50° fallisce)? Scritture critiche transazionali? Errori in Sentry con contesto? `health` endpoint misura davvero il DB?
*Red flag:* cron che riprocessa gli stessi record; invii senza dedup; `release-payouts` senza guardia di idempotenza; health check cosmetico (200 anche con DB giù).

### 4.9 Performance & scalabilità — *[Performance]*
N+1 nelle liste (catalogo, ordini, admin)? Query calde indicizzate? Rate limit in-memory (`lib/rate-limit.ts`) regge in multi-istanza su Render o serve Upstash? Bundle client contenuto (`optimizePackageImports`, mappa in dynamic import)? Immagini ottimizzate (AVIF/WebP, cache TTL)? Realtime (tracking rider, chat) sostenibile? `revalidate`/cache sulle pagine pubbliche?
*Red flag:* `select('*')` su tabelle grandi; loop di query per riga; rate limit azzerato a ogni cold start; mappa non lazy; assenza paginazione.

### 4.10 Frontend, UX & resilienza client — *[Frontend]*
Ogni vista ha **loading/empty/error**? Form (`react-hook-form`+`zod`) con errori chiari e localizzati? Mutation con optimistic+rollback? Doppio submit possibile sui pagamenti? Offline/timeout gestiti?
*Red flag:* spinner infiniti su errore; bottoni pagamento ri-cliccabili; errori tecnici grezzi a video; testi hardcoded non localizzati.

### 4.11 Compliance (IT/EU) — *[Legal/Privacy]* 🔴
Consent bloccante prima del tracking (PostHog/GA4 solo dopo consenso)? Export dati e cancellazione (`account/export`, `account/delete` + cron `process-deletions`) realizzano Art. 15/17/20? KYC reale o `mock`? Fattura SDI a norma? Trasparenza ranking/sponsored (P2B)? Recesso 14gg/resi nel flusso? Audit log sulle azioni admin?
*Red flag:* analytics prima del consenso; "oblio" che lascia PII in ordini/log; mock scambiato per verifica; fattura senza numerazione; nessun audit trail admin.

### 4.12 Testing & qualità — *[QA]*
I test coprono i percorsi che fanno male (pagamenti, RLS, stati, COD, resi, auth)? Verificano comportamento o implementazione? E2E Playwright sui flussi critici? Test RLS bloccano davvero `anon`/ruoli non autorizzati? `npm run verify` passa pulito? C'è CI in `.github/`?
*Red flag:* molti test su util banali e zero su soldi/RLS; e2e solo sulla home; mock che nascondono il comportamento reale; CI assente; flaky.

### 4.13 Osservabilità, a11y, i18n/SEO, AI, comunicazioni — *[vari]*
Copri anche: **Observability** (Sentry server+client con PII scrubbata; alert operativi sui segnali giusti); **a11y** (tastiera, alt, label/aria, focus, contrasti — WCAG 2.1 AA); **i18n/SEO** (`next-intl` senza stringhe hardcoded, sitemap/robots/JSON-LD, CMS senza XSS); **AI** (prompt-injection da input utente, rate/size limit, fallback, validazione output, moderazione); **comunicazioni** (email DKIM/SPF/DMARC, unsubscribe, push idempotenti, notifiche best-effort che non rompono la transazione).

## 5. Caccia a bug ed errori — checklist del Bug Hunter

Cerca attivamente questi pattern (grep + lettura mirata). Per ognuno trovato: prova, scenario, severità, fix.
- **Promise non attese** (`await` mancante su scritture/chiamate esterne) → dati persi silenziosamente. `grep -rn "supabase\|fetch\|stripe\|resend" | grep -v await` come punto di partenza, poi leggi.
- **Errori inghiottiti**: `catch {}` vuoti, `catch (e) {}` senza log/rethrow, `.catch(() => {})`.
- **Null/undefined**: accesso a `data` senza controllare `error` di Supabase; `data!` non giustificato; optional chaining mancante su risposte esterne.
- **Race condition**: stock/claim/payout/idempotenza senza lock o `UNIQUE`/upsert atomico; doppio submit; webhook concorrenti.
- **Off-by-one / arrotondamenti**: calcoli soldi (centesimi), paginazione, slice, date/timezone.
- **Type lie**: `as any`, `@ts-ignore`, cast che mascherano forme dati sbagliate; tipi DB disallineati dalla realtà.
- **Collegamenti rotti** (dalle 3 mappe): href→route inesistente; `.from('tabella_inesistente')`; colonna inesistente; env letta ma non in `.env.example`; route chiamata dal client ma assente.
- **Stato incoerente**: transizioni ordine fuori dalla macchina a stati; UI che assume uno stato che il backend non garantisce.
- **Sicurezza**: `dangerouslySetInnerHTML` senza sanitizzazione; redirect non validati; service-role dove basterebbe l'utente; secret in codice client.
- **Errori di logica**: condizioni invertite, `===` vs `==`, default sbagliati, `||` dove serve `??` (0/"" trattati come falsy).
```bash
grep -rn "@ts-ignore\|as any\|: any\b" app lib components | head -50
grep -rn "catch *(.*) *{[[:space:]]*}" app lib
grep -rn "dangerouslySetInnerHTML" app components
grep -rn "console\.\(log\|error\)" app lib | head   # logging grezzo / PII?
```

## 6. Rubrica di severità & template di finding

**Severità** (impatto × probabilità):
- **🔴 Critico/Bloccante** — perdita di denaro, breach dati personali, accesso non autorizzato, illegalità (GDPR/SDI), corruzione dati, downtime, **collegamento rotto su flusso core**.
- **🟠 Alto** — bug funzionale serio su flusso core, sicurezza sfruttabile con condizioni, gap compliance.
- **🟡 Medio** — edge case errato, performance degradata sotto carico, gap di test su area sensibile.
- **🟢 Minore** — code smell, inconsistenze, micro-ottimizzazioni.

Aggiungi a ciascuno lo **sforzo** (S/M/L/XL) e marca i **quick win** (impatto≥Alto, sforzo≤M).

**Template di finding** (uno per problema):
```
### [SEVERITÀ] [Area/Esperto] Titolo conciso e specifico
- **Dove:** percorso/file.ts:riga (+ altri riferimenti)
- **Tipo di collegamento (se applicabile):** pagina↔pagina | codice↔DB | codice↔esterno
- **Cosa:** cosa fa il codice oggi (preciso).
- **Perché è un problema:** impatto concreto + chi colpisce + scenario di rottura.
- **Prova:** snippet minimo o comando+output.
- **Epistemico:** [Fatto] / [Inferenza] / [Ipotesi: come verificarla].
- **Raccomandazione:** fix concreto e azionabile (cosa cambiare, dove). Trade-off se rilevanti.
- **Sforzo:** S/M/L/XL   ·   **Quick win:** sì/no
```

## 7. Formato del report finale

Produci un unico documento Markdown, salvato come `AUDIT_PROFONDO_<YYYY-MM-DD>.md` nella root:

1. **Executive summary (½ pagina).** Stato di salute, i 5-7 rischi che tengono sveglio di notte, e risposta netta a: *"Ho capito esattamente come è cablato il sistema e dove il cablaggio è rotto? È pronto a gestire soldi e dati reali in Italia?"*.
2. **Inventario del sistema** — numeri reali ricontati (pagine, route, cron, migrazioni, tabelle, servizi esterni).
3. **Le tre mappe** (il valore distintivo di questo report):
   - **3a. Mappa di navigazione** (pagina↔pagina) — tabella e/o diagramma Mermaid, con pagine orfane e link morti evidenziati.
   - **3b. Mappa dati** (codice↔DB) — tabella route/pagina → tabelle/RPC → operazione → RLS/service-role, con colonne inesistenti e drift evidenziati.
   - **3c. Mappa integrazioni** (codice↔app esterne) — tabella servizio → punti di chiamata → failure mode → stato sicurezza/env.
4. **Scorecard per dimensione** — ogni area di §4 con voto (🟢/🟡/🟠/🔴), una riga di motivazione, il finding peggiore.
5. **Finding dettagliati** — raggruppati per severità (🔴→🟢), poi per area, nel template §6.
6. **Flussi critici end-to-end** — narrativa breve con riferimenti a file, tracciando la rotta sulle tre mappe: *pagamento buyer→payout seller/rider*, *reso→rimborso*, *onboarding+KYC*, *macchina a stati ordine*, *cancellazione account GDPR*. Per ciascuno: tiene? dove si rompe?
7. **Bug ed errori trovati** (dal §5) — lista con riproducibilità.
8. **Cosa è fatto bene** (conciso) — pattern validi da preservare, *se verificati*.
9. **Prioritizzazione & roadmap** — tabella ordinata per ROI: 🔴 bloccanti, quick win, rischi strutturali, con sforzo e sequenza consigliata.
10. **Domande aperte / assunzioni** — cosa non hai potuto verificare dal solo codice (config prod, chiavi live, comportamento Stripe live, se n8n è realmente attivo) e come confermarlo.

## 8. Regole d'oro (cosa NON fare)
- **Non inventare** nomi di file/funzioni/colonne/env/tabelle/route/policy/numeri: leggi, grep, o dichiara [Ipotesi].
- **Non fidarti dei markdown/README del repo**: sono storici; la verità è codice+schema+tipi.
- **Non confondere "assente nei nomi file" con "assente"**: cerca davvero e mostra come.
- **Niente report da checklist generica**: ogni finding ancorato a *questo* codice con `file:riga`.
- **Non confondere severità**: motiva sempre con impatto×probabilità.
- **Non riscrivere il codice** (salvo richiesta esplicita): è un audit-mappa, l'output è il report.
- **Alloca la profondità dove il rischio è alto** (soldi/RLS/auth/dati personali/collegamenti core), non sulle util banali.
- **Niente segnaposto** ("TODO", "qui andrebbe…"): o l'hai verificato, o è una domanda aperta con il modo per chiuderla.

## 9. Checklist di autocontrollo (prima di consegnare)
- [ ] Ho eseguito l'inventario (§3 Fase 0) e ricontato i numeri reali?
- [ ] Ho costruito **tutte e tre le mappe** (navigazione, dati, integrazioni) con orfani/link morti/colonne inesistenti/failure mode evidenziati?
- [ ] Ho letto **davvero** il codice dei percorsi critici (soldi, auth, RLS, dati personali, stati ordine, webhook)?
- [ ] Ho cercato **attivamente** bug/errori (§5), non solo aspettato che emergessero?
- [ ] Ogni finding ha `file:riga`, severità motivata, prova, raccomandazione azionabile, sforzo?
- [ ] Ho marcato ogni claim come [Fatto]/[Inferenza]/[Ipotesi]?
- [ ] Ho tracciato i flussi end-to-end sulle tre mappe e detto dove si rompono?
- [ ] Ho coperto **tutte** le dimensioni di §4 (anche a11y, i18n, SEO, email)?
- [ ] Ho verificato lo stato reale invece di fidarmi di README/markdown datati?
- [ ] L'executive summary risponde senza giri a "ho capito il cablaggio? è pronto per soldi+dati reali?"?
- [ ] Riguardando il report: lo firmerei come senior responsabile del go-live?

---

*Inizia dalla Fase 0 (inventario), poi costruisci le tre mappe (Fase 1), poi scava per dominio (Fase 2) e caccia i bug (Fase 3). Pensa a voce alta come panel — attribuisci ogni punto all'esperto giusto — e consegna il report-mappa unico secondo §7.*
