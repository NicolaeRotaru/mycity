import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { upsert, warn, error } = vi.hoisted(() => ({ upsert: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: vi.fn(),
  getServerSupabase: vi.fn(async () => ({ from: vi.fn() })),
  getAdminSupabase: vi.fn(() => ({ from: vi.fn(() => ({ upsert })) })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn, error, info: vi.fn(), debug: vi.fn() },
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

  /**
   * 8/9/2026 — QUI SI PRETENDEVA IL CONTRARIO, ED ERA LA DECISIONE SBAGLIATA.
   *
   * «Un lavoro fallito non lascia il battito» sembra prudente e invece disarma
   * il sensore. I guasti veri non sono episodi: un permesso revocato, o un
   * fattorino che se n'e' andato senza versare i contanti, fanno fallire il
   * lavoro TUTTE le notti. Dopo 26 ore il sorvegliante annuncia «process-deletions
   * fermo: scheduler o deploy down?» — e manda a guardare Vercel, che sta
   * benissimo. Da quel momento il battito resta vecchio per sempre: il giorno in
   * cui il lavoro non parte davvero, il segnale e' identico a quello di ieri.
   *
   * Il battito risponde a una domanda sola: «sei passato di qui?». Che il giro
   * abbia trovato guai lo dicono il codice di stato, la riga di errore qui sotto
   * e l'avviso agli amministratori che la rotta manda da se'.
   */
  it('un lavoro fallito lascia comunque il battito, e per di piu si lamenta', async () => {
    upsert.mockResolvedValue({ error: null });
    const res = await withCronAuth(async () => ({ status: 500 }) as never)(req());
    expect(res.status).toBe(500);
    expect(
      upsert,
      'il giro e passato e il battito manca: il sorvegliante dira che e fermo un lavoro che gira',
    ).toHaveBeenCalled();
    expect(
      error,
      'il lavoro ha risposto con un errore e nei log non resta niente: il 500 lo legge solo lo scheduler',
    ).toHaveBeenCalled();
  });
});
