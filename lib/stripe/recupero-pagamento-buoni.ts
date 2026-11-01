/**
 * Recupero del pagamento sui buoni regalo che non lo hanno segnato.
 *
 * Per ogni riga di `gift_cards` con `stripe_payment_intent` vuoto ritrova il
 * pagamento su Stripe: dalla sessione scritta sul buono, oppure — se la
 * sessione manca — scorrendo le sessioni dei buoni e confrontando il codice.
 *
 * DI BASE NON SCRIVE NIENTE: stampa cosa scriverebbe. Scrive solo con --applica.
 *
 *   npx tsx lib/stripe/recupero-pagamento-buoni.ts            # giro a vuoto
 *   npx tsx lib/stripe/recupero-pagamento-buoni.ts --applica  # scrive
 *
 * Rilanciarlo e' innocuo: la scrittura vale solo dove il pagamento e' ancora
 * vuoto, quindi un secondo giro (o due giri insieme) non sovrascrive niente.
 */
import { pathToFileURL } from 'node:url';
import { giftCardCodeForSession } from '@/lib/stripe/webhook/giftcard';

type SessioneStripe = {
  id: string;
  payment_intent?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
};

export interface StripeSessioni {
  checkout: {
    sessions: {
      retrieve(id: string): Promise<SessioneStripe>;
      list(params: { limit?: number; starting_after?: string }): Promise<{ data: SessioneStripe[]; has_more: boolean }>;
    };
  };
}

type Esito<T> = { data: T | null; error: { message: string; code?: string } | null };

/** Il minimo del client Supabase che serve qui (le prove lo sostituiscono). */
export interface DbBuoni {
  from(tabella: string): {
    select(colonne: string): {
      is(colonna: string, valore: null): PromiseLike<Esito<Array<{ code: string; stripe_session_id: string | null }>>>;
      in(colonna: string, valori: string[]): PromiseLike<Esito<Array<{ stripe_payment_intent: string }>>>;
    };
    update(valori: Record<string, unknown>): {
      eq(colonna: string, valore: string): {
        is(colonna: string, valore: null): PromiseLike<Esito<unknown>>;
      };
    };
  };
}

export type VoceDelPiano = {
  code: string;
  sessione: string | null;
  pagamento: string | null;
  /** Il pagamento e' gia' tornato indietro: il buono va poi annullato a mano. */
  pagamentoGiaTornato: boolean;
  nota?: string;
};

export type Resoconto = {
  applica: boolean;
  piano: VoceDelPiano[];
  scritti: string[];
  errori: Array<{ code: string; errore: string }>;
};

function idPagamento(s: SessioneStripe): string | null {
  const pi = s.payment_intent;
  if (typeof pi === 'string') return pi || null;
  return pi?.id ?? null;
}

/** Tutte le sessioni dei buoni, indicizzate per codice. Letta una volta sola. */
async function sessioniPerCodice(stripe: StripeSessioni): Promise<Map<string, SessioneStripe>> {
  const mappa = new Map<string, SessioneStripe>();
  let dopo: string | undefined;
  for (;;) {
    const pagina = await stripe.checkout.sessions.list({ limit: 100, ...(dopo ? { starting_after: dopo } : {}) });
    for (const s of pagina.data) {
      if (s.metadata?.kind === 'gift_card') mappa.set(giftCardCodeForSession(s.id), s);
    }
    if (!pagina.has_more || pagina.data.length === 0) break;
    dopo = pagina.data[pagina.data.length - 1].id;
  }
  return mappa;
}

export async function recuperaPagamentiDeiBuoni(args: {
  db: DbBuoni;
  stripe: StripeSessioni;
  applica: boolean;
}): Promise<Resoconto> {
  const { db, stripe, applica } = args;
  const resoconto: Resoconto = { applica, piano: [], scritti: [], errori: [] };

  const { data: buoni, error } = await db
    .from('gift_cards')
    .select('code, stripe_session_id')
    .is('stripe_payment_intent', null);
  if (error) throw new Error(`lettura dei buoni non riuscita: ${error.message}`);

  let perCodice: Map<string, SessioneStripe> | null = null;
  for (const b of buoni ?? []) {
    let sessione: SessioneStripe | null = null;
    try {
      if (b.stripe_session_id) {
        sessione = await stripe.checkout.sessions.retrieve(b.stripe_session_id);
      } else {
        perCodice ??= await sessioniPerCodice(stripe);
        sessione = perCodice.get(b.code) ?? null;
      }
    } catch (e) {
      resoconto.errori.push({ code: b.code, errore: `Stripe: ${(e as Error).message}` });
      continue;
    }
    const pagamento = sessione ? idPagamento(sessione) : null;
    resoconto.piano.push({
      code: b.code,
      sessione: sessione?.id ?? b.stripe_session_id,
      pagamento,
      pagamentoGiaTornato: false,
      ...(pagamento ? {} : { nota: sessione ? 'sessione senza pagamento' : 'sessione non ritrovata' }),
    });
  }

  const pagamenti = resoconto.piano.map((v) => v.pagamento).filter((p): p is string => !!p);
  if (pagamenti.length > 0) {
    const { data: tornati, error: errTornati } = await db
      .from('gift_card_pending_voids')
      .select('stripe_payment_intent')
      .in('stripe_payment_intent', pagamenti);
    if (errTornati) throw new Error(`lettura dei pagamenti tornati indietro non riuscita: ${errTornati.message}`);
    const set = new Set((tornati ?? []).map((t) => t.stripe_payment_intent));
    for (const v of resoconto.piano) v.pagamentoGiaTornato = !!v.pagamento && set.has(v.pagamento);
  }

  if (!applica) return resoconto;

  for (const v of resoconto.piano) {
    if (!v.pagamento) continue;
    const { error: errScrittura } = await db
      .from('gift_cards')
      .update({ stripe_payment_intent: v.pagamento })
      .eq('code', v.code)
      .is('stripe_payment_intent', null);
    if (errScrittura) {
      resoconto.errori.push({ code: v.code, errore: errScrittura.message });
      continue;
    }
    resoconto.scritti.push(v.code);
  }
  return resoconto;
}

function stampa(r: Resoconto): void {
  const nascosto = (c: string) => `${c.slice(0, 5)}…`;
  console.log(r.applica ? 'MODALITA: SCRITTURA (--applica)' : 'MODALITA: GIRO A VUOTO (nessuna scrittura)');
  for (const v of r.piano) {
    const azione = v.pagamento ? `${r.applica ? 'scritto' : 'scriverei'} ${v.pagamento}` : `salto (${v.nota})`;
    console.log(`${nascosto(v.code)}  sessione=${v.sessione ?? '-'}  ${azione}${v.pagamentoGiaTornato ? '  ATTENZIONE: pagamento gia\' tornato indietro, buono da annullare' : ''}`);
  }
  for (const e of r.errori) console.log(`ERRORE ${nascosto(e.code)}: ${e.errore}`);
  console.log(`buoni senza pagamento: ${r.piano.length + r.errori.length} · ritrovati: ${r.piano.filter((v) => v.pagamento).length} · scritti: ${r.scritti.length} · errori: ${r.errori.length}`);
}

async function main(): Promise<void> {
  const applica = process.argv.includes('--applica');
  const { getAdminSupabase } = await import('@/lib/supabase/server');
  const { getStripe } = await import('@/lib/stripe/client');
  const r = await recuperaPagamentiDeiBuoni({
    db: getAdminSupabase() as unknown as DbBuoni,
    stripe: getStripe() as unknown as StripeSessioni,
    applica,
  });
  stampa(r);
  if (r.errori.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
