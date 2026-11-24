import { z } from 'zod';
import { withSellerAnchePendingRateLimit } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { logger } from '@/lib/logger';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import {
  ABBONAMENTI,
  testoAvvisoPreventivo,
} from '@/lib/agenzia/preventivo';
import { inviaAlFlusso } from '@/lib/agenzia/flusso-n8n';
import { leggiPreventivo, type Letti } from '@/lib/agenzia/leggi-preventivo';

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

export const GET = withSellerAnchePendingRateLimit(
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

export const POST = withSellerAnchePendingRateLimit(
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
