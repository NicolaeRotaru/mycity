"""
core/execution_engine.py — ExecutionEngine: invio ordini, errori, retry.

Tutto cio' che "tocca i soldi" passa di qui. Due modalita':
  - DRY_RUN=True  -> PAPER: nessun ordine reale, contabilita' simulata
                     (con fee taker) per testare il loop end-to-end offline.
  - DRY_RUN=False -> LIVE: ordini reali via ccxt, con retry/backoff su
                     NetworkError / RateLimitExceeded / ExchangeError.

NB (brief): l'ExecutionEngine e' a livello SKELETON. I parametri esatti
degli ordini condizionati (stop/trailing) variano per exchange: qui si usa
l'interfaccia unificata ccxt; calibrare i `params` su Bybit/Binance prima
del live. Il modulo blindato e completo e' il RiskManager.
"""

from __future__ import annotations

import asyncio
from typing import Optional

import ccxt.async_support as ccxt
from ccxt.base.errors import ExchangeError, NetworkError, RateLimitExceeded

from config import Config
from core.models import Side
from utils.logger import get_logger

# Fee taker usata SOLO in modalita' paper per non sovrastimare il PnL.
# In live le fee reali arrivano dai fill dell'exchange.
DEFAULT_TAKER_FEE = 0.0006  # 0.06% (ordine di grandezza Bybit/Binance perp)


class ExecutionEngine:
    def __init__(self, config: Config) -> None:
        self.cfg = config
        self.log = get_logger("exec")
        self.exchange: Optional[ccxt.Exchange] = None

        # --- stato simulato (modalita' paper) ---
        self._sim_equity = config.INITIAL_CAPITAL
        self._sim_pos: dict | None = None  # {'side': Side, 'qty': float, 'entry': float}

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #
    async def connect(self) -> None:
        klass = getattr(ccxt, self.cfg.EXCHANGE_ID)
        self.exchange = klass({
            "apiKey": self.cfg.API_KEY,
            "secret": self.cfg.API_SECRET,
            "enableRateLimit": True,
            "options": {"defaultType": "swap", "recvWindow": self.cfg.RECV_WINDOW_MS},
        })
        if self.cfg.USE_TESTNET and hasattr(self.exchange, "set_sandbox_mode"):
            self.exchange.set_sandbox_mode(True)
        await self.exchange.load_markets()
        if not self.cfg.DRY_RUN:
            await self._set_leverage()
        self.log.info("ExecutionEngine pronto (dry_run=%s, testnet=%s).",
                      self.cfg.DRY_RUN, self.cfg.USE_TESTNET)

    async def close(self) -> None:
        if self.exchange is not None:
            await self.exchange.close()

    async def _set_leverage(self) -> None:
        try:
            await self._with_retry(
                lambda: self.exchange.set_leverage(self.cfg.MAX_LEVERAGE, self.cfg.SYMBOL),
                what="set_leverage",
            )
        except Exception as e:  # leva gia' impostata o non supportata: non fatale
            self.log.warning("set_leverage non riuscito (non fatale): %s", e)

    # ------------------------------------------------------------------ #
    # Equity (sorgente di verita' per il circuit breaker)
    # ------------------------------------------------------------------ #
    async def fetch_equity(self) -> float:
        """Equity totale del conto in USDT. In paper usa la contabilita' interna."""
        if self.cfg.DRY_RUN:
            return self._sim_equity
        bal = await self._with_retry(lambda: self.exchange.fetch_balance(), what="fetch_balance")
        total = bal.get("total", {}).get(self.cfg.QUOTE_CCY)
        return float(total) if total is not None else self._sim_equity

    # ------------------------------------------------------------------ #
    # Apertura / chiusura
    # ------------------------------------------------------------------ #
    async def open_market(self, side: Side, qty: float, ref_price: float) -> dict:
        """Ingresso a mercato. side LONG->buy, SHORT->sell."""
        order_side = "buy" if side is Side.LONG else "sell"
        if self.cfg.DRY_RUN:
            self._sim_pos = {"side": side, "qty": qty, "entry": ref_price}
            self._apply_fee(qty * ref_price)
            self.log.info("[PAPER] APRO %s qty=%.6f @ %.2f", side.value, qty, ref_price)
            return {"paper": True, "side": order_side, "qty": qty, "price": ref_price}

        order = await self._with_retry(
            lambda: self.exchange.create_order(
                self.cfg.SYMBOL, self.cfg.ORDER_TYPE, order_side, qty
            ),
            what="open_market",
        )
        self.log.info("APRO %s qty=%.6f (ordine %s)", side.value, qty, order.get("id"))
        return order

    async def reduce(self, side: Side, qty: float, ref_price: float, reason: str) -> dict:
        """Chiusura (totale o parziale) reduce-only. side = lato della POSIZIONE."""
        close_side = "sell" if side is Side.LONG else "buy"
        if self.cfg.DRY_RUN:
            realized = self._paper_realize(side, qty, ref_price)
            self.log.info("[PAPER] RIDUCO %s qty=%.6f @ %.2f | PnL=%.2f | %s",
                          side.value, qty, ref_price, realized, reason)
            return {"paper": True, "qty": qty, "pnl": realized}

        order = await self._with_retry(
            lambda: self.exchange.create_order(
                self.cfg.SYMBOL, "market", close_side, qty, None, {"reduceOnly": True}
            ),
            what="reduce",
        )
        self.log.info("RIDUCO %s qty=%.6f | %s", side.value, qty, reason)
        return order

    async def place_protective_stop(self, side: Side, qty: float, stop_price: float) -> dict:
        """
        Stop di protezione reduce-only (stop-market) lato exchange.
        Cosi' lo stop sopravvive anche se il bot perde la connessione.
        """
        close_side = "sell" if side is Side.LONG else "buy"
        if self.cfg.DRY_RUN:
            self.log.debug("[PAPER] STOP %s qty=%.6f @ %.2f", side.value, qty, stop_price)
            return {"paper": True, "stop": stop_price}
        return await self._with_retry(
            lambda: self.exchange.create_order(
                self.cfg.SYMBOL, "market", close_side, qty, None,
                {"reduceOnly": True, "triggerPrice": stop_price, "stopLossPrice": stop_price},
            ),
            what="place_protective_stop",
        )

    async def cancel_all(self) -> None:
        if self.cfg.DRY_RUN:
            self.log.debug("[PAPER] cancel_all_orders")
            return
        try:
            await self._with_retry(
                lambda: self.exchange.cancel_all_orders(self.cfg.SYMBOL), what="cancel_all"
            )
        except Exception as e:
            self.log.warning("cancel_all non riuscito: %s", e)

    async def liquidate_all(self, side: Side | None, qty: float, ref_price: float) -> None:
        """
        Procedura del kill switch: cancella ordini e chiude TUTTO a mercato.
        Idempotente e best-effort: non deve mai sollevare e bloccare lo shutdown.
        """
        self.log.error("LIQUIDAZIONE TOTALE in corso (kill switch / shutdown).")
        await self.cancel_all()
        if side is not None and qty > 0:
            try:
                await self.reduce(side, qty, ref_price, reason="LIQUIDAZIONE kill switch")
            except Exception as e:
                self.log.error("Chiusura forzata fallita: %s", e)

    # ------------------------------------------------------------------ #
    # Contabilita' paper
    # ------------------------------------------------------------------ #
    def _paper_realize(self, side: Side, qty: float, exit_price: float) -> float:
        if not self._sim_pos:
            return 0.0
        entry = self._sim_pos["entry"]
        pnl = side.sign * (exit_price - entry) * qty
        self._sim_equity += pnl
        self._apply_fee(qty * exit_price)
        self._sim_pos["qty"] = max(0.0, self._sim_pos["qty"] - qty)
        if self._sim_pos["qty"] <= 1e-12:
            self._sim_pos = None
        return pnl

    def _apply_fee(self, notional: float) -> None:
        self._sim_equity -= notional * DEFAULT_TAKER_FEE

    # ------------------------------------------------------------------ #
    # Retry con backoff esponenziale
    # ------------------------------------------------------------------ #
    async def _with_retry(self, fn, what: str):
        last_exc: Exception | None = None
        for attempt in range(1, self.cfg.MAX_RETRIES + 1):
            try:
                return await fn()
            except (RateLimitExceeded, NetworkError, ExchangeError) as e:
                last_exc = e
                wait = self.cfg.BACKOFF_BASE_SECONDS ** attempt
                self.log.warning("[%s] %s (tentativo %d/%d). Attendo %.1fs.",
                                 what, type(e).__name__, attempt, self.cfg.MAX_RETRIES, wait)
                await asyncio.sleep(wait)
        self.log.error("[%s] fallito dopo %d tentativi: %s", what, self.cfg.MAX_RETRIES, last_exc)
        raise last_exc  # type: ignore[misc]
