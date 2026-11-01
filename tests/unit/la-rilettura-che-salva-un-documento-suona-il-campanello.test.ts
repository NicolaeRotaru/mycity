import { describe, it, expect, vi } from 'vitest';
import { potaOrfaniKyc, type ClienteOrfani } from '@/lib/privacy/orfani-kyc';

/**
 * 1/11/2026 — Se l'ultimo controllo (la rilettura del profilo) salva un
 * documento, la lettura generale ha mancato un riferimento vivo: senza la
 * rilettura sarebbe sparita una carta d'identita' vera. Va scritto come
 * avviso (warn), non come notizia (info).
 */

const giorniFa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString();

function lettura(righe: Record<string, unknown>[]) {
  const l: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: righe, error: null }).then(ok),
  };
  for (const f of ['or', 'order', 'gt', 'limit']) l[f] = () => l;
  return l;
}

function mondo() {
  const rimossi: string[] = [];
  const admin = {
    from: () => ({
      select: () => {
        const generale = lettura([{ id: 'u2', kyc_selfie_url: 'u2/altro.jpg' }]);
        // La lettura generale non vede il fronte di u1; la rilettura per id si'.
        generale.eq = () => lettura([{ id: 'u1', kyc_id_doc_front_url: 'u1/fronte.jpg' }]);
        return generale;
      },
    }),
    storage: {
      from: () => ({
        list: async (prefisso: string) => ({
          data:
            prefisso === ''
              ? [{ name: 'u1', id: null }]
              : [{ name: 'fronte.jpg', id: 'a', created_at: giorniFa(40) }],
          error: null,
        }),
        remove: async (p: string[]) => { rimossi.push(...p); return { error: null }; },
      }),
    },
  };
  return { admin: admin as unknown as ClienteOrfani, rimossi };
}

describe('la rilettura che salva un documento', () => {
  it('IL CASO CHE ROMPEVA — scrive un warn, non un info, e non toglie niente', async () => {
    const { admin, rimossi } = mondo();
    const registro = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const r = await potaOrfaniKyc(admin, registro, Date.now());
    expect(r.salvatiAllaRilettura).toBe(1);
    expect(rimossi).toEqual([]);
    expect(registro.warn).toHaveBeenCalledWith(expect.stringContaining('mancato'), expect.objectContaining({ salvatiAllaRilettura: 1 }));
    expect(registro.info).not.toHaveBeenCalled();
  });
});
