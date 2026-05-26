# MyCity Piacenza — Acquisition Plan 90 giorni

> Versione 1.0 · piano concreto giorno per giorno per primi 90 giorni post-launch.

---

## Filosofia

> "Do things that don't scale" — Paul Graham

Pre-PMF, ogni canale automatico fallisce. Il founder è l'agente di vendita.
L'obiettivo NON è scalare: è arrivare a 10 seller + 50 buyer + 100 ordini reali
con cui imparare cosa funziona davvero.

**Budget marketing**: €100-300 totali (volantini stampa + caffè di pitch).

---

## Settimana 1-2: Setup & primi 5 seller

### Lunedì sett. 1 (operativo)
- ✅ Stampa 100 volantini A5 di pitch seller (costo €30)
- ✅ Account Instagram MyCity Piacenza aperto
- ✅ Numero WhatsApp Business attivato
- ✅ Email accessibilita@mycity-marketplace.com setup
- ✅ Google Business Profile creato (in attesa verifica)

### Martedì-Venerdì sett. 1 (door-to-door)
- ✅ 10 negozi target identificati (lista in fondo)
- ✅ Visita di persona, 30 min per ogni negozio
- ✅ Pitch demo 5 min con tablet/portatile
- ✅ Onboarding ON THE SPOT se accetta
- ✅ Carica TU 3-5 prodotti per ognuno
- ✅ Stampa QR code da appendere in vetrina

**Target sett. 1**: 3-5 seller approvati

### Sett. 2

- ✅ Iterate negozi sett. 1: foto migliori, prezzi controllati
- ✅ Altri 5 negozi visitati
- ✅ Daily story Instagram (1/giorno) con foto dei negozi onboarded
- ✅ Personal post Facebook a tutti gli amici di Piacenza ("Ho lanciato MyCity, dai un'occhiata")

**Target sett. 2**: 8-10 seller totali, primi 5 buyer signup (amici)

---

## Settimana 3-4: Primi 10 ordini

### Sett. 3 — Demand kickoff

- ✅ Newsletter "Venerdì del Mercato" issue #1: storia di 1 seller + offerta
- ✅ WhatsApp groups Piacenza (mamme di Piacenza, quartiere centro, ecc.) — annuncio (NON spam)
- ✅ Volantini A5 stampati 200 (€60)
- ✅ Distribuzione volantini sabato mattina al Mercato del Sabato
- ✅ Personal call ai primi 5 buyer per debrief

**Target sett. 3**: 5-10 ordini reali

### Sett. 4 — Tu = rider

- ✅ Tu fai TU la consegna dei primi 10 ordini
- ✅ Misura tempo dalla richiesta alla consegna
- ✅ Chiedi feedback dopo consegna (anche solo "com'è andata?")
- ✅ Scrivi lista 50 bug/miglioramenti

**Target sett. 4**: 10 consegne completate, 30+ feedback

---

## Settimana 5-6: Validation iniziale

### Sett. 5 — Iterate

- ✅ Fix top 10 bug critici
- ✅ Newsletter issue #2 con statistiche reali ("la prima settimana: 10 ordini, 5 negozi, 3 quartieri")
- ✅ Personal post LinkedIn (target: imprenditori Piacenza, possibili PR)
- ✅ Pitch a Confcommercio Piacenza (richiedi incontro tramite email ufficiale)

### Sett. 6 — Local PR

- ✅ Pitch a IlPiacenza.it (giornale locale): "Nasce a Piacenza un marketplace dei negozi"
- ✅ Pitch a Liberta.it (giornale storico Piacenza)
- ✅ Se accettano: 1 articolo = 200-500 click in 7 giorni
- ✅ Continua door-to-door: 5 nuovi negozi target

**Target sett. 6**: 15-20 seller, 30-50 buyer, 50+ ordini totali

---

## Settimana 7-8: Mobile + Trust audit

### Sett. 7 — Tech polish

- ✅ Audit mobile reale su iPhone + Android di parenti
- ✅ Fix top 5 problemi mobile
- ✅ Test screen reader VoiceOver / NVDA
- ✅ Audit pa11y per a11y violations

### Sett. 8 — Retention infra

- ✅ Attiva cron-job.org per `/api/cron/send-emails` ogni 10min
- ✅ Attiva cron-job.org per `/api/cron/abandoned-carts` ogni 1h
- ✅ Verifica 1 email lifecycle ricevuta a te stesso (test)
- ✅ Personal call ai primi 30 buyer per insight raccolta

**Target sett. 8**: 100+ buyer, 100+ ordini totali

---

## Settimana 9-10: Unit economics

### Sett. 9 — Numeri reali

- ✅ Calcola CAC reale: €marketing speso / nuovi buyer acquisiti
- ✅ Calcola LTV reale primi 30 buyer: ordini × margine medio
- ✅ Decisione: take rate finale (8% vs 10%) con 3 seller pilota
- ✅ Decisione: subscription PRO lanciata o aspetta?

### Sett. 10 — Quality bar

- ✅ Setup Sentry alerting (errore critico → email tua)
- ✅ Setup UptimeRobot 5 endpoint critici
- ✅ Test refund parziale end-to-end
- ✅ Test dispute resolution end-to-end
- ✅ Manual QA checklist 30-step eseguita pre-deploy

**Target sett. 10**: 200+ buyer attivi, 200+ ordini

---

## Settimana 11-13: Scale what works

### Sett. 11 — Identifica canale #1

- ✅ Analytics PostHog: quale canale ha portato più conversione?
- ✅ Probabilmente è word-of-mouth via negozi (referral organico)
- ✅ Investi 80% tempo sul canale #1

### Sett. 12 — Primo hire

- ✅ Recluta 1 rider freelance (Subito.it Piacenza, Indeed)
- ✅ Onboarding rider: 1 turno con te accanto
- ✅ Smettila di essere rider tu

### Sett. 13 — Decisione GO/NO-GO

Domande a cui rispondere:
1. **Ho 30+ seller attivi?** Sì → continua. No → ripensa supply strategy.
2. **Ho 200+ ordini consolidati negli ultimi 30gg?** Sì → continua. No → ripensa demand.
3. **Retention 30d > 30%?** Sì → continua. No → ripensa value proposition.
4. **Founder felice o burnout?** Felice → continua. Burnout → pausa, riconsidera.

Se 3+ Sì → **CONTINUA** con expansion plan (Parma o Reggio Emilia)
Se 2+ No → **PIVOT** (cambia verticale, target, modello)

---

## Lista 30 negozi target Piacenza (esempio)

### Centro storico
1. Salumeria del Borgo (Via Calzolai)
2. Forno Carradori (Piazza Cavalli)
3. Pasticceria San Bernardino
4. Libreria Romagnosi
5. Cartoleria Sereni
6. Erboristeria del Centro
7. Profumeria Tinelli
8. Macelleria Lazzati

### Periferia immediata (1-3 km)
9. Mercato Coperto Piazza Cittadella (10 banchi)
10. Frutta e Verdura Via Roma
11. Negozio Eco-bio Via XXIV Maggio
12. Pet Shop Via Emilia Pavese
13. Ottica Tarini
14. Calzature Pizzaballa

### Borghi e periferia
15. Salumeria di Borgotrebbia
16. Bottega Bio San Polo
17. Cartoleria San Lazzaro
... [completa lista]

---

## Materiale necessario

| Item | Costo | Dove |
|---|---|---|
| 100 volantini A5 pitch seller | €30 | Stampa locale |
| 200 volantini A5 pitch buyer | €60 | Stampa locale |
| Stampa QR vetrina (laminata) | €5/negozio | Stampa locale |
| Caffè al pitch (10 negozi) | €15 | Bar |
| Materiale Instagram (treppiede, ring light usata) | €30 | Amazon |
| **TOTALE 90 giorni** | **€150-200** | |

---

## KPI da tracciare ogni settimana

| Metrica | Sett. 1 | Sett. 6 | Sett. 13 |
|---|---|---|---|
| Seller attivi | 3 | 15 | 30+ |
| Buyer registrati | 5 | 50 | 300+ |
| Ordini cumulativi | 0 | 50 | 200+ |
| GMV cumulato | €0 | €1.2k | €5k+ |
| Activation rate (signup→1°ordine) | n/a | 20% | 35%+ |
| NPS | n/a | n/a | >50 |

---

## Anti-pattern (NON fare)

- ❌ Spendere su Google/Meta Ads prima di 50 ordini consolidati
- ❌ Aggiungere nuove feature al prodotto durante questi 90 giorni
- ❌ Espandere a Parma/Reggio prima di sett. 13
- ❌ Forzare KYC/SDI/burocrazia al seller il giorno 1 (chiediglielo prima del payout)
- ❌ Inviare email lifecycle prima di averla testata su te stesso
- ❌ Promettere "consegna in 1 ora" se non hai 5+ rider

---

*Documento vivo. Aggiorna ogni venerdì con dati reali della settimana.*
