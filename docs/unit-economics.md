# MyCity Piacenza — Unit Economics

> Versione 1.0 · numeri target da validare con i primi 50 ordini reali.

---

## Schema base per ordine

### Revenue per ordine (lato MyCity)

| Voce | Importo | Note |
|---|---|---|
| GMV medio per ordine | €25 | Target alimentari + cross categoria |
| Take rate commissione | 8% | Standard marketplace local |
| **Revenue commissione** | **€2,00** | |
| Tip rider opzionale 10% | €2,50 | Va al rider, no MyCity |
| Spedizione pagata dal buyer (sotto €30) | €4,90 | Va al rider, no MyCity |

### Costi per ordine (lato MyCity)

| Voce | Importo | Note |
|---|---|---|
| Stripe fee carta | €0,28 | 1,5% + €0,25 per €25 |
| Stripe Connect application fee | ~€0,05 | Per payout split |
| Rider compensation (zona vicina <3km) | €3,00 | A carico MyCity se spedizione gratis |
| SMS notifica (Twilio opz.) | €0,10 | Se attivato |
| Email transactional (Resend) | €0,00 | Free tier |
| Server compute (proporzionale) | €0,02 | Render scale-down |
| **TOTALE COSTI** | **€3,45** | |

### Margine per ordine

| Scenario | GMV | Revenue | Costo | Margine | Note |
|---|---|---|---|---|---|
| **Card + spedizione pagata (subtotal <€30)** | €25 | €2,00 + €4,90 (ship) - €4,90 (a rider) - €0,28 = **€1,72** | €3,00 (rider) ma incassiamo €4,90 = **+€1,90** netto | **+€0,18** | Margine sottile |
| **Card + free shipping (subtotal >€30)** | €35 | €2,80 - €0,33 = **€2,47** | €3,00 (rider) | **-€0,53** | Negativo: MyCity assorbe rider |
| **COD (Cash On Delivery)** | €25 | €2,00 | €3,00 (rider) + €0,20 cash handling | **-€1,20** | Sempre negativo |
| **Pickup in negozio (-10%)** | €25 | €2,00 - €0,28 (Stripe) = **€1,72** | €0 (no rider) | **+€1,72** | Margine ottimo |

### Conclusione margine

**Marketplace è in loss strutturale sul singolo ordine sotto certe condizioni**.
Per breakeven serve:
- O subscription seller (€15/mese × N seller)
- O frequenza ordini alta (LTV)
- O take rate più alto (10-12% — rischio churn seller)
- O pickup in negozio incentivato (+10% sconto)

---

## LTV (Lifetime Value buyer)

### Assunzioni baseline

- Frequenza ordini: 2/mese (target buyer attivo)
- Retention mese 12: 30% (cohort)
- Decay esponenziale: -10%/mese

### Calcolo LTV 12 mesi

| Mese | % attivi | Ordini totali | Margine ordini (mix) |
|---|---|---|---|
| 1 | 100% | 2 | €0,18 × 2 = €0,36 |
| 2 | 90% | 1,8 | €0,32 |
| 3 | 81% | 1,62 | €0,29 |
| ... | ... | ... | ... |
| 12 | 28% | 0,56 | €0,10 |

**LTV margine cumulato 12 mesi**: ~€2,80 per buyer (solo margine, no subscription)

### LTV revenue (per investitori)

Revenue lordo cumulato 12 mesi (commissioni + spedizioni):
- 2 ordini/mese × 12 mesi × decay = ~12 ordini totali
- 12 × €2,47 = **~€30 revenue lordo per buyer in 12 mesi**

---

## CAC (Customer Acquisition Cost)

### Target

| Canale | CAC stimato | Volume mese 6 |
|---|---|---|
| Word of mouth (referral) | €0 (costo: gift €5+€5) | 30% |
| Volantini fisici | €3 (€100 stampa / 33 conversioni) | 20% |
| Instagram organico | €0 (tempo founder) | 25% |
| Local PR (IlPiacenza, Confcommercio) | €0 | 10% |
| Google Ads (futuro) | €15-25 | 0% mese 6, 30% mese 12 |
| **CAC blended target** | **€5-10 mese 6** | |
| **CAC blended target** | **€15-20 mese 12** | |

### LTV/CAC ratio

- **Mese 6**: LTV €30 / CAC €7 = **4.3x** ✅ sano
- **Mese 12**: LTV €30 / CAC €18 = **1.6x** ⚠️ sotto target (3x)

→ A regime con paid acquisition, **serve aumentare LTV via**:
1. Frequenza ordini +1/mese → +50% LTV
2. Take rate +2% (10% vs 8%) → +25% revenue
3. Subscription PRO seller (revenue diretta, non per-buyer)

---

## Breakeven point

### Costi fissi mensili infrastruttura (no founder salary)

€280/mese (vedi business-plan.md)

### Calcolo breakeven

Se margine medio per ordine = **€0,30** (mix bilanciato):
- Ordini/mese per coprire costi: 280 / 0,30 = **~930 ordini/mese**
- Buyer attivi (2 ordini/mese): **~465 buyer**
- Seller necessari (3-5 ordini/mese/seller): **100-150 seller**

### Calcolo breakeven con subscription PRO

Se 30 seller pagano €15/mese = €450 sub revenue:
- Costi netti dopo sub: €280 - €450 = **-€170 (profitto)**
- → breakeven a 30 seller PRO + 50 buyer attivi

**Strategia consigliata**: spingere subscription PRO aggressivamente prima di
ottimizzare commissione. Subscription è MRR garantito; commissione è variabile.

---

## Sensitivity analysis

### Scenario ottimista (mese 12)

- 80 seller (40 PRO + 40 free)
- 500 buyer attivi (3 ordini/mese)
- 1500 ordini/mese × €25 = €37.5k GMV
- Revenue commissione: 1500 × €2 = €3k
- Revenue subscription: 40 × €15 = €600
- Costi: €280 fixed + 1500 × €1 variabile = €1780
- **Profitto netto: €1.8k/mese** ✅

### Scenario realistico (mese 12)

- 30 seller (10 PRO + 20 free)
- 200 buyer attivi (2 ordini/mese)
- 400 ordini/mese × €25 = €10k GMV
- Revenue commissione: 400 × €2 = €800
- Revenue subscription: 10 × €15 = €150
- Costi: €280 fixed + 400 × €1 variabile = €680
- **Profitto netto: €270/mese** ⚠️ break-even appena

### Scenario pessimista (mese 12)

- 10 seller (0 PRO)
- 50 buyer attivi (1 ordine/mese)
- 50 ordini/mese × €25 = €1.25k GMV
- Revenue: €100
- Costi: €280 + €50 = €330
- **Loss: -€230/mese** ❌ founder sotto-paga sé stesso

---

## Decisioni strategiche P0

1. **Lancio subscription PRO al day 1**: la sub salva la matematica.
2. **Spingere ritiro in negozio (-10%)**: ogni pickup = +€1.72 margine vs -€0.50 delivery.
3. **Free shipping threshold a €40** (non €30): aumenta GMV medio e ammortizza rider cost.
4. **COD limit a €50**: oltre, solo card. Frode + cash handling cost.
5. **Founder = rider primi 20 ordini**: zero rider cost finché non valida demand.

---

*Da rivedere ogni 30 ordini reali. I numeri sopra sono target, non realtà.*
