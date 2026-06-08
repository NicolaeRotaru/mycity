# quant-bot — trading bot intraday crypto (USDT-M)

Sistema di trading algoritmico intraday su **futures crypto USDT-M** (Bybit /
Binance), in Python `asyncio` + `ccxt`. Filosofia: **sopravvivenza del
capitale prima del profitto**. Niente codice giocattolo: circuit breaker,
sizing a rischio fisso, stop su ATR, take-profit parziale + trailing.

> Sottoprogetto autonomo dentro il monorepo `mycity` (l'app marketplace
> Next.js è cosa separata: questo vive isolato in `quant-bot/`).

> ⚠️ **Software educativo / di ricerca.** Il trading con leva può azzerare il
> capitale. Default in `DRY_RUN` (paper). Nessuna garanzia di profitto.

## Strategia — 3 filtri sequenziali (a cascata)

| # | Filtro | TF | Regola |
|---|---|---|---|
| 1 | **Regime** (EMA200) | 1H | prezzo > EMA200 → solo **Long**; < → solo **Short** |
| 2 | **Trigger** (RSI 14) | 5m | Long se RSI < 35; Short se RSI > 65 |
| 3 | **Volatilità** (ATR 14) | 5m | opera solo se `ATR%` ∈ [min, max] |

## Gestione del rischio (core)

- **Sizing dinamico:** rischio **1% del capitale attuale** per trade →
  `qty = (equity · 0.01) / distanza_stop`, con tetto di esposizione (leva ≤ 3x).
- **Stop su ATR:** `SL = entry ∓ 1.5·ATR` (mai percentuali fisse).
- **TP parziale + trailing:** chiudi 50% a R/R 1:1.5, poi trailing a 1·ATR sul
  residuo (con stop spostato a break-even).
- **Circuit breaker:** `equity_monitor()` ad ogni ciclo. Se l'equity tocca
  **−10%** (810 € su 900 €) → liquida tutto, cancella ordini, alert, termina.
- Freni aggiuntivi: stop morbido giornaliero **−3%**, profit-lock al **+1%**.

## Struttura

```
quant-bot/
├── config.py                 # TUTTI i parametri centralizzati
├── main.py                   # entrypoint + main_loop() asincrono
├── core/
│   ├── models.py             # dataclass condivise (Signal, Position, ...)
│   ├── data_fetcher.py       # OHLCV + real-time (ccxt async / pro)
│   ├── strategy_engine.py    # indicatori + segnali (3 filtri)
│   ├── risk_manager.py       # sizing, SL/TP, trailing, circuit breaker  ← CORE
│   ├── execution_engine.py   # ordini, retry/backoff, modalità paper
│   └── notifier.py           # alert Telegram (webhook)
├── utils/logger.py           # logging rotativo (DEBUG→ERROR)
├── backtest/
│   └── backtest_vectorbt.py  # backtest VectorBT + metriche
├── tests/
│   └── test_risk_manager.py  # 13 test deterministici del core (no rete)
├── docs/
│   ├── FEASIBILITY.md        # analisi win-rate & rischio drawdown
│   └── BACKTEST_PLAN.md      # piano di validazione pre-live
├── requirements.txt
└── .env.example
```

## Setup

```bash
cd quant-bot
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # compila le chiavi; lascia DRY_RUN=true
```

## Uso

```bash
# Test del core (nessuna dipendenza di rete, solo stdlib):
python tests/test_risk_manager.py        # -> 13/13 test superati

# Backtest su dati storici Bybit:
python -m backtest.backtest_vectorbt

# Avvio bot (paper di default):
python main.py
```

## Percorso verso il LIVE (non saltare passaggi)

1. `tests/` verdi → 2. **backtest** out-of-sample ok → 3. **forward test**
testnet ≥ 2 settimane coerente col backtest → 4. solo allora `DRY_RUN=false`.

Criteri di promozione e metriche: vedi [`docs/BACKTEST_PLAN.md`](docs/BACKTEST_PLAN.md).
Matematica di fattibilità (win rate, rischio −10%): [`docs/FEASIBILITY.md`](docs/FEASIBILITY.md).

## Disclaimer

Nessun consiglio finanziario. Usa a tuo rischio. Gli autori non sono
responsabili di perdite. Parti **sempre** da `DRY_RUN`/testnet.
