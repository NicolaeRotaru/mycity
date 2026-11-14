import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { domandaNegozio } from '@/lib/queries/catalogo';

/** R17-006 — /store/abc: l'id non e' un uuid, Postgres risponde 22P02, la vetrina deve dire «non trovato». */
function clienteCheRisponde(risposta: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.maybeSingle = async () => risposta;
  return { from: () => q } as never;
}

describe('R17-006 — il link tagliato a un negozio', () => {
  it('22P02 e\' «negozio non trovato», non un errore da riprovare', async () => {
    const supa = clienteCheRisponde({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } });
    await expect(domandaNegozio(supa, 'abc').queryFn()).resolves.toBeNull();
  });
  it('un errore vero resta un errore', async () => {
    const supa = clienteCheRisponde({ data: null, error: { code: '08006', message: 'connessione persa' } });
    await expect(domandaNegozio(supa, 'abc').queryFn()).rejects.toBeTruthy();
  });
  it('un negozio che c\'e\' si legge', async () => {
    const supa = clienteCheRisponde({ data: { id: 'n1', store_name: 'Pane' }, error: null });
    await expect(domandaNegozio(supa, 'n1').queryFn()).resolves.toMatchObject({ id: 'n1' });
  });
});
