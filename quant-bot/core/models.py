"""
core/models.py — Modelli di dominio condivisi.

Strutture dati immutabili/leggere che viaggiano tra i moduli (DataFetcher ->
StrategyEngine -> RiskManager -> ExecutionEngine) SENZA accoppiarli tra loro.
Ogni modulo conosce questi tipi, non l'implementazione degli altri.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


class Side(str, Enum):
    LONG = "long"
    SHORT = "short"

    @property
    def sign(self) -> int:
        """+1 per long, -1 per short. Comodo nei calcoli di PnL/stop."""
        return 1 if self is Side.LONG else -1

    @property
    def opposite(self) -> "Side":
        return Side.SHORT if self is Side.LONG else Side.LONG


class RiskDecision(str, Enum):
    """Esito del presidio rischio ad ogni ciclo."""
    CONTINUE = "continue"            # tutto ok, si puo' operare
    HALT_TRADING_DAY = "halt_day"    # stop morbido: niente nuovi trade oggi
    KILL_SWITCH = "kill_switch"      # stop duro: liquida tutto e termina


class ActionType(str, Enum):
    """Cosa l'ExecutionEngine deve fare su una posizione aperta."""
    HOLD = "hold"
    PARTIAL_CLOSE = "partial_close"  # chiusura parziale (TP1)
    CLOSE_ALL = "close_all"          # stop / trailing colpito
    UPDATE_STOP = "update_stop"      # sposta lo stop (break-even / trailing)


@dataclass(frozen=True)
class Signal:
    """Segnale generato dallo StrategyEngine dopo i 3 filtri sequenziali."""
    side: Side
    entry_price: float
    atr: float
    reason: str = ""
    ts: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass(frozen=True)
class SizingResult:
    """Output del position sizing: tutto cio' che serve per aprire."""
    qty: float                 # quantita' in unita' base (es. BTC)
    notional: float            # qty * prezzo (USDT)
    margin: float              # notional / leva
    leverage: float
    risk_amount: float         # quanto rischio in USDT se va allo stop
    stop_distance: float       # distanza prezzo->stop (USDT)
    capped_by: str             # 'risk' | 'notional' | 'margin' | 'rejected'
    accepted: bool = True


@dataclass
class TradeAction:
    """Istruzione atomica per l'ExecutionEngine."""
    type: ActionType
    qty: float = 0.0
    reason: str = ""
    new_stop: float | None = None


@dataclass
class Position:
    """Stato vivo di una posizione aperta (mutabile: lo aggiorna il RiskManager)."""
    side: Side
    entry_price: float
    qty: float                 # quantita' RESIDUA (scende dopo i parziali)
    initial_qty: float
    stop_loss: float
    take_profit_1: float
    atr_at_entry: float
    tp1_done: bool = False
    # Estremo raggiunto a favore (max per long, min per short): base del trailing.
    trail_anchor: float = 0.0
    opened_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def unrealized_r(self, price: float) -> float:
        """PnL non realizzato espresso in multipli di R (rischio iniziale)."""
        risk_per_unit = abs(self.entry_price - self._initial_stop())
        if risk_per_unit == 0:
            return 0.0
        return self.side.sign * (price - self.entry_price) / risk_per_unit

    def _initial_stop(self) -> float:
        # Lo stop iniziale e' entry -/+ 1.5*ATR; lo ricaviamo dall'ATR d'ingresso.
        return self.entry_price - self.side.sign * 1.5 * self.atr_at_entry
