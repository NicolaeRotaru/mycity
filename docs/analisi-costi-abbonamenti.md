# MyCity Piacenza — Analisi costi & abbonamenti

> Versione 1.0 · 31 maggio 2026 · analisi profonda di **tutti** i costi sostenuti
> dalla piattaforma (uscite) e di **tutti** i prezzi/abbonamenti incassati dagli
> utenti (entrate). Numeri ancorati a: codice sorgente, `.env.example`,
> `render.yaml`, `docs/business-plan.md`, `docs/unit-economics.md`,
> `docs/dpa-vendors.md` e — dove possibile — allo **stato live reale** verificato
> via MCP su Supabase e Stripe.

---

## 0. TL;DR (sintesi in 30 secondi)

- **Costi fissi infrastruttura oggi (pre-launch reale):** ~**€25–35/mese** effettivi
  (Supabase Pro già attivo + dominio), tutto il resto su free tier.
- **Costo fisso "a regime" dichiarato dal business plan:** **€160–280/mese**
  (include commercialista €100–200, che è la voce più pesante).
- **Costi variabili** legati al volume: Stripe (per transazione), Anthropic (per
  token AI), KYC (per verifica), SMS Twilio (opzionale). Zero finché non c'è traffico.
- **Entrate / "abbonamenti" verso i venditori:** qui c'è una **incongruenza grave**
  tra codice e marketing — vedi §3. Il codice incassa **solo l'8% di commissione**;
  l'abbonamento venditore (€50/mese o €15/mese a seconda della pagina) **non è
  implementato** (nessun prodotto ricorrente su Stripe, account ancora in sandbox).

---

## PARTE A — COSTI CHE LA PIATTAFORMA *PAGA* (uscite)

### A.1 Inventario completo dei servizi terzi

Ogni dipendenza esterna del prodotto, con tier gratuito, soglia di upgrade e costo.
Fonti: `.env.example`, `README.md`, `render.yaml`, `package.json`, `docs/dpa-vendors.md`.

| # | Servizio | Ruolo | Tier free | Quando si paga | Costo a pagamento | Modello |
|---|---|---|---|---|---|---|
| 1 | **Render** | Hosting web + cron | Sì (con limiti/sleep) | Da subito per prod 24/7 | **$7/mese** (Starter) → **$25/mese** (Standard) + worker cron Starter | Abbonamento mensile |
| 2 | **Supabase** | DB Postgres + Auth + Storage + Realtime | Sì (1 progetto, limiti) | Al ~1° €1k MRR / o già attivo | **$25/mese** (Pro) + extra compute | Abbonamento mensile |
| 3 | **Stripe** | Pagamenti + Connect (escrow) | — (no canone) | Su ogni transazione | **1,5% + €0,25** carte EU (+ extra non-EU/Connect) | Variabile per transazione |
| 4 | **Anthropic (Claude API)** | AI: descrizioni, vision foto prodotto | Crediti iniziali | A consumo | **~$5–30/mese** (pay-per-token) | Variabile per token |
| 5 | **Resend** | Email transazionali | 3.000 email/mese, 100/giorno | Oltre 3k email/mese | **$20/mese** (50k email) | Abbonamento mensile |
| 6 | **Cloudflare Turnstile** | CAPTCHA anti-bot signup | Sì (illimitato di fatto) | Praticamente mai | €0 | Free |
| 7 | **Cloudflare (proxy/DNS)** | CDN + proxy dominio | Sì (Free plan) | Solo feature Pro | €0 (Free) → $20/mese (Pro, opz.) | Free / opz. |
| 8 | **Netsons** | Registrazione dominio | — | Annuale | **~€10–15/anno** (~€1/mese) | Abbonamento annuale |
| 9 | **PostHog** | Analytics + session replay | 1M eventi/mese, 5k replay | Oltre il free tier | da **$0** (usage-based oltre soglia) | Free → usage |
| 10 | **Sentry** | Error tracking + source maps | 5k errori/mese | Oltre il free tier | da **$26/mese** (Team) | Free → abbonamento |
| 11 | **Google Analytics 4** | Analytics web (opz.) | Sì (illimitato) | Mai (GA4 standard) | €0 | Free |
| 12 | **Push VAPID (web-push)** | Notifiche push | Sì (self-hosted, no servizio) | Mai | €0 | Free (self) |
| 13 | **Upstash Redis** | Rate limit multi-istanza (opz.) | 10k comandi/giorno | Oltre free / prod multi-nodo | usage-based (~$0,2/100k cmd) | Free → usage |
| 14 | **OpenStreetMap / Nominatim** | Mappe + geocoding | Sì (fair use) | Mai (rispettando rate limit) | €0 | Free |
| 15 | **cron-job.org** | Scheduler esterno cron | Sì | Mai | €0 | Free |
| 16 | **Fatturazione SDI** (FattureInCloud / Aruba) | Fattura elettronica | `mock` in dev | In produzione fiscale | **~€5–20/mese** (piano provider) | Abbonamento mensile |
| 17 | **KYC** (Onfido / Jumio / Veriff) | Verifica documento + face match | `mock` in dev | Verifica venditori/rider reali | **~€1–3 per verifica** | Variabile per verifica |
| 18 | **Twilio** (SMS) | Notifiche SMS (opzionale) | — | Se attivato | **~€0,07–0,10 per SMS** | Variabile per SMS |
| 19 | **Commercialista** | Adempimenti fiscali | — | Sempre (in esercizio) | **€100–200/mese** | Servizio ricorrente |

> Nota: le voci 16–18 sono **predisposte ma non obbligatorie** allo stadio MVP
> (default `mock`/opzionale). La voce 19 non è software ma è il costo fisso più
> alto del business plan.

### A.2 Stato LIVE reale (verificato via MCP, 31/05/2026)

| Servizio | Stato reale rilevato | Implicazione di costo |
|---|---|---|
| **Supabase** | Org `mycity.inizioditutto`, progetto `Mycity`, region **eu-west-3 (Parigi)**, Postgres 17.6, creato 21/05/2026, stato `ACTIVE_HEALTHY`. L'org risulta su **piano a pagamento** (creare un progetto aggiuntivo costa **$10/mese** di compute → indicatore di org **Pro**, non Free). | **Supabase Pro già attivo ≈ $25/mese** sostenuto **oggi**, prima ancora del lancio. |
| **Stripe** | Account `acct_1TahVgIyxOZShuhj` = **"Sandbox di boh", TEST mode**. **Zero subscription** attive. Nessun prodotto ricorrente. Unico prodotto presente: `dfsasfasdf` (€5,00 one-time) — chiaramente un test. | Nessun incasso reale possibile finché si resta in sandbox; **l'abbonamento venditore non esiste come prodotto Stripe**. |

> ⚠️ Due conseguenze operative immediate:
> 1. Si sta **già pagando Supabase Pro (~$25/mese)** mentre il prodotto non è
>    ancora in produzione → valutare se serve davvero il tier Pro adesso.
> 2. **Stripe è in sandbox**: non si può incassare nulla (né commissioni né
>    abbonamenti) finché non si passa all'account live e si completa l'attivazione.

### A.3 Costi fissi mensili — riepilogo per fase

#### Fase 1 — MVP / pre-launch (oggi)
Tutto su free tier tranne ciò che è già attivo.

| Voce | Costo/mese |
|---|---|
| Supabase Pro (già attivo, verificato) | ~€23 ($25) |
| Dominio (Netsons, quota mensile) | ~€1 |
| Render / Resend / PostHog / Sentry / Turnstile / GA4 / Upstash | €0 (free tier) |
| **TOTALE effettivo oggi** | **~€24–35/mese** |

#### Fase 2 — Post-launch (traffico iniziale, business plan)
Cifre da `docs/business-plan.md → §6`.

| Voce | Costo/mese |
|---|---|
| Render hosting (Standard) | €25 |
| Supabase Pro | €25 |
| Dominio Netsons | €1 |
| Resend | €0 (entro 3k email) |
| PostHog | €0 (entro 1M eventi) |
| Sentry | €0 (entro 5k errori) |
| Anthropic API | €5–30 (variabile) |
| Stripe | 0% fisso (solo variabile) |
| Commercialista | €100–200 |
| **TOTALE** | **€160–280/mese** |

#### Fase 3 — Scale (con volume)
Si aggiungono: Sentry Team (~€26), Resend a pagamento (~€20), SDI (~€5–20),
KYC e SMS a consumo, eventuale Render upgrade. Stima **€300–500/mese** + variabili.

### A.4 Costi variabili (scalano col volume — €0 senza traffico)

| Voce | Trigger | Costo unitario | Note (da unit-economics.md) |
|---|---|---|---|
| Stripe — fee carta | ogni ordine card | 1,5% + €0,25 | ~€0,28 su ordine medio €25 |
| Stripe Connect — application fee split | ogni payout split | ~€0,05/ordine | per gestione transfer SCT |
| Anthropic — token | uso AI descrizioni/vision | pay-per-token | rientra nei €5–30/mese |
| KYC — verifica | onboarding seller/rider | ~€1–3/verifica | solo provider reale (non `mock`) |
| Twilio — SMS | notifica (se attiva) | ~€0,07–0,10/SMS | opzionale, oggi off |
| Server compute | per ordine | ~€0,02/ordine | quota proporzionale Render |

### A.5 Costi annuali e una-tantum

| Voce | Tipo | Costo |
|---|---|---|
| Dominio (Netsons) | Ricorrente annuale | ~€10–15/anno |
| Apertura P.IVA | Una-tantum | €0–50 |
| Logo + brand | Una-tantum | €0 (DIY) – €200 (designer) |
| Volantini stampa | Periodico per round | €100–200/round |

### A.6 Proiezione costo annualizzato (solo fissi infrastruttura)

| Scenario | Mensile | **Annuale** |
|---|---|---|
| Oggi (effettivo) | €24–35 | **~€290–420** |
| Post-launch (business plan) | €160–280 | **~€1.920–3.360** |
| Scale | €300–500 | **~€3.600–6.000** |

> A regime la voce dominante è il **commercialista** (€1.200–2.400/anno), non il
> software. Il SaaS stack puro (senza commercialista) sta intorno a **€600–1.200/anno**.

---

## PARTE B — PREZZI/ABBONAMENTI CHE LA PIATTAFORMA *INCASSA* (entrate)

Questi sono gli "abbonamenti" che il marketplace fa pagare ai suoi utenti
(soprattutto i venditori). Fonti: codice + pagine pubbliche + business plan.

### B.1 Commissione di transazione — **l'unica cosa realmente implementata**

| Parametro | Valore | Fonte (codice) |
|---|---|---|
| Take rate | **8,00%** sul totale ordine | `lib/stripe/client.ts` → `MARKETPLACE_FEE_BPS = 800` |
| Applicazione | trattenuta automatica al payout seller | `app/api/stripe/webhook/route.ts:222` (`computeApplicationFeeCents`) |
| Sui rimborsi | la commissione **viene restituita** (si recupera solo la quota netta del seller) | `lib/stripe/payout.ts:277` |
| Visibile al seller | "solo l'8% del venduto, nessuna commissione mensile" | `app/seller/earnings/page.tsx:239`, `app/seller/help/page.tsx:39` |

### B.2 Abbonamento venditore — **dichiarato ma NON implementato** ⚠️

Tre versioni diverse del prezzo convivono nel prodotto, e **nessuna è cablata**:

| Dove | Cosa dice | File |
|---|---|---|
| Homepage (sezione venditori) | **"€50/mese, abbonamento fisso, ZERO commissioni sul venduto"** | `app/page.tsx:283,294` |
| Pagina "Chi siamo" | "abbonamento mensile, niente commissioni" | `app/about/page.tsx:43,55,123` |
| Layout dashboard seller | "abbonamento mensile, niente commissioni sulle vendite" | `app/seller/layout.tsx:53` |
| Pagina `/sell` (SEO) | "Nessuna commissione mensile" | `app/sell/layout.tsx:6` |
| Earnings / Help / FAQ seller | **"8% sul venduto, NESSUN costo mensile o di iscrizione"** | `app/seller/earnings/page.tsx:240`, `app/seller/help/page.tsx:39`, `app/faq/page.tsx:118` |
| Business plan | **"8% commissione + PRO €15/mese opzionale"** (free tier + PRO) | `docs/business-plan.md → §3` |
| Codice / Stripe | **solo 8% commissione. Nessun prodotto/price ricorrente. Account in sandbox.** | verificato via MCP |

> 🔴 **Incongruenza critica.** Esistono *tre modelli di pricing mutuamente
> esclusivi* presentati all'utente nello stesso prodotto:
> - **A)** "€50/mese fisso, 0% commissione" (home, about, sell, seller layout)
> - **B)** "8% commissione, €0 abbonamento" (earnings, help, faq, codice)
> - **C)** "8% + PRO €15/mese opzionale" (business plan)
>
> Il venditore che legge la home si aspetta €50/mese senza commissioni, ma il
> codice gli tratterrà l'8% e non gli farà mai pagare un abbonamento. È un
> problema di **trasparenza commerciale** (rischio reclami / pratiche
> commerciali scorrette) prima ancora che tecnico.

### B.3 Altri stream di ricavo previsti (business plan, non implementati)

| Stream | Prezzo previsto | Stato | Fonte |
|---|---|---|---|
| Sponsored listings | €0,50–2 / giorno per placement | non implementato | `docs/business-plan.md → §3` |
| Featured "Negozio del mese" | **€100/mese** (1 slot) | UI esiste (`/admin/shop-of-month`), billing no | business plan |
| Tip rider | 10% opzionale → **va al rider, take 0%** | logica presente | unit-economics |

### B.4 Voci che i clienti pagano ma che NON sono ricavo MyCity

Importante per non confonderle con margine della piattaforma:

| Voce | Importo | Destinatario | Fonte |
|---|---|---|---|
| Spedizione (sotto soglia) | **€4,90** flat | **Rider** (non MyCity) | `lib/constants.ts → SHIPPING_PER_ORDER` |
| Soglia spedizione gratuita | sopra **€30** | — | `lib/constants.ts → FREE_SHIPPING_THRESHOLD` |
| Sconto ritiro in negozio | **−10%** | sconto al buyer | `lib/constants.ts → PICKUP_DISCOUNT_PERCENT` |
| Pagamento alla consegna (COD) | contanti | incassati dal rider | unit-economics |

---

## PARTE C — MARGINE, BREAKEVEN E RACCOMANDAZIONI

### C.1 Margine per ordine (da `docs/unit-economics.md`)

| Scenario | Margine MyCity per ordine |
|---|---|
| Card + spedizione pagata (subtotal < €30) | **+€0,18** (sottile) |
| Card + free shipping (subtotal > €30) | **−€0,53** (negativo, MyCity assorbe il rider) |
| COD | **−€1,20** (sempre negativo) |
| Ritiro in negozio | **+€1,72** (ottimo) |

→ Il marketplace è in **loss strutturale sul singolo ordine** in vari scenari.
La matematica chiude solo con: subscription seller (MRR), alta frequenza ordini,
take rate più alto, o spinta sul ritiro in negozio.

### C.2 Breakeven (da unit-economics)

- Senza subscription: **~930 ordini/mese** (~465 buyer attivi / 100–150 seller).
- Con 30 seller PRO a €15/mese (€450 MRR): breakeven a **~30 seller PRO + 50 buyer attivi**.
- Conclusione del documento: *"spingere la subscription è la cosa che salva la matematica"* —
  il che rende **ancora più grave** che la subscription oggi non sia implementata.

### C.3 Findings & azioni consigliate

1. 🔴 **Allineare il pricing.** Decidere UN modello (consiglio: 8% + PRO €15/mese
   opzionale, come da business plan) e correggere home/about/sell/seller-layout
   che oggi promettono "€50/mese, 0% commissioni". Oggi sono in contraddizione
   diretta con codice e pagine seller.
2. 🔴 **Implementare davvero l'abbonamento** se si vuole offrirlo: serve un
   prodotto ricorrente su Stripe (Billing/Subscriptions) + gating feature lato
   app. Oggi su Stripe non esiste alcun price ricorrente.
3. 🔴 **Uscire dalla sandbox Stripe** prima del lancio: l'account live e
   l'attivazione Connect sono prerequisiti per incassare qualsiasi cosa.
4. 🟠 **Rivalutare Supabase Pro adesso:** si paga ~$25/mese da prima del lancio.
   Se il traffico è ~0, il Free tier potrebbe bastare fino al go-live.
5. 🟠 **Tenere d'occhio le voci variabili** (Anthropic, KYC, SMS): a basso volume
   sono trascurabili, ma KYC reale (€1–3/verifica) scala col numero di seller/rider.
6. 🟡 **Commercialista = voce dominante** del fisso: il software è secondario nel
   budget. Pianificare cassa di conseguenza.

---

*Documento da rivedere ad ogni cambio di pricing o di vendor. I costi infrastruttura
sono ancorati ai tier ufficiali e allo stato live verificato il 31/05/2026; le cifre
variabili sono target da validare con i primi ordini reali.*
