import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { isStripeConfigured } from '@/lib/stripe/client';
import {
  AccreditoGiaUscitoConAltroImporto,
  cosaMancaAlBonifico,
  ilRimborsoDellaChiaveGiaUscito,
  RimborsoInAttesaDellaDivisione,
  refundOrder,
} from '@/lib/stripe/payout';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { COLONNE_124, conRipiegoSchema, senzaColonne } from '@/lib/db/migrazione-124';
import { chiComandaIlReso } from '../../chi-comanda-il-reso';
import {
  eUnRecesso,
  interoDelRecesso,
  motivoNienteDaRestituire,
  percheIlRecessoNonSiChiude,
  percheIlRimborsoDelRecessoNonBasta,
  quantoSiPuoRestituire,
  rigaResaCents,
  type RigaDellOrdine,
  type OrdineDaRimborsare,
} from '@/lib/rimborsi/regole-del-rimborso';
import {
  avvisoDelRimborsoNonRegistrato,
  bonificoDaFinire,
  RIMBORSO_PARTITO_MA_NON_REGISTRATO,
  titoloDelResoRimborsato,
} from '@/lib/rimborsi/bonifici-da-fare';
import { bonificoDellaChiave } from '@/lib/stripe/elenco-dei-rimborsi';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { scriviCampanella } from '@/lib/ordini/campanella';
import { giornoPiacenza } from '@/lib/tempo-piacenza';

export const runtime = 'nodejs';

/**
 * UN RESO APPROVATO DEVE POTER ARRIVARE A FINE CORSA.
 *
 * 27/8/2026 (R042) — QUESTA ROTTA NON ESISTEVA, e il commento in cima a
 * `decide` la prometteva già: «transizione RECEIVED -> REFUNDED via altro
 * endpoint». Sotto `app/api/returns` c'erano due sole cartelle, `create` e
 * `[id]/decide`, e l'unica altra scrittura sulla tabella `returns` in tutto il
 * repository azzerava le note alla cancellazione di un account.
 *
 * La conseguenza non era di forma. Il giro dei bonifici esclude dai pagamenti
 * gli ordini con un reso in REQUESTED, APPROVED, SHIPPED_BACK o RECEIVED. Un
 * cliente apre un reso, il negozio lo approva e aspetta la merce indietro: da
 * quel momento il bonifico di quell'ordine è fermo PER SEMPRE, anche se il reso
 * poi non arriva o si chiude di persona. Il negozio vedeva «in attesa» senza
 * scadenza e telefonava; l'amministratore non aveva nessun comando per
 * sbloccare.
 *
 * Qui c'è quel comando. Le tappe sono quelle già dichiarate nello schema del
 * database (migrazione 024), e ognuna parte solo dallo stato giusto:
 *  · APPROVED    → SHIPPED_BACK  il cliente ha rispedito
 *  · SHIPPED_BACK/APPROVED → RECEIVED  la merce è tornata
 *  · RECEIVED    → REFUNDED      i soldi tornano al cliente (chiude il reso)
 *  · qualunque stato aperto → CANCELED  il reso si chiude senza rimborso
 *    (non il recesso: vedi `percheIlRecessoNonSiChiude`)
 *    (merce mai partita, accordo di persona, cliente che ci ripensa): è la
 *    voce che libera il bonifico, e prima non c'era.
 *
 * Chi può: il venditore del reso, o un amministratore. Il cliente dell'ordine
 * fa due cose sole: ritira la sua richiesta (CANCELED) e dice di aver
 * rispedito la merce (SHIPPED_BACK, col giorno della spedizione).
 */
const Body = z.object({
  stato: z.enum(['SHIPPED_BACK', 'RECEIVED', 'REFUNDED', 'CANCELED']),
  note: z.string().max(1000).optional(),
  refundAmountCents: z.number().int().positive().optional(),
  /** R17-003 — Solo il cliente: il giorno in cui ha rispedito la merce (AAAA-MM-GG). */
  speditoIl: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** R17-003 — Solo il cliente: il numero di spedizione, se ce l'ha. */
  numeroSpedizione: z.string().trim().max(100).optional(),
});

/** Da dove si può arrivare a ogni tappa. Fuori da qui non si passa. */
const PARTENZE_AMMESSE: Record<string, string[]> = {
  SHIPPED_BACK: ['APPROVED'],
  RECEIVED: ['APPROVED', 'SHIPPED_BACK'],
  REFUNDED: ['RECEIVED'],
  CANCELED: ['REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'],
};

/**
 * 31/10/2026 — IL RECESSO NON SI CHIUDE «SENZA RIMBORSO».
 *
 * Il ripensamento entro 14 giorni (motivo CHANGED_MIND) e' il recesso del
 * consumatore: non si puo' rifiutare, e il rimborso e' dovuto appena la merce
 * torna o il cliente prova di averla spedita (Cod. Cons. artt. 52, 56 c.3 e 57).
 * `decide` bloccava il «Rifiuta», ma qui «chiudi senza rimborso» passava da
 * ogni stato aperto: anche con la merce gia' in negozio. Era lo stesso rifiuto,
 * per un'altra porta, e il giro dei bonifici pagava il negozio subito dopo.
 *
 * Resta una sola strada legittima: approvato, il cliente non ha rispedito nulla
 * e i 14 giorni che ha per farlo (art. 57) sono passati. Altrimenti si rimborsa,
 * anche in parte se la merce e' tornata rovinata.
 */
// La regola vive in lib/rimborsi/regole-del-rimborso.ts, la stessa che usa la scheda del negozio.

/**
 * 31/10/2026 — IL CLIENTE PUO' RITIRARE LA SUA RICHIESTA.
 *
 * Un recesso che il cliente lascia cadere prima che la merce parta restava
 * aperto: il negozio non puo' chiuderlo (sarebbe il rifiuto per un'altra porta)
 * e il bonifico dell'ordine stava fermo almeno 14 giorni. Chi ha chiesto il reso
 * puo' ritirarlo finche' la merce non e' in viaggio. Chi e' il cliente lo dice
 * l'ordine, non la riga del reso.
 */
const PARTENZE_DEL_RITIRO = ['REQUESTED', 'APPROVED'];

async function eIlClienteDellOrdine(orderId: string, utenteId: string): Promise<{ sellerId: string | null } | null> {
  const { data } = await getAdminSupabase().from('orders').select('user_id, seller_id').eq('id', orderId).single();
  const ordine = data as { user_id?: string | null; seller_id?: string | null } | null;
  return ordine?.user_id && ordine.user_id === utenteId ? { sellerId: ordine.seller_id ?? null } : null;
}

/**
 * 13/11/2026 (R17-003) — IL CLIENTE DICE «HO RISPEDITO LA MERCE».
 *
 * Un recesso approvato si chiudeva «senza rimborso» dopo 14 giorni se il reso
 * era ancora APPROVED: la regola presume che il cliente non abbia rispedito
 * niente. Ma «in rientro» lo scriveva solo il negozio, cioe' chi ha interesse a
 * non rimborsare. Recesso approvato il 2/11, pacco spedito il 15/11, il 17/11 il
 * negozio non l'ha ancora e preme «Chiudi senza rimborso»: il bonifico al
 * negozio riparte, il pacco arriva il 18/11 e il reso chiuso non si riapre.
 * Il rimborso si trattiene solo finche' non arrivano i beni o la prova della
 * spedizione (Cod. Cons. art. 56 c.3).
 *
 * Adesso il cliente dell'ordine porta lui il reso da APPROVED a SHIPPED_BACK,
 * col giorno della spedizione e, se ce l'ha, il numero. Da li' un recesso non si
 * chiude senza rimborso (`percheIlRecessoNonSiChiude`, e il database dalla 411)
 * e il giro dei bonifici lo tiene fermo come reso aperto. Il negozio non scrive
 * la dichiarazione al posto suo: il suo «Il cliente ha rispedito» cambia lo
 * stato, non il giorno ne' il numero.
 */
const COLONNA_DEL_GIORNO = 'customer_shipped_back_on';

function percheLaSpedizioneNonVale(speditoIl: string | undefined, chiestoIl: string | null | undefined, adesso: number): string | null {
  if (!speditoIl) return 'Indica il giorno in cui hai spedito la merce.';
  const giorno = new Date(`${speditoIl}T12:00:00Z`);
  if (!Number.isFinite(giorno.getTime()) || giorno.toISOString().slice(0, 10) !== speditoIl) {
    return 'Il giorno della spedizione non è una data valida.';
  }
  if (speditoIl > giornoPiacenza(adesso)) return 'Il giorno della spedizione non può essere nel futuro.';
  const richiesta = chiestoIl && Number.isFinite(Date.parse(chiestoIl)) ? giornoPiacenza(chiestoIl) : null;
  if (richiesta && speditoIl < richiesta) {
    return `Il giorno della spedizione non può venire prima della richiesta di reso (${inLettere(richiesta)}).`;
  }
  return null;
}

/** «2026-11-15» → «15/11/2026». */
function inLettere(giorno: string): string {
  const [a, m, g] = giorno.split('-');
  return `${g}/${m}/${a}`;
}

/** PostgREST o PostgreSQL dicono che la colonna della 411 non c'e' ancora (migrazione non applicata). */
function mancaLaColonnaDelGiorno(errore: unknown): boolean {
  const e = errore as { code?: string; message?: string; details?: string } | null;
  if (!e || (e.code !== 'PGRST204' && e.code !== '42703')) return false;
  return new RegExp(`\\b${COLONNA_DEL_GIORNO}\\b`).test(`${e.message ?? ''} ${e.details ?? ''}`);
}

/**
 * 13/11/2026 (R17-004) — IL RIMBORSO CON LA CARTA DI QUESTO RESO E' GIA' USCITO.
 *
 * Il negozio approva un reso da 40 € su un ordine con carta da 40 €: Stripe rimborsa e l'ordine
 * conta 40 €, poi cade la scrittura dell'esito sul reso (decide risponde 500, il reso resta
 * APPROVED). Coi passi normali («merce ricevuta», «rimborsato») il residuo dell'ordine e' zero, e qui
 * si rispondeva «già rimborsato per intero» (o «non può superare») prima che `refundOrder` potesse
 * riconoscere il rimborso della chiave del reso: il reso non si chiudeva mai «rimborsato». Sui
 * contanti lo dice il segno sull'ordine (`giaSullOrdine`); sulla carta il testimone e' Stripe. Si
 * guarda solo quando il residuo non basta; una lettura caduta lascia la risposta di prima.
 */
async function ilRimborsoDelResoGiaSullaCarta(
  ordine: OrdineDaRimborsare,
  ret: { id: string; order_id: string },
): Promise<{ refundId: string; centesimi: number } | null> {
  if (!ordine.stripe_payment_intent || !isStripeConfigured()) return null;
  try {
    const visto = await ilRimborsoDellaChiaveGiaUscito(
      { id: ret.order_id, stripe_payment_intent: ordine.stripe_payment_intent },
      `return_${ret.id}`,
      ret.id,
    );
    return visto ? { refundId: visto.uscito.id, centesimi: visto.uscito.amount ?? 0 } : null;
  } catch (err) {
    logger.error('[returns/avanza] rimborsi del pagamento non letti: resta il controllo sul residuo', { returnId: ret.id, err });
    return null;
  }
}

async function handler(req: NextRequest, user: { id: string }, params: { id: string }): Promise<NextResponse> {
  let body;
  try {
    body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
  /**
   * 6/9/2026 — «TROPPO GRANDE» E «DATI NON VALIDI» NON SONO LA STESSA COSA.
   *
   * Il tetto sul corpo lancia un errore che porta con sé lo stato giusto (413).
   * Questo `catch` lo raccoglieva insieme a un JSON rotto e rispondeva 400
   * «Dati non validi»: chi manda troppa roba non capisce che deve solo mandarne
   * meno, e nei registri un limite superato non si distingue da un errore del
   * browser. Le rotte AI questa distinzione ce l'hanno da fine agosto (R153),
   * queste tre no.
   */
    if (e instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge('La richiesta è troppo grande: scrivi una nota più corta.');
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }

  const supa = await getServerSupabase();
  const { data: ret, error } = await supa
    .from('returns')
    .select('id, status, seller_id, buyer_id, order_id, reason, refund_amount_cents, created_at, refund_id, order_item_id, decided_at')
    .eq('id', params.id)
    .single();

  if (error || !ret) return ApiErrors.notFound('Reso non trovato');

  /**
   * 3/9/2026 — IL NEGOZIO LO DICE L'ORDINE, NON IL RESO.
   *
   * Qui c'era `if (ret.seller_id !== user.id)`: il permesso di rimborsare si
   * decideva leggendo una colonna della riga del reso, e quella riga il cliente
   * se la scriveva da solo. Bastava metterci il proprio identificativo per
   * essere «il negozio» e farsi restituire l'ordine intero tenendo la merce.
   * Il venditore vero e' quello dell'ordine, che il cliente non tocca.
   */
  const comando = await chiComandaIlReso(ret.order_id, user.id);
  let ritiro: { sellerId: string | null } | null = null;
  // R17-003 — Il cliente dell'ordine che dice di aver rispedito la merce.
  let dichiarazione: { sellerId: string | null } | null = null;
  if (!comando.autorizzato) {
    if (comando.motivo === 'guasto') return ApiErrors.unavailable('Non riusciamo a leggere il reso adesso: riprova fra poco.');
    if (comando.motivo === 'ordine-mancante') return ApiErrors.notFound('Ordine del reso non trovato');
    const cliente =
      body.stato === 'CANCELED' || body.stato === 'SHIPPED_BACK' ? await eIlClienteDellOrdine(ret.order_id, user.id) : null;
    if (!cliente) return ApiErrors.forbidden();
    if (body.stato === 'CANCELED') {
      ritiro = cliente;
      if (!PARTENZE_DEL_RITIRO.includes(ret.status)) {
        return ApiErrors.conflict(
          'La merce è già in viaggio o in negozio: la richiesta non si può più ritirare. Scrivi al negozio.',
        );
      }
    } else {
      dichiarazione = cliente;
      if (ret.status !== 'APPROVED') {
        return ApiErrors.conflict(
          ret.status === 'REQUESTED'
            ? 'Il negozio non ha ancora approvato il reso: aspetta la sua risposta prima di spedire.'
            : 'La spedizione di questo reso risulta già segnata, o il reso è chiuso.',
        );
      }
      const nonVale = percheLaSpedizioneNonVale(body.speditoIl, (ret as { created_at?: string | null }).created_at, Date.now());
      if (nonVale) return ApiErrors.invalidRequest(nonVale);
    }
  } else if (body.speditoIl !== undefined || body.numeroSpedizione !== undefined) {
    // La spedizione la dichiara il cliente: il negozio non la scrive al posto suo.
    return ApiErrors.forbidden('Il giorno e il numero della spedizione li dichiara il cliente, dalla sua pagina del reso.');
  }

  // Un «rimborsato» rimasto a meta' si riprende (vedi `ripresa`, piu' sotto).
  const forseRipresa = body.stato === 'REFUNDED' && ret.status === 'REFUNDED' && !ret.refund_id;
  const partenze = PARTENZE_AMMESSE[body.stato];
  if (!forseRipresa && !partenze.includes(ret.status)) {
    return ApiErrors.conflict(`Un reso in ${ret.status} non può passare a ${body.stato}.`);
  }

  if (body.stato === 'CANCELED' && !ritiro) {
    const perche = percheIlRecessoNonSiChiude(ret, Date.now());
    if (perche) return ApiErrors.conflict(perche);
  }

  const admin = getAdminSupabase();

  // Il rimborso si controlla PRIMA di prendere il turno, come su `decide`: un
  // importo impossibile non deve lasciare traccia sul reso, e il venditore deve
  // leggere il motivo invece di un guasto tecnico.
  // R84 — Il tetto lo decide la stessa regola che usa chi muove i soldi: sui
  // contanti conta solo quello che e' stato incassato davvero.
  const COLONNE_ORDINE =
    'stripe_payment_intent, payment_method, gross_total_cents, total_price, refunded_amount_cents, wallet_applied_cents, cash_confirmed_at, payment_status, delivery_status, stripe_refund_id, discount_amount';
  let ordine: OrdineDaRimborsare | null = null;
  let importoRimborso = 0;
  /**
   * Riesame del 16/10, terzo giro — IL RIMBORSO E' GIA' PARTITO, MA IL RESO NON LO SA.
   *
   * Succede quando la scrittura dell'esito cade dopo il rimborso (in `decide`
   * o qui). Prima il reso restava li': «rimborsato» rispondeva «gia' rimborsato
   * per intero», e l'unica strada era «chiudi senza rimborso», che scriveva al
   * cliente «chiuso senza rimborso» mentre gli dovevamo il bonifico. Adesso, se
   * l'ordine porta gia' il rimborso di questo reso, «rimborsato» lo registra sul
   * reso senza rifarlo (nessun secondo bonifico), e «chiudi» non passa.
   *
   * Collaudo del 17/10, terzo giro — se il tentativo di prima e' morto dopo il segno,
   * l'avviso a chi paga o il credito possono mancare, e registrarlo e basta lasciava il
   * cliente senza soldi: allora «rimborsato» li finisce (vedi `manca`, piu' sotto).
   */
  let giaSullOrdine: { segno: string; centesimi: number } | null = null;

  if (body.stato === 'REFUNDED' || body.stato === 'CANCELED') {
    const { data, error: errOrdine } = await conRipiegoSchema(
      'orders.select (avanzamento del reso)',
      () => admin.from('orders').select(COLONNE_ORDINE).eq('id', ret.order_id).single(),
      () => admin.from('orders').select(senzaColonne(COLONNE_ORDINE, COLONNE_124)).eq('id', ret.order_id).single(),
    );
    ordine = (data ?? null) as OrdineDaRimborsare | null;
    if (!ordine) {
      return body.stato === 'CANCELED' && errOrdine
        ? ApiErrors.unavailable("Non riesco a controllare l'ordine del reso: riprova tra poco.")
        : ApiErrors.notFound('Ordine del reso non trovato');
    }
    giaSullOrdine = bonificoDellaChiave(ordine as { stripe_refund_id?: string | null }, `return_${ret.id}`);
  }

  /**
   * Collaudo del 17/10, terzo giro — «RIMBORSATO» RIMASTO A META' SI RIPRENDE.
   * Il turno scrive «rimborsato» prima dei soldi: se la funzione muore dentro il
   * rimborso, il reso resta «rimborsato» senza riferimento, e un secondo
   * «rimborsato» rispondeva 409 mentre il bonifico non l'aveva chiesto nessuno.
   * Se l'ordine porta il bonifico di questo reso, lo si finisce, senza un nuovo turno.
   */
  const ripresa = forseRipresa && !!giaSullOrdine;
  if (forseRipresa && !ripresa) {
    return ApiErrors.conflict(`Un reso in ${ret.status} non può passare a ${body.stato}.`);
  }

  if (body.stato === 'CANCELED' && giaSullOrdine) {
    return ApiErrors.conflict(
      'Il rimborso di questo reso è già partito: non si può chiudere «senza rimborso». ' +
        'Segna la merce come ricevuta e poi il reso come rimborsato: il rimborso non si ripete, si registra.',
    );
  }

  /**
   * Collaudo del 17/10, quarto giro — SE IL BONIFICO E' FINITO, SI REGISTRA E BASTA.
   * Segno e avviso (e credito) ci sono: si registra sul reso senza ripassare dal rimborso, come
   * prima. Si riprende (`refundOrder`) solo se manca un pezzo. Prima ci si ripassava sempre, e un
   * guasto qualsiasi della ripresa faceva leggere «non è partito» su un rimborso finito.
   */
  let manca: 'avviso' | 'credito' | 'niente' | null = null;
  if (body.stato === 'REFUNDED' && giaSullOrdine) {
    // Il rimborso c'e' gia': si registra quello, con la cifra promessa all'approvazione.
    importoRimborso = Number(ret.refund_amount_cents ?? 0) > 0 ? Number(ret.refund_amount_cents) : giaSullOrdine.centesimi;
    try {
      manca = await cosaMancaAlBonifico(`return_${ret.id}`, importoRimborso - giaSullOrdine.centesimi);
    } catch (err) {
      logger.error('[returns/avanza] bonifico gia sull ordine, non si riesce a vedere se e finito', { returnId: ret.id, err });
      return ApiErrors.unavailable("Non riesco a controllare l'ordine del reso: riprova tra poco.");
    }
  } else if (body.stato === 'REFUNDED' && ordine) {
    const rimborsabile = quantoSiPuoRestituire(ordine);
    const residuoCent = rimborsabile.massimoCents;
    // Se non è indicato niente si rimborsa quello che il venditore aveva già
    // promesso quando ha approvato il reso.
    importoRimborso = body.refundAmountCents ?? Number(ret.refund_amount_cents ?? 0) ?? 0;
    if (importoRimborso <= 0) {
      return ApiErrors.invalidRequest('Indica quanto rimborsare al cliente.');
    }
    // R17-004 — Il residuo non basta: forse e' il rimborso di questo reso, gia' uscito sulla carta.
    const giaSullaCarta =
      rimborsabile.perche !== 'ok' || importoRimborso > residuoCent ? await ilRimborsoDelResoGiaSullaCarta(ordine, ret) : null;
    // Si registra quello che e' uscito: `refundOrder` lo riconosce e non lo rifa'.
    if (giaSullaCarta) importoRimborso = giaSullaCarta.centesimi;
    if (!giaSullaCarta && rimborsabile.perche !== 'ok') {
      return ApiErrors.conflict(motivoNienteDaRestituire(rimborsabile.perche));
    }
    if (!giaSullaCarta && importoRimborso > residuoCent) {
      return ApiErrors.invalidRequest(
        `Il rimborso non può superare quello che resta dell ordine: al massimo ${(residuoCent / 100).toFixed(2)} €.`,
      );
    }
    /**
     * 31/10/2026 — IL RECESSO SI RIMBORSA PER INTERO.
     * Il collaudo ha chiuso un recesso da 30 € con 1 centesimo: merce tornata, cliente
     * senza soldi, bonifico al negozio libero. Sotto l'intero si passa solo scrivendo
     * il motivo (merce rovinata o usata oltre la prova), che arriva al cliente.
     * Vale anche per l'amministratore.
     */
    if (!giaSullaCarta && eUnRecesso(ret)) {
      let righe: RigaDellOrdine[] | null = null;
      if (ret.order_item_id) {
        const { data: lette, error: errRighe } = await admin
          .from('order_items')
          .select('id, unit_price, quantity')
          .eq('order_id', ret.order_id);
        if (errRighe || !lette) {
          return ApiErrors.unavailable("Non riesco a leggere i prodotti dell'ordine: riprova tra poco.");
        }
        righe = lette as RigaDellOrdine[];
      }
      const nonBasta = percheIlRimborsoDelRecessoNonBasta({
        reso: ret,
        importoCents: importoRimborso,
        interoCents: interoDelRecesso(residuoCent, rigaResaCents(righe, ret.order_item_id ?? null, Math.round(Number((ordine as { discount_amount?: number | string | null } | null)?.discount_amount ?? 0) * 100))),
        motivo: body.note,
      });
      if (nonBasta) return ApiErrors.conflict(nonBasta);
    }
    if (!!ordine.stripe_payment_intent && !isStripeConfigured()) {
      return ApiErrors.unavailable('Stripe non configurato: impossibile emettere il rimborso ora.');
    }
  }

  // Il turno si prende con la scrittura: due schede aperte sullo stesso reso
  // non possono farlo avanzare due volte.
  const statoPrecedente = ret.status;
  const prendiIlTurno = (patch: Record<string, unknown>) =>
    admin.from('returns').update(patch).eq('id', params.id).eq('status', statoPrecedente).select('id');
  // R17-003 — La dichiarazione del cliente scrive stato, giorno e numero: la nota del negozio resta sua.
  const numeroSpedizione = body.numeroSpedizione ? body.numeroSpedizione : null;
  let presa: { data: Array<{ id: string }> | null; error: unknown } = ripresa
    ? { data: [{ id: ret.id }], error: null }
    : await prendiIlTurno(
        dichiarazione
          ? { status: 'SHIPPED_BACK', [COLONNA_DEL_GIORNO]: body.speditoIl, tracking_number: numeroSpedizione }
          : {
              status: body.stato,
              decision_notes: body.note ?? null,
              ...(body.stato === 'REFUNDED' ? { refund_amount_cents: importoRimborso } : {}),
            },
      );
  if (dichiarazione && presa.error && mancaLaColonnaDelGiorno(presa.error)) {
    // Prima della 411 la colonna del giorno non c'e': lo stato (che ferma la chiusura) e il numero si
    // scrivono lo stesso, e il giorno arriva al negozio nell'avviso qui sotto.
    logger.warn('[returns/avanza] migrazione 411 non ancora applicata: la spedizione si segna senza il giorno', {
      returnId: ret.id,
    });
    presa = await prendiIlTurno({ status: 'SHIPPED_BACK', tracking_number: numeroSpedizione });
  }
  const { data: preso, error: errPresa } = presa;

  if (errPresa) return ApiErrors.internal('Aggiornamento del reso fallito');
  if (!preso || preso.length === 0) {
    return ApiErrors.conflict("Il reso è già stato aggiornato da un'altra sessione");
  }

  let refundId: string | null = null;
  /** R71 — quanto del rimborso va pagato col bonifico, a mano. */
  let bonificoCents = 0;
  if (body.stato === 'REFUNDED' && giaSullOrdine && manca === 'niente') {
    // Il rimborso e' gia' partito e finito (vedi sopra): si registra, non si rifa'.
    refundId = giaSullOrdine.segno;
    bonificoCents = giaSullOrdine.centesimi;
  } else if (body.stato === 'REFUNDED') {
    // R71 — Sui contanti il rimborso va col bonifico, sempre (refundOrder). Se e'
    // gia' sull'ordine (vedi sopra) refundOrder non lo rifa': finisce quello che manca.
    try {
      const res = await refundOrder({
        orderId: ret.order_id,
        amountCents: importoRimborso,
        reason: body.note ?? 'requested_by_customer',
        metadata: { return_id: ret.id },
        idempotencyKey: `return_${ret.id}`,
        notifyBuyer: true,
        resoChiestoIl: (ret as { created_at?: string | null }).created_at ?? null,
      });
      refundId = res.refundId;
      bonificoCents = res.bonificoCents ?? 0;
    } catch (err) {
      logger.error('[returns/avanza] rimborso fallito', err);
      // I soldi non sono usciti: il reso torna dov'era, così resta lavorabile
      // invece di restare fermo su «rimborsato» senza rimborso.
      // 5/11/2026 — Se anche il ritorno indietro cade, il reso resta «rimborsato»
      // senza soldi: si avvisa chi amministra e non si dice «riprova».
      const { error: errRitorno } = ripresa
        ? { error: null }
        : await admin
            .from('returns')
            .update({ status: statoPrecedente })
            .eq('id', params.id)
            .eq('status', 'REFUNDED');
      if (errRitorno) {
        logger.error('[returns/avanza] reso non rimesso com era dopo un rimborso non partito', {
          returnId: params.id, message: errRitorno.message,
        });
        try {
          await notifyAdmins(
            '⚠️ Reso bloccato: rimborso non partito',
            `Il rimborso del reso ${params.id.slice(0, 6).toUpperCase()} non è partito e il reso è rimasto «rimborsato»: ` +
              `nessun soldo è uscito. Riportalo a ${statoPrecedente} dal pannello prima di rimborsarlo.`,
            '/admin/orders',
            { unaVoltaPer: `reso-bloccato:${params.id}` },
          );
        } catch (e) {
          logger.error('[returns/avanza] avviso del reso bloccato non inviato', { returnId: params.id, e });
        }
        return ApiErrors.internal(
          "Il rimborso non è partito e il reso non si è potuto rimettere com'era: abbiamo avvisato l'amministrazione. Non riprovare per ora.",
        );
      }
      // 17/10/2026 — Come `decide`: il negozio legge i due casi che deve
      // conoscere, e per tutto il resto una frase sola. Mai il testo grezzo
      // dell'errore (R138: niente messaggi interni).
      if (err instanceof AccreditoGiaUscitoConAltroImporto) return ApiErrors.conflict(err.message);
      if (err instanceof RimborsoInAttesaDellaDivisione) return ApiErrors.conflict(err.message);
      // Il bonifico era gia' registrato sull'ordine: quello resta, manca un pezzo.
      if (manca === 'avviso' || manca === 'credito') return ApiErrors.badGateway(bonificoDaFinire(manca));
      return ApiErrors.badGateway("Il rimborso non è partito: riprova o scrivi all'assistenza.");
    }
  }
  if (body.stato === 'REFUNDED') {
    const { error: updErr } = await admin
      .from('returns')
      .update({ refund_id: refundId, refunded_at: new Date().toISOString() })
      .eq('id', params.id);
    /**
     * Riesame del 16/10 — UNA SCRITTURA CADUTA NON E' UN «OK».
     *
     * I soldi sono gia' partiti (o il bonifico e' gia' registrato sull'ordine).
     * Il negozio leggeva «rimborsato» come se fosse tutto a posto. Qui si ferma,
     * e `decide` fa lo stesso (terzo giro del riesame): chi amministra riceve un
     * avviso con reso, ordine e cifra, e chi ha premuto legge che la
     * registrazione non e' riuscita.
     */
    if (updErr) {
      const avviso = avvisoDelRimborsoNonRegistrato({
        resoId: params.id, ordineId: ret.order_id, refundId, bonificoCents, resoGiaRimborsato: true,
      });
      try {
        await notifyAdmins(avviso.titolo, avviso.testo, avviso.link);
      } catch (e) {
        logger.error('[returns/avanza] avviso del rimborso non registrato non inviato', { returnId: params.id, e });
      }
      return ApiErrors.internal(RIMBORSO_PARTITO_MA_NON_REGISTRATO);
    }
  }

  const TITOLO: Record<string, string> = {
    SHIPPED_BACK: '📦 Reso: merce in viaggio',
    RECEIVED: '📥 Reso: merce ricevuta dal negozio',
    CANCELED: '✕ Reso chiuso senza rimborso',
  };
  // Quando ha agito il cliente (ritiro o spedizione) l'avviso va al negozio.
  const delCliente = ritiro ?? dichiarazione;
  await scriviCampanella(admin, {
    // #33 — la categoria decide se la persona vuole ancora ricevere questo
    // tipo di avviso: senza, gli interruttori non spegnevano niente.
    category: 'order',
    user_id: delCliente ? (delCliente.sellerId ?? ret.seller_id) : ret.buyer_id,
    // 17/10 (semplificazione) — Sui contanti il bonifico a questo punto e' solo
    // da fare: il titolo non dice «rimborsato», come non lo dice la pagina dell'ordine.
    // Sul misto dice anche il credito gia' tornato (titoloDelResoRimborsato).
    title:
      body.stato === 'REFUNDED'
        ? titoloDelResoRimborsato({ importoCents: importoRimborso, bonificoCents })
        : ritiro
          ? '↩ Il cliente ha ritirato la richiesta di reso'
          : dichiarazione
            ? '📦 Il cliente ha rispedito la merce del reso'
            : TITOLO[body.stato],
    body: dichiarazione
      ? `Spedita il ${inLettere(body.speditoIl ?? '')}${numeroSpedizione ? `, numero di spedizione ${numeroSpedizione}` : ''}.` +
        (eUnRecesso(ret) ? ' È un recesso: si chiude col rimborso quando ricevi la merce.' : '')
      : body.note ?? null,
    link: delCliente ? `/seller/orders/${ret.order_id}` : `/orders/${ret.order_id}`,
  }, { dove: 'returns-avanza', ordine: ret.order_id, reso: ret.id });

  return NextResponse.json({ ok: true, status: body.stato, refundId }, { status: 200 });
}

// Stesso freno della decisione sul reso: tocca i soldi.
// 30/8/2026 (R017) — L'ADATTATORE A MANO NON C'E' PIU'.
//
// Qui c'era la riga che tutte le rotte dinamiche si riscrivevano: prendeva il
// secondo argomento di Next, ne aspettava la promessa e la riportava dentro
// l'involucro. Copiata tredici volte, e in ognuna bastava dimenticare l'`await`
// per far arrivare `undefined` alla query. Adesso i pezzi dell'indirizzo li
// risolve l'involucro, una volta sola, e arrivano gia' pronti nel contesto.
export const POST = withAuthRateLimit(
  { name: 'returns-avanza', max: 30, windowMs: 10 * 60_000 },
  ({ req, user, params }) => handler(req, user, { id: String(params.id) }),
);
