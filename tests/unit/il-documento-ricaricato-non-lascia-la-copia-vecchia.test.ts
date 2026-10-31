import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 31/10/2026 — LA FOTO MOSSA DELLA CARTA D'IDENTITÀ RESTAVA NEL SECCHIO PER SEMPRE.
 *
 * Ogni caricamento in `/api/kyc/upload-document` crea un percorso nuovo con
 * l'orario dentro (`{userId}/{kind}-{Date.now()}.{ext}`) e il profilo tiene
 * solo l'ultimo. Chi ricaricava la carta d'identità perché la prima foto era
 * mossa lasciava la prima copia nel secchio `kyc-docs` senza più nessun
 * puntatore: la potatura dei 90 giorni cancella solo i percorsi scritti nelle
 * sei colonne del profilo, quindi l'orfano non lo vedeva nessuno. Un documento
 * d'identità conservato senza limite (art. 5.1.e e 17 GDPR).
 *
 * Qui si pretende che il secchio tenga UNA copia per tipo di documento: la
 * vecchia si toglie appena il profilo punta alla nuova. E se il profilo non si
 * aggiorna, l'orfano sarebbe la copia nuova: si toglie quella, e la rotta lo dice.
 */

const UTENTE = { id: 'negoziante-1', email: 'n@x.com' };

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opzioni: unknown, h: (ctx: { user: typeof UTENTE; req: Request }) => unknown) =>
    (req: Request) =>
      h({ user: UTENTE, req }),
}));

let profilo: Record<string, unknown> = {};
let erroreAggiornamento: { message: string } | null = null;
let eventi: string[] = [];
let rimossi: string[][] = [];
let caricati: string[] = [];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: profilo, error: null }) }),
      }),
      update: (patch: Record<string, unknown>) => {
        eventi.push(`aggiorna:${Object.keys(patch).join(',')}`);
        return { eq: () => Promise.resolve({ error: erroreAggiornamento }) };
      },
    }),
    storage: {
      from: (secchio: string) => ({
        upload: (path: string) => {
          eventi.push(`carica:${secchio}`);
          caricati.push(path);
          return Promise.resolve({ error: null });
        },
        remove: (percorsi: string[]) => {
          eventi.push(`togli:${secchio}`);
          rimossi.push(percorsi);
          return Promise.resolve({ data: [], error: null });
        },
        createSignedUrl: (path: string) =>
          Promise.resolve({ data: { signedUrl: `https://firmato.test/${path}` }, error: null }),
      }),
    },
  }),
}));

import { POST as UPLOAD } from '@/app/api/kyc/upload-document/route';

const MAGGIORENNE = { legal_birth_date: '1980-05-01' };
const FRONTE_VECCHIO = 'negoziante-1/id_front-1700000000000.png';
const SELFIE_VECCHIO = 'negoziante-1/selfie-1700000000000.png';

function caricamento(kind: string): never {
  const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const fd = new FormData();
  fd.append('file', new File([new Uint8Array([...firma, ...new Array(64).fill(0)])], 'doc.png', { type: 'image/png' }));
  fd.append('kind', kind);
  return new Request('http://localhost/api/kyc/upload-document', { method: 'POST', body: fd }) as never;
}

beforeEach(() => {
  profilo = { ...MAGGIORENNE };
  erroreAggiornamento = null;
  eventi = [];
  rimossi = [];
  caricati = [];
});

describe('un documento ricaricato non lascia la copia vecchia nel secchio kyc-docs', () => {
  it('ricaricare la carta d identità toglie la foto di prima, dopo che il profilo punta alla nuova', async () => {
    profilo = { ...MAGGIORENNE, kyc_id_doc_front_url: FRONTE_VECCHIO };

    const r = await UPLOAD(caricamento('id_front'));

    expect(r.status).toBe(200);
    expect(caricati).toHaveLength(1);
    expect(caricati[0]).not.toBe(FRONTE_VECCHIO);
    expect(rimossi, 'la copia vecchia è rimasta nel secchio senza più nessun puntatore').toEqual([[FRONTE_VECCHIO]]);
    expect(
      eventi.indexOf('aggiorna:kyc_id_doc_front_url'),
      'la copia vecchia va tolta solo quando il profilo punta già alla nuova',
    ).toBeLessThan(eventi.indexOf('togli:kyc-docs'));
  });

  it('il selfie toglie solo il selfie di prima, non la carta d identità', async () => {
    profilo = { ...MAGGIORENNE, kyc_id_doc_front_url: FRONTE_VECCHIO, kyc_selfie_url: SELFIE_VECCHIO };

    const r = await UPLOAD(caricamento('selfie'));

    expect(r.status).toBe(200);
    expect(rimossi).toEqual([[SELFIE_VECCHIO]]);
  });

  it('il primo caricamento non toglie niente', async () => {
    const r = await UPLOAD(caricamento('id_front'));

    expect(r.status).toBe(200);
    expect(rimossi).toEqual([]);
  });

  it('un percorso fuori dalla cartella della persona non si tocca', async () => {
    profilo = { ...MAGGIORENNE, kyc_id_doc_front_url: 'altra-persona/id_front-1.png' };

    const r = await UPLOAD(caricamento('id_front'));

    expect(r.status).toBe(200);
    expect(rimossi).toEqual([]);
  });

  it('se il profilo non si aggiorna, la copia nuova non resta orfana e la rotta non dice «fatto»', async () => {
    profilo = { ...MAGGIORENNE, kyc_id_doc_front_url: FRONTE_VECCHIO };
    erroreAggiornamento = { message: 'database non raggiungibile' };

    const r = await UPLOAD(caricamento('id_front'));

    expect(r.status, 'la rotta risponde 200 con un percorso che il profilo non ha').toBe(500);
    expect(caricati).toHaveLength(1);
    expect(rimossi, 'la copia nuova è rimasta nel secchio senza puntatore').toEqual([[caricati[0]]]);
  });
});
