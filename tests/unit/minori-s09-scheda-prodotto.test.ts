/**
 * S09 — Letture della scheda prodotto (lib/queries/catalogo.ts).
 */
import { describe, it, expect } from 'vitest';
import { leggiRigaDelProdotto } from '@/lib/queries/catalogo';

function clienteCheRisponde(risposta: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.maybeSingle = async () => risposta;
  return { from: () => q } as never;
}

describe('1678 — un link a un prodotto tagliato a metà', () => {
  it('è «non trovato», non un errore di rete da riprovare', async () => {
    const supa = clienteCheRisponde({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } });
    await expect(leggiRigaDelProdotto(supa, '3f2a1c9e-7b')).resolves.toBeNull();
  });
  it('un errore vero resta un errore', async () => {
    const supa = clienteCheRisponde({ data: null, error: { code: '08006', message: 'connessione persa' } });
    await expect(leggiRigaDelProdotto(supa, '3f2a1c9e-7b')).rejects.toBeTruthy();
  });
});
