import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getKycProvider } from '@/lib/kyc/providers';

/**
 * R01-015 (27/11/2026) — Con Onfido acceso, ogni nuovo tentativo di verifica creava un'altra scheda
 * con nome, email e data di nascita, e alla chiusura dell'account nessuno le toglieva. Ora, con
 * l'id del controllo di prima, si riprende la sua scheda (aggiornandone i dati) invece di crearne
 * una nuova, e la scheda si può togliere partendo dall'id del controllo salvato nel profilo.
 */

type Chiamata = { url: string; metodo: string };
let chiamate: Chiamata[] = [];
let checkRisponde = 201;
let putRisponde = 200;
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.stubEnv('KYC_PROVIDER', 'onfido');
  vi.stubEnv('KYC_API_KEY', 'chiave-finta');
  chiamate = [];
  checkRisponde = 201;
  putRisponde = 200;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    chiamate.push({ url, metodo });
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://archivio.test/')) {
      return new Response(new Blob(['img']), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    if (url.endsWith('/checks/chk_vecchio') && metodo === 'GET') return json(200, { id: 'chk_vecchio', applicant_id: 'app_vecchia' });
    if (url.endsWith('/applicants/app_vecchia') && metodo === 'PUT') return json(putRisponde, { id: 'app_vecchia' });
    if (url.endsWith('/applicants') && metodo === 'POST') return json(201, { id: 'app_nuova' });
    if (url.endsWith('/documents') || url.endsWith('/live_photos')) return json(201, { id: 'doc_1' });
    if (url.endsWith('/checks') && metodo === 'POST') {
      return checkRisponde === 201 ? json(201, { id: 'chk_nuovo' }) : json(422, { error: { message: 'no documents' } });
    }
    if (url.includes('/applicants/') && metodo === 'DELETE') return new Response(null, { status: 204 });
    return json(404, {});
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const SOGGETTO = { userId: 'u1', firstName: 'Anna', lastName: 'Rossi', email: 'a@x.it', birthDate: '1990-01-01' };
const DOCUMENTI = { idFrontUrl: 'https://archivio.test/f.jpg', selfieUrl: 'https://archivio.test/s.jpg' };

type ConScheda = {
  startCheck: (s: typeof SOGGETTO, d: typeof DOCUMENTI, checkPrecedente?: string | null) => Promise<unknown>;
  cancellaScheda?: (checkId: string | null) => Promise<string>;
};
const onfido = () => getKycProvider() as unknown as ConScheda;
const percorsi = () => chiamate.filter((c) => c.url.includes('onfido.com')).map((c) => `${c.metodo} ${c.url.replace(/^.*v3\.6/, '')}`);

describe('R01-015 · Onfido: una persona, una scheda', () => {
  it('con il controllo di prima si riprende la sua scheda, aggiornata, senza crearne un altra', async () => {
    const esito = await onfido().startCheck(SOGGETTO, DOCUMENTI, 'chk_vecchio');
    expect(esito).toMatchObject({ ok: true, providerCheckId: 'chk_nuovo' });
    expect(percorsi()).toEqual([
      'GET /checks/chk_vecchio', 'PUT /applicants/app_vecchia', 'POST /documents', 'POST /live_photos', 'POST /checks',
    ]);
  });

  it('se il nuovo controllo fallisce, la scheda ripresa resta: porta il controllo di prima', async () => {
    checkRisponde = 422;
    const esito = await onfido().startCheck(SOGGETTO, DOCUMENTI, 'chk_vecchio');
    expect(esito).toMatchObject({ ok: false });
    expect(percorsi()).not.toContain('POST /applicants');
    expect(percorsi().some((p) => p.startsWith('DELETE'))).toBe(false);
  });

  it('se la scheda di prima non c è più su Onfido, se ne crea una sola nuova', async () => {
    putRisponde = 404;
    const esito = await onfido().startCheck(SOGGETTO, DOCUMENTI, 'chk_vecchio');
    expect(esito).toMatchObject({ ok: true });
    expect(percorsi().filter((p) => p === 'POST /applicants')).toHaveLength(1);
  });

  it('alla chiusura dell account la scheda si toglie partendo dal controllo salvato', async () => {
    const esito = await onfido().cancellaScheda?.('chk_vecchio');
    expect(esito).toBe('tolta');
    expect(percorsi()).toEqual(['GET /checks/chk_vecchio', 'DELETE /applicants/app_vecchia']);
  });

  it('una verifica manuale non ha scheda su Onfido: niente da togliere, nessuna chiamata', async () => {
    const esito = await onfido().cancellaScheda?.('manual_123');
    expect(esito).toBe('niente');
    expect(percorsi()).toEqual([]);
  });
});
