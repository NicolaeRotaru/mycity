import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { upsert, warn } = vi.hoisted(() => ({ upsert: vi.fn(), warn: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: vi.fn(),
  getServerSupabase: vi.fn(async () => ({ from: vi.fn() })),
  getAdminSupabase: vi.fn(() => ({ from: vi.fn(() => ({ upsert })) })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { withCronAuth } from '@/lib/api/middleware';

/**
 * IL BATTITO ERA SPARATO E DIMENTICATO.
 *
 * Radiografia del 27/8/2026 (R181). Ogni lavoro periodico lascia un battito in
 * `cron_heartbeats`, e `operational-alerts` guarda quei battiti per accorgersi
 * se un lavoro ha SMESSO di girare. Ma il battito partiva come
 * `void recordCronHeartbeat(req)`: lanciato e non atteso.
 *
 * Su Vercel una funzione puo' essere spenta appena ha risposto. Un lavoro
 * lanciato senza aspettarlo puo' morire a meta' o non partire affatto. La
 * conseguenza e' la peggiore possibile per un sensore: il lavoro gira benissimo,
 * il battito non viene scritto, e il sorvegliante annuncia che il lavoro e'
 * fermo. Allarmi falsi finche' nessuno li guarda piu'.
 *
 * Aspettarlo costa pochi millisecondi su un lavoro periodico, dove il tempo di
 * risposta non lo guarda nessuno.
 *
 * Queste prove non cercano la parola `await` nel sorgente: costruiscono una
 * scrittura che si blocca a comando e guardano SE la risposta arriva prima.
 */

function req(): NextRequest {
  return {
    headers: new Headers({ authorization: 'Bearer segreto-di-prova' }),
    nextUrl: { pathname: '/api/cron/send-emails' },
    url: 'http://localhost/api/cron/send-emails',
  } as unknown as NextRequest;
}

const rispostaOk = { status: 200 } as unknown as Response;

/** Lascia girare le code dei microtask e un giro di timer. */
const respira = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'segreto-di-prova';
});

describe('il battito del lavoro periodico si aspetta, non si spara', () => {
  it('la risposta NON parte finche il battito non e scritto', async () => {
    let scriviIlBattito!: () => void;
    upsert.mockImplementation(
      () => new Promise((r) => { scriviIlBattito = () => r({ error: null }); }),
    );

    const wrapped = withCronAuth(async () => rispostaOk as never);
    let rispostaArrivata = false;
    const inCorso = wrapped(req()).then((r) => { rispostaArrivata = true; return r; });

    await respira();
    expect(
      rispostaArrivata,
      'la rotta ha gia risposto mentre il battito era ancora a meta: su Vercel quella scrittura puo non arrivare mai',
    ).toBe(false);

    scriviIlBattito();
    await inCorso;
    expect(rispostaArrivata).toBe(true);
    expect(upsert).toHaveBeenCalledOnce();
  });

  it('il battito porta il nome del lavoro giusto', async () => {
    upsert.mockResolvedValue({ error: null });
    await withCronAuth(async () => rispostaOk as never)(req());
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'send-emails' }),
      expect.objectContaining({ onConflict: 'name' }),
    );
  });

  /**
   * Il battito non deve MAI far fallire il lavoro: se il database non risponde,
   * il lavoro e' andato lo stesso e la risposta e' quella del lavoro.
   * Ma non deve nemmeno sparire in silenzio, o il sensore muore muto.
   */
  it('se la scrittura del battito fallisce il lavoro riesce lo stesso, ma si lamenta', async () => {
    upsert.mockRejectedValue(new Error('database irraggiungibile'));
    const res = await withCronAuth(async () => rispostaOk as never)(req());
    expect(res.status).toBe(200);
    expect(warn, 'il battito e caduto e nessuno l ha scritto da nessuna parte').toHaveBeenCalled();
  });

  it('un lavoro fallito non lascia il battito: sarebbe un sensore che mente', async () => {
    upsert.mockResolvedValue({ error: null });
    const res = await withCronAuth(async () => ({ status: 500 }) as never)(req());
    expect(res.status).toBe(500);
    expect(upsert).not.toHaveBeenCalled();
  });
});
