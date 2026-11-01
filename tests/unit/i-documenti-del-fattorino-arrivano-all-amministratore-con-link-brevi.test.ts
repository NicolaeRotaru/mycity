/**
 * Ondata 3 — la rotta che porta all'amministratore i documenti di un fattorino.
 *
 * Senza di lei il pannello «Esamina» non aveva niente da mostrare: in
 * produzione la verifica e' solo manuale. Qui si prova che i documenti
 * arrivano come link firmati BREVI dal bucket privato, con le scadenze di
 * patente e polizza, che ogni lettura resta a verbale, e che la rotta non
 * serve i documenti di chi fattorino non e'.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const ADMIN = { id: 'admin-1' };
const ID = '11111111-2222-3333-4444-555555555555';

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (h: (ctx: { req: Request; user: typeof ADMIN; params: Record<string, string> }) => unknown) =>
    (req: Request, ctx: { params: Record<string, string> }) =>
      h({ req, user: ADMIN, params: ctx.params }),
}));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: () => '1.2.3.4' }));

let profilo: Record<string, unknown> | null = null;
let firme: Array<{ bucket: string; path: string; secondi: number }> = [];
let verbale: Array<Record<string, unknown>> = [];

vi.mock('@/lib/audit', () => ({
  writeAudit: async (r: Record<string, unknown>) => { verbale.push(r); },
}));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: profilo, error: null }) }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, secondi: number) => {
          firme.push({ bucket, path, secondi });
          return { data: { signedUrl: `https://firmato/${path}?s=${secondi}` } };
        },
      }),
    },
  }),
}));

import { GET } from '@/app/api/kyc/documenti-rider/[id]/route';

const chiama = (id = ID) =>
  (GET as unknown as (r: Request, c: { params: Record<string, string> }) => Promise<Response>)(
    new Request(`http://x/api/kyc/documenti-rider/${id}`),
    { params: { id } },
  );

beforeEach(() => {
  firme = [];
  verbale = [];
  profilo = {
    id: ID, role: 'rider', legal_birth_date: '2000-03-15',
    kyc_id_doc_front_url: `${ID}/fronte.jpg`, kyc_id_doc_back_url: null, kyc_selfie_url: `${ID}/selfie.jpg`,
    rider_license_url: `${ID}/patente.jpg`, rider_license_expires_on: '2030-05-01',
    rider_insurance_url: `${ID}/polizza.pdf`, rider_insurance_expires_on: '2026-01-31',
  };
});

describe('i documenti del fattorino per l\'amministratore', () => {
  it('arrivano con link firmati brevi dal bucket privato, con le scadenze e la data di nascita', async () => {
    const res = await chiama();
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.legal_birth_date).toBe('2000-03-15');

    const per = Object.fromEntries(corpo.documenti.map((d: { chiave: string }) => [d.chiave, d]));
    expect(per.patente.url).toContain('patente.jpg');
    expect(per.patente.scade_il).toBe('2030-05-01');
    expect(per.polizza.url).toContain('polizza.pdf');
    expect(per.polizza.scade_il, 'la scadenza della polizza non arrivava al pannello').toBe('2026-01-31');
    expect(per.documento_fronte.url).toContain('fronte.jpg');
    expect(per.selfie.url).toContain('selfie.jpg');
    expect(per.documento_retro.url, 'un file che non c\'e\' non diventa un link').toBeNull();

    expect(firme.length).toBe(4);
    for (const f of firme) {
      expect(f.bucket).toBe('kyc-docs');
      expect(f.secondi, 'un link ai documenti d\'identita\' deve durare pochi minuti').toBeLessThanOrEqual(300);
    }
    expect(res.headers.get('cache-control') ?? '').toContain('no-store');
  });

  it('ogni lettura resta a verbale: chi, di chi', async () => {
    await chiama();
    expect(verbale).toHaveLength(1);
    expect(verbale[0].actorId).toBe(ADMIN.id);
    expect(verbale[0].targetId).toBe(ID);
  });

  it('non serve i documenti di chi non e\' un fattorino', async () => {
    profilo = { ...profilo, role: 'buyer' };
    const res = await chiama();
    expect(res.status).toBe(400);
    expect(firme).toHaveLength(0);
  });

  it('rifiuta un id che non e\' un id', async () => {
    const res = await chiama('../../altro');
    expect(res.status).toBe(400);
    expect(firme).toHaveLength(0);
  });
});
