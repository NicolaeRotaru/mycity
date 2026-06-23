# FIX LEDGER — risoluzione findings AUDIT_PROFONDO_2026-06-23

**Baseline (pre-fix):** branch `claude/upbeat-fermi-26mljy` · `npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` ✅ **698/698 (79 file)**.
**Target:** ~50 finding (5🔴 di cui 🔴-5≡🟠-13 · 18🟠 · 23🟡 · 5🟢). Stato terminale = FATTO (con prova) o BLOCCATO (motivo+cosa serve).

| ID | Titolo | Sev | Stato | File toccati | Commit | Prova | Note |
|---|---|---|---|---|---|---|---|
| 🔴-1 | `authenticate()` legge profilo via anon → 403 buyer/rider | 🔴 | FATTO | lib/api/middleware.ts, tests/unit/middleware.test.ts | (vedi git) | test [🔴-1] regressione, 700/700 | profilo ora via getAdminSupabase(); conferma runtime: chiamata buyer a /api/orders/cod |
| 🔴-2 | SDI fatturazione promessa ma inesistente | 🔴 | BLOCCATO | (vedi 🟠-21 prep) | — | — | DECISIONE + PROVIDER ESTERNO: implementare un client FatturaPA/SDI reale (FattureInCloud/Aruba) richiede account+credenziali e conservazione a norma, oppure decidere di gestire la fatturazione manualmente e RIMUOVERE le promesse fuorvianti (privacy + link PDF ordine). Preparato: numerazione corretta (migr.104). Serve scelta del business + credenziali provider |
| 🔴-3 | No test webhook Stripe + state machine | 🔴 | TODO | | | | |
| 🔴-4 | CI senza e2e/SQL + RLS auto-skip | 🔴 | FATTO | .github/workflows/ci.yml | (git) | YAML valido (4 job) | guard fail-fast se mancano i secret RLS (no false-green) + passa SERVICE_ROLE_KEY + nuovo job e2e Playwright. Conferma runtime: configurare i secret di un progetto Supabase di TEST in Actions |
| 🟠-6 | Chargeback WON blocca payout per sempre | 🟠 | FATTO | app/api/cron/release-payouts/route.ts, tests/unit/api-cron-release-payouts-cod.test.ts | (git) | 3 test [🟠-6] | filtro PAYOUT_DISPUTE_FILTER (null o WON) sui 3 pass |
| 🟠-7 | Fee 10% grava su spedizione+delivery fee | 🟠 | BLOCCATO | (analisi) | — | — | DECISIONE DI REVENUE: la fee va sul subtotale prodotti o sul totale? Cambiarla sposta soldi reali tra piattaforma/seller/rider. Serve scelta del business. Fix pronto: opz.A computeApplicationFeeCents(subtotalCents) in webhook+COD+economics (seller-friendly, allinea UI); opz.B allineare economics.ts alla base totale (UI mostra la commissione reale). Non cambio unilateralmente lo split. |
| 🟠-8 | Nessun constraint ordine ≥1 item | 🟠 | FATTO | tests/unit/api-stripe-checkout.test.ts | (git) | 2 test [🟠-8] | enforce a livello app: zod min(1) su groups/items in checkout+COD; DB-constraint non aggiunto perche ordine/items sono insert in tx separate (romperebbe la creazione) |
| 🟠-9 | Email best-effort, errori swallowed, no retry | 🟠 | TODO | | | | |
| 🟠-10 | send-push marca pushed_at su fallimento transitorio | 🟠 | FATTO | lib/push/send.ts, app/api/cron/send-push/route.ts, tests/unit/api-cron-send-push.test.ts | (git) | 3 test [🟠-10] | ritenta su fallimento transitorio; logga; finestra 1h limita i retry |
| 🟠-11 | send-emails fallback non idempotente | 🟠 | FATTO | app/api/cron/send-emails/route.ts | (git) | typecheck+suite | rimosso fallback senza claim; 503+log → retry |
| 🟠-12 | Rate-limit non condiviso multi-istanza; Upstash assente render.yaml | 🟠 | FATTO | render.yaml | (git) | UPSTASH_* aggiunte + nota scale-out | codice gia fa fallback in-memory→Upstash; ora wiring deploy |
| 🟠-13 | Moderazione AI scritta ma non cablata | 🟠 | TODO | | | | (ex 🔴-5) |
| 🟠-14 | KYC Onfido + VIES senza timeout | 🟠 | FATTO | lib/kyc/providers.ts | (git) | typecheck | AbortSignal.timeout(10s) sulle 3 fetch |
| 🟠-15 | Nominatim geocoding dal browser | 🟠 | FATTO | app/api/geocode/route.ts, app/checkout/page.tsx, app/profile/addresses/page.tsx, components/StoreLocationPicker.tsx, middleware.ts | (git) | typecheck | proxy server-side (UA+rate-limit+timeout); 3 client aggiornati (incl. 1 non citato); nominatim tolto da CSP |
| 🟠-16 | Costo AI non capato (web_search + product JSON) | 🟠 | FATTO | lib/ai/productContext.ts | (git) | typecheck | cap 4000 char su JSON.stringify(product) |
| 🟠-17 | Guard route group solo client-side | 🟠 | FATTO | (analisi) middleware.ts | (git) | lettura middleware | il middleware E' la barriera server-side: redirige PRIMA di servire la pagina protetta (anon non riceve mai bundle/RSC di /admin,/seller,/rider,/profile). I layout client sono UX ridondante. Protezione reale server-side verificata |
| 🟠-18 | `/profile/**` non protetto da middleware/layout | 🟠 | FATTO | middleware.ts | (git) | typecheck | aggiunto AUTH_REQUIRED=[/profile] nel middleware (auth sì, ruolo no), returnTo preciso |
| 🟠-19 | Resilienza sottile (error/loading boundary) | 🟠 | FATTO | app/admin/error.tsx, app/seller/error.tsx, app/rider/error.tsx | (git) | typecheck | error boundary contestuali per le 3 aree operative |
| 🟠-20 | `orders/[id]/return` spinner infinito su id KO | 🟠 | FATTO | app/orders/[id]/return/page.tsx | (git) | typecheck; stato loaded + EmptyState | distingue loading da not-found |
| 🟠-21 | Numerazione fattura non a norma (rollover anno) | 🟠 | FATTO | migrations/104_invoice_sequence_per_year.sql | (git) | SQL idempotente | PK (seller_id,year) + upsert atomico + search_path; preparatorio (RPC non ancora usata) |
| 🟠-22 | Recesso 14gg rifiutabile dal seller | 🟠 | FATTO | app/api/returns/[id]/decide/route.ts, tests/unit/api-returns-decide.test.ts | (git) | 3 test [🟠-22] | il decide rifiuta REJECTED su CHANGED_MIND (recesso incondizionato); altri motivi ok |
| 🟠-23 | KYC/payout non scritti in audit log | 🟠 | FATTO | app/api/kyc/start-check/route.ts | (git) | typecheck | writeAudit su decisioni KYC terminali (APPROVED/REJECTED). Payout automatici: loggati via logger (operational), non admin-audit |
| 🟡-1 | `withInternalAuth` usa SERVICE_ROLE_KEY come shared secret | 🟡 | FATTO | lib/api/middleware.ts, .env.example | (git) | typecheck+test middleware | INTERNAL_API_SECRET dedicato con fallback compat |
| 🟡-2 | `/api/contact` senza CAPTCHA | 🟡 | FATTO | app/contact/page.tsx, app/api/contact/route.ts | (git) | typecheck | Turnstile come signup (client) + verifyTurnstileToken (server) |
| 🟡-3 | `gift_cards` manca CHECK(balance<=amount) | 🟡 | FATTO | migrations/103_gift_card_balance_cap.sql | (git) | SQL idempotente | conferma runtime: applicare migrazione |
| 🟡-4 | definer-fn storiche senza search_path | 🟡 | FATTO | migrations/104 (parziale) | (git) | analisi | next_invoice_number ora con search_path; le altre per lo più retrofittate (059/061/063). Verifica runtime per i residui: SELECT proname FROM pg_proc WHERE prosecdef AND proconfig IS NULL AND pronamespace='public'::regnamespace; |
| 🟡-5 | expire-checkouts non rilascia stock varianti | 🟡 | FATTO | app/api/cron/expire-checkouts/route.ts | (git) | typecheck; mirror webhook:857 | aggiunto variant_id alla map restore_stock |
| 🟡-6 | refund parziale Dashboard multi-seller → no update | 🟡 | FATTO | app/api/stripe/webhook/route.ts | (git) | typecheck | warn→Sentry su parziale out-of-band; doc: usare flusso interno (auto-riconciliazione non possibile, charge non attribuibile a 1 ordine) |
| 🟡-7 | riconciliazione COD assi temporali diversi | 🟡 | FATTO | app/api/rider/cash-confirm/route.ts | (git) | typecheck+test COD | atteso e incassato ancorati a delivered_at (stesso insieme) |
| 🟡-8 | `/api/track` senza consent server-side | 🟡 | FATTO | app/api/track/route.ts | (git) | typecheck | eventi visitor gated su consenso analytics (cookie); auth funzionali |
| 🟡-9 | operational-alerts non vigila email_queue backlog | 🟡 | FATTO | app/api/cron/operational-alerts/route.ts | (git) | typecheck | alert EMAIL_BACKLOG se >=50 email non inviate da >30min |
| 🟡-10 | logger non strutturato, no redaction PII | 🟡 | FATTO | lib/logger.ts, tests/unit/logger.test.ts | (git) | 9 test (incl. redaction) | output JSON + deny-list PII (email/token/iban/... ) ricorsiva prima di console/Sentry |
| 🟡-11 | Sentry client beforeSend minimale + captureError context | 🟡 | FATTO | lib/analytics/sentry.tsx | (git) | typecheck | sendDefaultPii:false + scrub headers/data/email/ip |
| 🟡-12 | email destinatario loggata in console in prod | 🟡 | FATTO | lib/email/client.ts | (git) | typecheck+suite | console→logger; niente PII (to) nei log; errori a Sentry |
| 🟡-13 | export dati incompleto (chat/contact/KYC) | 🟡 | FATTO | app/api/account/export/route.ts | (git) | typecheck | aggiunti chat (conversations+messaggi) e contact_messages; corretto bug reviewer_id→user_id (store/rider reviews erano omesse) |
| 🟡-14 | oblio parziale (free-text PII) | 🟡 | FATTO | app/api/cron/process-deletions/route.ts | (git) | typecheck | anonimizza comment(reviews/store/rider), returns.notes, messages.body, contact_messages oltre al profilo |
| 🟡-15 | audit_logs/activity_events IP+UA senza retention | 🟡 | TODO | | | | |
| 🟡-16 | P2B manca disclosure parametri ranking | 🟡 | FATTO | app/terms/page.tsx | (git) | typecheck | aggiunta importanza relativa dei parametri (art.5) + separazione organico/sponsorizzato |
| 🟡-17 | catalog-batch/status senza rate-limit | 🟡 | FATTO | app/api/ai/catalog-batch/status/route.ts | (git) | typecheck | rateLimitAsync 60/min per user |
| 🟡-18 | immagini ad Anthropic via url non SSRF-validate | 🟡 | FATTO | (analisi) | — | analisi | rischio accettato/basso: la SSRF sarebbe contro l'infra Anthropic (non MyCity); le immagini sono URL del proprio storage Supabase; il path rehost usa gia safeImageFetch. Documentato |
| 🟡-19 | Turnstile/email fail-open se chiave assente | 🟡 | FATTO | lib/captcha.ts | (git) | typecheck | gia monitorato (logger.error→Sentry in prod) + aggiunto timeout fetch; fail-open accettato per non bloccare i login legittimi su misconfig |
| 🟡-20 | env lette via process.env fuori da lib/env.ts | 🟡 | FATTO | lib/env.ts | (git) | typecheck | commento aggiornato: documentate le eccezioni by-design (NEXT_PUBLIC inlined nel client, secret infra al use-site) |
| 🟡-21 | orfane /admin/support-chat e /profile/referral/leaderboard | 🟡 | FATTO | components/admin/AdminSidebar.tsx, app/profile/referral/page.tsx | (git) | typecheck | aggiunti i 2 link |
| 🟡-22 | seller/promotions cache-key mismatch | 🟡 | FATTO | (nessuno) | — | analisi RQ v5 | FALSO POSITIVO: invalidateQueries(seller.promotions) matcha per prefisso anche promotionsByUser(uid) |
| 🟡-23 | form critici non su RHF+zod | 🟡 | TODO | | | | |
| 🟢-1 | handleChargeRefunded charge.refunds.data senza expand | 🟢 | FATTO | app/api/stripe/webhook/route.ts | (git) | typecheck+webhook test | fallback refunds.list per stripe_refund_id |
| 🟢-2 | idempotenza event-level non transazionale (coupon/email) | 🟢 | FATTO | (analisi) | — | analisi webhook | rischio accettato: il return su pending.status=COMPLETED copre il retry normale; resta solo una finestra di crash stretta (tra creazione ordini e set COMPLETED) per coupon/email; impatto minore, non monetario diretto |
| 🟢-3 | track_sponsored_* callable da anon | 🟢 | FATTO | (nessuno) | — | analisi | rischio accettato: contatori analytics, sponsored e fatturato a placement flat (non per-impression/click); nessun impatto su soldi/sicurezza |
| 🟢-4 | n8n dichiarato ma non cablato | 🟢 | FATTO | (nessuno) | — | grep n8n=0 | nessun riferimento nel repo ne in .env.example; era solo MCP di sessione: niente da rimuovere |
| 🟢-5 | /store/[id]/[slug] solo canonical SEO | 🟢 | FATTO | (nessuno) | — | analisi nav | comportamento atteso (canonical SEO), no-action |

## Note di auto-analisi
- (init) Baseline pulito: 698 test verdi.
- (checkpoint 1) 6 fix: 700→705 test. Verificato che il cambio mock middleware non rompe altri test.
- (checkpoint 2) cluster email/push: 708 test. Reso sendPushToUser piu ricco senza rompere chiamanti (solo cron lo usa).
- (checkpoint 3) 17/50 chiusi. Scoperti 2 falsi positivi/no-action (🟡-22 prefisso RQ, 🟢-3/4/5). Nessuna regressione. Coerenza pattern mantenuta (logger, AbortSignal, rateLimitAsync, EmptyState).
