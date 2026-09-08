import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  vistaDelleCampagne,
  SEGNO_NON_SO,
  type Campagna,
  type ElencoCampagne,
} from '@/lib/admin/vista-delle-campagne';

/**
 * 8/9/2026 — SE LA LETTURA DELLE CAMPAGNE CADEVA, IL PANNELLO SCRIVEVA CHE NON CE N'ERA NESSUNA.
 *
 * La lettura faceva `const { data } = await q; return (data ?? [])`. Quel `const { data }` butta
 * via `error` per costruzione: una lettura caduta diventava un elenco vuoto. Sotto c'era la sola
 * guardia `if (isLoading)`, e il provider di React Query riprova una volta sola senza alzare
 * l'errore al confine della pagina — quindi dopo il secondo tentativo `isLoading` torna falso,
 * `data` resta `undefined`, e il ripiego prende il posto del dato.
 *
 * A schermo: «Nessuna campagna.» sotto quattro riquadri a zero, «0,00 €» compreso. Cioè il
 * pannello diceva all'amministratore che i venditori hanno smesso di comprare pubblicità — mentre
 * l'unica cosa vera era che non era riuscito a guardare. Nessun avviso, nessun «Riprova».
 *
 * È la seconda metà della scheda che la corsia 7 ha chiuso su `/admin/coupons`: stessa malattia,
 * stessa cura, stessa regola di casa (`lib/stato-vista.ts` → `lib/vista-query.ts`).
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────────────────────
 * ① ESEGUE i quattro stati: sto leggendo · letto e vuoto · letto e pieno · caduta.
 * ② ESEGUE i due modi in cui la caduta si presenta — senza niente in mano e con l'elenco vuoto di
 *    ripiego in mano — perché è il secondo che scriveva «Nessuna campagna».
 * ③ Pretende che sulla caduta i quattro riquadri restino «—»: uno «0,00 €» lì è un numero
 *    inventato, ed è quello che fa prendere la decisione sbagliata.
 *
 * ⚪ Da qui non apro il pannello nel browser: verifico la regola e chi la chiama, non i pixel.
 */

const PAGINA = readFileSync(join(process.cwd(), 'app/admin/sponsored/page.tsx'), 'utf8');
const CODICE = PAGINA.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CAMPAGNA: Campagna = {
  id: 'c1',
  product_id: 'p1',
  seller_id: 's1',
  placement: 'home_top',
  category_slug: null,
  start_date: '2026-09-01',
  end_date: '2026-09-30',
  daily_budget_cents: 1000,
  spent_cents: 10_000,
  impressions: 1000,
  clicks: 20,
  status: 'active',
  product: { name: 'Focaccia' },
  seller: { store_name: 'Pane Quotidiano' },
};

const elenco = (campagne: Campagna[]): ElencoCampagne => ({ campagne, totale: campagne.length });
const soldi = (v: ReturnType<typeof vistaDelleCampagne>) =>
  v.riquadri.find((r) => r.chiave === 'speso')!;

describe('sto ancora leggendo', () => {
  it('non scrive un numero che non ha letto', () => {
    const v = vistaDelleCampagne({ isPending: true, isError: false, data: undefined }, 'all');
    expect(v.stato).toBe('carico');
    expect(v.mostraScheletro).toBe(true);
    expect(v.mostraVuoto).toBe(false);
    expect(soldi(v).valore).toBe(SEGNO_NON_SO);
    expect(v.sottotitolo).toBe('Sto leggendo…');
  });

  it('React Query ha smesso di provare e non ha dato niente: resta «non lo so», non «vuoto»', () => {
    const v = vistaDelleCampagne({ isPending: false, isError: false, data: undefined }, 'all');
    expect(v.stato).toBe('carico');
    expect(v.mostraVuoto).toBe(false);
    expect(soldi(v).numero).toBeNull();
  });
});

describe('ho letto davvero', () => {
  it('e non c’è niente: adesso «vuoto» è un’affermazione che si può sostenere', () => {
    const v = vistaDelleCampagne({ isPending: false, isError: false, data: elenco([]) }, 'all');
    expect(v.stato).toBe('vuoto');
    expect(v.mostraVuoto).toBe(true);
    expect(v.mostraErrore).toBe(false);
    expect(soldi(v).numero).toBe(0);
    expect(v.avviso).toBeNull();
  });

  it('e ce n’è una: la mostra e la conta', () => {
    const v = vistaDelleCampagne({ isPending: false, isError: false, data: elenco([CAMPAGNA]) }, 'all');
    expect(v.stato).toBe('pieno');
    expect(v.campagne.map((c) => c.id)).toEqual(['c1']);
    expect(soldi(v).numero).toBe(10_000);
  });
});

describe('la lettura è caduta', () => {
  it('senza niente in mano: lo ammette, e i riquadri restano «—»', () => {
    const v = vistaDelleCampagne(
      { isPending: false, isError: true, error: new Error('Failed to fetch'), data: undefined },
      'all',
    );
    expect(v.stato).toBe('rotto');
    expect(v.mostraErrore).toBe(true);
    expect(v.mostraVuoto).toBe(false);
    for (const r of v.riquadri) expect(r.valore).toBe(SEGNO_NON_SO);
    expect(v.avviso?.titolo).toContain('Non riesco a leggere');
    expect(v.sottotitolo).toBe('Non sono riuscito a leggere le campagne');
  });

  it('con l’elenco vuoto di ripiego in mano: NON diventa «nessuna campagna» né «0,00 €»', () => {
    // È la forma esatta del difetto: `data` vuoto per ripiego e l'errore ignorato.
    const v = vistaDelleCampagne(
      { isPending: false, isError: true, error: new Error('Failed to fetch'), data: elenco([]) },
      'all',
    );
    expect(v.stato).toBe('rotto');
    expect(v.mostraVuoto).toBe(false);
    expect(soldi(v).numero).toBeNull();
    expect(soldi(v).valore).toBe(SEGNO_NON_SO);
    expect(v.avviso?.dettaglio).toContain('non le ho potute guardare');
  });

  it('l’elenco vecchio non si mostra: non è quello che c’è nel database', () => {
    const v = vistaDelleCampagne(
      { isPending: false, isError: true, error: new Error('giù'), data: elenco([CAMPAGNA]) },
      'all',
    );
    expect(v.campagne).toHaveLength(0);
    expect(v.mostraErrore).toBe(true);
  });

  it('caduta col filtro acceso: nessuna riga di perimetro, perché non c’è niente da contare', () => {
    const v = vistaDelleCampagne(
      { isPending: false, isError: true, error: new Error('giù'), data: undefined },
      'paused',
    );
    expect(v.perimetro).toBeNull();
    expect(v.completo).toBe(false);
  });
});

describe('la pagina usa questa regola, e non ne tiene una sua', () => {
  it('il ripiego che nascondeva l’errore non c’è più', () => {
    expect(CODICE).not.toMatch(/const\s*\{\s*data\s*\}\s*=\s*await\s*q/);
    expect(CODICE).not.toMatch(/data:\s*listings\s*=\s*\[\]/);
    expect(CODICE).toMatch(/if\s*\(error\)\s*throw\s*error/);
  });

  it('quando la lettura è caduta si può riprovare', () => {
    expect(CODICE).toContain('ErrorState');
    expect(CODICE).toContain('refetch');
    expect(CODICE).toContain('vista.avviso');
  });
});
