# TEST REPORT — MyCity · campagna "TESTA TUTTO" · 2026-06-23

## ✅ VERDETTO: **GO CON CONDIZIONI**
Il **codice è solido** (715/715 unit, typecheck/lint/build verdi) e le due paure principali — **isolamento dati** e **sicurezza carta** — sono **verificate sul progetto reale a livello di policy/codice**. La piattaforma **non ha bug bloccanti noti** sul codice. **Ma NON è un GO pieno**: il **percorso di pagamento end-to-end non è stato provato a runtime** (il connettore Stripe è risultato **LIVE**, quindi non potevo simulare un pagamento senza muovere denaro vero), e restano **2 condizioni operative** da chiudere prima di aprire ai clienti.

---

## Metodo & sicurezza
Eseguito in **sola lettura** sul progetto di produzione (nessuna scrittura, nessun seed, nessun pagamento creato). Tutte le voci dell'ambito A–N sono in stato terminale (vedi `TEST_LEDGER.md`). Auto-controllo applicato a ogni test: **3 falsi risultati intercettati e corretti** durante la campagna (grep PCI che matchava `<span>`, glob route che saltava i file diretti, "violazioni soldi" che erano dati legacy).

## Scorecard
| Area | Stato | Sintesi |
|---|---|---|
| **Codice (static+unit)** | 🟢 | typecheck/lint/build OK · **715/715** unit |
| **Isolamento dati (RLS)** | 🟢 (policy) · 🟡 (runtime) | 71/71 tabelle RLS on, 0 `USING(true)` su dati sensibili, 0 ERROR advisor · test comportamentale con utenti reali ⛔ (serve env di test) |
| **Sicurezza carta (PCI)** | 🟢 | Stripe Checkout hosted, nessun dato carta nel backend, logger redige PII; SAQ-A |
| **Sicurezza app** | 🟢 | header+CSP forti, route pubbliche rate-limited+captcha, cron protetti, no service-key nel client |
| **Soldi / payout** | 🟢 (codice) · 🟡 (dati) | invarianti OK nel codice; live: 0 payout negativi, wallet=ledger; 21 ordini di **test legacy** da pulire |
| **Pagamenti a runtime** | 🔴 **non provato** | connettore Stripe **LIVE** → impossibile test sicuro; flusso reale + webhook da confermare |
| **Operatività (cron/advisor)** | 🟠 | 1 cron fermo (`expire-stale-orders`); advisor senza ERROR |

---

## 🔴 / 🟠 Da chiudere prima del lancio

### 🔴 1. Pagamento end-to-end NON provato + chiarire la modalità Stripe
Il connettore risponde **`livemode: true`**: è collegato all'account **LIVE**, non test (tu mi avevi detto "test mode"). Per il lancio **live è corretto** (incassi reali), ma significa che **non ho potuto eseguire un pagamento sintetico in sicurezza**. → **Azione:** fai **un acquisto reale di prova** (importo minimo) come primo cliente: carrello → checkout carta → l'ordine **appare una sola volta al seller giusto** → assegna rider → consegna con codice. Verifica in un colpo: checkout, webhook→ordine, isolamento per-ruolo, macchina a stati. Poi rimborsa l'ordine di prova.

### 🔴 2. Webhook Stripe di produzione da confermare
Senza webhook configurato (endpoint `/api/stripe/webhook` + `STRIPE_WEBHOOK_SECRET` di prod), **i pagamenti carta non creano ordini**. → **Azione:** Dashboard Stripe → Developers → Webhooks: verifica endpoint, secret e che l'evento `checkout.session.completed` arrivi (lo vedi nel test #1).

### 🟠 3. Cron `expire-stale-orders` fermo da ~8 giorni
7 cron su 8 girano regolarmente (release-payouts 22h fa, send-emails 0h…), ma **`expire-stale-orders` non parte da 191h**. Impatto: ordini NEW mai accettati dal seller non si auto-annullano → stock resta riservato. → **Azione:** verifica la schedulazione di quel job (Render/Vercel cron) e che risponda 200.

### 🟠 4. Pulire i 21 ordini di test legacy
Tutti gli ordini attuali sono dati di test (23/05–11/06, 2 account), molti precedenti alle colonne fee → non riconciliano. → **Azione:** elimina i dati di test prima di aprire, così la riconciliazione finanziaria parte da zero. (È una scrittura su prod: fallo tu o autorizzami esplicitamente.)

## 🟡 Consigliati (non bloccano)
- **`npm audit fix`**: 1 vuln high (`undici`, transitiva) + 14 moderate.
- **Supabase Auth → attiva "Leaked password protection"** (1 click, HaveIBeenPwned).
- **Hardening RPC**: revoca `EXECUTE` su funzioni-trigger esposte (`notify_buyer_on_order_status`, `reward_referrer_on_delivery`, `touch_loyalty_streak`); sposta `pg_trgm` fuori da `public`.
- **Perf advisor** (differibile): wrap `auth.uid()` → `(select auth.uid())` in 11 policy; consolida policy multiple su `products/orders/profiles`.
- **Test 🔧 da scrivere**: ~15 moduli `lib/*` senza unit; flussi e2e completi; RPC comportamentali (quando avrai un progetto Supabase di test).

## ⛔ Cosa NON è stato testabile qui (e come chiuderlo)
- **Test comportamentali RLS/RPC e flussi e2e completi**: richiedono un **progetto Supabase di TEST** + secret (assenti in sandbox; girano in CI). → crea un progetto di test o esegui in CI.
- **Pagamento/refund/dispute reali**: richiedono **Stripe test mode** (qui il connettore è live). → con chiavi test completo la prova end-to-end.
- **Load/Lighthouse/fault-injection**: richiedono app in esecuzione + strumenti di carico.

---

## Verifica finale (§8) — esito
1. **Completezza:** tutte le aree A–N hanno stato terminale nel ledger. ✅
2. **Anti-falso-verde:** 3 falsi risultati intercettati e corretti (PCI/grep, glob route, dati legacy). Re-check a campione dei PASS critici OK. ✅
3. **Nessun effetto collaterale:** **zero scritture** su produzione, nessun artefatto di test creato (Stripe/DB). ✅
4. **Nessun errore introdotto:** typecheck/lint/build/715 unit verdi. ✅
5. **Riproducibilità:** invarianti chiave ri-eseguite → stesso esito (tutti 0). ✅
6. **Verdetto↔prove:** ogni riga sostenuta da prova nel ledger. ✅

## Checklist go-live domattina (prima di aprire)
- [ ] **Acquisto reale di prova** end-to-end (poi rimborso) — chiude 🔴1
- [ ] **Webhook Stripe** verificato in Dashboard — chiude 🔴2
- [ ] **Riattiva/verifica `expire-stale-orders`** — chiude 🟠3
- [ ] **Pulisci i dati di test** — chiude 🟠4
- [ ] (consigliato) `npm audit fix` + leaked-password ON
- [ ] Tieni aperti **Sentry** e gli **alert operativi** il giorno-1

*Campagna eseguita in READ-ONLY sul progetto reale (advisor, policy, invarianti, riconciliazione) + suite del repo. Nessun dato di produzione modificato. Dettaglio per voce in `TEST_LEDGER.md`.*
