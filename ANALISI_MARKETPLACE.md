# Analisi marketplace MyCity — audit completo (giugno 2026)

Audit verificato su tre fonti: **codice** (`/home/user/mycity`), **database live** (Supabase MCP,
progetto `clmpyfvpvfjgeviworth`) e **automazioni n8n** (MCP). Obiettivo: capire *tutto* ciò che la
piattaforma sa fare e isolare ciò che **non è usato / è ridondante / è inutile**.

> ⚠️ Questo documento sostituisce la versione precedente, che era **obsoleta** (descriveva un MVP a
> 23 migrazioni "senza Stripe/test/GDPR"). Oggi quelle cose ci sono tutte.

Stack: Next.js 15 (App Router) · Supabase (Postgres 17 + Auth + Storage + Realtime + RLS) ·
Stripe Connect (SCT/escrow) · Resend · Anthropic (Vision) · Leaflet/OSM · PostHog + Sentry.
Dimensioni: ~93 pagine · ~37 API route · 120 componenti · 44 moduli `lib/` · 67 migrazioni · ~62 tabelle.

---

## 1. Sintesi esecutiva — stato REALE

Il prodotto è **tecnicamente maturo** ma **pre-lancio e dormiente**: sviluppo intenso dal 21 al 29
maggio 2026, poi fermo. Quasi tutti i dati sono di test. Questo è il contesto chiave: la maggior
parte delle funzionalità **non è rotta, è solo priva di traffico**.

| Metrica (DB live) | Valore |
|---|---|
| Utenti | 20 → 16 seller · 2 buyer · **1 rider** · 1 admin (16 approvati, 4 pending) |
| Prodotti / categorie | 242 / 14 |
| Ordini | 19 → 15 CANCELED, 4 DELIVERED · pagamento: 1 carta, 6 COD, 12 null |
| Pagamenti Stripe reali | 1 charge · 1 PAID (9 FAILED, 9 PENDING) |
| KYC / Stripe Connect | 0 documenti caricati · 1 seller con account Connect |
| Fatture / dispute / resi | 0 / 0 / 1 |
| Lead commerciali (`merchants_leads`) | 407 (tutti `to_contact`, solo 7 con email) |
| Ultimo ordine · uptime · KPI | 29 mag · 27 mag · 26 mag |

---

## 2. Cosa SA FARE (inventario funzionale)

### Buyer
Scoperta (home ricca, ricerca FTS + filtri, `/near` GPS, `/stores`, vetrina negozio, scheda prodotto
con recensioni/correlati/Schema.org); carrello multi-negozio (localStorage + sync cross-device);
checkout multi-seller con **Stripe carta** o **contrassegno (COD)**, coupon, ritiro in negozio,
carrello condivisibile; tracking ordine con **timeline + mappa rider live (Realtime)** + codici/QR;
**reso**, **dispute**, **recensioni** (prodotto/negozio/rider); preferiti, liste curate, gruppi
d'acquisto, chat (con venditore e con assistenza), notifiche, profilo pubblico `/u/[handle]`;
referral €5 + leaderboard, gift card, **loyalty** (punti+tier), achievement/badge, abbonamenti;
export dati GDPR + eliminazione account con cooldown 7gg; pagine legali/informative complete.

### Seller
Onboarding/KYC (anagrafica + P.IVA + PEC/SDI + IBAN + documenti + **verifica VIES**); CRUD prodotti
con attributi dinamici + **AI PhotoFill (Vision)** + **import CSV**; gestione ordini (QR pickup);
dashboard KPI, **earnings reali** (commissione 8% via Stripe, payout SCT), analytics, clienti,
**recensioni con risposta**, **promozioni**, **storie 24h**, **etichetta spedizione (Shippo)**,
vetrina personalizzabile (cover/accent/badge/social/annunci/orari).

### Rider
Onboarding + **KYC reale** (mezzo, targa, patente/assicurazione/HACCP con scadenze, Stripe Connect);
dashboard con **claim atomico** ordini; disponibilità (online/offline + orari + zone, su DB); mappa
navigazione; **conferma contante (foto+firma)**; **pulsante SOS**; earnings/payout; storico; recensioni.

### Admin
Dashboard, **/today** (cruscotto founder), **funnel & cohort**, utenti (approva/sospendi/elimina+KYC),
ordini (annulla+rimborsa), prodotti, coupon, negozio del mese, eventi, sponsored (CTR/CPC), cashback,
SOS rider, **dispute** (risolvi+rimborso), **audit log**, chat assistenza.

### Strato automazione ESTERNO (n8n) — fuori dal codice dell'app
13 workflow. **Attivi:** Outreach email (W2), Onboarding checklist (W4), Merchant health (W5),
KPI digest (W6), Anomaly alert (W7), Uptime monitor (W8). Popolano `merchants_leads`,
`uptime_checks`, `kpi_snapshots`. **Inattivi:** Merchant Hunter OSM, Merchant Intelligence (Groq),
Activation Coach, Group Buy Viral, 2× Telegram, Welcome email.

### Integrazioni
Stripe (checkout multi-seller SCT + Connect seller/rider + webhook + payout cron + refund/reversal/
dispute) **completo**; Resend via `email_queue`+cron; KYC con provider **mock di default** (schema
Onfido pronto) + VIES; Fatturazione SDI provider **mock** (schema FattureInCloud/Aruba pronto);
Web Push VAPID **completo** (client `PushNotificationOptIn` + server); PostHog + Sentry; 7 cron;
CI GitHub Actions; test (vitest 376 + playwright); PWA.

---

## 3. Cosa NON si usa / è inutile — 5 tier

### Tier A — codice morto/ridondante → **RIMOSSO/RISOLTO in questa pulizia**
| Elemento | Esito |
|---|---|
| `app/api/auth/signin` + `signup` | **Rimossi** — mai chiamati; signup/signin usano `supabase.auth` lato client (CAPTCHA verificato nativamente da Supabase). |
| `app/api/stripe/payout` (route HTTP) | **Rimosso** — il cron `release-payouts` importa `lib/stripe/payout` direttamente. |
| `app/api/account/export` | **Collegato (non rimosso)** — è l'export GDPR Art.20 *completo*; ora chiamato da `/profile/settings` (prima usava un export client parziale e con bug `buyer_id`). |
| `lib/audit.ts` / `/admin/audit` | **Attivato** — `writeAudit` ora è chiamato dalle 3 mutation admin (annullo ordine, elimina utente, risolvi dispute) → `audit_logs` finalmente popolata. |

### Tier B — feature COMPLETE ma mai esercitate (pre-lancio) → **NON toccare**
Tabelle a 0 righe con UI/codice pronti: recensioni (prodotto/negozio/rider), dispute, gift card,
cashback, sponsored, gruppi d'acquisto, abbonamenti, Q&A prodotti, web push (0 opt-in), referral,
eventi+RSVP, voto negozio del mese, B2B/business orders, fatturazione SDI (`invoice_sequences`),
daily drops/stories, newsletter, recupero carrello, indirizzi salvati, SOS. *Aspettano traffico
reale o un'azione admin che le popoli.*

### Tier C — pagine funzionanti ma ORFANE dal menu → **COLLEGATE/RIMOSSE**
- **Collegate** in `lib/account-menu.ts`: seller → `Clienti`, `Recensioni`; rider → `Storico`,
  `Recensioni`; admin → `Dispute`, `Audit log`.
- **Rimossa** `/status` (dati uptime mock hardcoded, non linkata; l'uptime reale è coperto da
  monitor esterni + n8n W8).
- Non orfane (nessuna azione): `/novita` e `/categorie` (linkate da `CategoryBar`); `/u/[handle]`
  (gated da `public_profile_enabled`, 0 attivi).

### Tier D — ridondanze (decisioni documentate)
- `seller/dashboard` + `earnings` + `analytics` si sovrappongono sul fatturato: separazione
  accettabile (overview / denaro / analisi), **nessun merge**.
- Commissione **8% hardcoded** (`MARKETPLACE_FEE_BPS=800` in `lib/stripe/client.ts`): renderla
  per-seller è una feature, **fuori scope**.

### Tier E — doppioni cron in-app ↔ n8n (ownership definita)
- **In-app = canonico** per transazionale/lifecycle: `send-emails`, `abandoned-carts`,
  `expire-checkouts`, `operational-alerts`, `process-deletions`, `release-payouts`, `send-push`.
- **n8n = canonico** per crescita/ops esterne: lead-gen, outreach, KPI digest, uptime, health.
- **Archiviati** in n8n (inattivi, impatto operativo zero): *G5 Welcome Email* (dup del welcome
  in-app) e *M1 Merchant Order Alert* (Telegram, non integrato). Da valutare manualmente (toccano
  monitoraggio attivo o strategia di crescita, lasciati alla tua decisione): *W7 Anomaly Alert*
  (attivo, probabile dup di `operational-alerts`), *W3 Telegram Pilot*, un hunter duplicato
  (OSM vs Intelligence Engine) e gli esperimenti inattivi (Activation Coach, Group Buy Viral).
- ⚠️ **Outreach inefficace**: 407 lead ma solo 7 con email e `outreach_events=0` → serve
  arricchimento email o resta a vuoto. Monitor uptime/KPI fermi dal 26-27 mag (riattivare se serve).

---

## 4. Raccomandazioni residue (non bloccanti)
1. **KYC/SDI in produzione**: oggi provider `mock`. Prima del lancio reale configurare Onfido/Veriff
   (KYC) e FattureInCloud/Aruba (SDI) via env.
2. **Outreach**: arricchire le email dei lead (solo 7/407) o l'automazione W2 resta inutile.
3. **Monitoraggio**: riattivare Uptime/KPI n8n (fermi) o affidarsi a un monitor esterno su `/api/health`.
4. **Feature pre-lancio**: valutare se nascondere dalla UI quelle che non si vogliono lanciare subito
   (es. gift card, B2B, gruppi) per ridurre superficie, riattivandole al momento giusto.
