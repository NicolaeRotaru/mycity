import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CRON_MAX_STALENESS_MIN, lavoriFermi } from '@/lib/cron-health';
import { avviaPostgresConIndirizzo, type PostgresConIndirizzo } from './riparazione-r01-pg';

/**
 * R01-019 — Dopo il rilascio il freno della veloce poteva risultare «mai partito», con un falso
 * allarme agli amministratori: i lavori nati dopo la 095 non avevano la riga iniziale in
 * cron_heartbeats, e la finestra di prima accensione si misurava dal battito piu' vecchio.
 */
const ROOT = process.cwd();
const MIG = join(ROOT, 'migrations');

/** I lavori seminati in cron_heartbeats da tutte le migrazioni, in ordine. */
function seminati(): Set<string> {
  const nomi = new Set<string>();
  for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIG, f), 'utf8');
    for (const blocco of sql.matchAll(/INSERT INTO public\.cron_heartbeats[^;]*;/gi)) {
      for (const m of blocco[0].matchAll(/\('([a-z0-9-]+)'\s*,/g)) nomi.add(m[1]);
    }
  }
  return nomi;
}

describe('R01-019 · ogni lavoro sorvegliato ha la sua riga iniziale', () => {
  it('ogni lavoro con una soglia e\' seminato in cron_heartbeats da una migrazione', () => {
    const s = seminati();
    const mancanti = Object.keys(CRON_MAX_STALENESS_MIN).filter((n) => !s.has(n));
    expect(mancanti).toEqual([]);
  });

  it('subito dopo il rilascio, con i battiti seminati, nessun lavoro risulta fermo', () => {
    const adesso = Date.UTC(2026, 10, 12, 12, 0, 0);
    const giornoFa = new Date(adesso - 25 * 3_600_000).toISOString();
    const appena = new Date(adesso - 60_000).toISOString();
    // I battiti come sono dopo la migrazione: i giornalieri vecchi di 25 ore, i seminati di adesso.
    const battiti = [...seminati()].map((name) => ({
      name,
      last_run_at: name === 'process-deletions' || name === 'riquadra-casse' ? giornoFa : appena,
    }));
    const soglie = { ...CRON_MAX_STALENESS_MIN, 'process-deletions': 1560 * 2, 'riquadra-casse': 1560 * 2 };
    expect(lavoriFermi(battiti, adesso, soglie).map((f) => f.name)).toEqual([]);
  });
});

describe('R01-019 · la migrazione semina senza toccare un battito vero', () => {
  let pg: PostgresConIndirizzo;
  beforeAll(() => { pg = avviaPostgresConIndirizzo(); });
  afterAll(() => { pg?.ferma(); });

  it('aggiunge le righe che mancano e lascia com\'e\' quella che c\'e\'', () => {
    pg.psql(readFileSync(join(MIG, '095_cron_heartbeats.sql'), 'utf8'));
    pg.psql("INSERT INTO public.cron_heartbeats VALUES ('veloce-non-confermata', '2026-01-01T00:00:00Z')");
    const file = readdirSync(MIG).find((f) => /^250_/.test(f));
    expect(file).toBeTruthy();
    pg.psql(readFileSync(join(MIG, file!), 'utf8'));
    pg.psql(readFileSync(join(MIG, file!), 'utf8'));
    expect(pg.psql("SELECT count(*) FROM public.cron_heartbeats WHERE name IN ('riquadra-casse','external-price-alerts')")).toBe('2');
    expect(pg.psql("SELECT to_char(last_run_at AT TIME ZONE 'UTC','YYYY-MM-DD') FROM public.cron_heartbeats WHERE name = 'veloce-non-confermata'")).toBe('2026-01-01');
  });
});
