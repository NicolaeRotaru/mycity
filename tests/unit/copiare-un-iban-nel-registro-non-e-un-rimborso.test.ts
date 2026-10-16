import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

const finto = vi.hoisted(() => ({
  db: null as unknown as FintoDatabase,
  registro: [] as Array<{ action: string; targetTable?: string; metadata?: Record<string, unknown> }>,
}));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => finto.db.client }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(async (voce: { action: string; targetTable?: string; metadata?: Record<string, unknown> }) => {
    finto.registro.push(voce);
  }),
}));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (h: (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown) =>
    async (req: Request) => h({ user: { id: 'nicola' }, req, params: {} }),
}));

import { POST as comandoDellaLista } from '@/app/api/admin/rimborsi-da-bonificare/route';
import { etichettaAzioneAudit, opzioniFiltroAudit } from '@/lib/audit-azioni';

/**
 * Riesame del 16/10, quinto giro — NEL REGISTRO, COPIARE UN IBAN ERA «ORDINE RIMBORSATO».
 *
 * Il cliente manda l'IBAN dai Contatti e chi paga lo copia sulla voce del bonifico. Nessun soldo si
 * muove. Nel registro delle azioni la riga diceva «Ordine rimborsato · returns/2222…», e il filtro
 * «Ordine rimborsato» la mescolava ai rimborsi veri: chi controlla il registro non li distingueva
 * senza aprire i dettagli. Adesso il salvataggio dell'IBAN ha la sua voce.
 *
 * Gira la rotta vera, su un finto database; il registro e' quello che la rotta chiede di scrivere,
 * letto con le stesse etichette della pagina «Audit log».
 */

const RESO = '22222222-2222-4222-8222-222222222222';
const ORDINE = '11111111-1111-4111-8111-111111111111';
const SEGNO = `bonifico:4000:return_${RESO}`;

beforeEach(() => {
  finto.registro = [];
  finto.db = creaFintoDatabase({
    orders: [{ id: ORDINE, stripe_refund_id: SEGNO }],
    returns: [{
      id: RESO, order_id: ORDINE, status: 'REFUNDED', refund_id: SEGNO, refund_iban: null, refund_bonifico_cents: 4000,
      refund_bonifico_fatto_at: null, refund_method: 'BONIFICO',
    }],
  });
});

async function comando(corpo: Record<string, unknown>) {
  const res = await (comandoDellaLista as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/admin/rimborsi-da-bonificare', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resoId: RESO, ...corpo }),
    }),
  );
  return res.status;
}

describe('nel registro, copiare un IBAN e segnare un bonifico fatto sono due cose diverse', () => {
  it('IL CASO CHE ROMPEVA — l IBAN copiato non si legge «Ordine rimborsato»', async () => {
    expect(await comando({ azione: 'iban', iban: 'IT60X0542811101000000123456' })).toBe(200);
    expect(finto.db.tabelle.returns[0].refund_iban, 'l IBAN non e stato salvato: la prova non misura niente').toBeTruthy();

    const [voce] = finto.registro;
    expect(etichettaAzioneAudit(voce.action), 'salvare un IBAN compare nel registro come un rimborso').not.toBe(etichettaAzioneAudit('order.refund'));
    // E il filtro della pagina la offre: si ritrova senza aprire i dettagli di ogni riga.
    expect(opzioniFiltroAudit().map((o) => o.valore)).toContain(voce.action);
  });

  it('il bonifico segnato fatto resta un rimborso: i soldi sono usciti', async () => {
    expect(await comando({ azione: 'fatto' })).toBe(200);
    expect(finto.registro[0].action).toBe('order.refund');
  });
});
