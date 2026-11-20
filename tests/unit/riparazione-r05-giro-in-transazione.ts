/**
 * R05-006 — La funzione del database `sposta_la_consegna_nel_carrello` (migrations/620), finta, per i
 * database finti delle prove dell'annullo (lib/ordini/annulla.ts).
 *
 * Fa quello che fa la funzione vera, provata su un PostgreSQL usa e getta in
 * tests/sql/rls/riparazione-r05-soldi-in-transazione.test.sql: controlla che ogni riga sia ancora come
 * l'ha letta il conto e solo allora scrive tutte le righe, insieme. Una riga cambiata: false, niente
 * scritto. Un errore a metà delle scritture (`scrivi` che lancia): tutto torna com'era, come in una
 * transazione, e la risposta è un errore.
 *
 * `applicata: false` è il database senza la 620 (PostgREST risponde PGRST202): annulla.ts fa le
 * scritture una per riga, come prima.
 */
type Riga = Record<string, unknown>;
type Risposta = { data: unknown; error: { code?: string; message: string } | null };

export const FUNZIONE_DEL_GIRO = 'sposta_la_consegna_nel_carrello';

const CHIAVI_DA = ['delivery_fee_cents', 'rider_fee_cents', 'delivery_status', 'refunded_amount_cents', 'incassato'];
const CHIAVI_A = ['delivery_fee_cents', 'rider_fee_cents', 'total_price', 'gross_total_cents'];
const nullo = (v: unknown) => (v === undefined ? null : v);

export function spostaLaConsegnaNelCarrello(
  ordini: Riga[],
  pRighe: unknown,
  scrivi?: (riga: Riga, valori: Riga) => void,
): Risposta {
  const errore = (message: string): Risposta => ({ data: null, error: { code: '22023', message } });
  if (!Array.isArray(pRighe) || pRighe.length === 0) return errore('nessuna riga');
  const righe = pRighe as Array<{ id?: unknown; da?: Riga; a?: Riga }>;
  for (const r of righe) {
    const da = r?.da;
    if (!da || CHIAVI_DA.some((k) => !(k in da))) return errore('riga malformata');
    if ('a' in r && (!r.a || CHIAVI_A.some((k) => !(k in (r.a as Riga))))) return errore('riga malformata');
  }
  const ids = righe.map((r) => r.id);
  if (ids.some((id) => id == null) || new Set(ids).size !== ids.length) return errore('righe senza id o ripetute');
  const trovate = ids.map((id) => ordini.find((o) => o.id === id));
  if (new Set(trovate.filter((o): o is Riga => !!o).map((o) => o.user_id)).size > 1) return errore('ordini di clienti diversi');

  // Ogni riga ancora come letta, o niente.
  for (const [i, r] of righe.entries()) {
    const o = trovate[i];
    const da = r.da as Riga;
    if (
      !o ||
      nullo(o.delivery_fee_cents) !== da.delivery_fee_cents ||
      nullo(o.rider_fee_cents) !== da.rider_fee_cents ||
      nullo(o.delivery_status) !== da.delivery_status ||
      nullo(o.refunded_amount_cents) !== da.refunded_amount_cents ||
      (o.cash_confirmed_at != null) !== da.incassato
    ) {
      return { data: false, error: null };
    }
  }

  // Tutte le scritture, in una transazione: un errore le disfa tutte.
  const copie = trovate.map((o) => ({ ...(o as Riga) }));
  try {
    for (const [i, r] of righe.entries()) {
      if (!r.a) continue;
      const valori = Object.fromEntries(CHIAVI_A.map((k) => [k, (r.a as Riga)[k]]));
      scrivi?.(trovate[i] as Riga, valori);
      Object.assign(trovate[i] as Riga, valori);
    }
  } catch (e) {
    trovate.forEach((o, i) => {
      for (const k of Object.keys(o as Riga)) delete (o as Riga)[k];
      Object.assign(o as Riga, copie[i]);
    });
    return { data: null, error: { code: '57P01', message: e instanceof Error ? e.message : String(e) } };
  }
  return { data: true, error: null };
}

/** Aggiunge la funzione finta al `rpc` di un database finto che tiene gli ordini in `tabelle.orders`. */
export function conLaFunzioneDelGiro<T extends { rpc: unknown; tabelle: Record<string, Riga[]> }>(
  db: T,
  o: { applicata?: boolean; scrivi?: (riga: Riga, valori: Riga) => void } = {},
): T {
  const altra = db.rpc as (nome: string, args?: Record<string, unknown>) => Promise<unknown>;
  const rpc = async (nome: string, args?: Record<string, unknown>) => {
    if (nome !== FUNZIONE_DEL_GIRO) return altra(nome, args);
    if (o.applicata === false) {
      return {
        data: null,
        error: { code: 'PGRST202', message: `Could not find the function public.${FUNZIONE_DEL_GIRO}(p_righe) in the schema cache` },
      };
    }
    return spostaLaConsegnaNelCarrello((db.tabelle.orders ??= []), args?.p_righe, o.scrivi);
  };
  (db as { rpc: unknown }).rpc = rpc;
  return db;
}
