# Audit Sicurezza & Performance — MyCity (giugno 2026)

Analisi end-to-end del marketplace con priorità assoluta sulla **sicurezza dei dati di pagamento**.
Eseguita su codice (`/home/user/mycity`) e database live Supabase `clmpyfvpvfjgeviworth` (Postgres 17, eu-west-3),
incluso il database linter (advisor di sicurezza e performance) e l'ispezione delle funzioni `SECURITY DEFINER`.

Stack: Next.js 15 (App Router) · Supabase (Postgres + Auth + Storage + RLS + Realtime) · Stripe Checkout + Connect · Resend · Claude API.

---

## 1. Esito complessivo

| Area | Valutazione | Note |
|---|---|---|
| 💳 **Carte di credito / pagamenti** | **Eccellente** | Nessun dato di carta tocca mai il backend. Vedi §2. |
| 🔒 Sicurezza applicativa | Forte | Auth, RLS, validazione input, gestione segreti tutte solide. |
| 🟠 Hardening DB (advisor) | Buono dopo fix | 6 finding WARN risolti o ridotti in questo intervento. Vedi §5. |
| 🟡 Performance | Buona (a scala: attenzione) | Nessun problema con i volumi attuali; ottimizzazioni RLS rinviate. Vedi §4. |

Nessuna vulnerabilità **critica** o **high** trovata.

---

## 2. 💳 Sicurezza delle carte di credito (priorità n.1) — ECCELLENTE

**I dati di carta (PAN, CVV, scadenza) non transitano e non sono mai memorizzati dal backend.**

- **Stripe Hosted Checkout**: l'inserimento carta avviene su dominio Stripe; il backend riceve solo ID-token
  (`stripe_session_id`, `stripe_payment_intent`, `stripe_charge_id`, …). PCI-DSS demandato a Stripe.
  Verificato sul DB live: **nessuna colonna** contiene numeri di carta/CVV in alcuna tabella.
- **Importi ricalcolati server-side** (`app/api/stripe/checkout/route.ts:175-251`): prezzi dal DB, sconto coupon
  ri-validato (`validateCoupon`), spedizione e sconto ritiro ricalcolati. Gli importi inviati dal client sono
  **ignorati** (commento di sicurezza esplicito alle righe 48-58). → ora coperto da test, vedi §3.
- **Webhook** (`app/api/stripe/webhook/route.ts:36-73`): firma verificata con `constructEvent`; idempotenza
  event-level via `stripe_event_log` (con riprocessamento corretto dei tentativi falliti) e order-level via unique index.
- **Payout/Refund** (`lib/stripe/payout.ts`): pattern SCT multi-seller, `idempotencyKey` sui transfer, claw-back su
  refund/dispute, commissione 8% tracciata per ordine (`application_fee_cents`/`seller_payout_cents`).
- **Funzioni di stato ordine `SECURITY DEFINER`** (`verify_pickup_code`, `verify_delivery_code`, `cancel_order`,
  `seller_reject_order`, `rider_release_order`): **ispezionate sul DB live** — tutte applicano controlli interni su
  `auth.uid()` (proprietario/rider/venditore) + lockout brute-force sui codici a 6 cifre (5 tentativi → 15 min).
  Nessun IDOR.
- **Segreti**: chiavi in env (gitignored), `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` solo server-side; nessuna
  chiave hardcoded.

**Raccomandazioni (non bloccanti):**
- Abilitare **3D Secure** (SCA) e **Stripe Radar** dal dashboard Stripe per riduzione frodi.
- Aggiornare la `apiVersion` di Stripe (`lib/stripe/client.ts:16`, `2024-06-20`) in ambiente di staging.

---

## 3. Test automatici aggiunti (regressione sui controlli che proteggono il denaro)

Nuovi unit test (girano in `npm run test`, sempre in CI):

| File | Cosa garantisce |
|---|---|
| `tests/unit/stripe-fee.test.ts` | Commissione = 8% esatto, arrotondamenti corretti, fee+payout = totale. |
| `tests/unit/api-stripe-checkout.test.ts` | **Anti-tampering**: prezzo unitario dal DB; spedizione e sconti ricalcolati server-side; sconto coupon da `validateCoupon`; clamp difensivo; 400/409 su mismatch venditore/stock/coupon; 403 email non confermata; 503 Stripe assente. |
| `tests/unit/api-stripe-webhook-signature.test.ts` | Webhook con firma falsa → 400; header firma assente → 503. |
| `tests/unit/api-stripe-webhook-idempotency.test.ts` | Evento nuovo processato; duplicato già processato → no-op; duplicato non completato → riprocessato. |

Suite completa: **450 test verdi** (typecheck + lint + test puliti).

---

## 4. Performance

Volumi attuali ridotti (≈243 prodotti, 19 ordini, 20 profili) → nessun problema percepibile oggi. Advisor performance:

- 🟡 **31 conflitti di "multiple permissive policies"** (lint `0006`, 155 righe ×5 ruoli) su `products`/`orders`/`profiles`/`order_items`/`returns`: più policy permissive valutate per ogni SELECT. Impatto a scala. **Non risolto qui** (consolidare le policy tocca il controllo accessi → richiede test di regressione RLS dedicati).
- 🔵 **74 "unused index"** (lint `0005`): in gran parte indici a copertura delle FK (aggiunti apposta da `fk_covering_indexes`). "Inutilizzati" riflette il basso traffico — **da NON droppare** ora.
- 🔵 Auth con 10 connessioni assolute (`auth_db_connections_absolute`): passare a strategia percentuale a scala.
- ✅ Già risolti in passato: `auth_rls_initplan` = 0, foreign key non indicizzate = 0.

Altre raccomandazioni performance (architetturali, fuori ambito di questo intervento): cache catalogo (Redis/HTTP),
cursor pagination sulle liste pubbliche, budget di bundle.

---

## 5. Hardening DB implementato — migrazione `070_storage_and_rls_hardening.sql`

Migrazione **idempotente**, committata nel repo **e applicata al DB live** via MCP. Esito advisor di sicurezza:

| Advisor | Prima | Dopo |
|---|---|---|
| `0024` policy RLS `WITH CHECK (true)` | 3 | **0** ✅ |
| `0025` bucket pubblici che permettono il listing | 3 | **0** ✅ |
| `0028` SECURITY DEFINER eseguibili da anon | 4 | **3** (rimossa `touch_loyalty_streak`) ✅ |

Interventi:
1. **Limiti upload server-side** sui bucket `products`/`reviews`/`stories`: `file_size_limit = 10 MiB` +
   `allowed_mime_types` (allowlist immagini raster). Prima gli upload via SDK avevano solo controlli client-side
   bypassabili; ora file enormi e non-immagini (incl. **SVG/HTML**, rischio XSS) sono rifiutati a livello storage.
2. **Blocco enumerazione bucket pubblici**: le policy SELECT "larghe" (`bucket_id = …`) permettevano di elencare
   tutti i file. Sostituite con policy **owner-scoped** (`cartella = auth.uid()`). La visualizzazione via URL pubblico
   **non passa da RLS** (bucket `public=true`), quindi le immagini restano visibili — come già avviene per i bucket
   `avatars`/`stores`, da sempre senza policy SELECT.
3. **Policy `WITH CHECK (true)`** rese non-banali senza rompere i flussi: `disputes_admin_update` (mirror dell'`USING`
   admin); `contact_messages` e `newsletter_subscribers` (vincoli che rispecchiano i CHECK di colonna + clausola
   anti-spoofing `user_id`, che impedisce a un insert diretto PostgREST di attribuire la riga a un altro utente).
4. **Revoca EXECUTE ad `anon`** su `touch_loyalty_streak` (chiamata solo da contesto autenticato).

---

## 6. Raccomandazioni residue (report-only)

Intenzionalmente **non** modificate (rischio o configurazione esterna):

| Tema | Perché non toccato | Azione |
|---|---|---|
| **Leaked Password Protection disabilitata** | Impostazione Auth, non SQL | **Abilitare dal dashboard**: Authentication → Sign In / Providers → Password → "Leaked password protection" (HaveIBeenPwned). Link: https://supabase.com/docs/guides/auth/password-security |
| `is_admin`, `track_story_view`, `get_referral_leaderboard` eseguibili da anon (`0028`) | `is_admin` è usata nelle policy RLS `USING` di tabelle leggibili da anon (`products`, `group_orders`, `rider_reviews`) → revocare anon **romperebbe il catalogo pubblico**; `track_story_view` è chiamata dal viewer storie anonimo | Lasciare; valutare `SECURITY INVOKER` con test |
| RPC ordine eseguibili da authenticated (`0029`) | Pattern corretto: `DEFINER` + check interni `auth.uid()` | Nessuna |
| `pg_trgm` nello schema `public` (`0014`) | Spostarlo può rompere indici trigram/full-text | Spostare con test in staging |
| 7 tabelle `rls_enabled_no_policy` (`0008`, INFO) | Per lo più intenzionale (accesso solo `service_role`: `stripe_event_log`, `email_queue`, …) | Documentare/aggiungere deny esplicito |
| 31 "multiple permissive policies" (`0006`) | Consolidamento tocca access-control | Pianificare con test RLS |
| 74 "unused index" (`0005`) | Indici FK su DB a basso traffico | Rivalutare a scala |
| 6 vulnerabilità npm "low" | `npm audit` al momento dell'install | `npm audit` periodico |

Altri spunti emersi dall'audit del codice (bassa priorità): validare l'IP da `X-Forwarded-For` solo dietro proxy
fidato (ok su Render); anti-abuso (Cloudflare Turnstile) su contact/newsletter va nel route handler, non in RLS.

---

## 7. Verifica eseguita

- `npm run verify` → typecheck + lint puliti, **450 test verdi** (inclusi i 4 nuovi file).
- `migrations/070` applicata al DB live (idempotente); riletto lo stato: bucket con limiti+MIME, policy storage
  owner-scoped, `with_check` di `contact`/`newsletter`/`disputes` non più `true`, `touch_loyalty_streak`
  anon=`false`/authenticated=`true`.
- `get_advisors(security)` ri-eseguito: `0024` e `0025` azzerati, `0028` ridotto.
- ⚠️ **Da confermare manualmente nel browser** (non verificabile da questo ambiente per policy di rete): che le
  immagini di prodotti/recensioni/storie carichino regolarmente e che il form contatti/newsletter funzionino. Per
  design restano invariati (URL pubblico non soggetto a RLS), ma una verifica visiva è consigliata.
