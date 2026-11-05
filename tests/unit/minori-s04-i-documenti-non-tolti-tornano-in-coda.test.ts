import { describe, it, expect } from 'vitest';
import {
  eseguiPotature,
  potatureDiRitenzione,
  type ClientePotature,
  type Registro,
} from '@/lib/privacy/potature-ritenzione';

/**
 * 5/11/2026 (S04, scheda 2518) — La coda dei documenti d'identità da togliere si svuota PRIMA che
 * lo storage tolga i file. Se lo storage rifiutava, i percorsi restavano solo nel registro e la
 * notte dopo la coda era vuota: i documenti restavano nel secchio per sempre. Ora tornano in coda
 * (kyc_file_da_togliere_rimetti, migrazione 215; la funzione è provata in tests/sql/rls/48).
 */
const muto: Registro = { info: () => {}, warn: () => {}, error: () => {} };

function amministratore(rimozioneRiesce: boolean) {
  const chiamate: Array<{ nome: string; argomenti?: Record<string, unknown> }> = [];
  const q: Record<string, unknown> = {};
  for (const m of ['eq', 'lt', 'is', 'not', 'or']) q[m] = () => q;
  q.then = (ok: (r: unknown) => unknown) => Promise.resolve({ error: null }).then(ok);
  const admin = {
    from: () => ({ update: () => q, delete: () => q }),
    rpc: async (nome: string, argomenti?: Record<string, unknown>) => {
      chiamate.push({ nome, argomenti });
      return nome === 'kyc_file_da_togliere_prendi'
        ? { data: [{ user_id: 'u2', percorsi: ['u2/kyc_selfie-1.jpg'] }], error: null }
        : { data: null, error: null };
    },
    storage: {
      from: () => ({
        remove: async () => ({ error: rimozioneRiesce ? null : { message: 'storage non risponde' } }),
      }),
    },
  } as unknown as ClientePotature;
  return { admin, chiamate };
}

describe('i documenti d’identità che lo storage non toglie', () => {
  const adesso = Date.parse('2026-11-05T03:00:00Z');
  const passi = potatureDiRitenzione(adesso).filter((p) => p.cosa === 'documenti-kyc-iscrizione-a-meta');

  it('tornano in coda, e la notte lo dice', async () => {
    const { admin, chiamate } = amministratore(false);
    const rapporto = await eseguiPotature(admin, muto, adesso, passi);
    expect(rapporto.fallite).toBe(1);
    expect(chiamate).toContainEqual({
      nome: 'kyc_file_da_togliere_rimetti',
      argomenti: { p_profilo: 'u2', p_percorsi: ['u2/kyc_selfie-1.jpg'] },
    });
  });

  it('se lo storage li toglie, non si rimette niente in coda', async () => {
    const { admin, chiamate } = amministratore(true);
    const rapporto = await eseguiPotature(admin, muto, adesso, passi);
    expect(rapporto.fallite).toBe(0);
    expect(chiamate.map((c) => c.nome)).not.toContain('kyc_file_da_togliere_rimetti');
  });
});
