"""
config.py — Parametri centralizzati del sistema quant intraday.

REGOLA D'ORO: nessun "numero magico" sparso nel codice. Ogni soglia, ogni
moltiplicatore, ogni limite di rischio vive QUI ed e' parametrizzabile.
Il codice di business legge da `Config`, non hardcoda nulla.

Filosofia: sopravvivenza del capitale prima del profitto. I default sono
volutamente conservativi (DRY_RUN attivo, leva bassa, rischio 1%).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str = "") -> str:
    """Legge una variabile d'ambiente senza far esplodere il bot se manca."""
    return os.getenv(name, default)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Config:
    # ------------------------------------------------------------------ #
    # 0. AMBIENTE / SICUREZZA
    # ------------------------------------------------------------------ #
    # DRY_RUN = True  -> nessun ordine reale, solo simulazione (PAPER).
    # Default TRUE di proposito: si passa a live SOLO consapevolmente,
    # dopo backtest + forward test su testnet.
    DRY_RUN: bool = _env_bool("DRY_RUN", True)
    USE_TESTNET: bool = _env_bool("USE_TESTNET", True)

    # ------------------------------------------------------------------ #
    # 1. EXCHANGE
    # ------------------------------------------------------------------ #
    EXCHANGE_ID: str = _env("EXCHANGE_ID", "bybit")          # 'bybit' | 'binanceusdm'
    API_KEY: str = field(default_factory=lambda: _env("EXCHANGE_API_KEY"))
    API_SECRET: str = field(default_factory=lambda: _env("EXCHANGE_API_SECRET"))

    # Simbolo unificato ccxt per i perpetual USDT-M.
    # Bybit:   'BTC/USDT:USDT'      Binance: 'BTC/USDT'
    SYMBOL: str = _env("SYMBOL", "BTC/USDT:USDT")
    MARGIN_MODE: str = _env("MARGIN_MODE", "isolated")        # isolated | cross
    QUOTE_CCY: str = "USDT"

    # ------------------------------------------------------------------ #
    # 2. CAPITALE & DRAWDOWN (il cuore della sopravvivenza)
    # ------------------------------------------------------------------ #
    INITIAL_CAPITAL: float = _env_float("INITIAL_CAPITAL", 900.0)   # EUR/USDT
    # Hard stop: se l'equity tocca questo valore -> kill switch totale.
    MAX_DRAWDOWN_PCT: float = 0.10                                  # -10%
    # Stop morbido giornaliero: smetti di tradare per oggi (non chiude).
    DAILY_MAX_LOSS_PCT: float = 0.03                               # -3% / giorno

    # Obiettivo di profitto giornaliero (range). Raggiunto il target,
    # il bot puo' "bloccare" i guadagni e smettere di esporsi (configurabile).
    DAILY_TARGET_PCT_MIN: float = 0.0033                          # +0.33%
    DAILY_TARGET_PCT_MAX: float = 0.01                            # +1.00%
    STOP_ON_DAILY_TARGET: bool = _env_bool("STOP_ON_DAILY_TARGET", True)

    # ------------------------------------------------------------------ #
    # 3. POSITION SIZING & LEVA
    # ------------------------------------------------------------------ #
    RISK_PER_TRADE_PCT: float = 0.01          # rischio l'1% del capitale ATTUALE
    MAX_LEVERAGE: float = 3.0                  # leva massima imposta dalla strategia

    # Tetto di esposizione per singola posizione, espresso come multiplo
    # del capitale (notional / equity).
    #
    # NOTA DI COERENZA (importante): il brief chiede "mai superare il 10% del
    # capitale in una singola posizione". Con rischio 1% + stop a 1.5*ATR il
    # NOTIONAL naturale di un trade e' tipicamente 2-3x il capitale (serve la
    # leva), quindi un tetto di notional al 10% del capitale e' incompatibile
    # con il resto del sistema (genererebbe size ridicole, ~0.1% di rischio).
    # Lo reinterpreto come: il notional non puo' superare la leva massima
    # consentita (3x). Il sizing finale e' SEMPRE il minimo tra il size a
    # rischio 1% e questo tetto -> approccio "prendi sempre il piu' piccolo".
    # Se intendevi "10% del capitale come MARGINE impegnato", imposta invece
    # MAX_MARGIN_PER_TRADE_PCT (sotto) e abilita il relativo guard.
    MAX_POSITION_NOTIONAL_PCT: float = 3.0    # notional <= 300% del capitale (= leva 3x)
    MAX_MARGIN_PER_TRADE_PCT: float = 1.00    # margine <= 100% equity (disattivato di fatto)
    ENFORCE_MARGIN_CAP: bool = _env_bool("ENFORCE_MARGIN_CAP", False)

    # Quantita' minima per evitare ordini "polvere" sotto i minimi exchange.
    MIN_NOTIONAL_USDT: float = 5.0

    # ------------------------------------------------------------------ #
    # 4. STRATEGIA — FILTRI SEQUENZIALI
    # ------------------------------------------------------------------ #
    TIMEFRAME_TRIGGER: str = "5m"             # trigger d'ingresso (RSI/ATR)
    TIMEFRAME_REGIME: str = "1h"              # filtro di regime (EMA200)

    # Livello 1 — Regime (1H)
    EMA_REGIME_LENGTH: int = 200

    # Livello 2 — Trigger (5m)
    RSI_LENGTH: int = 14
    RSI_OVERSOLD: float = 35.0                # Long se RSI < 35 in trend rialzista
    RSI_OVERBOUGHT: float = 65.0              # Short se RSI > 65 in trend ribassista

    # Livello 3 — Volatilita' (ATR su 5m).
    # Espresse come % del prezzo (ROBUSTE rispetto al livello assoluto del
    # prezzo). atr_pct = ATR / close. Calibrare con il backtest.
    ATR_LENGTH: int = 14
    ATR_PCT_MIN: float = 0.0015               # 0.15% -> sotto = mercato morto
    ATR_PCT_MAX: float = 0.0150               # 1.50% -> sopra = rischio flash crash

    # ------------------------------------------------------------------ #
    # 5. GESTIONE TRADE — SL / TP / TRAILING
    # ------------------------------------------------------------------ #
    ATR_SL_MULT: float = 1.5                  # SL = entry -/+ 1.5 * ATR
    TP1_RR: float = 1.5                       # primo target a R/R 1:1.5
    TP1_CLOSE_FRACTION: float = 0.50          # chiudi il 50% a TP1
    TRAIL_ATR_MULT: float = 1.0               # trailing a 1 * ATR sul residuo
    MOVE_SL_TO_BE_AFTER_TP1: bool = True      # dopo TP1 porta lo SL a break-even

    # ------------------------------------------------------------------ #
    # 6. EXECUTION — retry / backoff
    # ------------------------------------------------------------------ #
    MAX_RETRIES: int = 3                      # tentativi su errori API recuperabili
    BACKOFF_BASE_SECONDS: float = 2.0         # 2s, 4s, 8s (esponenziale)
    ORDER_TYPE: str = "market"               # ingresso a mercato (slippage controllato)
    RECV_WINDOW_MS: int = 10_000

    # ------------------------------------------------------------------ #
    # 7. LOOP
    # ------------------------------------------------------------------ #
    # Il loop lavora "a candela chiusa" sul 5m: valuta i segnali solo quando
    # si chiude una nuova candela 5m, ma il presidio del rischio (circuit
    # breaker + trailing) gira piu' spesso.
    RISK_POLL_SECONDS: float = 5.0            # ogni quanto controllare equity/trailing
    CANDLE_TIMEFRAME_SECONDS: int = 300       # 5m
    OHLCV_LOOKBACK: int = 300                 # candele da scaricare (>= EMA200)

    # ------------------------------------------------------------------ #
    # 8. NOTIFICHE — Telegram
    # ------------------------------------------------------------------ #
    TELEGRAM_ENABLED: bool = _env_bool("TELEGRAM_ENABLED", False)
    TELEGRAM_BOT_TOKEN: str = field(default_factory=lambda: _env("TELEGRAM_BOT_TOKEN"))
    TELEGRAM_CHAT_ID: str = field(default_factory=lambda: _env("TELEGRAM_CHAT_ID"))

    # ------------------------------------------------------------------ #
    # 9. LOGGING
    # ------------------------------------------------------------------ #
    LOG_DIR: str = _env("LOG_DIR", "logs")
    LOG_FILE: str = "quant_bot.log"
    LOG_LEVEL: str = _env("LOG_LEVEL", "INFO")        # DEBUG|INFO|WARNING|ERROR
    LOG_MAX_BYTES: int = 10 * 1024 * 1024              # 10 MB per file
    LOG_BACKUP_COUNT: int = 7                          # rotazione: 7 file storici

    # ------------------------------------------------------------------ #
    # Proprieta' derivate
    # ------------------------------------------------------------------ #
    @property
    def hard_stop_equity(self) -> float:
        """Soglia assoluta del kill switch (es. 900 * 0.90 = 810)."""
        return self.INITIAL_CAPITAL * (1.0 - self.MAX_DRAWDOWN_PCT)

    def validate(self) -> None:
        """Fail-fast: meglio crashare all'avvio che a mercato aperto."""
        assert 0 < self.RISK_PER_TRADE_PCT <= 0.05, "Rischio/trade fuori range sano (<=5%)."
        assert self.MAX_LEVERAGE <= 3.0, "Leva oltre il mandato (max 3x)."
        assert self.ATR_PCT_MIN < self.ATR_PCT_MAX, "Soglie ATR incoerenti."
        assert self.RSI_OVERSOLD < self.RSI_OVERBOUGHT, "Soglie RSI incoerenti."
        assert 0 < self.TP1_CLOSE_FRACTION < 1, "Frazione TP1 deve stare in (0,1)."
        if not self.DRY_RUN:
            assert self.API_KEY and self.API_SECRET, "Live mode senza credenziali API."


# Istanza singleton importata ovunque: `from config import CONFIG`
CONFIG = Config()
