import { describe, it, expect } from 'vitest';
import { potatureDiRitenzione, type ClientePotature } from '@/lib/privacy/potature-ritenzione';

/** S08 (5/11/2026) — scheda 1584: la potatura del profilo tocca solo le righe con ancora qualcosa. */

function clienteCheRegistra() {
  const catene: Array<{ tabella: string; passi: Array<[string, unknown[]]> }> = [];
  const cliente = {
    from(tabella: string) {
      const passi: Array<[string, unknown[]]> = [];
      catene.push({ tabella, passi });
      const f: Record<string, unknown> = {};
      for (const m of ['eq', 'lt', 'is', 'not', 'or']) f[m] = (...a: unknown[]) => { passi.push([m, a]); return f; };
      f.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, count: 0 }).then(ok);
      return {
        update: (v: unknown) => { passi.push(['update', [v]]); return f; },
        delete: () => { passi.push(['delete', []]); return f; },
      };
    },
    rpc: async () => ({ data: 0, error: null }),
    storage: { from: () => ({ remove: async () => ({ data: null, error: null }) }) },
  };
  return { cliente: cliente as unknown as ClientePotature, catene };
}

describe('activity_events.profilo', () => {
  it('ha un filtro che salta le righe già pulite, come le sorelle', async () => {
    const passo = potatureDiRitenzione(Date.now()).find((p) => p.cosa === 'activity_events.profilo')!;
    const { cliente, catene } = clienteCheRegistra();
    await passo.fai(cliente, { info() {}, warn() {}, error() {} });
    const catena = catene.find((c) => c.tabella === 'activity_events')!;
    const filtro = catena.passi.find(([m]) => m === 'or' || m === 'not');
    expect(filtro, 'nessun filtro: ogni notte si riscrivono le righe già pulite').toBeTruthy();
    const testo = String(filtro![1][0]);
    for (const colonna of ['anon_id', 'path', 'referrer', 'city', 'country']) expect(testo).toContain(`${colonna}.not.is.null`);
  });
});
