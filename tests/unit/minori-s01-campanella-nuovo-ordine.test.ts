import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
import { suonaLaCampanellaAiNegozi, idDaChiave } from '@/lib/stripe/webhook/comune';

/**
 * S01 — 155: in un carrello di più negozi, se il primo tentativo del webhook
 * crea l'ordine A e cade su B, alla riconsegna A riceve lo stesso la sua
 * campanella (e le sue email); un ordine già avvisato no.
 */
function finto(giaScritte: Set<string>) {
  const scritte: Array<Record<string, unknown>> = [];
  return {
    scritte,
    admin: {
      from: () => ({
        insert: async (righe: Array<Record<string, unknown>>) => {
          const r = righe[0];
          if (giaScritte.has(String(r.id))) return { error: { code: '23505', message: 'duplicate' } };
          giaScritte.add(String(r.id));
          scritte.push(r);
          return { error: null };
        },
      }),
    } as never,
  };
}
const A = { orderId: 'ordine-a', sellerId: 'forno', totalCents: 1500, itemsCount: 1 };
const B = { orderId: 'ordine-b', sellerId: 'frutta', totalCents: 1200, itemsCount: 2 };

describe('155 — la campanella di ogni ordine del carrello, una volta sola', () => {
  it('riconsegna dopo un tentativo morto prima degli avvisi: A e B ricevono la campanella', async () => {
    const db = finto(new Set());
    const avvisati = await suonaLaCampanellaAiNegozi(db.admin, [A, B], 'pc_1');
    expect([...avvisati].sort()).toEqual(['ordine-a', 'ordine-b']);
    expect(db.scritte.map((r) => r.user_id).sort()).toEqual(['forno', 'frutta']);
  });
  it('A già avvisato: niente seconda campanella né seconde email per A', async () => {
    const db = finto(new Set([idDaChiave('nuovo-ordine:ordine-a')]));
    const avvisati = await suonaLaCampanellaAiNegozi(db.admin, [A, B], 'pc_1');
    expect([...avvisati]).toEqual(['ordine-b']);
  });
  it('il webhook tenta la campanella per tutti gli ordini e manda le email a quelli avvisati adesso', () => {
    const s = readFileSync('lib/stripe/webhook/ordini.ts', 'utf8');
    expect(s).toContain('await suonaLaCampanellaAiNegozi(admin, createdOrderIds, pendingCheckoutId)');
    expect(s).toContain('createdOrderIds.filter((c) => daAvvisare.has(c.orderId))');
  });
});

describe('155 / revisore — campanella caduta per un altro guasto', () => {
  it('ordine già esistente: niente email ripetute; ordine nuovo: le email partono', async () => {
    const admin = { from: () => ({ insert: async () => ({ error: { code: '57014', message: 'timeout' } }) }) } as never;
    const avvisati = await suonaLaCampanellaAiNegozi(admin, [{ ...A, nuovo: false }, { ...B, nuovo: true }], 'pc_1');
    expect([...avvisati]).toEqual(['ordine-b']);
  });
});
