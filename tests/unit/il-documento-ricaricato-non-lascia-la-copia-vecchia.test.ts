import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
 *
 * Il collaudo ha trovato il caso che il primo fix non reggeva: due caricamenti
 * ravvicinati dello stesso tipo (doppio tocco, rete lenta) leggono tutti e due
 * il percorso vecchio prima che uno dei due aggiorni il profilo, e alla fine
 * nel secchio restano due copie con il profilo che ne indica una. Il finto
 * database qui sotto applica i filtri dell'aggiornamento quando la richiesta
 * parte davvero, come Postgres: chi scrive alla cieca sovrascrive, chi
 * condiziona lo scambio se ne accorge.
 */

const UTENTE = { id: 'negoziante-1', email: 'n@x.com' };

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opzioni: unknown, h: (ctx: { user: typeof UTENTE; req: Request }) => unknown) =>
    (req: Request) =>
      h({ user: UTENTE, req }),
}));

let profilo: Record<string, unknown> = {};
let nelSecchio = new Set<string>();
let erroreAggiornamento: { message: string } | null = null;
let eventi: string[] = [];
let rimossi: string[][] = [];
let caricati: string[] = [];
/** Se c'è, il PRIMO caricamento nel secchio aspetta questa promessa prima di finire. */
let frenoCaricamento: Promise<void> | null = null;
/** Se c'è, il PRIMO aggiornamento del profilo aspetta questa promessa prima di partire. */
let frenoAggiornamento: Promise<void> | null = null;
let trattenuti = 0;
/** Se c'è, prima di ogni aggiornamento un altro scrittore cambia la colonna. */
let rubaColonna: string | null = null;

function aggiornamento(patch: Record<string, unknown>) {
  const filtri: Array<[string, unknown]> = [];
  async function esegui() {
    const freno = frenoAggiornamento;
    frenoAggiornamento = null;
    if (freno) { trattenuti++; await freno; }
    eventi.push(`aggiorna:${Object.keys(patch).join(',')}`);
    if (erroreAggiornamento) return { data: null, error: erroreAggiornamento };
    if (rubaColonna) profilo = { ...profilo, [rubaColonna]: `${UTENTE.id}/altro-${eventi.length}.png` };
    const combacia = filtri.every(([c, v]) => (c === 'id' ? v === UTENTE.id : (profilo[c] ?? null) === v));
    if (combacia) profilo = { ...profilo, ...patch };
    return { data: combacia ? [{ id: UTENTE.id }] : [], error: null };
  }
  const q = {
    eq: (c: string, v: unknown) => { filtri.push([c, v]); return q; },
    is: (c: string, v: unknown) => { filtri.push([c, v]); return q; },
    select: () => q,
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => esegui().then(ok, ko),
  };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: { ...profilo }, error: null }) }),
      }),
      update: (patch: Record<string, unknown>) => aggiornamento(patch),
    }),
    storage: {
      from: (secchio: string) => ({
        upload: async (path: string) => {
          eventi.push(`carica:${secchio}`);
          caricati.push(path);
          const freno = frenoCaricamento;
          frenoCaricamento = null;
          if (freno) { trattenuti++; await freno; }
          if (nelSecchio.has(path)) return { error: { message: 'The resource already exists' } };
          nelSecchio.add(path);
          return { error: null };
        },
        remove: (percorsi: string[]) => {
          eventi.push(`togli:${secchio}`);
          rimossi.push(percorsi);
          for (const p of percorsi) nelSecchio.delete(p);
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

/** Un freno da rilasciare a mano: tiene ferma una richiesta a metà strada. */
function freno(): { promessa: Promise<void>; rilascia: () => void } {
  let rilascia!: () => void;
  const promessa = new Promise<void>((r) => { rilascia = r; });
  return { promessa, rilascia };
}

beforeEach(() => {
  profilo = { ...MAGGIORENNE };
  nelSecchio = new Set();
  erroreAggiornamento = null;
  eventi = [];
  rimossi = [];
  caricati = [];
  frenoCaricamento = null;
  frenoAggiornamento = null;
  trattenuti = 0;
  rubaColonna = null;
  // Due caricamenti nello stesso millisecondo avrebbero lo stesso percorso:
  // qui l'orologio avanza a ogni lettura, così le due copie sono distinte.
  let orologio = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => ++orologio);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('un documento ricaricato non lascia la copia vecchia nel secchio kyc-docs', () => {
  it('ricaricare la carta d identità toglie la foto di prima, dopo che il profilo punta alla nuova', async () => {
    profilo = { ...MAGGIORENNE, kyc_id_doc_front_url: FRONTE_VECCHIO };
    nelSecchio.add(FRONTE_VECCHIO);

    const r = await UPLOAD(caricamento('id_front'));

    expect(r.status).toBe(200);
    expect(caricati).toHaveLength(1);
    expect(caricati[0]).not.toBe(FRONTE_VECCHIO);
    expect(rimossi, 'la copia vecchia è rimasta nel secchio senza più nessun puntatore').toEqual([[FRONTE_VECCHIO]]);
    expect(
      eventi.indexOf('aggiorna:kyc_id_doc_front_url'),
      'la copia vecchia va tolta solo quando il profilo punta già alla nuova',
    ).toBeLessThan(eventi.indexOf('togli:kyc-docs'));
    expect([...nelSecchio]).toEqual([profilo.kyc_id_doc_front_url]);
  });

  it('il selfie toglie solo il selfie di prima, non la carta d identità', async () => {
    profilo = { ...MAGGIORENNE, kyc_id_doc_front_url: FRONTE_VECCHIO, kyc_selfie_url: SELFIE_VECCHIO };

    const r = await UPLOAD(caricamento('selfie'));

    expect(r.status).toBe(200);
    expect(rimossi).toEqual([[SELFIE_VECCHIO]]);
    expect(profilo.kyc_id_doc_front_url).toBe(FRONTE_VECCHIO);
  });

  it('il primo caricamento non toglie niente', async () => {
    const r = await UPLOAD(caricamento('id_front'));

    expect(r.status).toBe(200);
    expect(rimossi).toEqual([]);
    expect(profilo.kyc_id_doc_front_url).toBe(caricati[0]);
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

describe('due caricamenti ravvicinati dello stesso documento lasciano una copia sola', () => {
  async function dueRavvicinati(chiFrenare: 'caricamento' | 'aggiornamento') {
    const f = freno();
    if (chiFrenare === 'caricamento') frenoCaricamento = f.promessa;
    else frenoAggiornamento = f.promessa;

    const primo = UPLOAD(caricamento('id_front'));
    await vi.waitFor(() => expect(trattenuti).toBe(1));
    const secondo = await UPLOAD(caricamento('id_front'));
    f.rilascia();
    return { primo: await primo, secondo };
  }

  it('il primo caricamento trattenuto finché il secondo finisce: nel secchio resta solo la copia del profilo', async () => {
    profilo = { ...MAGGIORENNE, kyc_id_doc_front_url: FRONTE_VECCHIO };
    nelSecchio.add(FRONTE_VECCHIO);

    const { primo, secondo } = await dueRavvicinati('caricamento');

    expect(primo.status).toBe(200);
    expect(secondo.status).toBe(200);
    expect(caricati).toHaveLength(2);
    expect(
      [...nelSecchio],
      'due copie della carta d identità nel secchio e il profilo ne indica una: l altra non la trova più nessuno',
    ).toEqual([profilo.kyc_id_doc_front_url]);
  });

  it('il primo ha già letto il percorso vecchio quando il secondo aggiorna il profilo: nessuna copia orfana', async () => {
    profilo = { ...MAGGIORENNE, kyc_id_doc_front_url: FRONTE_VECCHIO };
    nelSecchio.add(FRONTE_VECCHIO);

    const { primo, secondo } = await dueRavvicinati('aggiornamento');

    expect(primo.status).toBe(200);
    expect(secondo.status).toBe(200);
    expect(caricati).toHaveLength(2);
    expect([...nelSecchio], 'la copia del secondo caricamento è rimasta senza puntatore').toEqual([
      profilo.kyc_id_doc_front_url,
    ]);
    expect(nelSecchio.has(FRONTE_VECCHIO)).toBe(false);
  });

  it('anche al primo caricamento in assoluto, con la colonna ancora vuota', async () => {
    const { primo, secondo } = await dueRavvicinati('aggiornamento');

    expect(primo.status).toBe(200);
    expect(secondo.status).toBe(200);
    expect(caricati).toHaveLength(2);
    expect([...nelSecchio]).toEqual([profilo.kyc_id_doc_front_url]);
  });

  it('se ogni scambio lo vince un altro caricamento, la copia nuova si toglie e la rotta lo dice', async () => {
    profilo = { ...MAGGIORENNE, kyc_id_doc_front_url: FRONTE_VECCHIO };
    nelSecchio.add(FRONTE_VECCHIO);
    rubaColonna = 'kyc_id_doc_front_url';

    const r = await UPLOAD(caricamento('id_front'));

    expect(r.status, 'la rotta risponde «fatto» con un percorso che il profilo non indica').toBe(409);
    expect(profilo.kyc_id_doc_front_url).not.toBe(caricati[0]);
    expect(nelSecchio.has(caricati[0]), 'la copia nuova è rimasta senza puntatore').toBe(false);
  });
});
