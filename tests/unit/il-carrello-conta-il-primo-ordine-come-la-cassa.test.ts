import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateCoupon } from '@/lib/coupons';

/**
 * Il codice di benvenuto (first_order_only) si controlla in DUE posti:
 *  - la cassa: validateCoupon (lib/coupons.ts), che esclude annullati e falliti;
 *  - il carrello: check_coupon nel database, chiamata da validateCouponFromBrowser.
 *
 * Il difetto: la cassa era stata corretta, il database no (114 contava TUTTI
 * gli ordini). Maria, con solo un ordine annullato, vedeva il carrello
 * rifiutarle BENVENUTO10.
 *
 * La prova prende la definizione di check_coupon IN VIGORE (l'ultima migrazione
 * che la ridefinisce), ne estrae il conteggio degli ordini e lo ESEGUE su ordini
 * di prova con la semantica SQL dei NULL. Poi esegue la cassa vera sugli stessi
 * ordini e pretende la stessa risposta.
 */

type Ordine = {
  user_id: string;
  delivery_status: string | null;
  payment_status: string | null;
};

const MARIA = 'u-maria';
const MIGRAZIONI = join(process.cwd(), 'migrations');

function checkCouponInVigore(): { file: string; corpo: string } {
  const files = readdirSync(MIGRAZIONI)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
  let trovato: { file: string; corpo: string } | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIGRAZIONI, f), 'utf8');
    const m = sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.check_coupon\s*\([\s\S]*?AS\s+\$\$([\s\S]*?)\$\$/i,
    );
    if (m) trovato = { file: f, corpo: m[1] };
  }
  if (!trovato) throw new Error('nessuna migrazione definisce check_coupon');
  return trovato;
}

type Cond = (o: Ordine, uid: string) => boolean | null;

/** Traduce il WHERE del conteggio in predicati, con i NULL alla maniera SQL. */
function predicatiDelConteggio(corpo: string): Cond[] {
  const pulito = corpo.replace(/--.*$/gm, '');
  const m = pulito.match(
    /SELECT\s+count\(\*\)\s+INTO\s+ordini\s+FROM\s+public\.orders\s+WHERE\s+([\s\S]*?);/i,
  );
  if (!m) throw new Error('check_coupon: conteggio degli ordini non trovato');
  return m[1]
    .split(/\s+AND\s+/i)
    .map((c) => c.trim())
    .map((c): Cond => {
      let x = c.match(/^(\w+)\s*=\s*uid$/i);
      if (x) {
        const col = x[1] as keyof Ordine;
        return (o, uid) => o[col] === uid;
      }
      x = c.match(/^(\w+)\s*(<>|!=)\s*'([^']*)'$/i);
      if (x) {
        const col = x[1] as keyof Ordine;
        const v = x[3];
        return (o) => (o[col] === null ? null : o[col] !== v);
      }
      x = c.match(/^(\w+)\s+IS\s+DISTINCT\s+FROM\s+'([^']*)'$/i);
      if (x) {
        const col = x[1] as keyof Ordine;
        const v = x[2];
        return (o) => o[col] !== v;
      }
      throw new Error(`condizione non riconosciuta nel conteggio: ${c}`);
    });
}

function contaCarrello(ordini: Ordine[], uid: string): number {
  const preds = predicatiDelConteggio(checkCouponInVigore().corpo);
  return ordini.filter((o) => preds.every((p) => p(o, uid) === true)).length;
}

/** Client finto per la cassa: applica davvero .eq/.neq sugli ordini (neq = SQL <>). */
function clientCassa(ordini: Ordine[]) {
  const coupon = {
    id: 'c1', code: 'BENVENUTO10', type: 'PERCENT', value: 10, active: true,
    expires_at: null, max_uses: null, uses_count: 0, min_subtotal: 0,
    first_order_only: true, description: null,
  };
  return {
    from(tabella: string) {
      const filtri: Array<(o: Ordine) => boolean> = [];
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => {
          filtri.push((o) => (o as Record<string, unknown>)[col] === v);
          return q;
        },
        neq: (col: string, v: unknown) => {
          filtri.push((o) => {
            const val = (o as Record<string, unknown>)[col];
            return val !== null && val !== v;
          });
          return q;
        },
        maybeSingle: async () => ({ data: tabella === 'coupons' ? coupon : null, error: null }),
        then: (res: (r: { count: number }) => unknown) =>
          Promise.resolve({ count: ordini.filter((o) => filtri.every((f) => f(o))).length }).then(res),
      };
      return q;
    },
  };
}

const casi: Array<{ nome: string; ordini: Ordine[]; primoOrdine: boolean }> = [
  { nome: 'nessun ordine', ordini: [], primoOrdine: true },
  {
    nome: 'solo un ordine annullato dal negozio',
    ordini: [{ user_id: MARIA, delivery_status: 'CANCELED', payment_status: 'PENDING' }],
    primoOrdine: true,
  },
  {
    nome: 'solo un ordine col pagamento fallito',
    ordini: [{ user_id: MARIA, delivery_status: 'PREPARATION', payment_status: 'FAILED' }],
    primoOrdine: true,
  },
  {
    nome: 'annullato + fallito',
    ordini: [
      { user_id: MARIA, delivery_status: 'CANCELED', payment_status: 'PAID' },
      { user_id: MARIA, delivery_status: 'PREPARATION', payment_status: 'FAILED' },
    ],
    primoOrdine: true,
  },
  {
    nome: 'un ordine consegnato e pagato',
    ordini: [{ user_id: MARIA, delivery_status: 'DELIVERED', payment_status: 'PAID' }],
    primoOrdine: false,
  },
  {
    nome: 'consegnato e poi rimborsato: il primo acquisto c\'è stato',
    ordini: [{ user_id: MARIA, delivery_status: 'DELIVERED', payment_status: 'REFUNDED' }],
    primoOrdine: false,
  },
  {
    nome: 'ordine in contanti ancora in preparazione',
    ordini: [{ user_id: MARIA, delivery_status: 'PREPARATION', payment_status: 'PENDING' }],
    primoOrdine: false,
  },
  {
    nome: 'l\'ordine di un altro cliente non conta',
    ordini: [{ user_id: 'u-altro', delivery_status: 'DELIVERED', payment_status: 'PAID' }],
    primoOrdine: true,
  },
];

describe('BENVENUTO10: il carrello (check_coupon) conta il primo ordine come la cassa', () => {
  for (const caso of casi) {
    it(`carrello: ${caso.nome}`, () => {
      expect(contaCarrello(caso.ordini, MARIA) === 0).toBe(caso.primoOrdine);
    });

    it(`carrello e cassa danno la stessa risposta: ${caso.nome}`, async () => {
      const cassa = await validateCoupon(
        'benvenuto10',
        20,
        MARIA,
        clientCassa(caso.ordini) as unknown as Parameters<typeof validateCoupon>[3],
      );
      const carrelloAccetta = contaCarrello(caso.ordini, MARIA) === 0;
      expect(cassa.ok).toBe(caso.primoOrdine);
      expect(carrelloAccetta).toBe(cassa.ok);
    });
  }

  it('la funzione in vigore mantiene i permessi: niente anonimi', () => {
    const { file } = checkCouponInVigore();
    const sql = readFileSync(join(MIGRAZIONI, file), 'utf8');
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.check_coupon\(text, numeric\) FROM public, anon/);
  });
});
