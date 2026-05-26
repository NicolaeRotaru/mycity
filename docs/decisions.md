# MyCity Piacenza — Decision Log

> Architecture Decision Records (ADR) — ogni decisione strategica
> documentata con contesto, alternative considerate, motivazione.

---

## Format

Per ogni decisione:
```
## ADR-NNN: <titolo>
- Data: YYYY-MM-DD
- Stato: proposed | accepted | superseded | deprecated
- Decisore: <chi>
- Contesto: perché serve decidere
- Decisione: cosa è stato deciso
- Alternative considerate: cosa NON è stato scelto e perché
- Conseguenze: positive + negative
```

---

## ADR-001: Stack Next.js 14 + Supabase + Stripe

- **Data**: 2025-12-01
- **Stato**: accepted
- **Decisore**: Founder

**Contesto**: Devo scegliere stack per MVP marketplace. Tempo limitato, budget zero,
1 sviluppatore.

**Decisione**: Next.js 14 App Router + Supabase managed Postgres + Stripe Checkout/Connect.

**Alternative considerate**:
- **Ruby on Rails + Heroku**: maturo ma lento per shipping nuove feature.
- **Django + Render**: stesso problema, ecosistema meno aggiornato.
- **Custom Node.js + Express + Postgres self-hosted**: troppo overhead ops.
- **Shopify + custom theme**: lock-in vendor, no controllo UX.
- **Bubble.io / no-code**: scalabilità + customization limitate.

**Conseguenze positive**:
- Setup in 1 giorno
- React ecosystem maturo
- Supabase = Auth + DB + Storage + Realtime in 1
- Stripe Connect risolve escrow per marketplace

**Conseguenze negative**:
- Vendor lock-in Supabase (mitigato: Postgres standard, esportabile)
- Costi Stripe alti su transazioni piccole (€0,25 fisso pesa su €10 ordini)

---

## ADR-002: COD (cash on delivery) come opzione primaria

- **Data**: 2025-12-15
- **Stato**: accepted
- **Decisore**: Founder

**Contesto**: Cultura Italia over-40 reluttante a pagare online. Glovo solo card.

**Decisione**: Supportare COD come opzione default per buyer >40 e seller alimentari.

**Alternative considerate**:
- **Solo card** (come Glovo 2023+): perde 40% dei buyer target.
- **COD + commissione +€1**: penalty psicologica.

**Conseguenze positive**:
- Mercato più ampio
- Trust (paghi quando ricevi)

**Conseguenze negative**:
- Rider deve portare cassa
- Frode cash-non-pagato (mitigato: KYC buyer dopo 3 COD)
- Cash handling cost ~€0,20/ordine

---

## ADR-003: Mediterranean Modern design system (no blue corporate)

- **Data**: 2026-01-10
- **Stato**: accepted
- **Decisore**: Founder

**Contesto**: 90% marketplace italiani usano blu/grigio. Voglio differenziarmi.

**Decisione**: Palette terracotta + cream + olive + mustard. Tipografia Fraunces serif + Inter.

**Alternative considerate**:
- **Material Design + blu**: corporate ma generico.
- **Tailwind UI default**: stesso problema di generico.
- **Stripe-inspired purple/indigo**: tech-corporate, distante da local commerce.

**Conseguenze positive**:
- Brand identity unica, memorabile
- Tono "casa, tradizione, locale" coerente
- Asset competitivo non replicabile da algoritmo

**Conseguenze negative**:
- Migrazione palette completa = 6h lavoro (in corso)
- Contrast WCAG AA al limite su alcune combinazioni (audit fatto, ok)

---

## ADR-004: 36 migrations idempotenti vs DB graph migration tools

- **Data**: 2026-02-15
- **Stato**: accepted
- **Decisore**: Founder

**Contesto**: Devo gestire schema evolution senza tool dedicati.

**Decisione**: SQL migrations numerate (`001_*.sql` → `037_*.sql`), tutte idempotenti
(`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` prima del `CREATE POLICY`).

**Alternative considerate**:
- **Prisma Migrate**: ORM-locked, schema reflective in TS. Bene ma overhead.
- **Supabase CLI migrations**: ottimo ma 1 file = 1 transaction, no rollback granular.
- **dbmate**: leggero ma nessuna integrazione Supabase Studio.

**Conseguenze positive**:
- Idempotente = ri-eseguibile senza paura
- Plain SQL = leggibile da chiunque conosca Postgres
- Funziona con Supabase Studio (paste & run)

**Conseguenze negative**:
- No tracking automatico di "quale migration è applicata"
- Manual coordinare con setup nuovo Supabase project

---

## ADR-005: PostHog + Sentry vs alternativa singola tool

- **Data**: 2026-05-26
- **Stato**: accepted
- **Decisore**: Founder

**Contesto**: Pre-launch ho 0 visibility. Devo installare observability.

**Decisione**: PostHog (analytics + funnel + session replay) + Sentry (errori + Web Vitals via PostHog).

**Alternative considerate**:
- **GA4 only**: pageview ok, nessun funnel custom, no session replay.
- **Amplitude**: ottimo funnel ma costo crescita rapida ($100/mese a 10k utenti).
- **Datadog all-in-one**: $40+/mese minimo, overkill MVP.
- **Mixpanel**: stesso problema di Amplitude.

**Conseguenze positive**:
- PostHog free fino 1M eventi/mese
- Sentry free fino 5k errors/mese
- EU instance PostHog = GDPR-friendly
- Session replay critico per primi user feedback

**Conseguenze negative**:
- 2 tool da configurare
- PostHog cookie consent va rispettato (implementato)

---

## ADR-006: Take rate 8% commissione (vs 5% / 12%)

- **Data**: TBD post primi 30 ordini reali
- **Stato**: proposed
- **Decisore**: Founder

**Contesto**: Devo decidere commissione marketplace.

**Decisione proposta**: 8% commissione + €15/mese subscription PRO opzionale.

**Alternative considerate**:
- **5% no sub**: troppo basso, breakeven irraggiungibile.
- **12% no sub**: rischio churn seller (eBay è 12-13%, Etsy 6,5%).
- **Solo subscription €19/mese**: scala male (linear con seller count).

**Conseguenze positive (atteso)**:
- 8% + €15 sub = breakeven a 30 seller PRO + 50 buyer attivi
- Sub PRO è opt-in, riduce friction onboarding
- 8% commission accettabile per seller alimentari (margini 30-50%)

**Conseguenze negative**:
- Seller abbigliamento ha margini 15-25% → 8% impatta più
- Possibile churn primi 3 mesi → flexibility con prima sub gratis

**Da validare**: A/B con 3 seller pilota nei primi 60 giorni.

---

## ADR-007: Welcome credit €5 vs €3 vs €10

- **Data**: TBD
- **Stato**: proposed
- **Decisore**: Founder

**Contesto**: Quanto offrire al buyer signup?

**Decisione proposta**: €5 con scadenza 7gg.

**Alternative considerate**:
- **€3 no scadenza**: troppo basso per persuadere primo ordine.
- **€10 con scadenza 3gg**: troppo costoso per MyCity, ROI negativo se LTV basso.
- **No welcome credit**: probabile -25% activation rate.

**Conseguenze positive**:
- €5 = soglia psicologica significativa (≈ caffè + brioche)
- Scadenza 7gg = urgenza senza pressing
- Cost: €5 × 100 signup = €500 totali pre-PMF, sostenibile

**Conseguenze negative**:
- Buyer farm-friendly: serve detection email duplicate / device fingerprint

---

## ADR-008: Founder = rider per primi 20 ordini

- **Data**: 2026-05-26
- **Stato**: accepted
- **Decisore**: Founder

**Contesto**: Devo decidere se assumere rider day 1 o farlo io stesso.

**Decisione**: Founder fa rider personalmente per primi 20 ordini.

**Alternative considerate**:
- **Assumere 1 rider freelance day 1**: costo €5-10/h × 0 ordini = perdita pura.
- **Partnership con Glovo rider in spillover**: complicato legalmente.

**Conseguenze positive**:
- 0 costo rider primi ordini
- Founder vede direttamente experienza buyer
- Personal call post-delivery = raccolta feedback insostituibile
- Valida che la consegna è fattibile prima di delegare

**Conseguenze negative**:
- Founder time = costoso (ma sunk cost se non c'è altro)
- Non scalabile dopo 20 ordini → hire freelance al 21°

---

## ADR-009: Onboarding seller manuale (door-to-door) vs self-serve

- **Data**: 2026-05-26
- **Stato**: accepted
- **Decisore**: Founder

**Contesto**: Acquisire primi 10 seller per cold start.

**Decisione**: Door-to-door 10 negozi Piacenza, onboarding sul posto.

**Alternative considerate**:
- **Self-serve form online + paid ads**: spreca budget pre-PMF.
- **Pitch via email**: tasso risposta <2%.
- **Confcommercio mass mailing**: spam-perceived, brand damage.

**Conseguenze positive**:
- 100% conversion rate sui visitati che dicono sì
- Relazione personale = trust + retention
- Founder impara obiezioni reali

**Conseguenze negative**:
- Tempo: 30 min/negozio × 10 = 5h
- Non scalabile oltre primi 50 seller → AM hire al 51°

---

## Decisioni pending (da prendere)

- [ ] **Quando attivare cron email lifecycle** (settimana 8 piano 90gg)
- [ ] **Quando aprire SDI XML invoice automatica** (al primo B2B order vero)
- [ ] **Quando passare a Supabase Pro** (al primo €1k MRR)
- [ ] **Quale città dopo Piacenza** (Parma vs Reggio Emilia vs Cremona)
- [ ] **Logo professionale** (DIY vs designer €200)

---

*Aggiorna ogni volta che prendi una decisione strategica reversibile o non.*
