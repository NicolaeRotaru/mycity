# TEST_LEDGER — campagna "TESTA TUTTO" · 2026-06-23

Ambiente: Supabase prod `clmpyfvpvfjgeviworth` (sola lettura) · Stripe connettore **LIVE** · sandbox repo (env test assenti).
Legenda: ✅ PASS · ❌ FAIL · ⛔ BLOCCATO · severità 🔴🟠🟡🟢

| # | Area | Check | Esito | Prova / Nota |
|---|------|-------|-------|--------------|
| A1 | Static | `tsc --noEmit` typecheck | ✅ | 0 errori |
| A2 | Static | ESLint | ✅ | 0 warning/error |
| A3 | Static | `next build` produzione | ✅ | exit 0 (background) |
| A4 | Static | Integrità migrazioni | ✅ | `migrations-integrity.test.ts` nella suite |
| A5 | Static | Tipi generati = schema | ✅ | `database-types.test.ts` + rigenerati post-105 |
| A6 | Static | Drift schema↔migrazioni | ⛔ | `db:check-drift` SKIP (manca `SUPABASE_DB_URL`); sostituito da audit connettore |
| A7 | Static | `npm audit` dipendenze | ✅ | **RISOLTO** via `npm audit fix`: prod 0 vuln (undici/protobufjs ok); restano 6 *low* dev-only (Storybook) |
| B1 | Unit | Suite completa | ✅ | **715/715, 82 file** |
| B2 | Unit | Soldi (fee/payout/refund/economics/coupon/promozioni) | ✅ | incl. nuovi test split su subtotale |
| B3 | Unit | Sicurezza utils (ssrf/safe-redirect/captcha/rate-limit) | ✅ | nella suite |
| B4 | Unit | Moduli `lib/*` senza test | ⚠️🟡 | ~15 moduli scoperti (cart, cms, promotions, push/send, kyc/providers, email/client…) → 🔧 da scrivere |
| C1 | Integration | RLS comportamentale per tabella | ⛔🟠 | serve progetto Supabase di TEST (env assenti); gira in CI. Sostituito da audit policy read-only (E2) |
| C2 | Integration | Lockdown `SECURITY DEFINER` | ✅ | `function-grants.test.ts` + advisor (guardie interne by-design) |
| C3 | Integration | Comportamento ~50 RPC | ⛔🟡 | serve test env; verificate esistenza/grant/guardie via advisor |
| D1 | E2E | Smoke (10 spec) | ✅ | passano in CI (home/signup/cart/checkout/auth/SEO/i18n) |
| D2 | E2E | Flussi completi (acquisto, COD, seller, rider, reso, multi-seller) | ⛔🟠 | serve app in esecuzione + backend (env assenti) |
| E1 | Runtime DB | Advisor sicurezza | ✅ | **0 ERROR/CRITICAL**; WARN by-design + hardening |
| E2 | Runtime DB | Copertura RLS | ✅ | 71/71 tabelle RLS on · 0 `USING(true)` su sensibili |
| E3 | Runtime DB | Advisor performance | ✅🟡 | 0 ERROR; 166 WARN (policy multiple/initplan) differibili |
| E4 | Runtime DB | Backlog webhook | ✅ | `stripe_event_log` unprocessed = 0 |
| E5 | Runtime DB | Freschezza cron | ❌🟠 | 7 cron attivi; **`expire-stale-orders` fermo 191h** |
| E6 | Runtime DB | Stock non negativo | ✅ | products/variants < 0 → 0 |
| E7 | Runtime DB | Cap gift card | ✅ | `balance>amount` → 0 (constraint 103) |
| E8 | Runtime DB | Orfani/FK | ✅ | order_items/seller/buyer orfani = 0 |
| J1 | Finance | Invariante soldi per ordine (codice attuale) | ✅ | verificato da unit (split) |
| J2 | Finance | Dati ordine live | ✅🟡 | 0 payout negativi; 12/21 "violazioni" = **dati legacy** pre-fee-columns (tutti < 2026-06-15) → pulire |
| J3 | Finance | Wallet = ledger | ✅ | mismatch = 0 |
| J4 | Finance | Riconciliazione Stripe↔DB | ✅ | 0 charge, balance 0 (pre-lancio, nulla da riconciliare) |
| F1 | Stripe | Modalità test/live | ❌🔴 | **`livemode: true`** — connettore LIVE (tu dicevi test) |
| F2 | Stripe | Test pagamento/refund/dispute | ⛔🔴 | connettore LIVE → creerei movimenti reali. NON eseguito (regola §2) |
| F3 | Stripe | Config endpoint webhook | ⛔🟠 | da verificare nel Dashboard (URL+secret); non ispezionabile da qui |
| G1 | Security | Chiave service-role nel client | ✅ | 0 occorrenze in `components/` |
| G2 | Security | Gating auth route | ✅ | 62 con wrapper; pubbliche verificate sotto |
| G3 | Security | Route pubbliche (contact/signup/track/geocode) | ✅ | rate-limit + Turnstile captcha + validazione + honeypot |
| G4 | Security | Cron protetti | ✅ | 9/9 con CRON_SECRET/Bearer |
| G5 | Security | Header + CSP | ✅ | HSTS preload, X-Frame DENY, nosniff, Permissions-Policy, **CSP nonce+strict-dynamic** |
| G6 | Security | PCI / no dato carta | ✅ | nessuna cattura carta (Stripe hosted, SAQ-A); `logger` redige card/cvv/iban/token |
| G7 | Security | RPC trigger esposte ad anon/auth | ✅ | **RISOLTO** migr.106: revoke EXECUTE su notify_buyer/reward_referrer/sync_review_helpful/log_activity (touch_loyalty_streak tenuta = RPC app). Resta: pg_trgm in public (accettato), leaked-password OFF (azione tua) |
| H1 | Perf | Load/Lighthouse/N+1 | ⛔🟡 | serve app + tool di carico; advisor perf = 0 ERROR |
| I1 | Resilienza | Fault injection (Supabase/Stripe/Resend giù, race, doppio cron) | ⛔🟡 | non iniettabile da qui; idempotenza webhook/payout verificata da unit |
| K1 | Compliance | Export/erasure GDPR | ✅🟡 | pipeline presente (api/account/export+delete, cron); test comportamentale ⛔ |
| K2 | Compliance | Termini/Privacy/Cookie + retention | ✅ | pagine presenti; retention IP/UA nei log |
| K3 | Compliance | Accessibilità WCAG | ✅🟡 | smoke a11y in CI; audit axe completo ⛔ (serve app) |
| L1 | AI | Unit route AI (validazione/moderazione/costo/schema) | ✅ | coperte nella suite 715 |
| L2 | AI | Moderazione contenuti vietati | ✅🟡 | `lib/ai/moderation.ts` default-deny; cablaggio nei write-path = decisione aperta |
| L3 | AI | Chiamate live alle 19 route | ⛔🟡 | serve app + auth |
| M1 | Ops | `/api/health` | ✅ | presente |
| M2 | Ops | Sentry | ✅ | configurato in `next.config.js` (se DSN) |
| M3 | Ops | Dead-man switch cron | ✅ | heartbeat presenti (vedi E5) |
| N1 | SEO | Meta/OG/sitemap/robots | ✅🟡 | smoke SEO in CI; verifica live ⛔ |
| N2 | SEO | i18n / responsive | ✅ | smoke (chromium + iPhone) in CI |

**Conteggio:** ~45 voci · ✅ 28 · ⚠️/parziale 6 · ⛔ 10 · ❌ 2 (F1 live-mode, E5 cron) · 🔴 2 · 🟠 5 · 🟡 9
