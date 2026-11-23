import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TIPI_ATTIVITA } from '@/lib/agenzia/tipi-attivita';

/**
 * 22/11/2026 — Nicola: «quando l'imprenditore si iscrive, non è più obbligatorio
 * essere per forza una bottega». Bar, ristoranti, artigiani, servizi: dentro tutti.
 *
 *  · un bar che si iscrive resta un bar nel database;
 *  · un tipo inventato non entra (né dal server né dal vincolo del database);
 *  · «altro» chiede due parole su che attività è;
 *  · un modulo vecchio, che il tipo non lo manda, non cancella quello salvato;
 *  · se il codice va online prima della migrazione 703, ci si iscrive lo stesso.
 */

const stato = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
  scritture: [] as Record<string, unknown>[],
  colonnaMancante: false,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: { id: 'utente-1', email: 'bar@esempio.it' }, profile: {}, req, params: {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      let valori: Record<string, unknown> | null = null;
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.in = () => c;
      c.or = () => c;
      c.insert = async () => ({ error: null });
      c.maybeSingle = async () => ({ data: stato.profilo, error: null });
      c.update = (v: Record<string, unknown>) => { valori = v; stato.scritture.push(v); return c; };
      (c as { then: unknown }).then = (ok: (v: unknown) => void) => {
        if (!valori) return ok({ data: null, error: null });
        if (stato.colonnaMancante && 'business_type' in valori) {
          return ok({ data: null, error: { code: 'PGRST204', message: "Could not find the 'business_type' column of 'profiles' in the schema cache" } });
        }
        return ok({ data: [{ id: 'utente-1' }], error: null });
      };
      return c;
    },
  }),
}));

const { POST } = await import('@/app/api/seller/apply/route');

const modulo = {
  businessType: 'bar',
  contactPhone: '3331234567',
  legalFirstName: 'Mario',
  legalLastName: 'Rossi',
  legalFiscalCode: 'RSSMRA80E05G535X',
  legalBirthDate: '1980-05-05',
  legalResidenceAddr: 'Via Roma 1',
  legalResidenceCity: 'Piacenza',
  legalResidenceZip: '29121',
  businessLegalName: 'Bar Roma di Mario Rossi',
  businessVatNumber: '01234567897',
  businessAddress: 'Via Roma 1',
  businessCity: 'Piacenza',
  businessZip: '29121',
  storeName: 'Bar Roma',
  storeDescription: '',
  billingIban: '',
  storeLogo: null,
  storeMedia: [],
  storeAddress: 'Via Roma 1, Piacenza',
  storeLat: 45.05,
  storeLng: 9.69,
  acceptTos: true,
  acceptPrivacy: true,
  acceptAccuracy: true,
};

const invia = (corpo: unknown) =>
  (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/seller/apply', { method: 'POST', body: JSON.stringify(corpo) }),
  );

beforeEach(() => {
  stato.profilo = { role: 'buyer', approval_status: 'pending' };
  stato.scritture = [];
  stato.colonnaMancante = false;
});

describe('ogni attività può iscriversi', () => {
  it('un bar si iscrive e resta un bar', async () => {
    const r = await invia(modulo);
    expect(r.status).toBe(200);
    expect(stato.scritture).toHaveLength(1);
    expect(stato.scritture[0].business_type).toBe('bar');
    expect(stato.scritture[0].business_type_detail).toBeNull();
    expect(stato.scritture[0].role).toBe('seller');
  });

  it('un ristorante entra: dal 22/11 dentro tutti', async () => {
    expect((await invia({ ...modulo, businessType: 'ristorante' })).status).toBe(200);
    expect(stato.scritture[0].business_type).toBe('ristorante');
  });

  it('un tipo inventato non entra', async () => {
    expect((await invia({ ...modulo, businessType: 'banca' })).status).toBe(400);
    expect(stato.scritture).toHaveLength(0);
  });

  it('«altro» chiede due parole su che attività è, e le salva', async () => {
    expect((await invia({ ...modulo, businessType: 'altro' })).status).toBe(400);
    expect((await invia({ ...modulo, businessType: 'altro', businessTypeDetail: ' ' })).status).toBe(400);
    expect(stato.scritture).toHaveLength(0);
    expect((await invia({ ...modulo, businessType: 'altro', businessTypeDetail: '  Fotografo  ' })).status).toBe(200);
    expect(stato.scritture[0].business_type_detail).toBe('Fotografo');
  });

  it('un modulo vecchio, che il tipo non lo manda, non cancella quello salvato', async () => {
    const vecchio: Record<string, unknown> = { ...modulo };
    delete vecchio.businessType;
    expect((await invia(vecchio)).status).toBe(200);
    expect('business_type' in stato.scritture[0]).toBe(false);
  });

  it('prima della migrazione 703 ci si iscrive lo stesso: la richiesta si salva senza il tipo', async () => {
    stato.colonnaMancante = true;
    const r = await invia(modulo);
    expect(r.status).toBe(200);
    expect(stato.scritture).toHaveLength(2);
    expect('business_type' in stato.scritture[1]).toBe(false);
    expect(stato.scritture[1].role).toBe('seller');
  });
});

describe('il database conosce gli stessi tipi del sito', () => {
  it('il vincolo della migrazione 703 elenca esattamente TIPI_ATTIVITA', () => {
    const sql = readFileSync(join(process.cwd(), 'migrations/703_ogni_attivita_puo_iscriversi_e_ha_il_suo_preventivo.sql'), 'utf8');
    const riga = sql.match(/business_type IN \(([^)]*)\)/);
    expect(riga, 'vincolo sul tipo non trovato').toBeTruthy();
    const nelDatabase = [...riga![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(nelDatabase).toEqual([...TIPI_ATTIVITA]);
  });
});
