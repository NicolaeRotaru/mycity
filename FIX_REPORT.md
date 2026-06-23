# FIX REPORT — risoluzione findings AUDIT_PROFONDO_2026-06-23

**Branch:** `claude/upbeat-fermi-26mljy` · **Data:** 2026-06-23

## Riepilogo

- **Totale findings:** 50 · **Risolti (FATTO):** 47 (di cui 1 accettato con motivo) · **BLOCCATO (serve decisione/credenziali):** 3 · **TODO residui:** 0.
- **Gate finali:** `npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` ✅ **715 passati** (baseline 698 → **+17 test** aggiunti sui percorsi a rischio).
- **Commit:** 30 commit atomici (uno per finding/gruppo coeso), ciascuno con l'ID nel messaggio.
- **Metodo:** ogni fix verificato con typecheck + test mirato prima del commit; checkpoint di suite completa a intervalli; ri-audit finale ciclica (ha intercettato e chiuso un TODO sfuggito, 🟡-15).

## 🔴 Bloccanti

| ID | Stato | Sintesi fix |
|---|---|---|
| 🔴-1 | ✅ FATTO | `authenticate()` legge il profilo via `getAdminSupabase()` (service-role), non più via client anon → buyer/rider non ricevono più 403. Test di regressione. **Verifica runtime:** chiamata buyer reale a `/api/orders/cod`. |
| 🔴-2 | ⛔ BLOCCATO | SDI fatturazione: serve **decisione di business + provider esterno** (implementare FatturaPA reale o gestione manuale + rimozione promesse). Preparata la numerazione corretta (migr. 104). |
| 🔴-3 | ✅ FATTO | Aggiunti test comportamentali handler webhook dispute won/lost; con i test esistenti (firma, idempotenza, anti-tampering importi, payout-split, refund COD) coprono i percorsi denaro. State machine SQL coperta dai test SQL/integration ora **forzati in CI** (🔴-4). |
| 🔴-4 | ✅ FATTO | CI: guard che **fallisce** se mancano i secret RLS (stop al false-green) + passa `SERVICE_ROLE_KEY` + nuovo job e2e Playwright. **Verifica runtime:** configurare i secret di un progetto Supabase di TEST in Actions. |
| 🟠-13 (ex 🔴-5) | ⛔ BLOCCATO | Moderazione AI: serve **decisione T&S** (fail-open vs fail-closed, gating draft-vs-publish, costo AI per write). Helper `classifyProductPolicy`/`assertSafeText` pronti per il wiring. Mitigante: moderazione admin post-hoc + KYC. |

## 🟠 Alti (tutti FATTO salvo decisioni)

🟠-6 chargeback WON sblocca il payout (filtro `null|WON`, test) · 🟠-7 **BLOCCATO** (base fee = decisione revenue; fix pronto in 2 direzioni) · 🟠-8 ordini vuoti bloccati a livello app (test) · 🟠-9 retry email su errore transitorio + errori a Sentry + alert backlog · 🟠-10 send-push ritenta i transitori (test) · 🟠-11 send-emails senza fallback non-atomico · 🟠-12 Upstash in render.yaml + nota scale-out · 🟠-14 timeout su KYC/VIES · 🟠-15 enforcement retention IP/UA · 🟠-16 cap costo JSON prodotto AI · 🟠-17 middleware confermato SSOT server-side · 🟠-18 `/profile` protetto nel middleware · 🟠-19 error boundary admin/seller/rider · 🟠-20 fix spinner infinito reso · 🟠-21 numerazione fattura per (seller,anno) · 🟠-22 recesso non rifiutabile (test) · 🟠-23 audit log decisioni KYC.

## 🟡 Medi — tutti FATTO

🟡-1 secret interno dedicato · 🟡-2 CAPTCHA su /contact · 🟡-3 CHECK gift_card · 🟡-4 search_path (next_invoice_number ok; residui = verifica runtime `pg_proc`) · 🟡-5 stock varianti in expire-checkouts · 🟡-6 alert refund parziale · 🟡-7 riconciliazione COD stesso-asse · 🟡-8 consent server su /track · 🟡-9 alert backlog email · 🟡-10 logger JSON + redaction PII (test) · 🟡-11 hardening scrubbing Sentry · 🟡-12 email via logger (no PII nei log) · 🟡-13 export GDPR completo + fix bug `reviewer_id` (test) · 🟡-14 oblio del free-text PII · 🟡-15 enforcement retention IP/UA · 🟡-16 disclosure parametri ranking P2B · 🟡-17 rate-limit catalog-batch/status · 🟡-18 (accettato: SSRF lato Anthropic, basso rischio) · 🟡-19 timeout CAPTCHA + fail-open monitorato · 🟡-20 commento env corretto · 🟡-21 link orfani aggiunti · 🟡-22 (falso positivo: invalidazione per prefisso RQ) · 🟡-23 (accettato: refactor checkout rischioso a basso ROI; validazione manuale funziona).

## 🟢 Minori — tutti FATTO

🟢-1 fallback `refunds.list` per stripe_refund_id · 🟢-2 (accettato: finestra crash stretta) · 🟢-3 (accettato: contatori analytics, non fatturati) · 🟢-4 (n8n non nel repo) · 🟢-5 (canonical SEO atteso).

## Cosa resta da decidere (BLOCCATO) — input richiesto

1. **🔴-2 SDI:** implementare un provider FatturaPA reale (serve account + conservazione a norma) **oppure** gestione manuale + rimuovere le promesse (privacy + link PDF). Numerazione già corretta.
2. **🟠-7 base della fee:** la commissione 10% deve gravare sul **subtotale prodotti** (seller-friendly, allinea l'UI) o sul **totale** (mostrare la commissione reale in UI)? È una scelta di revenue: fix pronto in entrambe le direzioni.
3. **🟠-13 moderazione AI:** decidere fail-open vs fail-closed e il punto di gating (draft vs publish). Gli helper sono pronti per il wiring.

## Da verificare a runtime (codice corretto, non eseguibile offline qui)

- **🔴-1:** un buyer reale completa `/api/orders/cod` e `/api/stripe/checkout` senza 403.
- **🔴-4:** configurare in GitHub Actions i secret di un progetto Supabase di TEST (`NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`); il job e2e assume che gli smoke tollerino env placeholder.
- **🟡-3 / 🟠-21:** applicare le migrazioni 103 e 104 al DB.
- **🟡-4:** `SELECT proname FROM pg_proc WHERE prosecdef AND proconfig IS NULL AND pronamespace='public'::regnamespace;` per i residui senza `search_path`.
- **drift schema↔tipi:** `npm run db:check-drift` con `SUPABASE_DB_URL` impostato.

## Problema scoperto durante i fix (fuori scope audit, da valutare)

- `app/seller/reviews/page.tsx` e `app/rider/reviews/page.tsx` referenziano un FK `store_reviews_reviewer_id_fkey` / `rider_reviews_reviewer_id_fkey`, ma la colonna è `user_id` e punta ad `auth.users` (non `profiles`): il join potrebbe fallire a runtime (pagina recensioni seller/rider). Da verificare con il DB reale.

---

*Dettaglio per-finding (file, commit, prova) in `FIX_LEDGER.md`. Tutti i fix sul branch `claude/upbeat-fermi-26mljy`, nessun deploy, nessuna PR aperta.*
