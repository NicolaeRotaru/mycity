import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  vistaDelleCampagne,
  sommaDelleCampagne,
  ctrPercento,
  ETICHETTA_FILTRO,
  SEGNO_NON_SO,
  type Campagna,
  type ElencoCampagne,
  type FiltroCampagne,
} from '@/lib/admin/vista-delle-campagne';

/**
 * 8/9/2026 — «SPESO TOTALE» NON ERA IL TOTALE: ERA IL TOTALE DEL FILTRO ACCESO.
 *
 * Il filtro sta dentro la lettura — `if (filter !== 'all') q = q.eq('status', filter)` — quindi la
 * lista che arriva è già ristretta. I quattro riquadri in cima la sommavano e tenevano l'etichetta
 * ferma: «Speso totale», «CTR medio». Premevi «In pausa» per guardare le campagne ferme e il
 * riquadro dei soldi scendeva. Sembrava che la spesa pubblicitaria fosse crollata; era solo il
 * filtro. Su un riquadro con dentro degli euro, quel malinteso è il tipo di numero che fa
 * prendere una decisione sbagliata.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────────────────────
 * ① ESEGUE la scena della scheda: stessa lettura, filtro «Tutti» e poi filtro «In pausa», e
 *    pretende che l'etichetta cambi insieme al numero.
 * ② Pretende l'invariante che chiude la malattia: quando il perimetro NON è tutto, la parola
 *    «totale» (e «medio») non compare in nessuna etichetta. Non importa quale riquadro: nessuno.
 * ③ ESEGUE l'altra porta dalla quale la stessa malattia rientra — la risposta troncata: se il
 *    database dice che le campagne sono 3200 e ne abbiamo lette 50, «totale» sparisce lo stesso.
 * ④ Pretende che la riga che spiega il perimetro usi la STESSA parola del pulsante premuto.
 *
 * ⚪ Da qui non apro il pannello nel browser: verifico la regola e chi la chiama, non i pixel.
 */

const PAGINA = readFileSync(join(process.cwd(), 'app/admin/sponsored/page.tsx'), 'utf8');
/** Il codice senza commenti: lì il difetto vecchio è citato per iscritto, e non va contato. */
const CODICE = PAGINA.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function campagna(p: Partial<Campagna> & { id: string }): Campagna {
  return {
    product_id: 'prod-1',
    seller_id: 'seller-1',
    placement: 'home_top',
    category_slug: null,
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    daily_budget_cents: 1000,
    spent_cents: 0,
    impressions: 0,
    clicks: 0,
    status: 'active',
    product: { name: 'Focaccia' },
    seller: { store_name: 'Pane Quotidiano' },
    ...p,
  };
}

/** Le due campagne della scheda: una attiva che ha speso 100 €, una in pausa che ha speso 25 €. */
const ATTIVA = campagna({ id: 'c1', status: 'active', spent_cents: 10_000, impressions: 1000, clicks: 20 });
const IN_PAUSA = campagna({ id: 'c2', status: 'paused', spent_cents: 2_500, impressions: 500, clicks: 5 });

function letta(campagne: Campagna[], totale: number | null = campagne.length) {
  return { isPending: false, isError: false, data: { campagne, totale } as ElencoCampagne };
}

const riquadro = (v: ReturnType<typeof vistaDelleCampagne>, chiave: string) =>
  v.riquadri.find((r) => r.chiave === chiave)!;

describe('i conti sono quelli', () => {
  it('somma i tre numeri e non inventa NaN su un campo storto', () => {
    const somma = sommaDelleCampagne([ATTIVA, IN_PAUSA, campagna({ id: 'c3', spent_cents: NaN })]);
    expect(somma).toEqual({ speso: 12_500, impressions: 1500, clicks: 25 });
  });

  it('il CTR senza visualizzazioni non è zero: non esiste', () => {
    expect(ctrPercento(20, 1000)).toBeCloseTo(2);
    expect(ctrPercento(0, 0)).toBeNull();
  });
});

describe('la scena della scheda: stessa lettura, filtro diverso', () => {
  it('con «Tutti» dice «Speso totale» e vale 125,00 €', () => {
    const v = vistaDelleCampagne(letta([ATTIVA, IN_PAUSA]), 'all');
    expect(v.completo).toBe(true);
    expect(riquadro(v, 'speso').etichetta).toBe('Speso totale');
    expect(riquadro(v, 'speso').numero).toBe(12_500);
    expect(riquadro(v, 'speso').valore).toContain('125,00');
    expect(riquadro(v, 'ctr').etichetta).toBe('CTR medio');
    expect(v.perimetro).toBeNull();
  });

  it('con «In pausa» il numero scende — e l’etichetta scende con lui', () => {
    // È la lettura vera col filtro acceso: il database ha già tolto le altre.
    const v = vistaDelleCampagne(letta([IN_PAUSA]), 'paused');
    expect(riquadro(v, 'speso').numero).toBe(2_500);
    expect(riquadro(v, 'speso').etichetta).toBe('Speso · in pausa');
    expect(riquadro(v, 'speso').etichetta).not.toContain('totale');
    expect(riquadro(v, 'ctr').etichetta).toBe('CTR · in pausa');
    expect(v.perimetro).toContain('solo le campagne in pausa');
    expect(v.perimetro).toContain('Tutti');
  });

  it('l’INVARIANTE: fuori da «Tutti» nessuna etichetta dice «totale» né «medio»', () => {
    for (const filtro of ['active', 'paused', 'ended'] as const) {
      const v = vistaDelleCampagne(letta([IN_PAUSA]), filtro);
      for (const r of v.riquadri) {
        expect(r.etichetta.toLowerCase()).not.toContain('totale');
        expect(r.etichetta.toLowerCase()).not.toContain('medio');
      }
      expect(v.completo).toBe(true); // il perimetro è ristretto, non la lettura
      expect(v.perimetro).not.toBeNull();
    }
  });

  it('la riga che spiega il perimetro usa la stessa parola del pulsante premuto', () => {
    for (const filtro of ['active', 'paused', 'ended'] as const) {
      const v = vistaDelleCampagne(letta([IN_PAUSA]), filtro);
      expect(v.perimetro!.toLowerCase()).toContain(ETICHETTA_FILTRO[filtro].toLowerCase());
    }
  });
});

describe('l’altra porta della stessa malattia: la risposta troncata', () => {
  it('«Tutti» ma ne ho lette 2 su 3200: «totale» sparisce e la riga lo dice', () => {
    const v = vistaDelleCampagne(letta([ATTIVA, IN_PAUSA], 3200), 'all');
    expect(v.completo).toBe(false);
    expect(riquadro(v, 'speso').etichetta).toBe('Speso');
    expect(riquadro(v, 'ctr').etichetta).toBe('CTR');
    expect(v.perimetro).toBe('Ho letto 2 campagne su 3200: i numeri qui sopra contano solo quelle.');
  });

  it('il database non ha detto quante ce ne sono: senza prova non si dice «totale»', () => {
    const v = vistaDelleCampagne(letta([ATTIVA, IN_PAUSA], null), 'all');
    expect(v.completo).toBe(false);
    expect(riquadro(v, 'speso').etichetta).not.toContain('totale');
    expect(v.perimetro).toContain('Non so quante campagne ci siano in tutto');
  });

  it('filtro acceso E risposta troncata: lo dice tutto e due, in una riga sola', () => {
    const v = vistaDelleCampagne(letta([IN_PAUSA], 40), 'paused');
    expect(v.perimetro).toContain('solo le campagne in pausa');
    expect(v.perimetro).toContain('ne ho lette 1 su 40');
  });
});

describe('quello che non abbiamo letto non vale zero', () => {
  it('mentre carica i quattro riquadri mostrano «—», non «0»', () => {
    const v = vistaDelleCampagne({ isPending: true, isError: false, data: undefined }, 'all');
    for (const r of v.riquadri) {
      expect(r.valore).toBe(SEGNO_NON_SO);
      expect(r.numero).toBeNull();
    }
  });

  it('letto davvero e non c’è niente: allora sì, zero — ma il CTR resta «—»', () => {
    const v = vistaDelleCampagne(letta([], 0), 'all');
    expect(riquadro(v, 'campagne').valore).toBe('0');
    expect(riquadro(v, 'speso').numero).toBe(0);
    expect(riquadro(v, 'ctr').valore).toBe(SEGNO_NON_SO);
    expect(v.frasePerTabellaVuota).toBe('Nessuna campagna.');
  });

  it('vuoto col filtro acceso: la frase dice quale vuoto è', () => {
    const v = vistaDelleCampagne(letta([], 0), 'paused');
    expect(v.frasePerTabellaVuota).toBe('Nessuna campagna in pausa.');
  });
});

describe('la pagina usa questa regola, e non ne tiene una sua', () => {
  it('i riquadri li disegna dall’elenco che arriva dalla funzione', () => {
    expect(CODICE).toContain('vistaDelleCampagne(');
    expect(CODICE).toContain('vista.riquadri.map');
    expect(CODICE).toContain('vista.perimetro');
  });

  it('nessuna somma scritta a mano accanto a un’etichetta scritta a mano', () => {
    expect(CODICE).not.toContain('Speso totale');
    expect(CODICE).not.toContain('CTR medio');
    expect(CODICE).not.toMatch(/listings\.reduce/);
  });

  it('il conteggio esatto lo chiede davvero: senza, «totale» non si potrebbe dimostrare', () => {
    expect(CODICE).toContain("count: 'exact'");
  });
});

/** I filtri che la pagina offre sono quelli che la funzione sa spiegare. */
describe('nessun filtro resta senza il suo nome', () => {
  it('ognuno dei quattro ha un’etichetta', () => {
    const tutti: FiltroCampagne[] = ['all', 'active', 'paused', 'ended'];
    for (const f of tutti) expect(ETICHETTA_FILTRO[f].length).toBeGreaterThan(0);
  });
});
