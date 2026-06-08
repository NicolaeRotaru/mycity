"""
main.py — Entrypoint e main_loop() asincrono.

Orchestrazione (a candele chiuse sul 5m, con presidio rischio ad alta
frequenza):

  ogni RISK_POLL_SECONDS:
    1. fetch equity -> equity_monitor() [CIRCUIT BREAKER, priorita' assoluta]
    2. se c'e' una posizione aperta -> manage_open_position() (TP1/trailing/stop)

  ad ogni NUOVA candela 5m chiusa:
    3. genera il segnale (3 filtri sequenziali)
    4. se flat e rischio verde -> sizing -> apri + piazza stop protettivo

Shutdown pulito (SIGINT/SIGTERM o kill switch): cancella ordini, flat della
posizione, alert, chiusura connessioni. Un bot che non sa morire bene e' un
bot pericoloso.
"""

from __future__ import annotations

import asyncio
import signal
from datetime import datetime, timezone

from config import CONFIG
from core.data_fetcher import DataFetcher
from core.execution_engine import ExecutionEngine
from core.models import ActionType, Position, RiskDecision
from core.notifier import NotificationService
from core.risk_manager import RiskManager
from core.strategy_engine import StrategyEngine
from utils.logger import get_logger, setup_logging


class TradingBot:
    def __init__(self) -> None:
        CONFIG.validate()
        setup_logging(CONFIG.LOG_DIR, CONFIG.LOG_FILE, CONFIG.LOG_LEVEL,
                      CONFIG.LOG_MAX_BYTES, CONFIG.LOG_BACKUP_COUNT)
        self.log = get_logger("main")

        self.data = DataFetcher(CONFIG)
        self.exec = ExecutionEngine(CONFIG)
        self.strategy = StrategyEngine(CONFIG)
        self.risk = RiskManager(CONFIG)
        self.notifier = NotificationService(CONFIG)

        self.position: Position | None = None
        self._running = True
        self._last_closed_ts: datetime | None = None
        self._latest_atr: float = 0.0

    # ------------------------------------------------------------------ #
    # Ciclo principale
    # ------------------------------------------------------------------ #
    async def main_loop(self) -> None:
        await self.data.connect()
        await self.exec.connect()
        await self.notifier.send(
            f"\U0001F916 Bot avviato | {CONFIG.SYMBOL} | dry_run={CONFIG.DRY_RUN} "
            f"| capitale={CONFIG.INITIAL_CAPITAL:.0f} | hard stop={CONFIG.hard_stop_equity:.0f}"
        )
        self.log.info("Avvio main_loop. Hard stop equity = %.2f", CONFIG.hard_stop_equity)

        try:
            while self._running:
                await self._cycle()
                await asyncio.sleep(CONFIG.RISK_POLL_SECONDS)
        except asyncio.CancelledError:
            self.log.info("Loop cancellato (shutdown).")
        finally:
            await self._shutdown()

    async def _cycle(self) -> None:
        # --- 1. CIRCUIT BREAKER (sempre per primo) ---------------------
        try:
            equity = await self.exec.fetch_equity()
        except Exception as e:
            # Se non riusciamo a leggere l'equity, NON apriamo nuovi rischi.
            self.log.error("Impossibile leggere equity: %s. Ciclo saltato.", e)
            return

        decision = self.risk.equity_monitor(equity)
        if decision is RiskDecision.KILL_SWITCH:
            await self._trigger_kill_switch(equity)
            return

        # --- 2. Gestione posizione aperta (TP1 / trailing / stop) ------
        if self.position is not None:
            await self._manage_position()

        # --- 3-4. Valutazione su nuova candela 5m ----------------------
        await self._maybe_evaluate_signal(equity, decision)

    # ------------------------------------------------------------------ #
    # Gestione posizione (alta frequenza)
    # ------------------------------------------------------------------ #
    async def _manage_position(self) -> None:
        assert self.position is not None
        try:
            price = await self.data.fetch_latest_price()
        except Exception as e:
            self.log.warning("Prezzo non disponibile per la gestione: %s", e)
            return

        atr = self._latest_atr or self.position.atr_at_entry
        for action in self.risk.manage_open_position(self.position, price, atr):
            if action.type is ActionType.HOLD:
                continue
            elif action.type is ActionType.PARTIAL_CLOSE:
                await self.exec.reduce(self.position.side, action.qty, price, action.reason)
                await self.notifier.trade(f"TP1 parziale {CONFIG.SYMBOL}: {action.reason}")
            elif action.type is ActionType.UPDATE_STOP:
                await self.exec.place_protective_stop(
                    self.position.side, self.position.qty, action.new_stop or 0.0
                )
            elif action.type is ActionType.CLOSE_ALL:
                await self.exec.reduce(self.position.side, self.position.qty, price, action.reason)
                await self.notifier.trade(f"Chiusura {CONFIG.SYMBOL}: {action.reason}")
                self.log.info("Posizione chiusa: %s", action.reason)
                self.position = None
                break

    # ------------------------------------------------------------------ #
    # Valutazione segnale (a candela chiusa)
    # ------------------------------------------------------------------ #
    async def _maybe_evaluate_signal(self, equity: float, decision: RiskDecision) -> None:
        try:
            df_5m = await self.data.fetch_ohlcv_df(CONFIG.TIMEFRAME_TRIGGER)
        except Exception as e:
            self.log.warning("Fetch 5m fallito: %s", e)
            return

        closed_ts = df_5m.index[-1].to_pydatetime()
        if self._last_closed_ts is not None and closed_ts <= self._last_closed_ts:
            return  # nessuna nuova candela: niente da fare
        self._last_closed_ts = closed_ts

        # Aggiorna l'ATR corrente (serve al trailing della posizione).
        _, _, self._latest_atr = self.strategy.compute_5m_indicators(df_5m)

        # Si APRE solo se: nessuna posizione + rischio verde.
        if self.position is not None or decision is not RiskDecision.CONTINUE:
            return

        try:
            df_1h = await self.data.fetch_ohlcv_df(CONFIG.TIMEFRAME_REGIME)
        except Exception as e:
            self.log.warning("Fetch 1H fallito: %s", e)
            return

        signal = self.strategy.generate_signal(df_5m, df_1h)
        if signal is None:
            return

        # --- Sizing + apertura -----------------------------------------
        sl = self.risk.compute_stop_loss(signal.side, signal.entry_price, signal.atr)
        sizing = self.risk.calculate_position_size(equity, signal.entry_price, sl)
        if not sizing.accepted:
            self.log.info("Segnale valido ma size rifiutata (cap=%s).", sizing.capped_by)
            return

        await self.exec.open_market(signal.side, sizing.qty, signal.entry_price)
        self.position = self.risk.build_position(signal, sizing)
        await self.exec.place_protective_stop(
            self.position.side, self.position.qty, self.position.stop_loss
        )
        await self.notifier.trade(
            f"APERTA {signal.side.value.upper()} {CONFIG.SYMBOL} @ {signal.entry_price:.2f}\n"
            f"qty={sizing.qty:.6f} SL={self.position.stop_loss:.2f} "
            f"TP1={self.position.take_profit_1:.2f} rischio={sizing.risk_amount:.2f} USDT"
        )

    # ------------------------------------------------------------------ #
    # Kill switch & shutdown
    # ------------------------------------------------------------------ #
    async def _trigger_kill_switch(self, equity: float) -> None:
        side = self.position.side if self.position else None
        qty = self.position.qty if self.position else 0.0
        price = 0.0
        try:
            price = await self.data.fetch_latest_price()
        except Exception:
            pass
        await self.exec.liquidate_all(side, qty, price)
        self.position = None
        await self.notifier.alert(
            f"KILL SWITCH @ {datetime.now(timezone.utc).isoformat()}\n"
            f"equity={equity:.2f} <= soglia={CONFIG.hard_stop_equity:.2f}\n"
            f"Tutto liquidato. Processo in arresto."
        )
        self.log.error("Kill switch eseguito. Arresto del processo.")
        self._running = False  # termina il loop -> _shutdown()

    async def _shutdown(self) -> None:
        self.log.info("Shutdown: flat della posizione e chiusura connessioni.")
        if self.position is not None:
            price = 0.0
            try:
                price = await self.data.fetch_latest_price()
            except Exception:
                pass
            await self.exec.liquidate_all(self.position.side, self.position.qty, price)
            self.position = None
        await self.exec.close()
        await self.data.close()
        await self.notifier.send("\U0001F6D1 Bot arrestato. Connessioni chiuse.")

    def request_stop(self, *_: object) -> None:
        self.log.warning("Segnale di stop ricevuto. Chiusura ordinata in corso...")
        self._running = False


async def _amain() -> None:
    bot = TradingBot()
    loop = asyncio.get_running_loop()
    # Shutdown pulito su Ctrl-C / SIGTERM (orchestratori, container).
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, bot.request_stop)
        except NotImplementedError:
            pass  # Windows: si fa affidamento su KeyboardInterrupt
    await bot.main_loop()


if __name__ == "__main__":
    try:
        asyncio.run(_amain())
    except KeyboardInterrupt:
        pass
