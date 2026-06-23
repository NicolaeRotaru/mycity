# FIX LEDGER — risoluzione findings AUDIT_PROFONDO_2026-06-23

**Baseline (pre-fix):** branch `claude/upbeat-fermi-26mljy` · `npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` ✅ **698/698 (79 file)**.
**Target:** ~50 finding (5🔴 di cui 🔴-5≡🟠-13 · 18🟠 · 23🟡 · 5🟢). Stato terminale = FATTO (con prova) o BLOCCATO (motivo+cosa serve).

| ID | Titolo | Sev | Stato | File toccati | Commit | Prova | Note |
|---|---|---|---|---|---|---|---|
| 🔴-1 | `authenticate()` legge profilo via anon → 403 buyer/rider | 🔴 | FATTO | lib/api/middleware.ts, tests/unit/middleware.test.ts | (vedi git) | test [🔴-1] regressione, 700/700 | profilo ora via getAdminSupabase(); conferma runtime: chiamata buyer a /api/orders/cod |
| 🔴-2 | SDI fatturazione promessa ma inesistente | 🔴 | TODO | | | | esterno/decisione |
| 🔴-3 | No test webhook Stripe + state machine | 🔴 | TODO | | | | |
| 🔴-4 | CI senza e2e/SQL + RLS auto-skip | 🔴 | TODO | | | | |
| 🟠-6 | Chargeback WON blocca payout per sempre | 🟠 | FATTO | app/api/cron/release-payouts/route.ts, tests/unit/api-cron-release-payouts-cod.test.ts | (git) | 3 test [🟠-6] | filtro PAYOUT_DISPUTE_FILTER (null o WON) sui 3 pass |
| 🟠-7 | Fee 10% grava su spedizione+delivery fee | 🟠 | TODO | | | | decisione prodotto |
| 🟠-8 | Nessun constraint ordine ≥1 item | 🟠 | TODO | | | | |
| 🟠-9 | Email best-effort, errori swallowed, no retry | 🟠 | TODO | | | | |
| 🟠-10 | send-push marca pushed_at su fallimento transitorio | 🟠 | TODO | | | | |
| 🟠-11 | send-emails fallback non idempotente | 🟠 | TODO | | | | |
| 🟠-12 | Rate-limit non condiviso multi-istanza; Upstash assente render.yaml | 🟠 | TODO | | | | |
| 🟠-13 | Moderazione AI scritta ma non cablata | 🟠 | TODO | | | | (ex 🔴-5) |
| 🟠-14 | KYC Onfido + VIES senza timeout | 🟠 | TODO | | | | |
| 🟠-15 | Nominatim geocoding dal browser | 🟠 | TODO | | | | |
| 🟠-16 | Costo AI non capato (web_search + product JSON) | 🟠 | TODO | | | | |
| 🟠-17 | Guard route group solo client-side | 🟠 | TODO | | | | |
| 🟠-18 | `/profile/**` non protetto da middleware/layout | 🟠 | TODO | | | | |
| 🟠-19 | Resilienza sottile (error/loading boundary) | 🟠 | TODO | | | | |
| 🟠-20 | `orders/[id]/return` spinner infinito su id KO | 🟠 | TODO | | | | |
| 🟠-21 | Numerazione fattura non a norma (rollover anno) | 🟠 | TODO | | | | |
| 🟠-22 | Recesso 14gg rifiutabile dal seller | 🟠 | TODO | | | | decisione legale |
| 🟠-23 | KYC/payout non scritti in audit log | 🟠 | TODO | | | | |
| 🟡-1 | `withInternalAuth` usa SERVICE_ROLE_KEY come shared secret | 🟡 | TODO | | | | |
| 🟡-2 | `/api/contact` senza CAPTCHA | 🟡 | TODO | | | | |
| 🟡-3 | `gift_cards` manca CHECK(balance<=amount) | 🟡 | TODO | | | | |
| 🟡-4 | definer-fn storiche senza search_path | 🟡 | TODO | | | | verifica runtime |
| 🟡-5 | expire-checkouts non rilascia stock varianti | 🟡 | TODO | | | | |
| 🟡-6 | refund parziale Dashboard multi-seller → no update | 🟡 | TODO | | | | |
| 🟡-7 | riconciliazione COD assi temporali diversi | 🟡 | TODO | | | | |
| 🟡-8 | `/api/track` senza consent server-side | 🟡 | TODO | | | | |
| 🟡-9 | operational-alerts non vigila email_queue backlog | 🟡 | TODO | | | | |
| 🟡-10 | logger non strutturato, no redaction PII | 🟡 | TODO | | | | |
| 🟡-11 | Sentry client beforeSend minimale + captureError context | 🟡 | TODO | | | | |
| 🟡-12 | email destinatario loggata in console in prod | 🟡 | TODO | | | | |
| 🟡-13 | export dati incompleto (chat/contact/KYC) | 🟡 | TODO | | | | |
| 🟡-14 | oblio parziale (free-text PII) | 🟡 | TODO | | | | |
| 🟡-15 | audit_logs/activity_events IP+UA senza retention | 🟡 | TODO | | | | |
| 🟡-16 | P2B manca disclosure parametri ranking | 🟡 | TODO | | | | |
| 🟡-17 | catalog-batch/status senza rate-limit | 🟡 | TODO | | | | |
| 🟡-18 | immagini ad Anthropic via url non SSRF-validate | 🟡 | TODO | | | | |
| 🟡-19 | Turnstile/email fail-open se chiave assente | 🟡 | TODO | | | | |
| 🟡-20 | env lette via process.env fuori da lib/env.ts | 🟡 | TODO | | | | |
| 🟡-21 | orfane /admin/support-chat e /profile/referral/leaderboard | 🟡 | TODO | | | | |
| 🟡-22 | seller/promotions cache-key mismatch | 🟡 | TODO | | | | |
| 🟡-23 | form critici non su RHF+zod | 🟡 | TODO | | | | |
| 🟢-1 | handleChargeRefunded charge.refunds.data senza expand | 🟢 | TODO | | | | |
| 🟢-2 | idempotenza event-level non transazionale (coupon/email) | 🟢 | TODO | | | | |
| 🟢-3 | track_sponsored_* callable da anon | 🟢 | TODO | | | | |
| 🟢-4 | n8n dichiarato ma non cablato | 🟢 | TODO | | | | |
| 🟢-5 | /store/[id]/[slug] solo canonical SEO | 🟢 | TODO | | | | atteso, no-action |

## Note di auto-analisi
- (init) Baseline pulito: typecheck/lint/test tutti verdi, 698 test. Buona rete di sicurezza.
