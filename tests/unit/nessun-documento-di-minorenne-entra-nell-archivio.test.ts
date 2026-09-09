import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 3/9/2026 — IL DOCUMENTO DEL MINORENNE ERA GIÀ NEL NOSTRO ARCHIVIO QUANDO IL
 * CANCELLO DEI DICIOTTO ANNI SI ACCORGEVA DI LUI.
 *
 * Il conto degli anni girava sul pulsante finale del modulo del fattorino. I
 * documenti però partono prima, appena si sceglie il file, con una chiamata a
 * parte a `/api/kyc/upload-document` che nessuna data di nascita la guardava; e
 * `/api/kyc/start-check` la leggeva solo per passarla al fornitore. Un
 * quindicenne caricava carta d'identità, retro e selfie — che finivano nel
 * secchio `kyc-docs` — e solo dopo leggeva «servono 18 anni compiuti».
 *
 * Il caso vero non è il ragazzo che aggira il controllo: è quello che lo
 * subisce. Da quel momento conserviamo il documento d'identità di un minorenne
 * senza una base giuridica utile (il contratto che la giustificherebbe non può
 * esistere), senza informativa dedicata ai minori e senza nessuno che lo
 * cancelli: la pulizia dell'archivio passa solo dalla chiusura dell'account,
 * che quel ragazzo non chiederà mai.
 *
 * Questa prova sta sulle DUE rotte del server, non sul modulo: il modulo è
 * difeso da `un-minorenne-non-si-iscrive-come-fattorino.test.ts`, ma il modulo
 * è un controllo del browser e il browser si chiude con gli strumenti da
 * sviluppatore. Qui si pretende che nel secchio non finisca niente.
 */

const FAKE_USER = { id: 'rider-1', email: 'r@x.com' };

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (
      _opzioni: unknown,
      h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown,
    ) =>
    (req: Request) =>
      h({ user: FAKE_USER, req }),
}));

/** Il profilo che il database restituisce in questa prova. */
let profiloInArchivio: Record<string, unknown> | null = null;
/** Ogni percorso davvero scritto nel secchio `kyc-docs`. */
let scrittiNelSecchio: string[] = [];
/** Ogni `update` arrivato su `profiles`. */
let aggiornamentiProfilo: Record<string, unknown>[] = [];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: profiloInArchivio, error: null }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        aggiornamentiProfilo.push(patch);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
    storage: {
      from: () => ({
        upload: (path: string) => {
          scrittiNelSecchio.push(path);
          return Promise.resolve({ error: null });
        },
        createSignedUrl: (path: string) =>
          Promise.resolve({ data: { signedUrl: `https://firmato.test/${path}` }, error: null }),
      }),
    },
  }),
}));

const startCheckMock = vi.fn();
vi.mock('@/lib/kyc/providers', () => ({
  getKycProvider: () => ({ startCheck: startCheckMock }),
  viesVatLookup: () => Promise.resolve({ valid: true }),
}));

vi.mock('@/lib/audit', () => ({ writeAudit: () => Promise.resolve() }));

import { POST as UPLOAD } from '@/app/api/kyc/upload-document/route';
import { POST as START_CHECK } from '@/app/api/kyc/start-check/route';

/** Un PNG vero: i primi byte sono la firma che la rotta controlla. */
function pngVero(): File {
  const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const bytes = new Uint8Array([...firma, ...new Array(64).fill(0)]);
  return new File([bytes], 'carta-identita.png', { type: 'image/png' });
}

function richiestaDiCaricamento(): never {
  const fd = new FormData();
  fd.append('file', pngVero());
  fd.append('kind', 'id_front');
  return new Request('http://localhost/api/kyc/upload-document', {
    method: 'POST',
    body: fd,
  }) as never;
}

function richiestaDiVerifica(): never {
  return new Request('http://localhost/api/kyc/start-check', { method: 'POST' }) as never;
}

/** Quanti anni fa, in data `AAAA-MM-GG`. */
function nataAnniFa(anni: number): string {
  const oggi = new Date();
  return new Date(Date.UTC(oggi.getUTCFullYear() - anni, oggi.getUTCMonth(), oggi.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

const PROFILO_COMPLETO = {
  id: FAKE_USER.id,
  role: 'rider',
  email: FAKE_USER.email,
  legal_first_name: 'Luca',
  legal_last_name: 'Rossi',
  legal_fiscal_code: 'RSSLCU11A01G535X',
  business_vat_number: null,
  kyc_id_doc_front_url: 'rider-1/id_front-1.png',
  kyc_id_doc_back_url: null,
  kyc_selfie_url: 'rider-1/selfie-1.png',
  rider_license_url: 'rider-1/rider_license-1.png',
  rider_insurance_url: 'rider-1/rider_insurance-1.png',
};

beforeEach(() => {
  vi.clearAllMocks();
  scrittiNelSecchio = [];
  aggiornamentiProfilo = [];
  profiloInArchivio = null;
  startCheckMock.mockResolvedValue({ ok: true, status: 'APPROVED', providerCheckId: 'chk_1' });
});

describe('il documento di un minorenne non entra nel secchio kyc-docs', () => {
  it('quindici anni: la carta d identità viene rifiutata e non resta da noi', async () => {
    profiloInArchivio = { legal_birth_date: nataAnniFa(15) };

    const r = await UPLOAD(richiestaDiCaricamento());
    const corpo = await r.json();

    expect(r.status, 'la rotta accetta il documento di un quindicenne').toBe(403);
    expect(corpo.error.message).toContain('18');
    expect(
      scrittiNelSecchio,
      'il documento di un minorenne è finito nell archivio kyc-docs',
    ).toEqual([]);
    expect(
      aggiornamentiProfilo,
      'il percorso del documento è stato scritto nel profilo del minorenne',
    ).toEqual([]);
  });

  it('senza data di nascita non si carica niente: il silenzio non è un sì', async () => {
    profiloInArchivio = { legal_birth_date: null };

    const r = await UPLOAD(richiestaDiCaricamento());
    const corpo = await r.json();

    expect(r.status, 'chi non ha ancora detto quando è nato carica lo stesso').toBe(400);
    expect(corpo.error.message.toLowerCase()).toContain('data di nascita');
    expect(scrittiNelSecchio, 'documento accettato prima di sapere l età di chi lo manda').toEqual([]);
  });

  it('a diciotto anni compiuti il documento passa: il cancello non dice no a tutti', async () => {
    profiloInArchivio = { legal_birth_date: nataAnniFa(30) };

    const r = await UPLOAD(richiestaDiCaricamento());

    expect(r.status, 'un maggiorenne non riesce più a caricare i documenti').toBe(200);
    expect(scrittiNelSecchio.length, 'il file di un maggiorenne non è stato salvato').toBe(1);
    expect(scrittiNelSecchio[0]).toContain('rider-1/id_front-');
  });
});

describe('la verifica del documento non parte per un minorenne', () => {
  it('quindici anni: start-check si ferma e il fornitore non viene nemmeno chiamato', async () => {
    profiloInArchivio = { ...PROFILO_COMPLETO, legal_birth_date: nataAnniFa(15) };

    const r = await START_CHECK(richiestaDiVerifica());
    const corpo = await r.json();

    expect(r.status, 'la verifica di un quindicenne parte lo stesso').toBe(403);
    expect(corpo.error.message).toContain('18');
    expect(
      startCheckMock.mock.calls.length,
      'i dati e i documenti di un minorenne sono stati mandati al fornitore KYC',
    ).toBe(0);
    expect(
      aggiornamentiProfilo,
      'lo stato KYC di un minorenne è stato scritto nel profilo',
    ).toEqual([]);
  });

  it('senza data di nascita la verifica non parte', async () => {
    profiloInArchivio = { ...PROFILO_COMPLETO, legal_birth_date: null };

    const r = await START_CHECK(richiestaDiVerifica());

    expect(r.status, 'si avvia una verifica senza sapere l età').toBe(400);
    expect(startCheckMock.mock.calls.length).toBe(0);
  });

  it('con l età giusta la verifica parte come prima', async () => {
    profiloInArchivio = { ...PROFILO_COMPLETO, legal_birth_date: nataAnniFa(30) };

    const r = await START_CHECK(richiestaDiVerifica());
    const corpo = await r.json();

    expect(r.status, 'un maggiorenne non riesce più ad avviare la verifica').toBe(200);
    expect(corpo.status).toBe('APPROVED');
    expect(startCheckMock.mock.calls.length).toBe(1);
  });
});
