"""
core/data_fetcher.py — DataFetcher: OHLCV e dati real-time (ccxt async).

Responsabilita': portare dati PULITI dal mercato al sistema.
  - REST: fetch_ohlcv_df() per le candele chiuse (sorgente di verita').
  - WS:   watch_price() opzionale via ccxt.pro per il prezzo a tick
          (utile per stop/trailing reattivi).

Regola: i segnali si valutano SOLO su candele CHIUSE. L'ultima candela
"in corso" restituita da ccxt viene scartata per evitare repainting.
"""

from __future__ import annotations

import asyncio
from typing import Optional

import ccxt.async_support as ccxt
import pandas as pd
from ccxt.base.errors import ExchangeError, NetworkError, RateLimitExceeded

from config import Config
from utils.logger import get_logger

_OHLCV_COLS = ["ts", "open", "high", "low", "close", "volume"]


class DataFetcher:
    def __init__(self, config: Config) -> None:
        self.cfg = config
        self.log = get_logger("data")
        self.exchange: Optional[ccxt.Exchange] = None

    async def connect(self) -> None:
        """Crea il client PUBBLICO (no chiavi: scarica solo dati di mercato)."""
        klass = getattr(ccxt, self.cfg.EXCHANGE_ID)
        self.exchange = klass({
            "enableRateLimit": True,
            "options": {"defaultType": "swap"},  # perpetual USDT-M
        })
        if self.cfg.USE_TESTNET and hasattr(self.exchange, "set_sandbox_mode"):
            self.exchange.set_sandbox_mode(True)
        await self.exchange.load_markets()
        self.log.info("DataFetcher connesso a %s (testnet=%s).",
                      self.cfg.EXCHANGE_ID, self.cfg.USE_TESTNET)

    async def close(self) -> None:
        if self.exchange is not None:
            await self.exchange.close()

    async def fetch_ohlcv_df(self, timeframe: str, limit: int | None = None) -> pd.DataFrame:
        """
        Scarica le OHLCV e le normalizza in DataFrame indicizzato sul tempo.
        Scarta l'ultima candela (potenzialmente non chiusa) -> niente repaint.
        Include retry con backoff esponenziale.
        """
        limit = limit or self.cfg.OHLCV_LOOKBACK
        raw = await self._with_retry(
            lambda: self.exchange.fetch_ohlcv(self.cfg.SYMBOL, timeframe, limit=limit),
            what=f"fetch_ohlcv {timeframe}",
        )
        df = pd.DataFrame(raw, columns=_OHLCV_COLS)
        df["ts"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
        df = df.set_index("ts")
        # Drop dell'ultima candela in formazione.
        if len(df) > 1:
            df = df.iloc[:-1]
        self.log.debug("OHLCV %s: %d candele chiuse, ultima @ %s close=%.2f",
                       timeframe, len(df), df.index[-1], df["close"].iloc[-1])
        return df

    async def fetch_latest_price(self) -> float:
        """Ultimo prezzo via ticker REST (fallback se il WS non e' attivo)."""
        t = await self._with_retry(
            lambda: self.exchange.fetch_ticker(self.cfg.SYMBOL), what="fetch_ticker"
        )
        return float(t["last"])

    async def watch_price(self):
        """
        Generatore async del prezzo a tick via WebSocket (ccxt.pro).
        Da usare per un trailing stop reattivo. Se l'exchange/installazione
        non supporta i WS, alza AttributeError -> il loop usa il REST.
        """
        while True:
            ticker = await self.exchange.watch_ticker(self.cfg.SYMBOL)  # type: ignore[attr-defined]
            yield float(ticker["last"])

    # ------------------------------------------------------------------ #
    # Retry con backoff esponenziale (2s, 4s, 8s...)
    # ------------------------------------------------------------------ #
    async def _with_retry(self, fn, what: str):
        last_exc: Exception | None = None
        for attempt in range(1, self.cfg.MAX_RETRIES + 1):
            try:
                return await fn()
            except RateLimitExceeded as e:
                last_exc = e
                wait = self.cfg.BACKOFF_BASE_SECONDS ** attempt
                self.log.warning("[%s] rate limit (tentativo %d/%d). Attendo %.1fs.",
                                 what, attempt, self.cfg.MAX_RETRIES, wait)
                await asyncio.sleep(wait)
            except (NetworkError, ExchangeError) as e:
                last_exc = e
                wait = self.cfg.BACKOFF_BASE_SECONDS ** attempt
                self.log.warning("[%s] errore rete/exchange: %s (tentativo %d/%d). Attendo %.1fs.",
                                 what, e, attempt, self.cfg.MAX_RETRIES, wait)
                await asyncio.sleep(wait)
        self.log.error("[%s] fallito dopo %d tentativi: %s",
                       what, self.cfg.MAX_RETRIES, last_exc)
        raise last_exc  # type: ignore[misc]
