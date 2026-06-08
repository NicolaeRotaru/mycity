# Analisi di fattibilità — quant-bot intraday

> Approccio cinico: prima i numeri, poi le speranze. Tutto ciò che segue
> assume trade i.i.d. (indipendenti, identicamente distribuiti). Il mercato
> reale **non** è i.i.d. (volatility clustering, gap, code grasse): quindi
> queste stime sono **ottimistiche**. Dimensiona per la coda, non per la media.

## 0. Definizioni

- **R (rischio unitario)** = distanza di stop = `1.5 × ATR`.
- Una perdita piena = **−1R**. Poiché il sizing fissa il rischio all'**1%**
  del capitale, vale comodamente: **1R ≈ 1% dell'equity ≈ 9 € iniziali**.
- **W** = vincita media in multipli di R (dipende da TP parziale + trailing).
- **p** = win rate. **N** = numero di trade al giorno.
- **Expectancy per trade (in R):**  `E[R] = p·W − (1 − p)`

## 1. Win rate minimo per essere in pari (break-even)

`E[R] = 0  ⇒  p* = 1 / (1 + W)`

| W (vincita media) | Win rate di break-even |
|------------------:|:----------------------:|
| 1.50              | **40.0 %**             |
| 1.75              | **36.4 %**             |
| 2.00              | **33.3 %**             |

Con take-profit a R/R 1:1.5, **sotto il ~40% di win rate si perde e basta**.
Il trailing sul 50% residuo serve proprio ad alzare W oltre 1.5 e abbassare
questa soglia.

## 2. Win rate necessario per +1 %/giorno

Poiché `1R ≈ 1%`, ottenere **+1%/giorno** significa accumulare **≈ +1R netto
al giorno**:  `N · E[R] = 1  ⇒  p = (1/N + 1) / (1 + W)`

| Trade/giorno (N) | W = 1.50 | W = 1.75 | W = 2.00 |
|-----------------:|:--------:|:--------:|:--------:|
| 2                | 60.0 %   | 54.5 %   | 50.0 %   |
| 3                | 53.3 %   | 48.5 %   | 44.4 %   |
| 5                | 48.0 %   | 43.6 %   | 40.0 %   |

**Lettura:** con 3–5 trade/giorno e un trailing decente (W≈1.75) serve un win
rate **45–49%**. È un obiettivo *ambizioso ma non fantascienza* per una mean-
reversion filtrata dal trend. Sotto i 3 trade/giorno la soglia sale in fretta.

## 3. Reality check sul compounding (la parte cinica)

| Target/giorno | Composto su 1 anno (365 gg) |
|--------------:|:----------------------------|
| +1.00 %       | `1.01^365 ≈ ` **37.8×**     |
| +0.33 %       | `1.0033^365 ≈ ` **3.33×**   |

Anche **solo il fondo del range** (+0.33%/giorno) implica **triplicare il
capitale in un anno**: roba da primo decile mondiale. Conclusione onesta:

> **+0.33%–1%/giorno NON è una media sostenibile, è un tetto per le belle
> giornate.** Vanno messi in conto molti giorni piatti o negativi. Tratta il
> +1% come *cap giornaliero* (vedi `STOP_ON_DAILY_TARGET`) e il −3% come
> freno morbido, lasciando al −10% il ruolo di rete ultima.

## 4. Probabilità di toccare il −10% (kill switch) in un mese

Il kill switch è un **floor assoluto a 810 €**, cioè **−10R** dal punto di
partenza. Modello: random walk con barriera assorbente. Per un processo con
drift `μ_R` e varianza `σ²_R` per trade, la probabilità di toccare *prima o
poi* la barriera a `−b·R` (b = 10) è:

`P_touch ≈ exp( −2 · μ_R · b / σ²_R )`

Con **W = 1.75** (quindi `μ_R = p·1.75 − (1−p)`):

| Win rate p | Drift μ_R/trade | P(toccare −10% nel mese) |
|-----------:|:---------------:|:------------------------:|
| 0.50       | +0.375 R        | **≈ 2 %**                |
| 0.45       | +0.238 R        | **≈ 8 %**                |
| 0.40       | +0.100 R        | **≈ 33 %**               |
| 0.36 (≈BE) | ≈ 0             | **≈ 45–55 %** (driftless, ~90–150 trade/mese) |

**Lettura senza sconti:**

- Con un **edge reale** (p ≥ 50%, W ≈ 1.75) il rischio mensile di stop-out al
  −10% è **basso (~2%)**. Il sistema è progettato per sopravvivere.
- **Senza edge** (win rate da lancio di moneta) toccare il −10% nel mese è
  **quasi un testa-o-croce**. Nessun money management salva una strategia
  senza vantaggio: rallenta solo la morte.
- Il **−10% hard stop trasforma il "rischio di rovina" (→0€) in un rischio di
  stop-out limitato**: con sizing all'1% del capitale *corrente* non puoi
  matematicamente azzerarti, e il kill switch impone la disciplina di
  fermarti a −90 € invece di mediare al ribasso nell'abisso.

### Caveat (perché la realtà è peggiore del modello)
- Trade **non indipendenti**: la volatilità si raggruppa → perdite a grappolo.
- **Code grasse / gap / flash crash**: lo stop può slittare oltre 1.5×ATR.
- **Funding, fee, slippage** erodono μ_R: una `E[R]` teorica di +0.2 può
  diventare ~0 dopo i costi. Vanno inclusi nel backtest (vedi BACKTEST_PLAN).

## 5. Verdetto

| Domanda | Risposta |
|---|---|
| Win rate min. per non perdere | **~40%** (W=1.5) |
| Win rate per +1%/giorno | **~45–49%** (N=3–5, W≈1.75) |
| +1%/giorno sostenibile? | **No**, è un cap per giorni buoni |
| Rischio −10% nel mese **con** edge | **basso (~2–8%)** |
| Rischio −10% nel mese **senza** edge | **~50%** |

Il sistema è **fattibile come macchina di sopravvivenza**. La sua redditività
dipende interamente dall'esistenza di un edge **dimostrato nel backtest e nel
forward test** — non dato per scontato. Finché l'edge non è provato su dati
out-of-sample, si gira in `DRY_RUN`/testnet.
