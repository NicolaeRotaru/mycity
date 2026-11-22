import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

/**
 * L'ora di tolleranza del ripiego del conto della spesa AI si contava dalla memoria della copia:
 * su Vercel ogni copia nuova ripartiva da zero e l'errore «non risponde da oltre un'ora» poteva
 * non arrivare mai. Ora la prima volta che una copia va in ripiego scrive l'inizio nella riga
 * CHIAVE_RIPIEGO_DA di operational_alert_log (upsert che ignora i doppioni), la rilegge e prende
 * il valore piu' vecchio. Una riga rimasta da un guasto gia' finito non si prende, e quando il
 * conto risponde di nuovo la riga si toglie.
 */

const TIMEOUT = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
const righe = new Map<string, string>();
const rpcMock = vi.fn();
const errorMock = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), spesa: vi.fn(), error: (...a: unknown[]) => errorMock(...a) },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: (...a: unknown[]) => rpcMock(...a),
    // operational_alert_log finta, con le sole colonne vere: alert_key e last_sent_at.
    from: () => ({
      upsert: (riga: { alert_key: string; last_sent_at: string }, o?: { ignoreDuplicates?: boolean }) => {
        const nuova = !righe.has(riga.alert_key);
        if (nuova || !o?.ignoreDuplicates) righe.set(riga.alert_key, riga.last_sent_at);
        const esito = { data: nuova ? [{ alert_key: riga.alert_key }] : [], error: null };
        return { select: () => Promise.resolve(esito), then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) };
      },
      select: () => ({
        eq: (_c: string, k: string) => ({
          maybeSingle: async () => ({ data: righe.has(k) ? { last_sent_at: righe.get(k) } : null, error: null }),
        }),
      }),
      update: (nuovo: { last_sent_at: string }) => ({
        eq: (_c: string, k: string) => ({
          lt: (_d: string, soglia: string) => {
            const ultima = righe.get(k);
            const presa = ultima !== undefined && ultima < soglia;
            if (presa) righe.set(k, nuovo.last_sent_at);
            const esito = { data: presa ? [{ alert_key: k }] : [], error: null };
            return { select: () => Promise.resolve(esito), then: (r: (v: unknown) => unknown) => Promise.resolve(esito).then(r) };
          },
        }),
      }),
      delete: () => ({ eq: async (_c: string, k: string) => { righe.delete(k); return { error: null }; } }),
    }),
  }),
}));

const CHIAVE = 'ai-tetto-condiviso:ripiego-da';

/** Una copia nuova del sito: il modulo riletto da zero, senza la memoria di prima. */
async function nuovaCopia() {
  vi.resetModules();
  return import('@/lib/ai/tettoSpesa');
}

const erroriDellOra = () =>
  errorMock.mock.calls.filter((c) => String(c[0]).includes('non risponde da oltre un ora'));

describe('l ora di tolleranza del ripiego si conta fra le copie, non per copia', () => {
  beforeEach(() => {
    righe.clear();
    errorMock.mockClear();
    rpcMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('il guasto inizia su una copia; un ora e cinque minuti dopo una copia nuova sa che dura da allora', async () => {
    rpcMock.mockResolvedValue(TIMEOUT);
    const prima = await nuovaCopia();
    expect(prima.CHIAVE_RIPIEGO_DA).toBe(CHIAVE);
    await prima.spesaDiOggiCents();
    expect(righe.get(CHIAVE)).toBe('2026-11-22T10:00:00.000Z');

    vi.setSystemTime(new Date('2026-11-22T10:40:00Z'));
    await (await nuovaCopia()).spesaDiOggiCents();
    // Chi arriva dopo non sposta l'inizio.
    expect(righe.get(CHIAVE)).toBe('2026-11-22T10:00:00.000Z');
    expect(erroriDellOra()).toHaveLength(0);

    vi.setSystemTime(new Date('2026-11-22T11:05:00Z'));
    const terza = await nuovaCopia();
    await terza.spesaDiOggiCents();
    expect(terza.statoContoCondiviso().daMinuti, 'prima la copia nuova ripartiva da zero').toBeGreaterThanOrEqual(65);
    expect(erroriDellOra(), 'prima l errore dell ora non arrivava mai su copie nuove').toHaveLength(1);
  });

  it('una riga rimasta da un guasto gia finito non si prende: si riparte da adesso', async () => {
    righe.set(CHIAVE, '2026-11-22T06:00:00.000Z');
    const copia = await nuovaCopia();
    // Alle 9 il conto risponde: il guasto delle 6 e finito (e la riga e rimasta).
    vi.setSystemTime(new Date('2026-11-22T09:00:00Z'));
    rpcMock.mockResolvedValue({ data: 120, error: null });
    await copia.spesaDiOggiCents();

    vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
    rpcMock.mockResolvedValue(TIMEOUT);
    await copia.spesaDiOggiCents();
    expect(copia.statoContoCondiviso().daMinuti).toBe(0);
    expect(erroriDellOra()).toHaveLength(0);
    expect(righe.get(CHIAVE)).toBe('2026-11-22T10:00:00.000Z');
  });

  it('quando il conto risponde di nuovo la riga si toglie', async () => {
    rpcMock.mockResolvedValue(TIMEOUT);
    const copia = await nuovaCopia();
    await copia.spesaDiOggiCents();
    expect(righe.has(CHIAVE)).toBe(true);

    vi.setSystemTime(new Date('2026-11-22T10:20:00Z'));
    rpcMock.mockResolvedValue({ data: 120, error: null });
    await copia.spesaDiOggiCents();
    await Promise.resolve();
    expect(righe.has(CHIAVE)).toBe(false);
  });
});
