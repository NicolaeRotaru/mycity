/**
 * Dead-man's switch dei cron (audit 🟠-25).
 *
 * Ogni cron registra un heartbeat (tabella cron_heartbeats, scritta in modo
 * trasparente da withCronAuth); il cron operational-alerts confronta i heartbeat
 * con le soglie qui sotto e segnala quelli che hanno SMESSO di girare (scheduler
 * fermo, deploy rotto, secret cambiato…). È il "ti accorgi alle 3 di notte".
 *
 * Limite noto: operational-alerts NON può vigilare su sé stesso (se muore, niente
 * gira). Quel caso resta coperto dal monitor uptime esterno su /api/health.
 */

export type CronHeartbeat = { name: string; last_run_at: string | null };

/**
 * Massima staleness tollerata per cron (minuti) — qualche volta la cadenza
 * attesa, per non lampeggiare a ogni piccolo ritardo. NB: operational-alerts non
 * è in elenco (non può auto-vigilarsi).
 */
export const CRON_MAX_STALENESS_MIN: Record<string, number> = {
  'release-payouts': 120, // cadenza 15 min
  'send-emails': 120, // cadenza 10 min
  'send-push': 120, // cadenza 5 min
  'expire-checkouts': 180, // cadenza 30 min
  'expire-stale-orders': 180, // cadenza 30 min
  'abandoned-carts': 180, // cadenza 1 h
  'process-deletions': 1560, // cadenza 1×/giorno → 26 h
};

export type StaleCron = { name: string; staleMin: number; thresholdMin: number };

/**
 * Cron monitorati il cui ultimo heartbeat supera la soglia. I cron senza alcun
 * heartbeat vengono IGNORATI (mai registrati: evita lo spam prima che lo
 * scheduler sia configurato; la migrazione 095 li seed-a con last_run_at=now()).
 */
export function staleCrons(
  heartbeats: CronHeartbeat[],
  nowMs: number,
  thresholds: Record<string, number> = CRON_MAX_STALENESS_MIN,
): StaleCron[] {
  const last = new Map(heartbeats.map((h) => [h.name, h.last_run_at]));
  const out: StaleCron[] = [];
  for (const [name, thresholdMin] of Object.entries(thresholds)) {
    const ts = last.get(name);
    if (!ts) continue;
    const staleMin = Math.floor((nowMs - new Date(ts).getTime()) / 60_000);
    if (staleMin > thresholdMin) out.push({ name, staleMin, thresholdMin });
  }
  return out;
}
