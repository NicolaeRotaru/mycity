import { z } from 'zod';
import { withSellerAuthRateLimit } from '@/lib/api/middleware';
import { getAdminSupabase } from '@/lib/supabase/server';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { logger } from '@/lib/logger';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import {
  ABBONAMENTI,
  costruisciPreventivo,
  leggiImpostazioniAgenzia,
  impostazioniSenzaPrezzi,
  testoAvvisoPreventivo,
  type Abbonamento,
  type Preventivo,
} from '@/lib/agenzia/preventivo';
import { tipoDelProfilo } from '@/lib/agenzia/tipi-attivita';
import { inviaAlFlusso } from '@/lib/agenzia/flusso-n8n';

export const runtime = 'nodejs';

/**
 * IL PREVENTIVO DELL'AGENZIA — GET lo prepara, POST lo accetta.
 *
 * 22/11/2026 — Nicola: la dashboard del cliente mostra «il preventivo di quello
 * che gli manca», già pronto. Il calcolo è uno solo (`lib/agenzia/preventivo.ts`)
 * e gira qui, sul server, con i dati letti dal database: il browser mostra il
 * preventivo, non lo decide. Quando il cliente accetta, manda solo QUALE
 * abbonamento sceglie (24/11/2026: Base, Business o Premium); canone e «cosa
 * manca» li ricalcola il server.
 *
 * Quello che succede all'accettazione:
 *  · un avviso agli amministratori, una volta sola per giorno e per fascia
 *    (due clic di fila non mandano due avvisi);
 *  · se Nicola l'ha collegato, il flusso n8n dell'agenzia (`lib/agenzia/flusso-n8n.ts`).
 * Nessun addebito: i prezzi sono quelli del listino e il pagamento lo concorda
 * l'agenzia. Niente passa da Stripe.
 */

/** I prodotti che contano per «senza foto»: quelli ancora in catalogo. */
const STATI_IN_CATALOGO = ['available', 'draft', 'out_of_stock', 'pending_approval'];

/** Un negozio con migliaia di schede non deve far leggere tutto: oltre questo numero si conta fin qui. */
const TETTO_PRODOTTI = 2000;

type Letti = { preventivo: Preventivo; telefono: string | null; socials: unknown };

async function leggiPreventivo(idAttivita: string, scelto?: Abbonamento): Promise<Letti> {
  const admin = getAdminSupabase();
  const [profilo, prodotti, impostazioni] = await Promise.all([
    admin
      .from('profiles')
      .select('*')
      .eq('id', idAttivita)
      .maybeSingle(),
    admin
      .from('products')
      .select('images')
      .eq('seller_id', idAttivita)
      .in('status', STATI_IN_CATALOGO)
      .limit(TETTO_PRODOTTI),
    admin.from('site_settings').select('agenzia').eq('id', 1).maybeSingle(),
  ]);
  if (profilo.error) throw new Error(`profilo non letto: ${profilo.error.message}`);
  if (!profilo.data) throw new Error('profilo non trovato');
  // «Non ho letto i prodotti» non è «non hai prodotti»: senza questa riga un catalogo
  // di quaranta schede senza foto risulterebbe a posto.
  if (prodotti.error) throw new Error(`prodotti non letti: ${prodotti.error.message}`);
  // Le impostazioni dell'agenzia sono facoltative. Riga vuota, o migrazione 703 non ancora
  // applicata (la colonna non c'è): valgono il nome e il listino scritti nel codice.
  // Qualunque altro errore di lettura: tutti i prezzi «su richiesta». Se Nicola ha tolto un
  // prezzo dalle impostazioni, un guasto di lettura non deve rimetterlo davanti al cliente.
  const colonnaAncoraAssente = impostazioni.error && ['42703', 'PGRST204'].includes(String(impostazioni.error.code));
  if (impostazioni.error) {
    logger.warn(
      colonnaAncoraAssente
        ? '[preventivo] colonna site_settings.agenzia assente (migrazione 703): vale il listino del codice'
        : '[preventivo] impostazioni dell agenzia non lette: prezzi su richiesta',
      { message: impostazioni.error.message },
    );
  }

  // `select('*')`: le colonne del tipo di attività arrivano con la migrazione 703, e chiederle
  // per nome prima di quella farebbe fallire la lettura. Con `*` ci sono se ci sono.
  const p = profilo.data as Record<string, unknown>;
  const personalizzazione = p.store_customization as { socials?: unknown } | null | undefined;
  const socials = personalizzazione?.socials ?? null;
  const preventivo = costruisciPreventivo({
    idAttivita,
    nomeAttivita: String(p.store_name ?? ''),
    tipoAttivita: tipoDelProfilo(p.business_type),
    dati: {
      storeLogo: (p.store_logo as string | null) ?? null,
      storeMedia: p.store_media,
      prodotti: (prodotti.data ?? []) as { images: unknown }[],
      socials,
    },
    impostazioni: impostazioni.error
      ? colonnaAncoraAssente ? leggiImpostazioniAgenzia(null) : impostazioniSenzaPrezzi()
      : leggiImpostazioniAgenzia(impostazioni.data?.agenzia),
    adesso: new Date(),
    scelto,
  });
  const telefono = (p.store_phone as string | null) || (p.phone as string | null) || null;
  return { preventivo, telefono, socials };
}

export const GET = withSellerAuthRateLimit(
  { name: 'seller-preventivo-leggi', max: 30, windowMs: 60_000 },
  async ({ user }) => {
    try {
      const { preventivo } = await leggiPreventivo(user.id);
      return apiSuccess(preventivo, { headers: { 'Cache-Control': 'no-store' } });
    } catch (errore) {
      logger.error('[preventivo] non preparato', { userId: user.id, errore: String(errore) });
      return ApiErrors.internal('Non sono riuscito a preparare il preventivo. Riprova fra un momento.');
    }
  },
);

const Accettazione = z.object({
  abbonamento: z.enum(ABBONAMENTI, { message: 'Scegli uno dei tre abbonamenti' }),
});

export const POST = withSellerAuthRateLimit(
  { name: 'seller-preventivo-accetta', max: 5, windowMs: 60_000 },
  async ({ user, req }) => {
    let corpo: unknown;
    try {
      corpo = await jsonRichiesta(req, TETTO_JSON);
    } catch (errore) {
      if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
      return ApiErrors.invalidRequest('Richiesta non leggibile');
    }
    const esito = Accettazione.safeParse(corpo);
    if (!esito.success) return ApiErrors.invalidRequest(esito.error.issues[0]?.message ?? 'Dati non validi');
    const scelto = esito.data.abbonamento;

    let letti: Letti;
    try {
      letti = await leggiPreventivo(user.id, scelto);
    } catch (errore) {
      logger.error('[preventivo] non riletto all accettazione', { userId: user.id, errore: String(errore) });
      return ApiErrors.internal('Non sono riuscito a inviare il preventivo. Riprova fra un momento.');
    }
    const { preventivo, telefono, socials } = letti;

    // Una volta per giorno e per fascia: lo stesso clic ripetuto non manda due avvisi.
    // L'id intero dell'attività: due negozi con le stesse prime sei cifre hanno lo stesso numero
    // breve, e senza l'id il secondo avviso sarebbe scambiato per un doppione (collaudo, 23/11).
    const chiave = `preventivo-agenzia:${user.id}:${preventivo.numero}:${scelto}`;
    let avviso: Awaited<ReturnType<typeof notifyAdmins>>;
    try {
      avviso = await notifyAdmins(
        `Preventivo accettato: ${preventivo.attivita}`,
        testoAvvisoPreventivo(preventivo, telefono),
        '/admin/users',
        { unaVoltaPer: chiave, almenoUnDestinatario: true },
      );
    } catch (errore) {
      // Senza l'avviso nessuno saprebbe che il cliente ha accettato: meglio dirgli di riprovare
      // che fargli credere che lo richiameremo.
      logger.error('[preventivo] avviso agli amministratori non scritto', { userId: user.id, errore: String(errore) });
      return ApiErrors.internal('Non sono riuscito a inviare il preventivo. Riprova fra un momento.');
    }

    const flusso = avviso === 'gia-mandato'
      ? 'spento'
      : await inviaAlFlusso(preventivo, { idAttivita: user.id, email: user.email ?? null, telefono, socials });

    return apiSuccess({ numero: preventivo.numero, abbonamento: scelto, giaInviato: avviso === 'gia-mandato', flusso });
  },
);
