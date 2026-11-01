/**
 * Le copie orfane nel secchio `kyc-docs` — file che nessun profilo indica piu' —
 * non le toglieva nessuno: la potatura notturna toglie solo i percorsi che il
 * database le restituisce. Qui un finto storage (con le pagine vere: `limit` e
 * `offset`) e un finto database (con `range`) e si guarda cosa resta nel secchio.
 */
import { describe, expect, it, vi } from 'vitest';
import { potaOrfaniKyc, type ClienteOrfani, type VoceSecchio } from '@/lib/privacy/orfani-kyc';
import { eseguiPotature, potatureNotturne } from '@/lib/privacy/potature-ritenzione';

type Lettura = ReturnType<ReturnType<ClienteOrfani['from']>['select']>;
type Risp = { data: Record<string, unknown>[] | null; error: { message: string } | null };

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
  rilettureRotte?: boolean;
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
          // Un finto PostgREST: i filtri si applicano quando si aspetta la risposta.
          const filtri: Array<(r: Record<string, unknown>) => boolean> = [];
          let quante = Infinity;
          let rilettura = false;
          const q = {
            or: () => q,
            order: () => q,
            gt: (c: string, v: string) => { filtri.push((r) => String(r[c]) > v); return q; },
            eq: (c: string, v: string) => { rilettura = true; filtri.push((r) => r[c] === v); return q; },
            limit: (n: number) => { quante = n; return q; },
            then: (ok?: ((v: Risp) => unknown) | null, ko?: ((e: unknown) => unknown) | null) => {
              let risposta: { data: Record<string, unknown>[] | null; error: { message: string } | null };
              const da = filtri.length === 0 ? 0 : 1;
              if (!rilettura) m.rangeCalls.push([da, da]);
              if (!rilettura && opz.profiliRotti === 'subito') risposta = { data: null, error: { message: 'permission denied' } };
              else if (!rilettura && opz.profiliRotti === 'seconda-pagina' && filtri.length > 0) risposta = { data: null, error: { message: 'timeout' } };
              else if (rilettura && opz.rilettureRotte) risposta = { data: null, error: { message: 'timeout' } };
              else {
                const righe = m.profili
                  .filter((r) => filtri.every((f) => f(r)))
                  .sort((a, b) => String(a.id).localeCompare(String(b.id)));
                risposta = { data: righe.slice(0, quante), error: null };
              }
              return Promise.resolve(risposta).then(ok, ko);
            },
          };
          return q as unknown as Lettura;
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
    expect(m.rangeCalls.filter(([da]) => da > 0).length, 'i profili non sono stati letti oltre la prima pagina').toBeGreaterThanOrEqual(2);
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
  it('rilegge il profilo prima di togliere: un riferimento scritto dopo la lettura salva il file', async () => {
    const { admin, m } = mondo({
      file: { 'u1/selfie-nuovo.jpg': giorniFa(30), 'u1/vivo.jpg': giorniFa(30) },
      profili: [{ id: 'u1', kyc_selfie_url: 'u1/vivo.jpg' }],
    });
    // Fra la lettura in blocco e la rimozione il profilo passa a indicare l'altro file.
    const listaVera = admin.from('profiles').select;
    let letture = 0;
    admin.from = () => ({
      select: (c: string) => {
        letture += 1;
        if (letture === 2) m.profili[0].kyc_id_doc_front_url = 'u1/selfie-nuovo.jpg';
        return listaVera(c);
      },
    });
    const r = await potaOrfaniKyc(admin, muto(), ADESSO);
    expect(m.rimozioni, 'un documento che il profilo indica e stato tolto').toEqual([]);
    expect(r).toMatchObject({ rimossi: 0, salvatiAllaRilettura: 1 });
  });

  it('se la rilettura del profilo fallisce, quella cartella non si tocca', async () => {
    const { admin, m } = mondo({
      file: { 'u1/a.jpg': giorniFa(30), 'u1/vivo.jpg': giorniFa(30) },
      profili: [{ id: 'u1', kyc_selfie_url: 'u1/vivo.jpg' }],
      rilettureRotte: true,
    });
    await potaOrfaniKyc(admin, muto(), ADESSO);
    expect(m.rimozioni).toEqual([]);
  });

  it('un valore salvato con la barra iniziale o col nome del secchio indica lo stesso file', async () => {
    const { admin, m } = mondo({
      file: { 'u1/a.jpg': giorniFa(30), 'u1/b.jpg': giorniFa(30), 'u1/c.jpg': giorniFa(30) },
      profili: [{ id: 'u1', kyc_selfie_url: '/u1/a.jpg', kyc_id_doc_front_url: 'kyc-docs/u1/b.jpg' }],
    });
    await potaOrfaniKyc(admin, muto(), ADESSO);
    expect([...m.secchio.keys()].sort()).toEqual(['u1/a.jpg', 'u1/b.jpg']);
  });
});
