# Changelog

Tutti i cambiamenti notabili al progetto MyCity sono documentati in questo file.

Format basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/).
Versioning: [SemVer](https://semver.org/lang/it/) ma in pre-launch il numero
maggiore resta a `0.x` finche' non c'e' PMF.

## [Unreleased]

### Removed
- **Pulizia codice morto**: rimosse le route mai chiamate `app/api/auth/{signin,signup}`
  (signup/signin usano `supabase.auth` lato client con CAPTCHA nativo Supabase),
  `app/api/stripe/payout` (ridondante: il cron `release-payouts` usa direttamente
  `lib/stripe/payout`) e la pagina `app/status` (uptime mock, non linkata da nessuna parte).
  Aggiornati/rimossi i test relativi.

### Added
- **Audit log operativo** — `writeAudit` (`lib/audit.ts`) ora è invocato dalle mutation admin
  (annulla ordine, elimina utente, risolvi dispute): `audit_logs` non è più sempre vuota e
  `/admin/audit` mostra dati reali.
- Pagine prima orfane collegate in `lib/account-menu.ts`: seller → Clienti, Recensioni;
  rider → Storico, Recensioni; admin → Dispute, Audit log.
- **Stripe multi-seller checkout** — il pagamento con carta supporta ora
  carrelli con prodotti da più negozi (era bloccato → forzava COD).
  - Migration 042: tabella `pending_checkouts` (record-of-intent),
    colonna `orders.stripe_transfer_group`, stato payout
    `PENDING_SELLER_ONBOARDING`, unique index `(stripe_session_id, seller_id)`.
  - Pattern: SCT (Separate Charges and Transfers) — 1 charge sulla
    piattaforma → N transfer ai seller post-DELIVERED via
    `source_transaction=charge_id` + `transfer_group=mc_<pendingId>`.
  - `lib/stripe/client.ts`: nuovo `createMultiSellerCheckoutSession` con
    Stripe Coupon ad-hoc per coupon+pickup discount, `client_reference_id`
    + `transfer_group` nel PaymentIntent.
  - Webhook `checkout.session.completed`: legge `pending_checkouts`, crea
    N ordini con quote pro-rata di shipping/coupon/pickup, fetch
    `latest_charge` dal PI per `stripe_charge_id`.
  - Webhook `charge.refunded`: aggiorna TUTTI gli ordini legati alla
    stessa charge (multi-seller condivide PaymentIntent).
  - `/api/stripe/payout`: usa `source_transaction` (lega liquidità alla
    charge) + nuovo stato `PENDING_SELLER_ONBOARDING` quando il seller
    non ha completato Connect.
  - Nuovo cron `/api/cron/expire-checkouts` (consigliato 30 min) per
    marcare EXPIRED i pending_checkouts non pagati entro 2 h.
  - UI `PaymentMethodSelector`: rimosso `disabled` su multi-seller,
    sostituito con banner informativo "Un solo pagamento, N ordini".
- Migration 039: bucket Supabase `reviews` mancante (bug fix bucket-not-found
  in upload foto recensioni)
- Endpoint `/api/health` per uptime monitor esterni (UptimeRobot/BetterStack)
- Loading boundaries Next 14: root + product/[id] + store/[id] + orders/[id]
- Error boundaries dinamiche: product, store, orders, checkout
- Pagina `/shared-cart` per ricarica carrello da WhatsApp/Email shared link
- Backup script `scripts/backup-db.sh` con rotation 28 giorni
- Rate limit adapter Upstash Redis con fallback automatico in-memory
- Env vars mancanti documentate in `.env.example` (CRON_SECRET, POSTHOG_KEY,
  GA_MEASUREMENT_ID, VAPID, WHATSAPP_NUMBER, SUPPORT_EMAIL, UPSTASH_*)
- Sentry server-side instrumentation (`sentry.server.config.ts`,
  `sentry.edge.config.ts`, `instrumentation.ts`)
- Vitest unit tests: lib/geo, lib/safe-redirect, lib/order-status, lib/cart,
  lib/errors, lib/copy (87 test, 6 spec, ~860ms)

### Changed
- **Export dati GDPR** ora server-side completo: `/profile/settings` chiama `/api/account/export`
  (profilo, ordini buyer/seller/rider, recensioni, referral, notifiche) invece dell'export client
  parziale che interrogava `orders.buyer_id` (colonna inesistente → export incompleto).
- `lib/rate-limit.ts`: aggiunto `rateLimitAsync()` per Redis-backed, mantenuta
  `rateLimit()` sync per back-compat (25+ callsite invariati)
- PWA service worker v2: stale-while-revalidate per immagini Supabase storage,
  network-first per HTML con offline fallback, cache-first per static assets
- `next.config.js`: aggiunto `experimental.instrumentationHook: true` +
  wrap condizionale con `withSentryConfig` se DSN settato
- queryKeys factory: tutti i 191 callsite inline migrate (0 inline restanti)

### Fixed
- Migration 035: rimosso `WHERE expires_at > now()` da indici parziali
  (errore Postgres `42P17`: functions in index predicate must be IMMUTABLE)
- React hydration errors #418/423/425 in produzione:
  - `DropOfDay` countdown: state null durante SSR, parte solo client-side
  - `LiveActivityFeed` timeAgo: now passato come param, calcolato in useEffect
  - `ProductCard` badge "Nuovo": calcolato in useEffect invece di render
- Bug column name `store_logo_url` → `store_logo` (10 occurrences, 4 file):
  app/store/[id]/opengraph-image, components/SearchBar,
  components/seller/SellerHealthScore, components/home/StoryOfDay
- npm audit fix non-force: vulnerabilità da 8 → 5
- ShareCartButton: link punta finalmente a `/shared-cart` esistente

### Security
- 5 vulnerabilità npm restanti (1 mod + 4 high) richiedono Next 16 major
  upgrade (breaking: params: Promise async, cookies async). Da pianificare.

### Documentation
- `ANALISI_MARKETPLACE.md` riscritto: audit completo e verificato (codice + DB live + n8n),
  inventario funzionale per ruolo e catalogo "non usato/inutile" in 5 tier.
- README.md mantiene setup locale completo
- docs/decisions.md, runbook.md, security-audit.md, dpa-vendors.md presenti
- `.env.example` esteso a 35+ variabili documentate

---

## Wave history (riepilogo development)

### Wave 19 — 2026-05-26
- 19a: Sentry server-side instrumentation + Vitest unit tests (0 → 87 test)
- 19b: PWA caching strategy + npm audit fix + Button/COPY push

### Wave 18 — 2026-05-26
- 18a: COPY adoption + Button push 16 → 28 file
- 18b: queryKeys factory 100% (33 → 0 inline)
- 18c: checkout split 861 → 675 LOC + 3 nuovi component
- 18d: button + : any → unknown narrowing + COPY toast + E2E spec (4 nuovi)

### Wave 15-17 — 2026-05-25
- 15a: API middleware adoption massiva (4 → 18 routes)
- 15b: API middleware adoption (18 → 22)
- 16a: useLocalStorage adoption (0 → 7 components)
- 16b: API middleware adoption COMPLETE (22 → 31 routes, withInternalAuth)
- 16c: queryKeys factory adoption (0 → 30 files)
- 17a: queryKeys 30 → 68 file + : any → unknown (197 → 151)
- 17b: Button primitive adoption 5 → 16 file

### Wave 9-14 (storia precedente)
- Features marketplace incrementali: welcome credit, FTS search, wishlist
  price alert, gift cards, subscriptions, photo reviews, sponsored listings,
  achievements, cart cross-device, auto-republish, buyer public profile,
  zone codes, bulk CSV, thermal label, shop of month, events, AI description,
  admin cashback, curated lists, B2B checkout, stories, observability,
  a11y baseline, SEO, security hardening, color palette, OrderStatusBadge,
  modal/loading/console cleanup, API middleware foundation, primitives,
  Playwright, DPA docs, render.yaml, no-zoom inputs.
