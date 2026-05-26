# MyCity Piacenza — Business Plan

> Versione 1.0 · maggio 2026 · ultima revisione: stadio MVP pre-launch

---

## 1. Vision & Mission

**Vision**: rendere il commercio di prossimità di Piacenza visibile, ordinabile
online e consegnabile a casa in 24-48h, mantenendo l'anima dei negozi locali.

**Mission**: offrire a buyer locali un'alternativa concreta ai marketplace globali
(Amazon, Glovo) per supportare l'economia della propria città; offrire ai
commercianti uno strumento di vendita digitale a basso costo e bassa friction.

---

## 2. Mercato

### Target

- **Lato buyer (demand)**: residenti di Piacenza (~100k abitanti), età 25-65, fascia
  socio-economica media e medio-alta, sensibili al "consuma locale".
- **Lato seller (supply)**: piccoli commercianti di Piacenza centro storico e
  prima periferia: alimentari, abbigliamento, casa, libri, elettronica, bellezza.
  Target iniziale: 30-50 negozi reali entro 6 mesi.

### TAM / SAM / SOM (stima Piacenza)

- **TAM (mercato totale e-commerce italiano)**: ~€50 mld annui (2025)
- **SAM (e-commerce locale Piacenza)**: ~€30 mln/anno spesa online residenti
- **SOM (raggiungibile MyCity anno 1)**: €100-300k GMV (0,3-1% di SAM)

### Competitor diretti

| Competitor | Presenza Piacenza | Differenziazione MyCity |
|---|---|---|
| Glovo | Sì (solo ristoranti) | Noi: tutti i negozi non-ristoranti |
| Just Eat | Sì (ristoranti) | Noi: alimentari + altri verticali |
| Amazon | Sì (tutto) | Noi: locale-only, paghi alla consegna |
| Subito.it | Sì (C2C) | Noi: solo negozi verificati B2C |
| Vicinato.it | No | Noi: presenza fisica + KYC |

### Vantaggi competitivi difensivi

1. **Hyperlocal**: zero competitor specifico per Piacenza con coverage tutti-verticali
2. **Brand identity** "Mediterranean Modern + italiano vivo" non replicabile da algoritmo
3. **First-mover advantage** 18-24 mesi prima che Just Eat/Wolt si espandano
4. **Onboarding seller manuale + AI-assisted** (5 min vs 30 min standard)
5. **COD-friendly** per cultura italiana over-40

---

## 3. Revenue model

### Stream

| Stream | Take rate / pricing | Stima anno 1 |
|---|---|---|
| Commissione transazione | 8% sul GMV venditore | €5-25k |
| Abbonamento seller (PRO) | €15/mese (opzionale, sblocca analytics + AI + promo wizard) | €1-4k |
| Sponsored listings | €0,50-2/giorno per placement | €0,5-2k |
| Featured "Negozio del mese" | €100/mese (1 slot) | €1-2k |
| Tip rider (opzionale) | 10% tip → rider, no take | €0 |

**Stima revenue anno 1**: €7-33k (sostenibilità infrastruttura, no salario founder)
**Stima revenue anno 2**: €30-100k (post-PMF se confermato)

### Pricing seller (decisione strategica)

- **Free tier**: pubblicazione fino 50 prodotti, 8% commissione, no AI, no analytics avanzata
- **PRO €15/mese**: prodotti illimitati, AI description, analytics, promo wizard, support prioritario

Razionale: subscription bassa = barriera basso → adoption ampia. Commissione moderata
= sostenibilità senza spaventare seller. Hybrid model copre fisso (sub) + variabile (comm).

---

## 4. Unit Economics

Vedi documento dedicato: [`unit-economics.md`](unit-economics.md)

**Sintesi**:
- GMV per ordine target: €25
- Margine per ordine: positivo se consegna in zona vicina + COD < 30% del volume
- LTV target buyer: €60 (12 mesi × 2 ordini/mese × €2.5 revenue/ordine)
- CAC target: €15-20 (target LTV/CAC ≥ 3:1)

---

## 5. Go-To-Market (anno 1)

### Fase 1: Pre-launch (mesi 1-3)

- Onboarding **manuale** 10 seller piacentini di persona (door-to-door)
- Founder = rider per primi 20 ordini
- Personal Instagram + WhatsApp Business + volantini
- Pitch Confcommercio Piacenza per credibility

### Fase 2: Soft launch (mesi 4-6)

- Estensione a 30 seller
- Newsletter "Venerdì del Mercato" settimanale
- 5-10 daily story Instagram dei negozi
- Volantini A5 al mercato del sabato + bar centro
- Target: 100 buyer registrati, 50 ordini/mese

### Fase 3: Validation (mesi 7-9)

- Misurazione: activation rate, retention 30d, LTV
- Iterate prodotto basato su feedback (target: 200 insight reali)
- Se PMF signal positivo → fase 4. Se no → pivot.

### Fase 4: Scale (mesi 10-12)

- 50+ seller, 500+ buyer, 200+ ordini/mese
- Primo hire (1 rider o 1 account manager)
- Apertura canale paid acquisition (€500-1000 test)
- Preparazione expansion altra città (Parma o Reggio Emilia)

---

## 6. Operazioni

### Team attuale

- 1 founder full-time (dev + GTM + ops)
- 0 employees
- 0 freelance

### Hire roadmap

| Quando | Ruolo | Salario | Razionale |
|---|---|---|---|
| €1k MRR | 1 rider freelance | €5-10/h | Founder smette di essere rider |
| €3k MRR | 1 account manager part-time | €800/mese | Onboarding seller scalabile |
| €10k MRR | 1 dev junior | €1500/mese | Founder full-time su GTM |

### Costi operativi fissi mensili (stadio attuale)

| Voce | Costo |
|---|---|
| Render hosting | €25 |
| Supabase Pro (al 1° €1k MRR) | €25 |
| Dominio Netsons | €1 |
| Resend (free fino 3k email) | €0 |
| PostHog (free fino 1M eventi) | €0 |
| Sentry (free fino 5k errors) | €0 |
| Anthropic API | €5-30 |
| Stripe (variabile su transazioni) | 0% fisso |
| Commercialista | €100-200 |
| **TOTALE** | **€160-280/mese** |

### Costi una tantum

- P.IVA apertura: €0-50
- Logo + brand: €0 (DIY) o €200 (designer)
- Volantini stampa: €100-200/round

---

## 7. Finanziamento

### Stato attuale

- 100% bootstrapped (founder self-funded)
- Nessun debito
- Cash runway: dipende dal salario founder (escluso dalle previsioni)

### Quando cercare investimento

**NON adesso**. Pre-PMF con €0 GMV un investitore non guarda.

**Quando**:
- €5k+ MRR sostenuto da 3 mesi
- LTV > 3x CAC verificato
- 100+ seller attivi
- Replicabilità prima città dimostrata

**Quanto chiedere**:
- Pre-seed €100-300k per expansion 2-3 città
- Equity 15-25%
- Investor target: business angel Emilia-Romagna, micro-VC italiani (e.g. Italian Angels for Growth)

---

## 8. Rischi & Mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---|---|---|---|
| Cold start fallisce (no traction) | Alta | Critico | GTM door-to-door manuale primi 30 negozi |
| Glovo/JustEat entra Piacenza non-food | Media | Alto | Defensive: relationship lock-in con seller via subscription PRO |
| Founder burnout | Alta | Critico | Time-box features, focus su acquisition, weekly time-off |
| Frodi pagamento | Bassa | Medio | Stripe Radar + COD limit + KYC seller |
| Bug critico in prod | Media | Medio | Sentry + UptimeRobot + restore drill |
| Compliance EAA/GDPR fault | Bassa | Critico | Consulenza legale + statement /accessibility |

---

## 9. KPI da monitorare (dashboard "Today")

### Top funnel
- Visitatori unici/giorno
- Signup completati/giorno
- Activation rate (signup → first order entro 7gg) **TARGET >30%**

### Marketplace health
- Sellers attivi (ordini ricevuti ultimo mese)
- Buyers attivi (ordini fatti ultimo mese)
- GMV mensile
- Ordini/giorno medi

### Retention
- Cohort retention 30d **TARGET >40%**
- Cohort retention 60d **TARGET >25%**
- Frequenza ordini per buyer attivo **TARGET >2/mese**

### Operations
- Tempo medio consegna **TARGET <90min**
- % ordini on-time **TARGET >85%**
- Dispute rate **TARGET <2%**
- NPS (chiedi via in-app survey post-3°-ordine) **TARGET >50**

### Finanziari
- MRR (subscription + commission rolling)
- CAC effettivo (€ marketing / nuovo buyer)
- LTV (rolling 12 mesi)
- Burn rate / runway

---

## 10. Decisioni chiave da prendere (P0)

1. **Take rate finale**: 8% vs 10% vs 12% → test con 3 seller pilota
2. **Subscription seller PRO**: lanciare day 1 o aspettare €1k MRR?
3. **Welcome credit €5**: ridurre a €3? Test A/B quando hai volumes.
4. **COD limit**: massimo ordine COD €100? €200? Frode trade-off.
5. **Founder = rider o ricerca rider day 1**: dipende dalla velocità di onboarding seller.

---

*Documento aggiornato a ogni cambio strategia rilevante. Revisione trimestrale obbligatoria.*
