import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/email/client';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { resoRichiestoAlNegozioTemplate } from '@/lib/rimborsi/email-dei-resi';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { fotoDiCasa } from '@/lib/storage/foto-di-casa';
import {
  MOTIVO_RIPENSAMENTO,
  notaDegliEsclusi,
  prodottiDelleRighe,
  rifiutoDelRecesso,
  type ProdottoPerIlRecesso,
  type RigaPerIlRecesso,
} from '@/lib/ordini/recesso';
import { scriviCampanella } from '@/lib/ordini/campanella';

export const runtime = 'nodejs';

const REASON = z.enum(['DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'CHANGED_MIND', 'LATE', 'OTHER']);

const Body = z.object({
  orderId: z.string().uuid(),
  orderItemId: z.string().uuid().optional(),
  reason: REASON,
  notes: z.string().max(2000).optional(),
  // 27/8/2026 (R021) — Era `z.string().url()`, che con zod 3 accetta anche
  // `javascript:` e `data:`. Quel valore finisce dentro un `<a href>` nella
  // scheda che il negoziante apre per decidere il reso: un indirizzo scelto
  // dall'utente dentro un collegamento, senza nessuna verifica. Le foto di un
  // reso stanno nel nostro archivio, e solo li'.
  photoUrls: z
    .array(z.string().refine(fotoDiCasa, 'Le foto del reso devono stare nell archivio di MyCity'))
    .max(8)
    .optional(),
});

/**
 * Apre una richiesta di reso. Vincoli:
 *  - L'ordine deve essere DELIVERED
 *  - L'utente deve esserne il buyer
 *  - Entro 14 giorni dalla consegna (recesso legale)
 *
 * Lo stato iniziale e' REQUESTED. Il seller ricevera' notifica e
 * potra' approvare/rifiutare via /api/returns/[id]/decide.
 */
// Rate limit: 10 reso / ora per utente (anti-spam reso fraudolento)
export const POST = withAuthRateLimit({ name: 'returns-create', max: 10, windowMs: 60 * 60_000 }, async ({ user, req }): Promise<NextResponse> => {
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
    if (e instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge('La richiesta è troppo grande: allega meno foto o scrivi una nota più corta.');
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }

  const supa = await getServerSupabase();
  const { data: order, error: oErr } = await supa
    .from('orders')
    .select('id, user_id, seller_id, delivery_status, delivered_at, total_price, created_at')
    .eq('id', body.orderId)
    .single();

  if (oErr || !order) return ApiErrors.notFound('Ordine non trovato');
  if (order.user_id !== user.id) return ApiErrors.forbidden();
  if (order.delivery_status !== 'DELIVERED') return ApiErrors.invalidRequest("L'ordine non risulta consegnato");

  /**
   * Vincolo 14 giorni dalla consegna (recesso).
   *
   * 27/8/2026 (R128) — IL TERMINE SALTAVA DEL TUTTO SENZA LA DATA DI CONSEGNA.
   * Il conto stava dentro `if (order.delivered_at)`: colonna vuota, blocco non
   * eseguito, reso aperto senza nessun limite di tempo. Oggi il caso non si
   * raggiunge perche' tutte le strade verso DELIVERED scrivono anche la data —
   * ma e' una difesa che, quando si rompe, si rompe nel verso sbagliato: lascia
   * passare invece di rifiutare. E il giorno in cui una strada nuova chiude un
   * ordine senza scrivere la data si aprono due difetti insieme, perche' la
   * stessa colonna governa l'ammissibilita' dei bonifici
   * (`release-payouts` filtra su `delivered_at`).
   *
   * Senza la data di consegna si conta dalla data dell'ordine: e' sempre
   * precedente alla consegna, quindi il cliente non perde mai giorni che gli
   * spettano, e il termine non sparisce.
   */
  const baseRecesso = order.delivered_at ?? order.created_at;
  if (baseRecesso) {
    const days = (Date.now() - new Date(baseRecesso).getTime()) / (1000 * 60 * 60 * 24);
    if (days > 14) return ApiErrors.invalidRequest('Termine per il recesso scaduto (14 giorni dalla consegna).');
  }

  // 186 — L'articolo indicato non veniva verificato: si poteva chiedere il reso
  // di un prodotto di un ALTRO ordine, e il negoziante si trovava una richiesta
  // che non torna con niente. Se c'è un articolo, deve essere di quest'ordine.
  if (body.orderItemId) {
    const { data: riga } = await supa
      .from('order_items')
      .select('id')
      .eq('id', body.orderItemId)
      .eq('order_id', body.orderId)
      .maybeSingle();
    if (!riga) return ApiErrors.invalidRequest("L'articolo indicato non appartiene a questo ordine");
  }

  // Anti-doppione: max 1 reso open per ordine
  /**
   * 31/10/2026 — «CAMBIO IDEA» NON VALE SUI PRODOTTI ESCLUSI DAL RECESSO.
   * Pane, freschi e ordinazioni (products.non_recedibile, migrazione 180).
   * I prodotti si leggono col servizio: un prodotto nascosto dopo l'ordine
   * resta escluso. Se la lettura non riesce non si decide al buio.
   * `*` e non la colonna per nome: prima della migrazione 180 la colonna non
   * c'e', la riga arriva senza, e vale «nessun prodotto escluso» (vero: nessun
   * negozio ha ancora potuto segnarne uno). Dopo la 180 e i tipi rigenerati
   * (lib/database.types.ts) si puo' tornare a 'id, name, non_recedibile'.
   */
  // Ordine misto (torta esclusa + miele): il reso nasce, e la nota dice al negozio cosa non rimborsare.
  let notaRecesso: string | null = null;
  if (body.reason === MOTIVO_RIPENSAMENTO) {
    let domandaRighe = supa.from('order_items').select('product_id, product_name').eq('order_id', body.orderId);
    if (body.orderItemId) domandaRighe = domandaRighe.eq('id', body.orderItemId);
    const { data: righe, error: rErr } = await domandaRighe;
    if (rErr) {
      logger.error(rErr, { context: 'returns-recesso-righe' });
      return ApiErrors.internal('Non riesco a verificare i prodotti dell\'ordine: riprova fra poco.');
    }
    const righeOrdine = (righe ?? []) as RigaPerIlRecesso[];
    const ids = [
      ...new Set(righeOrdine.map((r) => r.product_id).filter((x): x is string => typeof x === 'string')),
    ];
    if (ids.length > 0) {
      const { data: prodotti, error: pErr } = await getAdminSupabase()
        .from('products')
        .select('*')
        .in('id', ids);
      if (pErr) {
        logger.error(pErr, { context: 'returns-recesso-prodotti' });
        return ApiErrors.internal('Non riesco a verificare se i prodotti sono esclusi dal recesso: riprova fra poco.');
      }
      // Un prodotto per riga: quella col prodotto tolto dal catalogo conta come recedibile.
      const perRiga = prodottiDelleRighe(righeOrdine, (prodotti ?? []) as Array<ProdottoPerIlRecesso & { id?: string }>);
      const rifiuto = rifiutoDelRecesso(body.reason, perRiga);
      if (rifiuto) return ApiErrors.invalidRequest(rifiuto);
      notaRecesso = notaDegliEsclusi(body.reason, perRiga);
    }
  }

  const { data: existing } = await supa
    .from('returns')
    .select('id, status')
    .eq('order_id', body.orderId)
    .in('status', ['REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'])
    .limit(1)
    .maybeSingle();
  if (existing) return ApiErrors.invalidRequest("Esiste già una richiesta di reso aperta per questo ordine");

  const admin = getAdminSupabase();
  const { data: ret, error: insErr } = await admin
    .from('returns')
    .insert({
      order_id: body.orderId,
      order_item_id: body.orderItemId ?? null,
      buyer_id: user.id,
      seller_id: order.seller_id,
      reason: body.reason,
      notes: [body.notes, notaRecesso].filter(Boolean).join('\n\n') || null,
      photo_urls: body.photoUrls ?? [],
      status: 'REQUESTED',
    })
    .select('id')
    .single();

  if (insErr || !ret) {
    // 186 — Il controllo qui sopra non è atomico: due invii ravvicinati lo
    // superano entrambi. L'indice unico parziale della migrazione 119 è la
    // guardia vera; qui si traduce il suo rifiuto in una risposta che si capisce
    // invece che in un errore interno.
    if (insErr?.code === '23505') {
      return ApiErrors.conflict('Esiste già una richiesta di reso aperta per questo ordine');
    }
    logger.error(insErr, { context: 'returns-insert' });
    return ApiErrors.internal('Creazione reso fallita');
  }

  // Notifica seller (best-effort)
  await scriviCampanella(admin, {
    user_id: order.seller_id,
    /**
     * 30/8/2026 (R127) — La categoria, scritta invece che ereditata.
     *
     * Il valore e' lo stesso che il database metteva da solo, e resta giusto:
     * un reso e' l'aggiornamento di un ordine, e un negoziante che spegne gli
     * avvisi d'ordine sta spegnendo anche questo di sua volonta'. Scriverlo
     * serve a far vedere che e' una scelta: l'avviso di ammanco di cassa,
     * qualche riga piu' in la' nella stessa radiografia, ereditava questa
     * stessa predefinita e li' era sbagliata.
     */
    category: 'order',
    title: '↩️ Nuova richiesta di reso',
    body: `Il cliente ha richiesto il reso per l'ordine #${order.id.slice(0, 8)}`,
    link: `/seller/orders/${order.id}`,
  }, {
    dove: 'returns-create',
    ordine: order.id,
    reso: ret.id,
    ripiego: {
      titolo: '↩️ Nuova richiesta di reso (avviso al negozio non scritto)',
      corpo: `Reso richiesto per l'ordine #${order.id.slice(0, 8)}, ma l'avviso al negozio non è partito: avvisalo tu.`,
      link: '/admin/orders',
    },
  });

  // 5/11/2026 — Il negozio lo sa anche per email, e chi amministra con un avviso:
  // il reso ferma il bonifico dell'ordine. Best-effort: il reso e' gia' scritto.
  try {
    const { data: venditore } = await admin.auth.admin.getUserById(order.seller_id);
    const email = venditore?.user?.email;
    if (email) {
      const t = resoRichiestoAlNegozioTemplate({ orderId: order.id, motivo: body.reason });
      const res = await sendEmail({ to: email, subject: t.subject, html: t.html, text: t.text, tipo: 'transazionale' });
      if (!res.ok) logger.warn('[returns] email della richiesta di reso al negozio non partita', { orderId: order.id });
    }
  } catch (e) {
    logger.warn('[returns] email della richiesta di reso al negozio non partita', { orderId: order.id, e });
  }
  try {
    await notifyAdmins(
      '↩️ Nuova richiesta di reso',
      `Reso chiesto sull'ordine #${order.id.slice(0, 8)}: il bonifico di quell'ordine resta fermo finché il negozio non decide.`,
      `/admin/orders`,
      { unaVoltaPer: `reso-nuovo:${ret.id}` },
    );
  } catch (e) {
    logger.warn('[returns] avviso agli amministratori della richiesta di reso non partito', { orderId: order.id, e });
  }

  return NextResponse.json({ id: ret.id, status: 'REQUESTED' }, { status: 201 });
});
