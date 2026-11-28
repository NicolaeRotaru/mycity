import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { conFilaPerRichiesta } from '@/lib/api/fila-per-richiesta';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { annullaERimborsa, avvisaIlNegozioDellAnnullo, COLONNE_ANNULLO, type OrdineDaAnnullare } from '@/lib/ordini/annulla';

export const runtime = 'nodejs';

/**
 * 31/10/2026 — IL FATTORINO PUÒ DIRE «CLIENTE ASSENTE».
 *
 * Fino a oggi, da «in consegna» il fattorino aveva una strada sola: il codice
 * del cliente, che porta a «consegnato». Se alla porta non rispondeva nessuno
 * l'ordine restava «in consegna» per sempre, e la merce col fattorino.
 *
 * Scelta di Nicola del 31/10 (fatto `consegna.cliente-assente`): niente stato
 * nuovo e niente trattenute. Dopo aver provato a telefonare, il fattorino segna
 * «cliente assente» e l'ordine si annulla come ogni altro annullo, con
 * `annullaERimborsa`: con la carta torna tutto, coi contanti non si paga
 * niente, la merce torna a magazzino del negozio.
 *
 * Chi può: solo il fattorino assegnato all'ordine, e solo con l'ordine «in
 * consegna». Il doppio tocco non rende due volte: se l'ordine è già annullato
 * qui si risponde 409, e se due richieste arrivano insieme la scrittura di
 * `annullaERimborsa` lascia passare una sola delle due (GIA_ANNULLATO).
 */
const MOTIVO_CLIENTE_ASSENTE = 'cliente_assente';

const IdOrdine = z.string().uuid();

/** 400 → «4,00 €», come nelle email. */
const euro = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

/** Il profilo che il portiere (lib/api/middleware.ts, authenticate) legge a ogni richiesta. */
type ProfiloDiChiChiama = { role: string; is_approved: boolean };

async function handler(user: { id: string }, idGrezzo: string, profilo?: ProfiloDiChiChiama): Promise<NextResponse> {
  const id = IdOrdine.safeParse(idGrezzo);
  if (!id.success) return ApiErrors.notFound('Ordine non trovato');

  // Client di servizio: il fattorino non ha il permesso di scrivere CANCELED, e
  // chi può toccare quale ordine lo decidono i controlli qui sotto.
  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from('orders')
    .select(`${COLONNE_ANNULLO}, rider_id`)
    .eq('id', id.data)
    .maybeSingle();
  if (error) {
    logger.error('[cliente-assente] lettura ordine fallita', { orderId: id.data, message: error.message });
    return ApiErrors.internal("Impossibile leggere l'ordine");
  }
  if (!data) return ApiErrors.notFound('Ordine non trovato');

  const order = data as unknown as OrdineDaAnnullare & { rider_id: string | null };
  if (order.rider_id !== user.id) return ApiErrors.forbidden('Non autorizzato (ordine di altro rider)');
  // 17/11/2026 (R30-023) — Un fattorino sospeso non annulla più le consegne che aveva in mano: la
  // chiude l'assistenza. L'ordine si legge col client di servizio, quindi la regola di lettura del
  // database non lo ferma: il controllo sta qui. Sospendere mette is_approved=false sul profilo.
  if (profilo && (profilo.role !== 'rider' || profilo.is_approved !== true)) {
    return ApiErrors.forbidden('Il tuo profilo fattorino è sospeso: questa consegna la chiude l’assistenza.');
  }
  if (order.delivery_status === 'CANCELED') return ApiErrors.conflict('Ordine già annullato');
  // 5/11/2026 — Anche da «ritirato» (PICKED_UP): il fattorino che va dritto dal cliente senza
  // premere «Sto andando dal cliente» deve poter dire che non c'è nessuno. I contanti a quel punto
  // non possono essere già dichiarati (si dichiarano solo da OUT_FOR_DELIVERY in poi).
  if (order.delivery_status !== 'OUT_FOR_DELIVERY' && order.delivery_status !== 'PICKED_UP') {
    return ApiErrors.conflict('Puoi segnare «cliente assente» solo dopo aver ritirato la merce, mentre la porti al cliente.');
  }

  const esito = await annullaERimborsa(admin, order, {
    reason: 'Ordine annullato: cliente assente alla consegna',
    metadata: { canceled_by: user.id, source: MOTIVO_CLIENTE_ASSENTE },
    motivoCredito: 'order_canceled_cliente_assente',
  });

  if (!esito.ok) {
    if (esito.motivo === 'GIA_ANNULLATO') return ApiErrors.conflict('Ordine già annullato');
    if (esito.motivo === 'CONTANTI_INCASSATI') {
      return ApiErrors.conflict("Hai già registrato l'incasso in contanti: scrivi all'assistenza per annullare.");
    }
    if (esito.motivo === 'STRIPE_NON_CONFIGURATO') return ApiErrors.unavailable('Rimborsi non disponibili, riprova più tardi');
    if (esito.motivo === 'RIMBORSO_FALLITO') return ApiErrors.badGateway("Il rimborso non è partito: riprova o scrivi all'assistenza.");
    if (esito.motivo === 'RIMBORSO_DA_DIVIDERE') {
      return ApiErrors.conflict("Su questo pagamento c'è un rimborso da sistemare: abbiamo avvisato l'assistenza, riprova più tardi.");
    }
    // R08-001 (onda 2) — Un 500 senza riga nel registro non lo vede nessuno (come l'annullo del cliente
    // e dell'amministrazione): il guasto restava solo nella risposta al fattorino.
    logger.error('[cliente-assente] annullo ordine fallito', { orderId: order.id, motivo: esito.motivo, dettaglio: esito.dettaglio });
    return ApiErrors.internal('Annullamento fallito');
  }

  const sigla = order.id.slice(0, 6).toUpperCase();
  // 31/10/2026 (collaudo) — Qui il cliente leggeva sempre «Ti abbiamo rimborsato tutto», anche quando il
  // credito MyCity speso sull'ordine non era tornato (`creditoNonTornatoCents`): la carta sì, il credito
  // no. Ora la frase dice cosa è tornato e cosa manca. Gli amministratori li ha già avvisati
  // `annullaERimborsa`, con ordine, cliente e importo.
  const mancanteCents = esito.creditoNonTornatoCents ?? 0;
  const primaFrase = `Il fattorino non ti ha trovato all'indirizzo dell'ordine #${sigla}.`;
  const corpoCliente =
    mancanteCents > 0
      ? `${primaFrase} ${esito.refundId ? 'Il rimborso sulla carta è partito' : 'Non devi pagare niente'}, ` +
        `ma il credito MyCity che avevi usato (${euro(mancanteCents)}) non è ancora tornato sul tuo saldo. ` +
        "L'abbiamo segnalato all'assistenza, che te lo restituisce a mano: non devi fare niente."
      : esito.refundId
        ? // Non «ti abbiamo rimborsato tutto»: in un carrello con altri negozi ancora da consegnare
          // torna la merce e la differenza della consegna (COSA_TORNA). La cifra la dice l'email.
          `${primaFrase} Il rimborso sulla carta è partito: l'importo è nell'email «Rimborso emesso».`
        : `${primaFrase} Non devi pagare niente.`;
  const fraseAlNegozio = `Il cliente dell'ordine #${sigla} non era in casa: la merce torna in negozio.`;
  const { error: nErr } = await admin.from('notifications').insert([
    {
      category: 'order',
      user_id: order.user_id,
      title: '✕ Ordine annullato: non eri in casa',
      body: corpoCliente,
      link: `/orders/${order.id}`,
    },
    ...(order.seller_id
      ? [{
          category: 'order',
          user_id: order.seller_id,
          title: '↩️ Ordine annullato: cliente assente',
          body: fraseAlNegozio,
          link: `/seller/orders/${order.id}`,
        }]
      : []),
  ]);
  if (nErr) logger.error('[cliente-assente] notifiche non scritte', { orderId: order.id, message: nErr.message });
  // R03-007 (cura di R06-006) — Al negozio anche l'email dell'annullo, come nelle altre rotte d'annullo (R31-023): con la sola
  // campanella il negozio non lo sapeva finché non apriva il pannello. Non lancia: l'annullo è già scritto.
  await avvisaIlNegozioDellAnnullo(admin, order, fraseAlNegozio);

  return NextResponse.json({ ok: true, motivo: MOTIVO_CLIENTE_ASSENTE, refundId: esito.refundId }, { status: 200 });
}

// Un fattorino ha poche consegne l'ora: 20 tocchi sono tanti anche con un telefono che ripete.
const postSenzaFila = withAuthRateLimit(
  { name: 'rider-cliente-assente', max: 20, windowMs: 60 * 60_000 },
  ({ user, profile, params }) => handler(user, String(params.id), profile),
);

// 28/11/2026 (onda 2, R09-006 + R06-012) — Gli avvisi dell'annullo passano dalla fila della richiesta:
// la rotta si avvolge, così le email partono una alla volta e non tutte insieme.
export const POST = conFilaPerRichiesta(postSenzaFila);
