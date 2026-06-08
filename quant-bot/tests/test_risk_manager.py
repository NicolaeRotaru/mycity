"""
tests/test_risk_manager.py — Verifica deterministica del modulo CORE.

Il RiskManager non tocca la rete: e' puro input->output, quindi testabile a
tavolino. Questi test girano con la sola stdlib (niente ccxt/pandas) ed
eseguono il "contratto di sopravvivenza": circuit breaker, sizing, SL/TP,
take-profit parziale e trailing.

Esegui:  python tests/test_risk_manager.py     (oppure: pytest)
"""

from __future__ import annotations

import math
import os
import sys

# Rende importabile il package indipendentemente dalla cwd.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import CONFIG  # noqa: E402
from core.models import ActionType, Side, Signal  # noqa: E402
from core.risk_manager import RiskManager  # noqa: E402


def _rm() -> RiskManager:
    return RiskManager(CONFIG)


# --------------------------------------------------------------------- #
# D) Circuit breaker
# --------------------------------------------------------------------- #
def test_kill_switch_at_threshold():
    from core.models import RiskDecision
    assert _rm().equity_monitor(810.0) is RiskDecision.KILL_SWITCH
    assert _rm().equity_monitor(809.99) is RiskDecision.KILL_SWITCH


def test_kill_switch_latches():
    from core.models import RiskDecision
    rm = _rm()
    assert rm.equity_monitor(800.0) is RiskDecision.KILL_SWITCH
    # Anche se l'equity "risale", resta morto finche' un umano non riavvia.
    assert rm.equity_monitor(905.0) is RiskDecision.KILL_SWITCH


def test_continue_when_flat_pnl():
    from core.models import RiskDecision
    assert _rm().equity_monitor(900.0) is RiskDecision.CONTINUE


def test_halt_on_daily_loss():
    from core.models import RiskDecision
    # -3.33% rispetto ai 900 di apertura giornata -> stop morbido.
    assert _rm().equity_monitor(870.0) is RiskDecision.HALT_TRADING_DAY


def test_halt_on_daily_target():
    from core.models import RiskDecision
    # +1.1% -> target colpito -> chiude la giornata (profit lock).
    assert _rm().equity_monitor(910.0) is RiskDecision.HALT_TRADING_DAY


# --------------------------------------------------------------------- #
# B) Stop loss / Take profit basati su ATR
# --------------------------------------------------------------------- #
def test_stop_and_tp_long():
    rm = _rm()
    assert math.isclose(rm.compute_stop_loss(Side.LONG, 60000, 150), 59775.0)
    assert math.isclose(rm.compute_take_profit_1(Side.LONG, 60000, 150), 60337.5)


def test_stop_and_tp_short():
    rm = _rm()
    assert math.isclose(rm.compute_stop_loss(Side.SHORT, 60000, 150), 60225.0)
    assert math.isclose(rm.compute_take_profit_1(Side.SHORT, 60000, 150), 59662.5)


# --------------------------------------------------------------------- #
# A) Position sizing
# --------------------------------------------------------------------- #
def test_sizing_risk_based():
    rm = _rm()
    sl = rm.compute_stop_loss(Side.LONG, 60000, 150)  # dist = 225
    s = rm.calculate_position_size(900, 60000, sl)
    assert s.accepted and s.capped_by == "risk"
    assert math.isclose(s.qty, 0.04, rel_tol=1e-9)          # 9 / 225
    assert math.isclose(s.risk_amount, 9.0)                 # 1% di 900
    assert math.isclose(s.notional, 2400.0)


def test_sizing_capped_by_notional():
    rm = _rm()
    # Stop strettissimo -> il size a rischio esploderebbe -> taglia il notional.
    s = rm.calculate_position_size(900, 60000, 59990)       # dist = 10
    assert s.accepted and s.capped_by == "notional"
    assert math.isclose(s.qty, 0.045)                       # 2700 / 60000
    assert math.isclose(s.notional, 2700.0)                 # <= 3x capitale


def test_sizing_rejects_dust():
    rm = _rm()
    # Stop assurdamente largo -> notional sotto il minimo -> rifiuto.
    s = rm.calculate_position_size(900, 60000, 60000 - 600000)
    assert not s.accepted and s.capped_by == "rejected"


# --------------------------------------------------------------------- #
# C) Take profit parziale + trailing stop
# --------------------------------------------------------------------- #
def _long_position(rm: RiskManager):
    sig = Signal(Side.LONG, 60000.0, 150.0)
    sizing = rm.calculate_position_size(900, sig.entry_price,
                                        rm.compute_stop_loss(sig.side, 60000, 150))
    return rm.build_position(sig, sizing)


def test_initial_stop_hit():
    rm = _rm()
    pos = _long_position(rm)
    acts = rm.manage_open_position(pos, price=59770, atr=150)  # <= 59775
    assert acts[0].type is ActionType.CLOSE_ALL


def test_tp1_partial_and_breakeven():
    rm = _rm()
    pos = _long_position(rm)
    acts = rm.manage_open_position(pos, price=60340, atr=150)  # >= 60337.5
    kinds = [a.type for a in acts]
    assert ActionType.PARTIAL_CLOSE in kinds and ActionType.UPDATE_STOP in kinds
    partial = next(a for a in acts if a.type is ActionType.PARTIAL_CLOSE)
    assert math.isclose(partial.qty, 0.02)                    # 50% di 0.04
    assert pos.tp1_done and math.isclose(pos.stop_loss, 60000.0)  # SL -> break-even
    assert math.isclose(pos.qty, 0.02)


def test_trailing_then_exit():
    rm = _rm()
    pos = _long_position(rm)
    rm.manage_open_position(pos, price=60340, atr=150)        # attiva TP1 + trailing
    # Il prezzo corre: l'ancora sale, lo stop trailing la insegue a -1*ATR.
    up = rm.manage_open_position(pos, price=60800, atr=150)
    moved = next(a for a in up if a.type is ActionType.UPDATE_STOP)
    assert math.isclose(moved.new_stop, 60650.0)              # 60800 - 150
    assert all(a.type is not ActionType.CLOSE_ALL for a in up)
    # Ritracciamento sotto il trailing -> chiusura del residuo (run incassato).
    down = rm.manage_open_position(pos, price=60640, atr=150)
    assert any(a.type is ActionType.CLOSE_ALL for a in down)


# --------------------------------------------------------------------- #
# Runner standalone (senza pytest)
# --------------------------------------------------------------------- #
def _run_all() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  FAIL  {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            print(f"  ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{passed}/{len(tests)} test superati.")
    return 0 if passed == len(tests) else 1


if __name__ == "__main__":
    raise SystemExit(_run_all())
