"""
core/strategy_engine.py — StrategyEngine: indicatori e segnali.

Implementa i 3 FILTRI SEQUENZIALI (non una combinazione casuale: e' una
cascata, ogni filtro puo' solo bocciare il trade del precedente):

  1. REGIME (1H, EMA200) ......... decide la DIREZIONE consentita
  2. TRIGGER (5m, RSI 14) ........ decide il MOMENTO d'ingresso
  3. VOLATILITA' (5m, ATR 14) .... decide se il mercato e' OPERABILE

Lo StrategyEngine e' puro: dentro dati (DataFrame), fuori un Signal o None.
Nessun side effect, nessuna chiamata di rete. Testabile su dati storici 1:1
con il backtest -> niente sorprese tra simulazione e live.
"""

from __future__ import annotations

import pandas as pd
import pandas_ta as ta

from config import Config
from core.models import Side, Signal
from utils.logger import get_logger


class StrategyEngine:
    def __init__(self, config: Config) -> None:
        self.cfg = config
        self.log = get_logger("strategy")

    # ------------------------------------------------------------------ #
    # Calcolo indicatori (vettoriale: identico a quello del backtest)
    # ------------------------------------------------------------------ #
    def regime_bias(self, df_1h: pd.DataFrame) -> Side | None:
        """Filtro 1 — EMA200 su 1H. Restituisce la direzione consentita."""
        if len(df_1h) < self.cfg.EMA_REGIME_LENGTH:
            self.log.debug("Regime: storia 1H insufficiente (%d candele).", len(df_1h))
            return None
        ema = ta.ema(df_1h["close"], length=self.cfg.EMA_REGIME_LENGTH)
        if ema is None or ema.iloc[-1] != ema.iloc[-1]:  # NaN guard
            return None
        close = df_1h["close"].iloc[-1]
        ema_now = ema.iloc[-1]
        if close > ema_now:
            return Side.LONG          # trend rialzista -> solo long
        if close < ema_now:
            return Side.SHORT         # trend ribassista -> solo short
        return None

    def compute_5m_indicators(self, df_5m: pd.DataFrame) -> tuple[float, float, float]:
        """Restituisce (close, rsi, atr) dell'ultima candela 5m chiusa."""
        rsi = ta.rsi(df_5m["close"], length=self.cfg.RSI_LENGTH)
        atr = ta.atr(
            df_5m["high"], df_5m["low"], df_5m["close"], length=self.cfg.ATR_LENGTH
        )
        close = float(df_5m["close"].iloc[-1])
        rsi_now = float(rsi.iloc[-1]) if rsi is not None else float("nan")
        atr_now = float(atr.iloc[-1]) if atr is not None else float("nan")
        return close, rsi_now, atr_now

    # ------------------------------------------------------------------ #
    # Generazione del segnale (cascata dei 3 filtri)
    # ------------------------------------------------------------------ #
    def generate_signal(self, df_5m: pd.DataFrame, df_1h: pd.DataFrame) -> Signal | None:
        # --- FILTRO 1: regime -----------------------------------------
        bias = self.regime_bias(df_1h)
        if bias is None:
            return None

        close, rsi, atr = self.compute_5m_indicators(df_5m)
        if rsi != rsi or atr != atr:  # NaN -> dati non pronti
            self.log.debug("Indicatori 5m non pronti (RSI/ATR = NaN).")
            return None

        # --- FILTRO 3: volatilita' (ATR come % del prezzo) ------------
        # Lo applico prima del trigger: se il mercato non e' operabile,
        # non importa cosa dice l'RSI.
        atr_pct = atr / close if close else 0.0
        if atr_pct < self.cfg.ATR_PCT_MIN:
            self.log.debug("Scartato: ATR%% %.4f < min %.4f (mercato morto).",
                           atr_pct, self.cfg.ATR_PCT_MIN)
            return None
        if atr_pct > self.cfg.ATR_PCT_MAX:
            self.log.warning("Scartato: ATR%% %.4f > max %.4f (rischio flash crash).",
                             atr_pct, self.cfg.ATR_PCT_MAX)
            return None

        # --- FILTRO 2: trigger RSI, coerente col regime ---------------
        if bias is Side.LONG and rsi < self.cfg.RSI_OVERSOLD:
            return self._signal(Side.LONG, close, atr,
                                f"LONG | regime>EMA200 | RSI {rsi:.1f}<{self.cfg.RSI_OVERSOLD} "
                                f"| ATR% {atr_pct:.3%}")
        if bias is Side.SHORT and rsi > self.cfg.RSI_OVERBOUGHT:
            return self._signal(Side.SHORT, close, atr,
                                f"SHORT | regime<EMA200 | RSI {rsi:.1f}>{self.cfg.RSI_OVERBOUGHT} "
                                f"| ATR% {atr_pct:.3%}")

        return None

    def _signal(self, side: Side, price: float, atr: float, reason: str) -> Signal:
        self.log.info("SEGNALE %s @ %.2f | %s", side.value.upper(), price, reason)
        return Signal(side=side, entry_price=price, atr=atr, reason=reason)
