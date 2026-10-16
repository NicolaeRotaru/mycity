import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

const finto = vi.hoisted(() => ({
  db: null as unknown as FintoDatabase,
  registro: [] as Array<{ action: string; targetId?: string; metadata?: Record<string, unknown> }>,
}));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => finto.db.client }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(async (voce: { action: string; targetId?: string; metadata?: Record<string, unknown> }) => {
    finto.registro.push(voce);
  }),
}));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (h: (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown) =>
    async (req: Request) => h({ user: { id: 'nicola' }, req, params: {} }),
}));

import { POST as comandoDellaLista } from '@/app/api/admin/rimborsi-da-bonificare/route';

/**
 * Riesame del 16/10, sesto giro — UN IBAN SI SOSTITUIVA IN SILENZIO, E COL «FATTO» IL CONTO SPARIVA.
 *
 * Giulia scrive nel modulo di reso il suo IBAN, che finisce con 3456. La pagina dei bonifici mostra
 * il campo per l'IBAN solo dove manca, ma la rotta accettava lo stesso un IBAN nuovo sopra il suo:
 * una richiesta da un account amministratore lo cambiava con un conto tedesco che finisce con 3000,
 * e il registro diceva solo «IBAN salvato». Poi «fatto» cancellava l'IBAN e il registro diceva solo
 * «bonifico fatto»: su quale conto fossero andati i 40 € non lo diceva piu' niente.
 *
 * Adesso un IBAN scritto non si sostituisce da qui, e il registro tiene le ultime quattro cifre del
 * conto e, col «fatto», la cifra pagata. Gira la rotta vera su un finto database che applica i filtri
 * delle scritture.
 */

const RESO = '22222222-2222-4222-8222-222222222222';
const RECLAMO = '44444444-4444-4444-8444-444444444444';
const ORDINE = '11111111-1111-4111-8111-111111111111';
const SEGNO = `bonifico:4000:return_${RESO}`;
const IBAN_DI_GIULIA = 'IT60X0542811101000000123456';
const ALTRO_CONTO = 'DE89370400440532013000';

function mondo(ibanDelReso: string | null, ibanDelReclamo: string | null = null) {
  finto.registro = [];
  finto.db = creaFintoDatabase({
    orders: [{ id: ORDINE, stripe_refund_id: SEGNO }],
    returns: [{
      id: RESO, order_id: ORDINE, status: 'REFUNDED', refund_id: SEGNO, refund_method: 'BONIFICO', refund_iban: ibanDelReso,
      refund_intestatario: null, refund_bonifico_cents: 4000, refund_bonifico_fatto_at: null, refund_amount_cents: 4000,
    }],
    bonifici_dei_reclami: [{
      dispute_id: RECLAMO, order_id: ORDINE, importo_cents: 1800, registrato_at: '2026-10-15T10:00:00Z', fatto_at: null,
      iban: ibanDelReclamo, intestatario: null,
    }],
  });
}

async function comando(corpo: Record<string, unknown>) {
  const res = await (comandoDellaLista as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/admin/rimborsi-da-bonificare', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
    }),
  );
  return { status: res.status, corpo: (await res.json()) as { error?: { message?: string } } };
}

beforeEach(() => mondo(IBAN_DI_GIULIA));

describe('l IBAN scritto dal cliente non si sostituisce da qui', () => {
  it('IL CASO CHE ROMPEVA — un conto nuovo sopra quello di Giulia: rifiutato, il suo resta, il registro non scrive niente', async () => {
    const esito = await comando({ resoId: RESO, azione: 'iban', iban: ALTRO_CONTO });
    expect(esito.status, 'l IBAN di Giulia e stato sostituito').toBe(409);
    expect(finto.db.tabelle.returns[0].refund_iban).toBe(IBAN_DI_GIULIA);
    expect(finto.registro).toHaveLength(0);
    expect(esito.corpo.error?.message).toMatch(/non ce l.ha ancora/u);
  });

  it('lo stesso sul bonifico di un reclamo', async () => {
    mondo(null, IBAN_DI_GIULIA);
    expect((await comando({ reclamoId: RECLAMO, azione: 'iban', iban: ALTRO_CONTO })).status).toBe(409);
    expect(finto.db.tabelle.bonifici_dei_reclami[0].iban).toBe(IBAN_DI_GIULIA);
  });

  it('controllo: dove l IBAN manca si scrive, e il registro dice quale conto', async () => {
    mondo(null);
    expect((await comando({ resoId: RESO, azione: 'iban', iban: ALTRO_CONTO })).status).toBe(200);
    expect(finto.db.tabelle.returns[0].refund_iban).toBe(ALTRO_CONTO);
    expect(finto.registro[0]).toMatchObject({ action: 'refund.iban_registrato', metadata: { conto: '3000' } });
  });
});

describe('col «fatto» il registro ricorda su quale conto e quanto', () => {
  it('IL CASO CHE ROMPEVA — l IBAN si cancella, ma nel registro restano le ultime quattro cifre e i 40 €', async () => {
    expect((await comando({ resoId: RESO, azione: 'fatto' })).status).toBe(200);
    expect(finto.db.tabelle.returns[0].refund_iban, 'col fatto l IBAN doveva cancellarsi: la prova non misura il caso').toBeNull();

    expect(finto.registro).toHaveLength(1);
    expect(finto.registro[0]).toMatchObject({
      action: 'order.refund', targetId: RESO, metadata: { passo: 'bonifico_di_rimborso_fatto', conto: '3456', cifra_cents: 4000 },
    });
    // Le sole ultime quattro cifre: il conto intero non finisce nel registro.
    expect(JSON.stringify(finto.registro)).not.toContain(IBAN_DI_GIULIA);
  });

  it('lo stesso sul bonifico di un reclamo', async () => {
    mondo(null, IBAN_DI_GIULIA);
    expect((await comando({ reclamoId: RECLAMO, azione: 'fatto' })).status).toBe(200);
    expect(finto.db.tabelle.bonifici_dei_reclami[0].iban).toBeNull();
    expect(finto.registro[0].metadata).toMatchObject({ conto: '3456', cifra_cents: 1800 });
  });
});
