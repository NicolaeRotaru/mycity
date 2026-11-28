/**
 * R09-008 — LA FILA DEI LAVORI DOPO LA RISPOSTA È UNA PER RICHIESTA, NON UNA PER TUTTO IL SERVER.
 * Due richieste servite dallo stesso processo: i lavori della seconda non devono aspettare quelli
 * della prima (altrimenti, in una raffica, l'ultima può arrivare al tetto di durata prima del suo turno).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// 28/11/2026 (R09-006) — Le richieste non si simulano più sostituendo un file interno di Next
// (`next/dist/.../work-async-storage.external`): ogni richiesta è il gestore avvolto da
// `conFilaPerRichiesta`, come nelle rotte vere. Stessi due casi, stesse attese.
const stato = vi.hoisted(() => ({
  registrati: [] as Array<() => unknown>,
}));

vi.mock('next/server', () => ({ after: (fn: () => unknown) => void stato.registrati.push(fn) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { dopoLaRisposta } from '@/lib/api/dopo-la-risposta';
import { conFilaPerRichiesta } from '@/lib/api/fila-per-richiesta';

/** Una richiesta: il suo gestore, avvolto come nelle rotte. */
const richiesta = (gestore: () => void) => conFilaPerRichiesta(gestore)();

afterEach(() => {
  stato.registrati.length = 0;
  vi.useRealTimers();
});

describe('R09-008 — una fila per richiesta', () => {
  it('le email della seconda richiesta non aspettano il lavoro lento della prima', async () => {
    vi.useFakeTimers();
    const diario: string[] = [];

    richiesta(() => { // richiesta A: un lavoro lento da 8 s
      dopoLaRisposta(async () => {
        await new Promise((r) => setTimeout(r, 8_000));
        diario.push('A finito');
      }, 'lavoro lento di A');
    });

    richiesta(() => { // richiesta B
      dopoLaRisposta(async () => { diario.push('B parte'); }, 'email di B');
    });

    void Promise.all(stato.registrati.splice(0).map((fn) => fn()));
    await vi.advanceTimersByTimeAsync(0);
    expect(diario, 'B parte subito, senza aspettare A').toEqual(['B parte']);

    await vi.advanceTimersByTimeAsync(8_000);
    expect(diario).toEqual(['B parte', 'A finito']);
  });

  it('dentro la stessa richiesta restano in fila, uno alla volta', async () => {
    vi.useFakeTimers();
    const diario: string[] = [];
    richiesta(() => {
      dopoLaRisposta(async () => { await new Promise((r) => setTimeout(r, 100)); diario.push('1'); }, 'uno');
      dopoLaRisposta(async () => { diario.push('2'); }, 'due');
    });
    void Promise.all(stato.registrati.splice(0).map((fn) => fn()));
    await vi.advanceTimersByTimeAsync(0);
    expect(diario).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(diario).toEqual(['1', '2']);
  });
});
