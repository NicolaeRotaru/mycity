import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 25/11/2026 — L'ANAGRAFICA DEL FATTORINO SI SCRIVE DAL SERVER.
 *
 * La migrazione 861 toglie nome, cognome, codice fiscale, nascita e residenza dai campi che una
 * persona cambia di sé dal browser. Il passo 1 dell'iscrizione del fattorino passa da
 * PATCH /api/rider/anagrafica. Qui si prova che la rotta:
 *  · scrive i quattro campi di un fattorino, col codice fiscale in maiuscolo;
 *  · respinge un formato sbagliato e un minorenne, senza scrivere niente;
 *  · scrive solo per un fattorino, e mai per uno sospeso;
 *  · nella scrittura stessa lascia passare uno stato vuoto (NULL), che non è «sospeso»;
 *  · avvisa lo staff se un dato già scritto cambia, e non la prima volta.
 */

const stato = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
  scritture: [] as Record<string, unknown>[],
  filtriScrittura: [] as Array<[string, unknown[]]>,
  filtriLettura: [] as Array<[string, unknown[]]>,
  righeScritte: 1,
  avvisi: [] as string[][],
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: { id: 'fattorino-1', email: 'f@esempio.it' }, profile: {}, req, params: {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  notifyAdmins: async (...a: string[]) => { stato.avvisi.push(a); return 'scritto'; },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      let valori: Record<string, unknown> | null = null;
      const c: Record<string, unknown> = {};
      const filtro = (nome: string) => (...a: unknown[]) => {
        (valori ? stato.filtriScrittura : stato.filtriLettura).push([nome, a]);
        return c;
      };
      c.select = () => c;
      c.eq = filtro('eq');
      c.neq = filtro('neq');
      c.or = filtro('or');
      c.maybeSingle = async () => ({ data: stato.profilo, error: null });
      c.update = (v: Record<string, unknown>) => { valori = v; stato.scritture.push(v); return c; };
      (c as { then: unknown }).then = (ok: (v: unknown) => void) =>
        ok(valori
          ? { data: Array.from({ length: stato.righeScritte }, () => ({ id: 'fattorino-1' })), error: null }
          : { data: null, error: null });
      return c;
    },
  }),
}));

const { PATCH } = await import('@/app/api/rider/anagrafica/route');

const chiama = (corpo: unknown) =>
  (PATCH as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/rider/anagrafica', { method: 'PATCH', body: JSON.stringify(corpo) }),
  );

const giusto = { legalFirstName: ' Mario ', legalLastName: 'Rossi', legalFiscalCode: 'rssmra90a01g535x', legalBirthDate: '1990-01-01' };
/** Un anno di nascita che oggi dà 15 anni, così la prova non scade col calendario. */
const nascitaDaMinorenne = () => `${new Date().getFullYear() - 15}-01-01`;
const vuoto = { legal_first_name: null, legal_last_name: null, legal_fiscal_code: null, legal_birth_date: null };

beforeEach(() => {
  stato.profilo = { role: 'rider', approval_status: 'pending', full_name: 'Mario Rossi', ...vuoto };
  stato.scritture = [];
  stato.filtriScrittura = [];
  stato.filtriLettura = [];
  stato.righeScritte = 1;
  stato.avvisi = [];
});

describe('l anagrafica del fattorino si scrive dal server', () => {
  it('scrive i quattro campi, col codice fiscale in maiuscolo e il nome senza spazi', async () => {
    const r = await chiama(giusto);
    expect(r.status).toBe(200);
    expect(stato.scritture).toEqual([{
      legal_first_name: 'Mario', legal_last_name: 'Rossi', legal_fiscal_code: 'RSSMRA90A01G535X', legal_birth_date: '1990-01-01',
    }]);
  });

  // Dal collaudo del 25/11: il finto database ignora i filtri, quindi senza questa prova togliere
  // `.eq('id', user.id)` dalla scrittura restava verde, e la rotta avrebbe scritto su tutti i fattorini.
  it('legge e scrive solo il profilo di chi chiama, anche se il corpo porta un altro id', async () => {
    const r = await chiama({ ...giusto, id: 'altro-utente', userId: 'altro-utente' });
    expect(r.status).toBe(200);
    expect(stato.filtriLettura).toContainEqual(['eq', ['id', 'fattorino-1']]);
    expect(stato.filtriScrittura).toContainEqual(['eq', ['id', 'fattorino-1']]);
    const tuttiGliId = [...stato.filtriLettura, ...stato.filtriScrittura].filter(([, a]) => a[0] === 'id');
    expect(tuttiGliId.every(([, a]) => a[1] === 'fattorino-1'), 'un id preso dal corpo arriva al database').toBe(true);
    expect(stato.scritture[0]).not.toHaveProperty('id');
  });

  it('nella scrittura ricontrolla il ruolo e lo stato, e uno stato vuoto non è «sospeso»', async () => {
    await chiama(giusto);
    expect(stato.filtriScrittura).toContainEqual(['eq', ['role', 'rider']]);
    expect(stato.filtriScrittura).toContainEqual(['or', ['approval_status.is.null,approval_status.neq.suspended']]);
    // `neq` da solo escluderebbe le righe con lo stato NULL: in SQL NULL <> 'suspended' non è vero.
    expect(stato.filtriScrittura.some(([n]) => n === 'neq')).toBe(false);
  });

  it('un minorenne è respinto e non si scrive niente', async () => {
    const r = await chiama({ ...giusto, legalBirthDate: nascitaDaMinorenne() });
    expect(r.status).toBe(400);
    expect(stato.scritture).toEqual([]);
  });

  it('un codice fiscale di forma sbagliata è respinto e non si scrive niente', async () => {
    const r = await chiama({ ...giusto, legalFiscalCode: 'RSS-MRA' });
    expect(r.status).toBe(400);
    expect(stato.scritture).toEqual([]);
  });

  it('un nome di una lettera o una data illeggibile sono respinti', async () => {
    expect((await chiama({ ...giusto, legalFirstName: 'M' })).status).toBe(400);
    expect((await chiama({ ...giusto, legalBirthDate: '01/01/1990' })).status).toBe(400);
    expect(stato.scritture).toEqual([]);
  });

  it('un negozio o un cliente non scrivono da qui', async () => {
    for (const role of ['seller', 'buyer']) {
      stato.profilo = { role, approval_status: 'pending', full_name: 'X', ...vuoto };
      expect((await chiama(giusto)).status).toBe(403);
    }
    expect(stato.scritture).toEqual([]);
  });

  it('un fattorino sospeso non cambia i suoi dati da solo', async () => {
    stato.profilo = { role: 'rider', approval_status: 'suspended', full_name: 'Mario Rossi', ...vuoto };
    expect((await chiama(giusto)).status).toBe(403);
    expect(stato.scritture).toEqual([]);
  });

  it('se lo stato cambia fra la lettura e la scrittura, risponde 409', async () => {
    stato.righeScritte = 0;
    expect((await chiama(giusto)).status).toBe(409);
    expect(stato.avvisi).toEqual([]);
  });
});

describe('lo staff sa quando un dato già scritto cambia', () => {
  it('la prima volta non si avvisa: è l iscrizione', async () => {
    expect((await chiama(giusto)).status).toBe(200);
    expect(stato.avvisi).toEqual([]);
  });

  it('rimandare gli stessi dati non avvisa', async () => {
    stato.profilo = {
      role: 'rider', approval_status: 'approved', full_name: 'Mario Rossi',
      legal_first_name: 'Mario', legal_last_name: 'Rossi', legal_fiscal_code: 'RSSMRA90A01G535X', legal_birth_date: '1990-01-01',
    };
    expect((await chiama(giusto)).status).toBe(200);
    expect(stato.avvisi).toEqual([]);
  });

  it('un codice fiscale cambiato avvisa lo staff, con il nome del campo', async () => {
    stato.profilo = {
      role: 'rider', approval_status: 'approved', full_name: 'Mario Rossi',
      legal_first_name: 'Mario', legal_last_name: 'Rossi', legal_fiscal_code: 'BNCLGU85B02G535Y', legal_birth_date: '1990-01-01',
    };
    expect((await chiama(giusto)).status).toBe(200);
    expect(stato.avvisi).toHaveLength(1);
    expect(stato.avvisi[0][0]).toBe('Dati del fattorino cambiati');
    expect(stato.avvisi[0][1]).toContain('legal_fiscal_code');
    expect(stato.avvisi[0][1]).not.toContain('legal_first_name');
    expect(stato.avvisi[0][2]).toBe('/admin/users');
  });
});
