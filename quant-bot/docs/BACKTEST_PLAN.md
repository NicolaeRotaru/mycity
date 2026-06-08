# Piano di backtest — validare l'edge prima del capitale reale

> Regola: **nessun euro reale finché l'edge non è dimostrato out-of-sample.**
> Il backtest non serve a "confermare" la strategia, serve a **provare a
> ucciderla**. Se sopravvive, forse ha un vantaggio.

## 0. Pipeline in 5 fasi

```
1. Dati storici Bybit  →  2. In-sample (tuning)  →  3. Out-of-sample (walk-forward)
        →  4. Stress / costi  →  5. Forward test su TESTNET (paper, tempo reale)
```

Il modulo `backtest/backtest_vectorbt.py` copre le fasi 1–3. Le fasi 4–5 sono
checklist operative qui sotto.

## 1. Dati

- **Sorgente:** stessa di produzione (Bybit via `ccxt`), per coerenza fee/tick.
- **Timeframe:** 5m (trigger) + 1H (regime). Scaricare ≥ 6–12 mesi di 5m.
- **Periodi:** includere **regimi diversi** — bull, bear, range, un crash
  (es. mar-2020, mag-2021, nov-2022). Una strategia che funziona solo nel
  bull non è una strategia, è leva mascherata.
- **Anti-lookahead:** segnali su **candela chiusa** (nel codice live si scarta
  l'ultima candela; nel backtest si usa `shift(1)` sugli ingressi se necessario).

## 2. In-sample vs Out-of-sample (walk-forward)

- Dividi: **70% in-sample** (calibrazione soglie: `ATR_PCT_MIN/MAX`, livelli
  RSI) / **30% out-of-sample** (mai toccato durante il tuning).
- Meglio ancora: **walk-forward** a finestre mobili (es. 3 mesi train → 1 mese
  test, avanza di 1 mese). L'edge deve reggere su **ogni** finestra di test,
  non solo in media.
- **Allarme overfitting:** se servono parametri "chirurgici" per andare in
  profitto, l'edge non esiste. Preferisci robustezza a perfezione.

## 3. Metriche da monitorare (in ordine di importanza)

| Metrica | Cosa dice | Soglia minima accettabile |
|---|---|---|
| **Max Drawdown** | quanto fa male nel caso peggiore | **< 10%** (coerente col kill switch) |
| **Sharpe Ratio** | rendimento per unità di rischio totale | **> 1.0** (idealmente > 1.5) |
| **Sortino Ratio** | come Sharpe ma punisce solo il downside | **> 1.5** |
| **Profit Factor** | lordo vinto / lordo perso | **> 1.3** |
| **Win Rate** | % trade vincenti | **≥ 45%** (vedi FEASIBILITY) |
| Expectancy (R) | guadagno medio per trade in R | **> 0** dopo i costi |
| # Trade | significatività statistica | **≥ 200** trade |

> Un backtest con < 100 trade non dimostra niente: è rumore. E uno Sharpe alto
> con un Profit Factor < 1.1 è fragile (vive di pochi outlier).

Estrazione in `backtest_vectorbt.py`:
```python
pf.sharpe_ratio(); pf.sortino_ratio(); pf.max_drawdown()
pf.trades.profit_factor(); pf.trades.win_rate(); pf.trades.count()
pf.stats()   # report completo
```

## 4. Stress test & costi reali (dove muoiono le strategie da slide)

- **Fee:** taker ~0.06% per lato → ~0.12% andata/ritorno. Già impostate
  (`fees=0.0006`) nel backtest. Su 5 trade/giorno sono ~0.6%/giorno di costi:
  enormi rispetto al target dell'1%. **Verifica che l'edge sopravviva alle fee.**
- **Slippage:** aggiungi 1–3 tick di slippage sugli ingressi a mercato.
- **Funding:** sui perp, ogni 8h. Per un bot intraday l'impatto è minore ma va
  stimato nei periodi di funding estremo.
- **Gap / stop slippage:** simula stop riempiti **peggio** di 1.5×ATR nei
  giorni di crash. Quanto cambia il Max Drawdown?
- **Sensibilità parametri:** muovi RSI 35→30/40 e ATR mult 1.5→1.2/2.0. Se le
  metriche crollano, l'edge è overfit.

## 5. Forward test su TESTNET (obbligatorio prima del live)

- Gira `main.py` con `DRY_RUN=true` **o** su testnet (`USE_TESTNET=true`) per
  **almeno 2–4 settimane** in tempo reale.
- Confronta i trade live-paper con quelli che il backtest avrebbe generato
  sugli stessi minuti: **devono coincidere**. Divergenze = bug di timing/dati.
- Verifica end-to-end: segnali, sizing, SL/TP, trailing, **kill switch**,
  retry su errori API, notifiche Telegram, rotazione log.

## 6. Criteri di promozione a LIVE (gate, non opinione)

Si passa a capitale reale **solo se TUTTI** veri:
- [ ] Edge positivo su **out-of-sample** e su **ogni** finestra walk-forward.
- [ ] Max Drawdown backtest **< 10%**, Sharpe **> 1**, Profit Factor **> 1.3**.
- [ ] Edge **sopravvive a fee + slippage + funding**.
- [ ] ≥ 200 trade nel campione.
- [ ] Forward test testnet ≥ 2 settimane **coerente** col backtest.
- [ ] Kill switch testato e funzionante (vedi `tests/`).

Mancato anche **uno** solo: si resta in paper. La pazienza è una posizione.
