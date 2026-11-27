import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R15-004 — Senza la migrazione 164 la lettura dei nomi pubblici scriveva «vista nomi_pubblici assente»
 * a ogni chiamata. Ora l'avviso si scrive una volta; il ripiego su profiles lavora a ogni chiamata.
 */
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { logger } from '@/lib/logger';
import { fetchNomiPubblici } from '@/lib/queries/seller-public-profiles';

function database() {
  return {
    from: (tabella: string) => ({
      select: () => ({
        in: async () =>
          tabella === 'nomi_pubblici'
            ? { data: null, error: { code: 'PGRST205', message: 'Could not find the table public.nomi_pubblici' } }
            : { data: [{ id: 'u1', full_name: 'Maria Rossi' }], error: null },
      }),
    }),
  };
}

const avvisi = () => vi.mocked(logger.warn).mock.calls.filter((c) => String(c[0]).includes('vista nomi_pubblici assente')).length;

beforeEach(() => vi.mocked(logger.warn).mockClear());

describe('R15-004 · senza la 164 l’avviso non si ripete', () => {
  it('tre chiamate con la vista assente: il nome arriva ogni volta, l’avviso una volta sola', async () => {
    const client = database();
    for (let i = 0; i < 3; i++) {
      const nomi = await fetchNomiPubblici(client, ['u1']);
      expect(nomi.get('u1')).toBe('Maria');
    }
    expect(avvisi()).toBe(1);
  });
});
