import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getAdminSupabase } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe/client';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { CONDIZIONI, FASCE, leggiImpostazioniAgenzia, type Abbonamento } from '@/lib/agenzia/preventivo';
import { KIND_SERVIZI } from '@/lib/stripe/webhook/servizi';
import { MESSAGGIO_CASSA_SPENTA, pagamentoOnlineAttivo } from '@/lib/agenzia/pagamento-servizi';
import { abbonamentoIncluso, MESSAGGIO_ABBONAMENTO_INCLUSO } from '@/lib/agenzia/abbonamento-di-sdg';

/**
 * LA CASSA STRIPE DELL'ABBONAMENTO DEI SERVIZI — una sola, per due strade (24/11/2026):
 *  · la dashboard del negozio (/api/seller/preventivo/paga), con l'accesso fatto;
 *  · il link col codice (/api/preventivo/<codice>/accetta), per chi non ha ancora l'accesso
 *    (Ora del Gusto, «modalità preventivo»): lì l'email è quella appena data dal titolare.
 * Le regole (canone riletto dal server, un abbonamento in corso ferma la cassa, il buono del primo
 * mese solo se è -50% una volta e solo la prima volta) sono spiegate in testa alla rotta della
 * dashboard, dove sono nate.
 */

/** Il buono del primo mese: -50%, una volta sola. Lo stesso per tutti, creato la prima volta che serve. */
export const BUONO_PRIMO_MESE = 'mycity-servizi-primo-mese-meta';

/** Le richieste dello stesso negozio e della stessa fascia dentro questa finestra ricevono la stessa cassa. */
const FINESTRA_CASSA_MS = 10 * 60_000;

/** Gli stati di un abbonamento Stripe ancora in corso (o col primo pagamento in arrivo). */
const IN_CORSO = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'];

/** Quanto dura una cassa aperta: il minimo che Stripe accetta. */
const CASSA_SCADE_DOPO_S = 30 * 60 + 60;

const PERCENTO_PRIMO_MESE = Math.round(CONDIZIONI.primoMeseFrazione * 100);

class BuonoSbagliato extends Error {}

/** Il buono va bene solo se è esattamente lo sconto promesso in pagina: -50%, una volta, ancora valido. */
function buonoGiusto(c: Stripe.Coupon): boolean {
  return c.percent_off === PERCENTO_PRIMO_MESE && !c.amount_off && c.duration === 'once' && c.valid !== false;
}

async function buonoPrimoMese(stripe: Stripe): Promise<string> {
  let buono: Stripe.Coupon | null = null;
  try {
    buono = await stripe.coupons.retrieve(BUONO_PRIMO_MESE);
  } catch {
    try {
      buono = await stripe.coupons.create({
        id: BUONO_PRIMO_MESE,
        percent_off: PERCENTO_PRIMO_MESE,
        duration: 'once',
        name: 'Primo mese a metà prezzo',
      });
    } catch {
      // Due casse insieme: l'altra l'ha appena creato.
      buono = await stripe.coupons.retrieve(BUONO_PRIMO_MESE);
    }
  }
  // Un buono con lo stesso nome ma un altro sconto (fatto a mano sul cruscotto) farebbe pagare al
  // negozio un prezzo diverso da quello scritto, o regalerebbe mesi interi: niente cassa.
  if (!buonoGiusto(buono)) throw new BuonoSbagliato(`buono ${BUONO_PRIMO_MESE} diverso da -${PERCENTO_PRIMO_MESE}% una volta`);
  return buono.id;
}

/** Il cliente Stripe dei servizi del negozio: quello già fatto (stessa email e stesso seller_id), o uno nuovo. */
async function clienteDeiServizi(stripe: Stripe, sellerId: string, email: string, negozio: string): Promise<string> {
  const trovati = await stripe.customers.list({ email, limit: 20 });
  const giaFatto = trovati.data.find((c) => c.metadata?.kind === KIND_SERVIZI && c.metadata?.seller_id === sellerId);
  if (giaFatto) return giaFatto.id;
  return (await stripe.customers.create({ email, name: negozio, metadata: { kind: KIND_SERVIZI, seller_id: sellerId } })).id;
}

export async function apriCassaServizi({ sellerId, email, fascia, ritorno, chiaveExtra }: {
  sellerId: string;
  email: string;
  fascia: Abbonamento;
  ritorno: { pagato: string; annullato: string };
  /**
   * Un pezzo in più per la chiave di idempotenza di Stripe: la strada del link col codice ci mette
   * l'impronta di email e indirizzi di ritorno, perché la stessa chiave con parametri diversi Stripe
   * la rifiuta (collaudo del 24/11). La dashboard passa «abbonamento» dal 24/11, quando il suo indirizzo
   * di ritorno è passato da /seller/preventivo a /seller/abbonamento.
   */
  chiaveExtra?: string;
}): Promise<NextResponse> {
  // 26/11/2026 — Nicola: per ora si paga in contanti, la piattaforma dei pagamenti non è pronta
  // (lib/agenzia/pagamento-servizi.ts). Nessuna cassa, da nessuna delle due strade.
  if (!pagamentoOnlineAttivo()) return ApiErrors.conflict(MESSAGGIO_CASSA_SPENTA);
  // 28/11/2026 — SDG ha il Premium incluso (lib/agenzia/abbonamento-di-sdg.ts): non ha niente da pagare.
  if (abbonamentoIncluso(sellerId)) return ApiErrors.conflict(MESSAGGIO_ABBONAMENTO_INCLUSO);
  const admin = getAdminSupabase();
  const [profilo, impostazioni, attivi] = await Promise.all([
    admin.from('profiles').select('store_name').eq('id', sellerId).maybeSingle(),
    admin.from('site_settings').select('agenzia').eq('id', 1).maybeSingle(),
    // Tutte le righe del negozio, anche disdette: servono anche per sapere se il primo mese a metà l'ha già avuto.
    admin.from('abbonamenti_servizi').select('fascia, stato').eq('seller_id', sellerId).limit(20),
  ]);
  // Senza la tabella (migrazione 706 non applicata) il pagamento non deve partire: il webhook
  // non saprebbe dove scriverlo, e il negozio pagherebbe senza vedere l'abbonamento attivo.
  if (attivi.error) {
    logger.error('[servizi] abbonamenti non letti: niente cassa', { sellerId, message: attivi.error.message });
    return ApiErrors.unavailable('Il pagamento non è disponibile in questo momento. Riprova fra poco o scrivici.');
  }
  const righe = (attivi.data ?? []) as { stato: string }[];
  if (righe.some((r) => r.stato === 'active' || r.stato === 'past_due')) {
    return ApiErrors.conflict('Hai già un abbonamento attivo. Per cambiarlo scrivici: lo sistemiamo noi.');
  }
  // Il canone: con le impostazioni non lette, nessun prezzo (mai un prezzo sbagliato in cassa).
  const canone = impostazioni.error ? null : leggiImpostazioniAgenzia(impostazioni.data?.agenzia).prezzi[fascia];
  if (!canone) {
    return ApiErrors.conflict('Il prezzo di questo abbonamento te lo confermiamo noi: premi «Preferisco essere richiamato».');
  }
  const negozio = String((profilo.data as { store_name?: string | null } | null)?.store_name ?? '').trim() || 'Negozio';
  const nome = FASCE[fascia].nome;
  const metadati = { kind: KIND_SERVIZI, seller_id: sellerId, fascia, canone_centesimi: String(canone), negozio: negozio.slice(0, 120) };

  const stripe = getStripe();
  try {
    const cliente = await clienteDeiServizi(stripe, sellerId, email, negozio);
    // Su Stripe, che è la fonte vera: un abbonamento dei servizi già in corso ferma la cassa.
    const abbonamenti = await stripe.subscriptions.list({ customer: cliente, status: 'all', limit: 20 });
    if (abbonamenti.data.some((a) => IN_CORSO.includes(a.status))) {
      return ApiErrors.conflict('Risulta già un abbonamento in corso. Ricarica la pagina fra un momento; se non lo vedi, scrivici.');
    }
    // Una cassa ancora aperta: della stessa fascia e allo stesso prezzo si ridà; di un'altra si chiude.
    const aperte = await stripe.checkout.sessions.list({ customer: cliente, status: 'open', limit: 10 });
    for (const a of aperte.data.filter((x) => x.metadata?.kind === KIND_SERVIZI)) {
      // Si riusa solo se torna allo stesso posto: una cassa della dashboard non va bene per il link, e viceversa.
      if (a.metadata?.fascia === fascia && a.metadata?.canone_centesimi === String(canone) && a.success_url === ritorno.pagato && a.url) {
        return NextResponse.json({ ok: true, data: { url: a.url } }, { status: 200 });
      }
      await stripe.checkout.sessions.expire(a.id);
    }
    // Il primo mese a metà vale una volta per negozio: non a chi ha già avuto un abbonamento dei servizi.
    const primaVolta = righe.length === 0 && abbonamenti.data.length === 0;
    const sessione = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: cliente,
      expires_at: Math.floor(Date.now() / 1000) + CASSA_SCADE_DOPO_S,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: canone,
          recurring: { interval: 'month' },
          product_data: {
            name: `Servizi MyCity · ${nome}`,
            description: 'Foto e video, social, sito web e scheda Google, realizzati da SDG Agenzia per MyCity.',
          },
        },
      }],
      ...(primaVolta ? { discounts: [{ coupon: await buonoPrimoMese(stripe) }] } : {}),
      metadata: metadati,
      subscription_data: { metadata: metadati },
      success_url: ritorno.pagato,
      cancel_url: ritorno.annullato,
    }, { idempotencyKey: `servizi:${sellerId}:${fascia}:${canone}:${chiaveExtra ? `${chiaveExtra}:` : ''}${Math.floor(Date.now() / FINESTRA_CASSA_MS)}` });
    if (!sessione.url) throw new Error('sessione senza indirizzo');
    return NextResponse.json({ ok: true, data: { url: sessione.url } }, { status: 200 });
  } catch (errore) {
    if (errore instanceof BuonoSbagliato) {
      logger.error('[servizi] buono del primo mese diverso da quello promesso: niente cassa', { sellerId, errore: errore.message });
      return ApiErrors.unavailable('Il pagamento non è disponibile in questo momento. Scrivici e ti richiamiamo.');
    }
    logger.error('[servizi] cassa Stripe non creata', { sellerId, fascia, errore: String(errore) });
    return ApiErrors.internal('Non sono riuscito ad aprire il pagamento. Riprova fra un momento.');
  }
}
