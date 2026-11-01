/**
 * Le copie orfane nel secchio `kyc-docs` — file che nessun profilo indica piu' —
 * non le toglieva nessuno: la potatura notturna toglie solo i percorsi che il
 * database le restituisce. Qui un finto storage (con le pagine vere: `limit` e
 * `offset`) e un finto database (con `range`) e si guarda cosa resta nel secchio.
 */
import { describe, expect, it, vi } from 'vitest';
import { potaOrfaniKyc, type ClienteOrfani, type VoceSecchio } from '@/lib/privacy/orfani-kyc';
import { eseguiPotature, potatureNotturne } from '@/lib/privacy/potature-ritenzione';

const ADESSO = Date.parse('2026-11-01T03:00:00Z');
const giorniFa = (g: number) => new Date(ADESSO - g * 86_400_000).toISOString();

type Mondo = {
  /** percorso → data di caricamento */
  secchio: Map<string, string>;
  profili: Array<Record<string, unknown>>;
  rimozioni: string[][];
  listCalls: Array<{ prefisso: string; offset: number }>;
  rangeCalls: Array<[number, number]>;
};

function mondo(opz: {
  file: Record<string, string>;
  profili: Array<Record<string, unknown>>;
  profiliRotti?: 'subito' | 'seconda-pagina';
  rimozioneRifiutata?: boolean;
}): { admin: ClienteOrfani; m: Mondo } {
  const m: Mondo = {
    secchio: new Map(Object.entries(opz.file)),
    profili: opz.profili,
    rimozioni: [],
    listCalls: [],
    rangeCalls: [],
  };
  const admin: ClienteOrfani = {
    from(tabella) {
      expect(tabella).toBe('profiles');
      return {
        select: () => {
          const q = {
            or: () => q,
            order: () => q,
            range: async (da: number, a: number) => {
              m.rangeCalls.push([da, a]);
              if (opz.profiliRotti === 'subito') return { data: null, error: { message: 'permission denied' } };
              if (opz.profiliRotti === 'seconda-pagina' && da > 0) return { data: null, error: { message: 'timeout' } };
              return { data: m.profili.slice(da, a + 1), error: null };
            },
          };
          return q;
        },
      };
    },
    storage: {
      from(secchio) {
        expect(secchio).toBe('kyc-docs');
        return {
          list: async (prefisso, { limit, offset }) => {
            m.listCalls.push({ prefisso, offset });
            const voci = new Map<string, VoceSecchio>();
            for (const [percorso, data] of m.secchio) {
              const resto = prefisso === '' ? percorso : percorso.startsWith(`${prefisso}/`) ? percorso.slice(prefisso.length + 1) : null;
              if (resto === null) continue;
              const [testa, ...coda] = resto.split('/');
              voci.set(testa, coda.length > 0
                ? { name: testa, id: null }
                : { name: testa, id: `id-${percorso}`, created_at: data, updated_at: data });
            }
            const ordinate = [...voci.values()].sort((a, b) => a.name.localeCompare(b.name));
            return { data: ordinate.slice(offset, offset + limit), error: null };
          },
          remove: async (percorsi) => {
            if (opz.rimozioneRifiutata) return { error: { message: 'storage down' } };
            m.rimozioni.push(percorsi);
            for (const p of percorsi) m.secchio.delete(p);
            return { error: null };
          },
        };
      },
    },
  };
  return { admin, m };
}

const muto = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('le copie orfane dei documenti d identita', () => {
  it('toglie l orfano vecchio, lascia il referenziato e l orfano appena caricato', async () => {
    const { admin, m } = mondo({
      file: {
        'u1/id_front-1.jpg': giorniFa(60), // sostituito: orfano vecchio
        'u1/id_front-2.jpg': giorniFa(50), // quello del profilo
        'u1/selfie-3.jpg': giorniFa(1), // caricamento in corso: orfano giovane
        'u2/selfie-1.jpg': giorniFa(40), // URL firmata vecchio stile nel profilo
      },
      profili: [
        { id: 'u1', kyc_id_doc_front_url: 'u1/id_front-2.jpg' },
        { id: 'u2', kyc_selfie_url: 'https://x.supabase.co/storage/v1/object/sign/kyc-docs/u2/selfie-1.jpg?token=abc' },
      ],
    });
    const r = await potaOrfaniKyc(admin, muto(), ADESSO);

    expect([...m.secchio.keys()].sort()).toEqual(['u1/id_front-2.jpg', 'u1/selfie-3.jpg', 'u2/selfie-1.jpg']);
    expect(r).toMatchObject({ listati: 4, orfani: 2, recenti: 1, rimossi: 1, rinviati: 0 });
  });

  it('se la lettura dei riferimenti fallisce non toglie niente, e lo dice', async () => {
    for (const rotto of ['subito', 'seconda-pagina'] as const) {
      const file: Record<string, string> = {};
      const profili: Array<Record<string, unknown>> = [];
      for (let i = 0; i < 5; i++) {
        file[`u${i}/selfie-${i}.jpg`] = giorniFa(30);
        file[`u${i}/vecchio-${i}.jpg`] = giorniFa(30);
        profili.push({ id: `u${i}`, kyc_selfie_url: `u${i}/selfie-${i}.jpg` });
      }
      const { admin, m } = mondo({ file, profili, profiliRotti: rotto });
      await expect(potaOrfaniKyc(admin, muto(), ADESSO, { pagina: 2 })).rejects.toThrow(/riferimenti/);
      expect(m.rimozioni, `con la lettura rotta (${rotto}) qualcosa e stato tolto`).toEqual([]);
      expect(m.secchio.size).toBe(10);
    }
  });

  it('se i riferimenti tornano vuoti col secchio pieno si ferma invece di svuotarlo', async () => {
    const { admin, m } = mondo({ file: { 'u1/a.jpg': giorniFa(30), 'u2/b.jpg': giorniFa(30) }, profili: [] });
    await expect(potaOrfaniKyc(admin, muto(), ADESSO)).rejects.toThrow(/prudenza/);
    expect(m.rimozioni).toEqual([]);
  });

  it('pagina il secchio e i profili oltre la prima pagina', async () => {
    const file: Record<string, string> = {};
    const profili: Array<Record<string, unknown>> = [];
    // 5 persone (cartelle) con 3 file ciascuna, pagine da 2: servono tre pagine
    // di cartelle, due di file per cartella, tre di profili.
    for (let i = 0; i < 5; i++) {
      file[`u${i}/id_front-a.jpg`] = giorniFa(30);
      file[`u${i}/id_front-b.jpg`] = giorniFa(30);
      file[`u${i}/selfie-c.jpg`] = giorniFa(30);
      profili.push({ id: `u${i}`, kyc_id_doc_front_url: `u${i}/id_front-b.jpg`, kyc_selfie_url: `u${i}/selfie-c.jpg` });
    }
    const { admin, m } = mondo({ file, profili });
    const r = await potaOrfaniKyc(admin, muto(), ADESSO, { pagina: 2 });

    // L'ultima cartella e l'ultimo profilo stanno oltre la prima pagina: se
    // non si leggono, u4/id_front-a resta o il suo vicino referenziato sparisce.
    expect(m.secchio.has('u4/id_front-a.jpg'), 'l orfano dell ultima pagina e rimasto').toBe(false);
    expect(m.secchio.has('u4/id_front-b.jpg'), 'il riferito dell ultima pagina e stato tolto').toBe(true);
    expect(m.secchio.has('u4/selfie-c.jpg')).toBe(true);
    expect(r).toMatchObject({ listati: 15, riferiti: 10, orfani: 5, rimossi: 5 });
    expect(m.listCalls.some((c) => c.prefisso === '' && c.offset >= 4)).toBe(true);
    expect(m.rangeCalls.some(([da]) => da >= 4)).toBe(true);
  });

  it('non toglie piu del tetto in una notte, e i piu vecchi per primi', async () => {
    const { admin, m } = mondo({
      file: { 'u1/a.jpg': giorniFa(10), 'u1/b.jpg': giorniFa(90), 'u1/c.jpg': giorniFa(30), 'u1/vivo.jpg': giorniFa(30) },
      profili: [{ id: 'u1', kyc_selfie_url: 'u1/vivo.jpg' }],
    });
    const r = await potaOrfaniKyc(admin, muto(), ADESSO, { tetto: 2 });
    expect(m.rimozioni.flat().sort()).toEqual(['u1/b.jpg', 'u1/c.jpg']);
    expect(r).toMatchObject({ rimossi: 2, rinviati: 1 });
  });

  it('nella notte vera il passo c e, e se lo storage rifiuta la notte lo conta', async () => {
    const { admin } = mondo({
      file: { 'u1/a.jpg': giorniFa(30), 'u1/vivo.jpg': giorniFa(30) },
      profili: [{ id: 'u1', kyc_selfie_url: 'u1/vivo.jpg' }],
      rimozioneRifiutata: true,
    });
    const passi = potatureNotturne(ADESSO).filter((p) => p.cosa === 'documenti-kyc-orfani');
    expect(passi).toHaveLength(1);
    const rapporto = await eseguiPotature(admin as never, muto(), ADESSO, passi);
    expect(rapporto.fallite).toBe(1);
  });
});
