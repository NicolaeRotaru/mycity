/**
 * La fila per richiesta funziona senza lo stato interno di Next: il modulo non riceve alcun
 * work-async-storage, e due richieste (due flussi asincroni) restano separate.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AsyncResource } from 'node:async_hooks';

const registrati: Array<() => unknown> = [];
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void registrati.push(fn) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { dopoLaRisposta } from '@/lib/api/dopo-la-risposta';

const comeRichiesta = (fn: () => void) => new AsyncResource('richiesta-finta').runInAsyncScope(fn);
afterEach(() => { registrati.length = 0; vi.useRealTimers(); });

describe('la fila per richiesta con un archivio proprio', () => {
  it('due richieste restano separate, anche senza il file interno di Next', async () => {
    vi.useFakeTimers();
    const diario: string[] = [];
    comeRichiesta(() => dopoLaRisposta(async () => { await new Promise((r) => setTimeout(r, 5_000)); diario.push('A'); }, 'A'));
    comeRichiesta(() => dopoLaRisposta(async () => { diario.push('B'); }, 'B'));
    void Promise.all(registrati.splice(0).map((f) => f()));
    await vi.advanceTimersByTimeAsync(0);
    expect(diario).toEqual(['B']);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(diario).toEqual(['B', 'A']);
  });
  it('dopo una chiamata, le successive nello stesso flusso restano in fila dietro di lei', async () => {
    vi.useFakeTimers();
    const diario: string[] = [];
    await new Promise<void>((fine) => comeRichiesta(() => {
      dopoLaRisposta(async () => { await new Promise((r) => setTimeout(r, 50)); diario.push('1'); }, 'uno');
      Promise.resolve().then(() => dopoLaRisposta(async () => { diario.push('2'); }, 'due')).then(() => fine());
    }));
    void Promise.all(registrati.splice(0).map((f) => f()));
    await vi.advanceTimersByTimeAsync(0);
    expect(diario).toEqual([]);
    await vi.advanceTimersByTimeAsync(50);
    expect(diario).toEqual(['1', '2']);
  });
});
