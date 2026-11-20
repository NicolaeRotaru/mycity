import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import {
  isPushConfigured, iscrizioniPerUtenti, sendPushToUser, type PushDeliveryOptions,
} from '@/lib/push/send';

/**
 * 20/11/2026 (R02-004) — LA PUSH DEL NUOVO ORDINE PARTE SUBITO, NON AL GIRO DEI CINQUE MINUTI.
 *
 * La campanella «Nuovo ordine» del negozio nasce quando nasce l'ordine (rotta dei contanti,
 * webhook della carta), ma la push sul telefono la mandava solo il giro a orario
 * (app/api/cron/send-push, ogni 5 minuti): il negoziante poteva saperlo cinque minuti dopo, con il
 * pane da preparare e il cliente che aspetta. Scelta di Nicola: la push del nuovo ordine parte
 * subito, alla creazione dell'ordine; il giro a orario resta la rete di sicurezza.
 *
 * Senza doppio invio: prima di mandare, le campanelle si PRENDONO con una scrittura sola
 * (`pushed_at` da vuoto ad adesso, solo dove è ancora vuoto): quelle che il giro ha già mandato non
 * tornano, e una volta prese il giro non le vede più. Se l'invio non va (servizio push giù,
 * iscrizioni non lette), le campanelle tornano con `pushed_at` vuoto e il giro le riprende, come
 * faceva prima. Un errore qui non fa mai cadere la creazione dell'ordine: non si lancia.
 *
 * Qui stanno anche le regole della push che il giro e l'invio subito devono avere uguali: quanto
 * vale un avviso (`CONSEGNA_PER_CATEGORIA`) e quale sostituisce sul telefono (`contrassegno`).
 */

/**
 * 6/9/2026 — QUANTO A LUNGO VALE UN AVVISO, A SECONDA DI COSA DICE.
 *
 * Il servizio push di Apple/Google/Mozilla tiene in coda il messaggio se il
 * telefono e' spento: senza istruzioni per quattro settimane. «Il tuo ordine e'
 * in consegna» che arriva lunedi' per una consegna di sabato non e' un avviso,
 * e' un motivo per spegnere le notifiche. Un'ora per ordini e avvisi di
 * servizio, un giorno per promozioni, gruppi e newsletter (quelle possono
 * aspettare la prossima volta che lo schermo si accende).
 */
const UNORA = 3_600;
const UNGIORNO = 86_400;
export const CONSEGNA_PER_CATEGORIA: Record<string, PushDeliveryOptions> = {
  order:      { TTL: UNORA,    urgency: 'high' },
  system:     { TTL: UNORA,    urgency: 'high' },
  promo:      { TTL: UNGIORNO, urgency: 'normal' },
  group:      { TTL: UNGIORNO, urgency: 'normal' },
  newsletter: { TTL: UNGIORNO, urgency: 'low' },
};

/**
 * 6/9/2026 — UN AVVISO PER ORDINE, NON UNO PER MESSAGGIO.
 *
 * Il contrassegno (`tag`) dice al telefono quale notifica sostituire. Era
 * l'identificativo della notifica, cioe' sempre diverso: «confermato», «in
 * preparazione», «pronto», «in consegna» dello stesso ordine si impilavano in
 * quattro avvisi. Con il collegamento all'ordine l'ultimo stato prende il posto
 * del precedente e `renotify` fa comunque suonare il telefono.
 *
 * Se il collegamento e' generico ('/' o assente) si torna all'identificativo:
 * altrimenti due promozioni diverse si mangerebbero a vicenda.
 */
/*
 * 5/11/2026 — Il link fa da contrassegno solo se porta un id (un ordine, un reclamo). I link di
 * sezione ('/rider', '/admin/sos') valgono per tanti avvisi diversi: col link come contrassegno
 * «Ordine pronto» di un ordine cancellava sul telefono del fattorino quello di un altro ordine.
 */
// Un id è un pezzo del percorso, dopo il primo, che contiene una cifra (un uuid, un numero).
const ID_NEL_LINK = /^\/[^/?#]+\/[^?#]*\d/;
export function contrassegno(n: { id: string; link: string | null }): string {
  return n.link && ID_NEL_LINK.test(n.link) ? n.link : n.id;
}

/**
 * Le campanelle del nuovo ordine che partono subito: quella del NEGOZIO, col link all'ordine
 * (le scrivono la rotta dei contanti e `suonaLaCampanellaAiNegozi`). Quella del cliente («Ordine
 * ricevuto») resta al giro: chi ha appena ordinato ha la conferma davanti.
 */
export function linkDelNuovoOrdineAlNegozio(orderId: string): string {
  return `/seller/orders/${orderId}`;
}

type Campanella = {
  id: string; user_id: string; title: string; body: string | null;
  link: string | null; category: string | null;
};

export type EsitoPushSubito = {
  /** Push consegnate ai telefoni. */
  mandate: number;
  /** Campanelle prese da qui (il giro non le manda più). */
  prese: number;
  /** Campanelle prese e poi ridate al giro, perché l'invio non è andato. */
  ridateAlGiro: number;
};

const NIENTE: EsitoPushSubito = { mandate: 0, prese: 0, ridateAlGiro: 0 };

/** Ridà al giro le campanelle non mandate: `pushed_at` di nuovo vuoto. */
async function ridaiAlGiro(supa: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supa.from('notifications').update({ pushed_at: null }).in('id', ids);
  if (error) {
    logger.error('[push subito] push del nuovo ordine non mandata e non ridata al giro', {
      quante: ids.length, message: error.message,
    });
  }
}

/**
 * Manda SUBITO la push «nuovo ordine» ai negozi degli ordini appena creati. Da chiamare dopo aver
 * scritto le campanelle (anche dentro `dopoLaRisposta`). Non lancia mai.
 */
export async function mandaSubitoLaPushDelNuovoOrdine(
  supa: SupabaseClient,
  orderIds: string[],
): Promise<EsitoPushSubito> {
  const links = [...new Set(orderIds.filter(Boolean))].map(linkDelNuovoOrdineAlNegozio);
  if (links.length === 0) return NIENTE;
  // Le campanelle prese e non ancora sistemate: se qualcosa lancia a metà, tornano al giro.
  let inSospeso: string[] = [];
  try {
    // Senza chiavi VAPID non si prende niente, come il giro: quando ci saranno, l'arretrato recente parte.
    if (!isPushConfigured()) return NIENTE;

    // ① Si prendono, in una scrittura sola: solo quelle ancora da mandare, dell'ultima ora (la finestra del giro).
    const adesso = new Date();
    const { data, error } = await supa
      .from('notifications')
      .update({ pushed_at: adesso.toISOString() })
      .in('link', links)
      .is('pushed_at', null)
      .gte('created_at', new Date(adesso.getTime() - 60 * 60 * 1000).toISOString())
      .select('id, user_id, title, body, link, category');
    if (error) {
      logger.warn('[push subito] campanelle del nuovo ordine non prese: le manda il giro', { message: error.message });
      return NIENTE;
    }
    const prese = (data ?? []) as Campanella[];
    if (prese.length === 0) return NIENTE;
    inSospeso = prese.map((n) => n.id);

    // ② Le preferenze, come il giro: chi ha spento gli avvisi degli ordini non riceve la push (e la
    // campanella resta presa: è una scelta, non un guasto). Preferenza non letta: un ordine parte.
    const vuole = new Map<string, boolean>();
    for (const n of prese) {
      const categoria = n.category ?? 'order';
      const chiave = `${n.user_id}|${categoria}`;
      if (vuole.has(chiave)) continue;
      const { data: si, error: e } = await supa.rpc('vuole_notifica', { p_user_id: n.user_id, p_category: categoria });
      if (e) logger.warn('[push subito] preferenza push non letta: l ordine parte', { categoria, message: e.message });
      vuole.set(chiave, e ? true : si !== false);
    }
    const daMandare = prese.filter((n) => vuole.get(`${n.user_id}|${n.category ?? 'order'}`) !== false);
    inSospeso = daMandare.map((n) => n.id);
    if (daMandare.length === 0) return { mandate: 0, prese: prese.length, ridateAlGiro: 0 };

    // ③ Le iscrizioni, una lettura per tutti; se cade, niente è mandato e tutto torna al giro.
    let iscrizioni: Awaited<ReturnType<typeof iscrizioniPerUtenti>>;
    try {
      iscrizioni = await iscrizioniPerUtenti(supa, [...new Set(daMandare.map((n) => n.user_id))]);
    } catch (e) {
      logger.warn('[push subito] iscrizioni non lette: le manda il giro', { message: e instanceof Error ? e.message : String(e) });
      inSospeso = [];
      await ridaiAlGiro(supa, daMandare.map((n) => n.id));
      return { mandate: 0, prese: prese.length, ridateAlGiro: daMandare.length };
    }

    // ④ Gli invii. Si tiene presa solo quella arrivata almeno su un telefono (o senza telefoni a cui
    // arrivare), come fa il giro; le altre tornano al giro.
    const esiti = await Promise.allSettled(
      daMandare.map((n) =>
        sendPushToUser(supa, n.user_id, {
          title: n.title,
          body: n.body ?? undefined,
          url: n.link ?? '/',
          tag: contrassegno(n),
          renotify: true,
        }, iscrizioni.get(n.user_id) ?? [], CONSEGNA_PER_CATEGORIA[n.category ?? 'order']),
      ),
    );
    let mandate = 0;
    const daRidare: string[] = [];
    esiti.forEach((esito, k) => {
      if (esito.status === 'fulfilled' && (esito.value.delivered > 0 || esito.value.total === 0)) {
        mandate += esito.value.delivered;
      } else {
        daRidare.push(daMandare[k].id);
      }
    });
    inSospeso = [];
    await ridaiAlGiro(supa, daRidare);
    return { mandate, prese: prese.length, ridateAlGiro: daRidare.length };
  } catch (e) {
    // Anche un guasto inatteso resta qui: l'ordine è già nato, la push la riprende il giro.
    logger.warn('[push subito] push del nuovo ordine non partita', { message: e instanceof Error ? e.message : String(e) });
    const daRidare = inSospeso;
    if (daRidare.length > 0) await ridaiAlGiro(supa, daRidare).catch(() => undefined);
    return { mandate: 0, prese: daRidare.length, ridateAlGiro: daRidare.length };
  }
}
