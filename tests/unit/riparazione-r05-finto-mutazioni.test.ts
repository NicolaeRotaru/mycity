/**
 * Il finto di react-query: un errore DENTRO `onSuccess` non deve sparire in `onError`.
 *
 * Con `globalThis.__MUTAZIONI_VERE__` acceso, il finto esegue davvero `mutationFn` e poi `onSuccess`
 * o `onError`. Se `onSuccess` cade (un nome sbagliato, un campo letto da `undefined`), quel guasto è
 * un difetto della pagina: se finisce in `onError`, la pagina mostra «non riuscito» e la prova che
 * guarda il messaggio d'errore resta verde mentre la pagina ha un difetto vero. Qui l'errore di
 * `onSuccess` deve emergere (la scrittura in volo si rompe con quell'errore) e `onError` non deve
 * essere chiamato. Un errore della scrittura vera (`mutationFn`) va invece in `onError`, come prima.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Finto = {
  useMutation: (o: Record<string, unknown>) => { mutate: (v: unknown) => void };
};

const g = globalThis as unknown as Record<string, unknown>;

describe('finto di react-query: mutationFn e onSuccess stanno in due momenti separati', () => {
  beforeEach(() => {
    g.__MUTAZIONI_VERE__ = true;
    g.__MUTAZIONI_IN_VOLO__ = [];
  });
  afterEach(() => {
    delete g.__MUTAZIONI_VERE__;
    delete g.__MUTAZIONI_IN_VOLO__;
  });

  it('un errore in onSuccess emerge e NON passa da onError', async () => {
    const { useMutation } = (await import('./aiuti/finti/react-query.mjs')) as unknown as Finto;
    const onError = vi.fn();
    const guasto = new Error('onSuccess rotto');
    const m = useMutation({
      mutationFn: async () => 'scritto',
      onSuccess: () => {
        throw guasto;
      },
      onError,
    });
    m.mutate({ id: 1 });
    const [volo] = g.__MUTAZIONI_IN_VOLO__ as Promise<unknown>[];
    const esito = await Promise.allSettled([volo]);
    expect(onError).not.toHaveBeenCalled();
    expect(esito[0]).toEqual({ status: 'rejected', reason: guasto });
  });

  it('un errore della scrittura (mutationFn) va ancora in onError, e onSuccess non parte', async () => {
    const { useMutation } = (await import('./aiuti/finti/react-query.mjs')) as unknown as Finto;
    const onError = vi.fn();
    const onSuccess = vi.fn();
    const caduta = new Error('rete caduta');
    const m = useMutation({
      mutationFn: async () => {
        throw caduta;
      },
      onSuccess,
      onError,
    });
    m.mutate({ id: 2 });
    await Promise.allSettled(g.__MUTAZIONI_IN_VOLO__ as Promise<unknown>[]);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(caduta, { id: 2 });
  });

  it('una scrittura riuscita chiama onSuccess col risultato', async () => {
    const { useMutation } = (await import('./aiuti/finti/react-query.mjs')) as unknown as Finto;
    const onError = vi.fn();
    const onSuccess = vi.fn();
    const m = useMutation({ mutationFn: async (v: unknown) => ({ eco: v }), onSuccess, onError });
    m.mutate('x');
    await Promise.all(g.__MUTAZIONI_IN_VOLO__ as Promise<unknown>[]);
    expect(onSuccess).toHaveBeenCalledWith({ eco: 'x' }, 'x');
    expect(onError).not.toHaveBeenCalled();
  });
});
