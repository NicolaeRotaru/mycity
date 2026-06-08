"""
backtest/backtest_vectorbt.py — Backtest VectorBT della strategia.

Obiettivo: validare la logica su dati storici Bybit PRIMA di rischiare
capitale reale. Stessi indicatori e stesse soglie del live (StrategyEngine):
se diverge la simulazione dal live, e' un bug, non "mercato strano".

LIMITE NOTO (onesto): `Portfolio.from_signals` modella un'unica uscita per
trade. Il take-profit PARZIALE (50% a TP1) + trailing sul residuo si
approssima qui simulando DUE gambe separate e sommando le equity:
  - Gamba A (50% size): uscita fissa a TP1 (R/R 1:1.5) con SL 1.5*ATR.
  - Gamba B (50% size): trailing stop a 1*ATR (tsl_stop).
Per una replica esatta usare `from_order_func` (controllo ordine per ordine).

Esegui:  python -m backtest.backtest_vectorbt
"""

from __future__ import annotations

import asyncio

import numpy as np
import pandas as pd

try:
    import vectorbt as vbt
except ImportError:  # il file resta leggibile/documentato anche senza vbt
    vbt = None

import ccxt.async_support as ccxt
import pandas_ta as ta

from config import CONFIG


# --------------------------------------------------------------------- #
# 1. Download dati storici (paginazione completa)
# --------------------------------------------------------------------- #
async def fetch_history(symbol: str, timeframe: str, since_days: int) -> pd.DataFrame:
    ex = getattr(ccxt, CONFIG.EXCHANGE_ID)({"enableRateLimit": True,
                                            "options": {"defaultType": "swap"}})
    try:
        await ex.load_markets()
        since = ex.milliseconds() - since_days * 24 * 60 * 60 * 1000
        tf_ms = ex.parse_timeframe(timeframe) * 1000
        rows: list[list] = []
        while True:
            batch = await ex.fetch_ohlcv(symbol, timeframe, since=since, limit=1000)
            if not batch:
                break
            rows += batch
            since = batch[-1][0] + tf_ms
            if len(batch) < 1000:
                break
        df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])
        df["ts"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
        return df.set_index("ts").drop_duplicates()
    finally:
        await ex.close()


# --------------------------------------------------------------------- #
# 2. Costruzione segnali (identica allo StrategyEngine)
# --------------------------------------------------------------------- #
def build_signals(df_5m: pd.DataFrame, df_1h: pd.DataFrame) -> pd.DataFrame:
    out = df_5m.copy()
    out["rsi"] = ta.rsi(out["close"], length=CONFIG.RSI_LENGTH)
    out["atr"] = ta.atr(out["high"], out["low"], out["close"], length=CONFIG.ATR_LENGTH)
    out["atr_pct"] = out["atr"] / out["close"]

    # Regime 1H riallineato sul 5m (forward fill: la candela 1H "in corso"
    # detta il regime per i 5m che cadono al suo interno).
    ema = ta.ema(df_1h["close"], length=CONFIG.EMA_REGIME_LENGTH)
    regime = (df_1h["close"] > ema).astype(int) - (df_1h["close"] < ema).astype(int)
    out["regime"] = regime.reindex(out.index, method="ffill")

    vol_ok = (out["atr_pct"] >= CONFIG.ATR_PCT_MIN) & (out["atr_pct"] <= CONFIG.ATR_PCT_MAX)
    out["long_entry"] = (out["regime"] > 0) & (out["rsi"] < CONFIG.RSI_OVERSOLD) & vol_ok
    out["short_entry"] = (out["regime"] < 0) & (out["rsi"] > CONFIG.RSI_OVERBOUGHT) & vol_ok
    return out.dropna()


# --------------------------------------------------------------------- #
# 3. Backtest a due gambe (TP parziale + trailing) e metriche
# --------------------------------------------------------------------- #
def run_backtest(sig: pd.DataFrame) -> None:
    if vbt is None:
        raise RuntimeError("vectorbt non installato: pip install vectorbt")

    close = sig["close"]
    # SL/TP come frazione del prezzo, derivati dall'ATR all'ingresso.
    sl_pct = (CONFIG.ATR_SL_MULT * sig["atr"] / close)
    tp_pct = (CONFIG.TP1_RR * CONFIG.ATR_SL_MULT * sig["atr"] / close)
    tsl_pct = (CONFIG.TRAIL_ATR_MULT * sig["atr"] / close)

    long_e, short_e = sig["long_entry"], sig["short_entry"]
    fees = 0.0006  # taker
    cash = CONFIG.INITIAL_CAPITAL

    # Gamba A: 50% size, uscita a TP1 fissa (R/R 1:1.5) o SL.
    leg_a = vbt.Portfolio.from_signals(
        close, entries=long_e, short_entries=short_e,
        sl_stop=sl_pct, tp_stop=tp_pct,
        init_cash=cash * 0.5, fees=fees, freq="5min",
    )
    # Gamba B: 50% size, trailing stop a 1*ATR.
    leg_b = vbt.Portfolio.from_signals(
        close, entries=long_e, short_entries=short_e,
        sl_stop=tsl_pct, sl_trail=True,
        init_cash=cash * 0.5, fees=fees, freq="5min",
    )

    print("\n================  GAMBA A (TP1 50%)  ================")
    _print_metrics(leg_a)
    print("\n================  GAMBA B (Trailing 50%)  ==========")
    _print_metrics(leg_b)

    # Equity combinata (somma delle due gambe).
    combined = leg_a.value() + leg_b.value()
    total_ret = combined.iloc[-1] / combined.iloc[0] - 1.0
    dd = (combined / combined.cummax() - 1.0).min()
    print("\n================  PORTAFOGLIO COMBINATO  ===========")
    print(f"Rendimento totale : {total_ret:6.2%}")
    print(f"Max drawdown      : {dd:6.2%}")
    print(f"Equity finale     : {combined.iloc[-1]:.2f} (start {combined.iloc[0]:.2f})")


def _print_metrics(pf) -> None:
    """Le metriche che contano: rischio prima del rendimento."""
    try:
        print(f"Sharpe Ratio   : {pf.sharpe_ratio():.2f}")
        print(f"Sortino Ratio  : {pf.sortino_ratio():.2f}")
        print(f"Max Drawdown   : {pf.max_drawdown():.2%}")
        print(f"Profit Factor  : {pf.trades.profit_factor():.2f}")
        print(f"Win Rate       : {pf.trades.win_rate():.2%}")
        print(f"# Trade        : {pf.trades.count()}")
        print(f"Total Return   : {pf.total_return():.2%}")
    except Exception as e:
        print(f"(metriche parziali: {e})\n{pf.stats()}")


async def _amain() -> None:
    print(f"Scarico dati storici {CONFIG.SYMBOL} ...")
    df_5m = await fetch_history(CONFIG.SYMBOL, CONFIG.TIMEFRAME_TRIGGER, since_days=90)
    df_1h = await fetch_history(CONFIG.SYMBOL, CONFIG.TIMEFRAME_REGIME, since_days=120)
    print(f"5m: {len(df_5m)} candele | 1H: {len(df_1h)} candele")
    sig = build_signals(df_5m, df_1h)
    print(f"Segnali: {int(sig['long_entry'].sum())} long, {int(sig['short_entry'].sum())} short")
    run_backtest(sig)


if __name__ == "__main__":
    asyncio.run(_amain())
