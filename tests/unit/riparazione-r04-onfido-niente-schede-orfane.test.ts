import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getKycProvider } from '@/lib/kyc/providers';

/**
 * R04-024 — Con Onfido acceso ogni tentativo creava una scheda con nome, email
 * e data di nascita senza caricare i documenti: il controllo falliva e la
 * scheda restava li', orfana. Adesso i documenti si caricano prima del
 * controllo, e se un passo dopo la scheda fallisce la scheda si toglie.
 */

type Chiamata = { url: string; metodo: string; corpo: unknown };
let chiamate: Chiamata[] = [];
let checkRisponde = 201;

beforeEach(() => {
  vi.stubEnv('KYC_PROVIDER', 'onfido');
  vi.stubEnv('KYC_API_KEY', 'chiave-finta');
  chiamate = [];
  checkRisponde = 201;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    chiamate.push({ url, metodo, corpo: init?.body });
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://archivio.test/')) return new Response(new Blob(['img']), { status: 200 });
    if (url.endsWith('/applicants') && metodo === 'POST') return json(201, { id: 'app_1' });
    if (url.endsWith('/documents') || url.endsWith('/live_photos')) return json(201, { id: 'doc_1' });
    if (url.endsWith('/checks')) return checkRisponde === 201 ? json(201, { id: 'chk_1' }) : json(422, { error: { message: 'no documents' } });
    if (url.includes('/applicants/') && metodo === 'DELETE') return new Response(null, { status: 204 });
    return json(404, {});
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const SOGGETTO = { userId: 'u1', firstName: 'Anna', lastName: 'Rossi', email: 'a@x.it', birthDate: '1990-01-01' };
const DOCUMENTI = { idFrontUrl: 'https://archivio.test/f.jpg', idBackUrl: 'https://archivio.test/b.jpg', selfieUrl: 'https://archivio.test/s.jpg' };

describe('Onfido: niente schede orfane', () => {
  it('i documenti e il selfie si caricano sulla scheda PRIMA del controllo', async () => {
    const esito = await getKycProvider().startCheck(SOGGETTO, DOCUMENTI);
    expect(esito).toMatchObject({ ok: true, providerCheckId: 'chk_1' });
    const onfido = chiamate.filter((c) => c.url.includes('onfido.com')).map((c) => `${c.metodo} ${c.url.replace(/^.*v3\.6/, '')}`);
    expect(onfido).toEqual(['POST /applicants', 'POST /documents', 'POST /documents', 'POST /live_photos', 'POST /checks']);
    const documento = chiamate.find((c) => c.url.endsWith('/documents'))!.corpo as FormData;
    expect(documento.get('applicant_id')).toBe('app_1');
  });

  it('se il controllo fallisce, la scheda con i dati personali si toglie', async () => {
    checkRisponde = 422;
    const esito = await getKycProvider().startCheck(SOGGETTO, DOCUMENTI);
    expect(esito.ok).toBe(false);
    expect(chiamate.some((c) => c.metodo === 'DELETE' && c.url.endsWith('/applicants/app_1'))).toBe(true);
  });
});
