"""
utils/logger.py — Logging strutturato su file rotativo.

Livelli usati nel sistema:
  DEBUG   -> dati grezzi (OHLCV, valori indicatori) — rumoroso, solo su file
  INFO    -> eventi di trading (segnali, ingressi, uscite, PnL)
  WARNING -> anomalie non fatali (retry, dati mancanti, soglie sfiorate)
  ERROR   -> eccezioni critiche (kill switch, fallimenti ordine irrecuperabili)

Un trade bot senza log affidabili e' un'auto senza scatola nera: quando
salta, non saprai mai perche'.
"""

from __future__ import annotations

import logging
import os
from logging.handlers import RotatingFileHandler

_CONFIGURED = False


def setup_logging(
    log_dir: str,
    log_file: str,
    level: str = "INFO",
    max_bytes: int = 10 * 1024 * 1024,
    backup_count: int = 7,
) -> logging.Logger:
    """Configura il root logger una sola volta (idempotente)."""
    global _CONFIGURED

    root = logging.getLogger("quant")
    if _CONFIGURED:
        return root

    os.makedirs(log_dir, exist_ok=True)
    root.setLevel(logging.DEBUG)  # il root cattura tutto; gli handler filtrano

    fmt = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-7s | %(name)-18s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # File rotativo: tiene la storia completa a livello DEBUG.
    file_handler = RotatingFileHandler(
        os.path.join(log_dir, log_file),
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(fmt)

    # Console: solo il livello richiesto, per non sommergere l'operatore.
    console = logging.StreamHandler()
    console.setLevel(getattr(logging, level.upper(), logging.INFO))
    console.setFormatter(fmt)

    root.addHandler(file_handler)
    root.addHandler(console)
    root.propagate = False

    _CONFIGURED = True
    return root


def get_logger(name: str) -> logging.Logger:
    """Logger figlio namespaced (es. 'quant.risk', 'quant.exec')."""
    return logging.getLogger(f"quant.{name}")
