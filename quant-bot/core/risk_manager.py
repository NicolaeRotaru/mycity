"""
core/risk_manager.py — RiskManager (CORE OBBLIGATORIO).

Responsabilita' (in ordine di priorita' per la SOPRAVVIVENZA):
  D) Circuit breaker / kill switch ........ equity_monitor()
  A) Position sizing dinamico ............. calculate_position_size()
  B) Stop loss basato su ATR .............. compute_stop_loss()
  C) Take profit parziale + trailing ...... manage_open_position()

Principio guida: il RiskManager NON sa nulla di exchange, websocket o API.
Riceve numeri (equity, prezzo, ATR), restituisce decisioni e azioni.
E' deterministico e quindi testabile a tavolino. Tutta la logica di
sopravvivenza vive qui, lontano dal rumore della rete.
"""

from __future__ import annotations

from datetime import datetime, timezone

from config import Config
from core.models import (
    ActionType,
    Position,
    RiskDecision,
    Side,
    Signal,
    SizingResult,
    TradeAction,
)
from utils.logger import get_logger


class RiskManager:
    def __init__(self, config: Config) -> None:
        self.cfg = config
        self.log = get_logger("risk")

        # Stato equity
        self.initial_capital: float = config.INITIAL_CAPITAL
        self.equity: float = config.INITIAL_CAPITAL
        self.peak_equity: float = config.INITIAL_CAPITAL

        # Stato giornaliero (per target/loss limit morbidi)
        self._day_key: str = self._today_key()
        self.day_start_equity: float = config.INITIAL_CAPITAL

        # Latch del kill switch: una volta scattato, non si disarma da solo.
        self.killed: bool = False

    # =================================================================== #
    # D) CIRCUIT BREAKER — la funzione piu' importante del bot
    # =================================================================== #
    def equity_monitor(self, current_equity: float) -> RiskDecision:
        """
        Eseguito AD OGNI CICLO. Aggiorna l'equity e decide se:
          - continuare (CONTINUE),
          - sospendere i nuovi trade per oggi (HALT_TRADING_DAY),
          - attivare il kill switch totale (KILL_SWITCH).

        Il kill switch e' un confronto con una soglia ASSOLUTA derivata dal
        capitale iniziale (es. 900 * 0.90 = 810), non un drawdown mobile:
        e' la rete di sicurezza ultima e non negoziabile.
        """
        self._roll_day_if_needed(current_equity)
        self.equity = current_equity
        self.peak_equity = max(self.peak_equity, current_equity)

        # --- HARD STOP (priorita' assoluta) ---
        if current_equity <= self.cfg.hard_stop_equity:
            if not self.killed:
                self.killed = True
                self._log_kill_event(current_equity)
            return RiskDecision.KILL_SWITCH

        if self.killed:
            # Una volta morti, si resta morti finche' un umano non riavvia.
            return RiskDecision.KILL_SWITCH

        # --- STOP MORBIDO GIORNALIERO ---
        daily_pnl_pct = self.daily_pnl_pct()
        if daily_pnl_pct <= -self.cfg.DAILY_MAX_LOSS_PCT:
            self.log.warning(
                "Stop morbido: perdita giornaliera %.2f%% <= -%.2f%%. "
                "Niente nuovi trade fino a domani.",
                daily_pnl_pct * 100, self.cfg.DAILY_MAX_LOSS_PCT * 100,
            )
            return RiskDecision.HALT_TRADING_DAY

        # --- TARGET GIORNALIERO RAGGIUNTO (profit lock) ---
        if self.cfg.STOP_ON_DAILY_TARGET and daily_pnl_pct >= self.cfg.DAILY_TARGET_PCT_MAX:
            self.log.info(
                "Target giornaliero raggiunto (+%.2f%%). Chiudo la giornata: "
                "non si restituisce al mercato cio' che si e' preso.",
                daily_pnl_pct * 100,
            )
            return RiskDecision.HALT_TRADING_DAY

        return RiskDecision.CONTINUE

    def _log_kill_event(self, equity: float) -> None:
        """Log forense del kill switch: timestamp + stato del portafoglio."""
        self.log.error(
            "=== KILL SWITCH ATTIVATO === ts=%s | equity=%.2f <= soglia=%.2f | "
            "capitale_iniziale=%.2f | drawdown=%.2f%% | picco=%.2f",
            datetime.now(timezone.utc).isoformat(),
            equity,
            self.cfg.hard_stop_equity,
            self.initial_capital,
            (equity / self.initial_capital - 1.0) * 100,
            self.peak_equity,
        )

    # =================================================================== #
    # B) STOP LOSS & TARGET basati su ATR (mai percentuali fisse)
    # =================================================================== #
    def compute_stop_loss(self, side: Side, entry: float, atr: float) -> float:
        """SL = entry -/+ (1.5 * ATR). Lo stop respira con la volatilita'."""
        return entry - side.sign * self.cfg.ATR_SL_MULT * atr

    def compute_take_profit_1(self, side: Side, entry: float, atr: float) -> float:
        """
        Primo target a R/R 1:1.5.
        R = distanza stop = ATR_SL_MULT * ATR. Profitto target = TP1_RR * R.
        """
        r = self.cfg.ATR_SL_MULT * atr
        return entry + side.sign * self.cfg.TP1_RR * r

    # =================================================================== #
    # A) POSITION SIZING DINAMICO
    # =================================================================== #
    def calculate_position_size(
        self, equity: float, entry: float, stop_loss: float
    ) -> SizingResult:
        """
        Size a rischio fisso 1% del capitale ATTUALE:

            qty = (equity * RISK_PER_TRADE_PCT) / distanza_stop_in_USDT

        Per i futures lineari USDT-M la perdita allo stop e'
        qty * |entry - stop|, quindi la formula isola direttamente la qty.

        Il size finale e' il MINIMO tra:
          1. size a rischio 1%,
          2. tetto di notional (leva max / esposizione),
          3. (opzionale) tetto di margine per trade.
        "Prendi sempre il piu' piccolo" = sopravvivenza prima del profitto.
        """
        stop_distance = abs(entry - stop_loss)
        if stop_distance <= 0 or entry <= 0 or equity <= 0:
            return SizingResult(0, 0, 0, self.cfg.MAX_LEVERAGE, 0, 0, "rejected", False)

        # (1) Size a rischio 1%
        risk_amount = equity * self.cfg.RISK_PER_TRADE_PCT
        qty_risk = risk_amount / stop_distance
        capped_by = "risk"

        # (2) Tetto di notional (esposizione massima = leva)
        max_notional = equity * self.cfg.MAX_POSITION_NOTIONAL_PCT
        qty_notional_cap = max_notional / entry
        qty = min(qty_risk, qty_notional_cap)
        if qty == qty_notional_cap and qty_notional_cap < qty_risk:
            capped_by = "notional"

        # (3) Tetto di margine per trade (disattivato di default — vedi config)
        if self.cfg.ENFORCE_MARGIN_CAP:
            max_margin = equity * self.cfg.MAX_MARGIN_PER_TRADE_PCT
            qty_margin_cap = (max_margin * self.cfg.MAX_LEVERAGE) / entry
            if qty_margin_cap < qty:
                qty, capped_by = qty_margin_cap, "margin"

        notional = qty * entry
        leverage = min(self.cfg.MAX_LEVERAGE, notional / equity) if equity else 0.0
        margin = notional / self.cfg.MAX_LEVERAGE

        # Rifiuto ordini "polvere" sotto il minimo notional dell'exchange.
        if notional < self.cfg.MIN_NOTIONAL_USDT:
            self.log.warning(
                "Size rifiutata: notional %.2f < minimo %.2f (stop troppo "
                "largo o capitale troppo piccolo per questo simbolo).",
                notional, self.cfg.MIN_NOTIONAL_USDT,
            )
            return SizingResult(0, notional, margin, leverage, risk_amount,
                                stop_distance, "rejected", False)

        self.log.info(
            "Sizing: qty=%.6f notional=%.2f margin=%.2f leva=%.2fx rischio=%.2f "
            "USDT (stop_dist=%.2f) cap=%s",
            qty, notional, margin, leverage, risk_amount, stop_distance, capped_by,
        )
        return SizingResult(qty, notional, margin, leverage, risk_amount,
                            stop_distance, capped_by, True)

    def build_position(self, signal: Signal, sizing: SizingResult) -> Position:
        """Assembla lo stato di una posizione a partire da segnale + sizing."""
        sl = self.compute_stop_loss(signal.side, signal.entry_price, signal.atr)
        tp1 = self.compute_take_profit_1(signal.side, signal.entry_price, signal.atr)
        return Position(
            side=signal.side,
            entry_price=signal.entry_price,
            qty=sizing.qty,
            initial_qty=sizing.qty,
            stop_loss=sl,
            take_profit_1=tp1,
            atr_at_entry=signal.atr,
            trail_anchor=signal.entry_price,  # parte dall'ingresso
        )

    # =================================================================== #
    # C) TAKE PROFIT PARZIALE + TRAILING STOP
    # =================================================================== #
    def manage_open_position(
        self, pos: Position, price: float, atr: float
    ) -> list[TradeAction]:
        """
        Macchina a stati della gestione del trade, valutata ad ogni tick:

          FASE 1 (pre-TP1):
            - prezzo colpisce lo stop      -> CLOSE_ALL (perdita 1R)
            - prezzo raggiunge TP1         -> PARTIAL_CLOSE 50% + sposta SL a BE
                                              + attiva trailing sul residuo
          FASE 2 (post-TP1, trailing attivo sul 50% residuo):
            - aggiorna l'ancora (estremo a favore)
            - trailing_stop = ancora -/+ 1*ATR (ATR corrente, non d'ingresso)
            - lo SL effettivo non scende mai sotto il break-even
            - prezzo colpisce lo SL effettivo -> CLOSE_ALL (incassa il run)

        Restituisce la lista di azioni per l'ExecutionEngine e AGGIORNA lo
        stato della posizione in-place (qty, stop, flag tp1).
        """
        actions: list[TradeAction] = []
        sgn = pos.side.sign

        # --- FASE 1: stop loss iniziale colpito ------------------------- #
        if not pos.tp1_done and self._stop_hit(pos.side, price, pos.stop_loss):
            actions.append(TradeAction(
                ActionType.CLOSE_ALL, qty=pos.qty,
                reason=f"Stop loss colpito @ {pos.stop_loss:.2f} (perdita ~1R)",
            ))
            return actions

        # --- FASE 1 -> 2: TP1 raggiunto --------------------------------- #
        if not pos.tp1_done and sgn * (price - pos.take_profit_1) >= 0:
            close_qty = pos.initial_qty * self.cfg.TP1_CLOSE_FRACTION
            actions.append(TradeAction(
                ActionType.PARTIAL_CLOSE, qty=close_qty,
                reason=f"TP1 @ R/R 1:{self.cfg.TP1_RR} colpito @ {price:.2f} "
                       f"-> chiudo {self.cfg.TP1_CLOSE_FRACTION:.0%}",
            ))
            pos.qty = max(0.0, pos.qty - close_qty)
            pos.tp1_done = True

            # Porta lo stop a break-even: da qui in poi il trade e' "gratis".
            if self.cfg.MOVE_SL_TO_BE_AFTER_TP1:
                pos.stop_loss = pos.entry_price
                actions.append(TradeAction(
                    ActionType.UPDATE_STOP, new_stop=pos.entry_price,
                    reason="SL spostato a break-even dopo TP1",
                ))
            pos.trail_anchor = price
            return actions

        # --- FASE 2: trailing stop sul residuo -------------------------- #
        if pos.tp1_done and pos.qty > 0:
            # Aggiorna l'estremo a favore.
            if pos.side is Side.LONG:
                pos.trail_anchor = max(pos.trail_anchor, price)
                trail_stop = pos.trail_anchor - self.cfg.TRAIL_ATR_MULT * atr
                effective_stop = max(trail_stop, pos.entry_price)  # mai sotto BE
            else:
                pos.trail_anchor = min(pos.trail_anchor, price)
                trail_stop = pos.trail_anchor + self.cfg.TRAIL_ATR_MULT * atr
                effective_stop = min(trail_stop, pos.entry_price)  # mai sopra BE

            # Aggiorna lo stop sull'exchange solo se si e' mosso a nostro favore.
            if sgn * (effective_stop - pos.stop_loss) > 0:
                pos.stop_loss = effective_stop
                actions.append(TradeAction(
                    ActionType.UPDATE_STOP, new_stop=effective_stop,
                    reason=f"Trailing stop -> {effective_stop:.2f} "
                           f"(ancora {pos.trail_anchor:.2f} - {self.cfg.TRAIL_ATR_MULT}*ATR)",
                ))

            if self._stop_hit(pos.side, price, pos.stop_loss):
                actions.append(TradeAction(
                    ActionType.CLOSE_ALL, qty=pos.qty,
                    reason=f"Trailing stop colpito @ {pos.stop_loss:.2f} — incasso il run",
                ))
                return actions

        if not actions:
            actions.append(TradeAction(ActionType.HOLD))
        return actions

    @staticmethod
    def _stop_hit(side: Side, price: float, stop: float) -> bool:
        """Long: prezzo <= stop. Short: prezzo >= stop."""
        return price <= stop if side is Side.LONG else price >= stop

    # =================================================================== #
    # Tracking giornaliero
    # =================================================================== #
    def daily_pnl_pct(self) -> float:
        if self.day_start_equity <= 0:
            return 0.0
        return self.equity / self.day_start_equity - 1.0

    def can_open_new_trade(self) -> bool:
        """Gate sintetico: si apre solo se il presidio rischio e' verde."""
        return self.equity_monitor(self.equity) is RiskDecision.CONTINUE

    @staticmethod
    def _today_key() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def _roll_day_if_needed(self, current_equity: float) -> None:
        """A mezzanotte UTC azzera l'ancora giornaliera (target/loss limit)."""
        key = self._today_key()
        if key != self._day_key:
            self.log.info(
                "Nuovo giorno %s. PnL di ieri: %.2f%%. Reset ancora giornaliera.",
                key, self.daily_pnl_pct() * 100,
            )
            self._day_key = key
            self.day_start_equity = current_equity
