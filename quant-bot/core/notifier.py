"""
core/notifier.py — NotificationService: alert Telegram (webhook semplice).

Le notifiche sono "best-effort": un fallimento di rete sulla notifica NON
deve MAI propagarsi e fermare il bot. Per questo ogni invio e' avvolto in
try/except e, al massimo, logga un warning.

Setup: crea un bot con @BotFather, prendi il token, ricava la chat_id e
mettili in TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (env).
"""

from __future__ import annotations

import aiohttp

from config import Config
from utils.logger import get_logger


class NotificationService:
    def __init__(self, config: Config) -> None:
        self.cfg = config
        self.log = get_logger("notify")
        self._base = f"https://api.telegram.org/bot{config.TELEGRAM_BOT_TOKEN}/sendMessage"

    async def send(self, text: str) -> None:
        """Invia un messaggio Telegram. No-op se le notifiche sono disabilitate."""
        if not self.cfg.TELEGRAM_ENABLED:
            self.log.debug("Notifica (disabilitata): %s", text)
            return
        if not self.cfg.TELEGRAM_BOT_TOKEN or not self.cfg.TELEGRAM_CHAT_ID:
            self.log.warning("Telegram abilitato ma token/chat_id mancanti.")
            return

        payload = {
            "chat_id": self.cfg.TELEGRAM_CHAT_ID,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
        try:
            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(self._base, json=payload) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        self.log.warning("Telegram HTTP %s: %s", resp.status, body[:200])
        except Exception as e:  # rete giu' / DNS / timeout: non deve fermare il bot
            self.log.warning("Invio notifica fallito (non fatale): %s", e)

    async def alert(self, text: str) -> None:
        """Alert ad alta priorita' (kill switch, errori critici)."""
        await self.send(f"\U0001F6A8 <b>ALERT</b>\n{text}")

    async def trade(self, text: str) -> None:
        """Notifica di evento di trading (ingresso/uscita)."""
        await self.send(f"\U0001F4C8 {text}")
