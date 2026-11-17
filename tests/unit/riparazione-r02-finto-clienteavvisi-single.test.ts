import { describe, it, expect } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

/**
 * R02-004 — Il finto database del giro notturno risponde anche a `.single()`, come il client vero:
 * la prima riga che passa i filtri, o null. Sta in un file suo perché, senza la correzione, questo caso
 * cade per un nome che manca, non per il comportamento.
 */
describe('R02-004 — il finto ClienteAvvisi unico, single()', () => {

  it('single() dà la prima riga che passa i filtri, o null', async () => {
    const f = fintoGiroNotturno({ tabelle: { profiles: [{ id: 'a', role: 'admin' }, { id: 'b', role: 'user' }] } });
    const q = f.admin.from('profiles') as unknown as { select(): { eq(c: string, v: unknown): { single(): PromiseLike<{ data: unknown }> } } };
    expect((await q.select().eq('id', 'b').single()).data).toEqual({ id: 'b', role: 'user' });
    const q2 = f.admin.from('profiles') as unknown as { select(): { eq(c: string, v: unknown): { single(): PromiseLike<{ data: unknown }> } } };
    expect((await q2.select().eq('id', 'zzz').single()).data).toBeNull();
  });
});
