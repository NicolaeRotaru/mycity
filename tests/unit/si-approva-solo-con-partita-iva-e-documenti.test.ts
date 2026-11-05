// 5/11/2026 (S05, scheda 2617) — I fattorini dei casi hanno patente e polizza con la
// scadenza: ora il server la pretende (prima la guardava solo il pannello).
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 1/11/2026 — TRE DIFETTI DELLA ROTTA DI MODERAZIONE (S5, ondata 10, squadra D).
 *
 * ① Il rifiuto deve scrivere `approved_at = adesso`: la potatura dei documenti
 *   dei respinti (migrations/135) conta 90 giorni da lì e salta chi l'ha vuoto.
 * ② Un negozio senza partita IVA (o con una sbagliata) non si approva.
 * ③ Un fattorino senza i documenti obbligatori non si approva: il controllo
 *   c'era solo nel browser. Vale anche per `reactivate`, che da un rifiuto porta
 *   dritto ad «approvato».
 *
 * Le prove leggono quello che la rotta scriverebbe sul database finto: lo stato
 * di risposta e la patch, non il testo del codice.
 */

const ADMIN = { id: 'admin-1', email: 'a@x.com' };
let idBersaglio = 'x';

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (h: (ctx: { req: Request; user: typeof ADMIN; params: { id: string } }) => unknown) =>
    (req: Request) =>
      h({ req, user: ADMIN, params: { id: idBersaglio } }),
}));

let profilo: Record<string, unknown> | null = null;
let colonneLette: string[] = [];
let letture = 0;
let aggiornamenti: Record<string, unknown>[] = [];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) =>
      tabella === 'profiles'
        ? {
            select: (colonne: string) => {
              letture++;
              colonneLette = colonne.split(',').map((c) => c.trim());
              // Il database finto restituisce SOLO le colonne chieste: se la rotta
              // non legge la partita IVA o i documenti, per lei non esistono.
              const riga = profilo
                ? Object.fromEntries(colonneLette.map((c) => [c, profilo![c] ?? null]))
                : null;
              return { eq: () => ({ single: () => Promise.resolve({ data: riga, error: null }) }) };
            },
            update: (patch: Record<string, unknown>) => {
              aggiornamenti.push(patch);
              return { eq: () => Promise.resolve({ error: null }) };
            },
          }
        : { insert: () => Promise.resolve({ error: null }) },
  }),
}));

vi.mock('@/lib/audit', () => ({ writeAudit: () => Promise.resolve() }));

import { POST as MODERA } from '@/app/api/admin/users/[id]/moderate/route';

function richiesta(action: string, extra: Record<string, unknown> = {}): never {
  return new Request('http://localhost/api/admin/users/x/moderate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
  }) as never;
}

// 01234567897 ha il carattere di controllo giusto; 01234567890 no.
const PIVA_BUONA = '01234567897';
const NEGOZIO = { id: 'seller-1', role: 'seller', store_name: 'Pane', full_name: null, legal_birth_date: null, business_vat_number: PIVA_BUONA };
const FATTORINO = {
  id: 'rider-1', role: 'rider', store_name: null, full_name: 'Luca', legal_birth_date: null,
  kyc_id_doc_front_url: 'rider-1/fronte.jpg', kyc_selfie_url: 'rider-1/selfie.jpg',
  rider_license_url: 'rider-1/patente.pdf', rider_insurance_url: 'rider-1/rc.pdf', rider_license_expires_on: '2099-01-01', rider_insurance_expires_on: '2099-01-01',
};

function usa(p: Record<string, unknown>) {
  profilo = { ...p };
  idBersaglio = String(p.id);
}

beforeEach(() => {
  aggiornamenti = [];
  colonneLette = [];
  letture = 0;
  usa(FATTORINO);
});

describe('① il rifiuto fa partire i 90 giorni', () => {
  it('scrive approved_at = adesso anche per chi non era mai stato approvato', async () => {
    usa({ ...FATTORINO, approved_at: null });
    const prima = Date.now();
    const r = await MODERA(richiesta('reject', { reason: 'patente scaduta' }));
    expect(r.status).toBe(200);
    expect(aggiornamenti[0].approval_status).toBe('rejected');
    expect(aggiornamenti[0].approved_at, 'senza approved_at la potatura dei documenti non parte mai').toBeTruthy();
    expect(Date.parse(String(aggiornamenti[0].approved_at))).toBeGreaterThanOrEqual(prima - 1000);
  });

  it('il rifiuto non pretende partita IVA né documenti: si respinge proprio chi non li ha', async () => {
    usa({ ...NEGOZIO, business_vat_number: null });
    const r = await MODERA(richiesta('reject', { reason: 'manca la partita IVA' }));
    expect(r.status).toBe(200);
  });
});

describe('② il negozio si approva solo con una partita IVA valida', () => {
  it('senza partita IVA: 400 e niente scritto', async () => {
    usa({ ...NEGOZIO, business_vat_number: null });
    const r = await MODERA(richiesta('approve'));
    expect(r.status).toBe(400);
    expect(aggiornamenti).toEqual([]);
    expect(JSON.stringify(await r.json())).toMatch(/partita IVA/i);
  });

  it('partita IVA con il carattere di controllo sbagliato: 400', async () => {
    usa({ ...NEGOZIO, business_vat_number: '01234567890' });
    const r = await MODERA(richiesta('approve'));
    expect(r.status).toBe(400);
    expect(aggiornamenti).toEqual([]);
  });

  it('partita IVA troppo corta: 400', async () => {
    usa({ ...NEGOZIO, business_vat_number: '1234567' });
    expect((await MODERA(richiesta('approve'))).status).toBe(400);
    expect(aggiornamenti).toEqual([]);
  });

  it('la riattivazione chiede la stessa cosa', async () => {
    usa({ ...NEGOZIO, business_vat_number: '' });
    expect((await MODERA(richiesta('reactivate'))).status).toBe(400);
    expect(aggiornamenti).toEqual([]);
  });

  it('con una partita IVA valida (anche scritta «IT …» con spazi) si approva', async () => {
    usa({ ...NEGOZIO, business_vat_number: 'IT 0123 4567 897' });
    const r = await MODERA(richiesta('approve'));
    expect(r.status).toBe(200);
    expect(aggiornamenti[0].approval_status).toBe('approved');
  });

  it('la sospensione non chiede la partita IVA', async () => {
    usa({ ...NEGOZIO, business_vat_number: null, approval_status: 'approved' });
    expect((await MODERA(richiesta('suspend'))).status).toBe(200);
  });
});

describe('③ il fattorino si approva solo con i documenti caricati, guardati dal server', () => {
  for (const colonna of ['kyc_id_doc_front_url', 'kyc_selfie_url', 'rider_license_url', 'rider_insurance_url']) {
    it(`senza ${colonna}: 400 e niente scritto`, async () => {
      usa({ ...FATTORINO, [colonna]: null });
      const r = await MODERA(richiesta('approve'));
      expect(r.status).toBe(400);
      expect(aggiornamenti).toEqual([]);
    });
  }

  it('un respinto i cui documenti sono già stati potati non si riattiva', async () => {
    usa({ ...FATTORINO, kyc_id_doc_front_url: null, kyc_selfie_url: null, rider_license_url: null, rider_insurance_url: null });
    expect((await MODERA(richiesta('reactivate'))).status).toBe(400);
    expect(aggiornamenti).toEqual([]);
  });

  it('quello che manda il browser non conta: il profilo si legge dal database, una volta sola', async () => {
    usa({ ...FATTORINO, rider_license_url: null });
    const r = await MODERA(richiesta('approve', { rider_license_url: 'finto.pdf', business_vat_number: PIVA_BUONA }));
    expect(r.status).toBe(400);
    expect(letture).toBe(1);
  });

  it('con tutti i documenti si approva (il retro e l HACCP non servono)', async () => {
    const r = await MODERA(richiesta('approve'));
    expect(r.status).toBe(200);
    expect(aggiornamenti[0].is_approved).toBe(true);
  });
});
