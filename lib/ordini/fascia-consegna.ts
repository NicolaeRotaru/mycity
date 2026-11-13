import { z } from 'zod';
import { FASCE_AMMESSE } from '@/lib/quando-arriva';

/**
 * LA FASCIA DI CONSEGNA, CONTROLLATA UNA VOLTA SOLA PER TUTT'E DUE LE CASSE.
 *
 * ── Cos'è ───────────────────────────────────────────────────────────────────────────────────
 * «Quando vuoi riceverlo»: la riga che il cliente sceglie in cassa e che il negoziante legge
 * sull'ordine («Domani · 9:00–12:00»). Viaggia nel corpo della richiesta, quindi la scrive il
 * browser — cioè, per chi vuole, chiunque.
 *
 * ── Il difetto che ha prodotto questo file (3/9/2026) ────────────────────────────────────────
 * Era dichiarata `z.string().max(120)`: testo libero, mai confrontato con niente. Il 3/9 la
 * stessa stringa ha smesso di essere un'etichetta e ha cominciato a DECIDERE: le due rotte che
 * creano gli ordini le chiedono se il negozio può servire, e una fascia «per domani» fa guardare
 * gli orari di domani invece dell'orologio di adesso. Bastava mandare la parola «domani» perché
 * un panificio chiuso alle 3 di notte risultasse servibile: l'ordine partiva, il fattorino
 * trovava la saracinesca abbassata.
 *
 * ── La regola ───────────────────────────────────────────────────────────────────────────────
 * Un dato che arriva da fuori e ALLARGA un permesso si confronta con un elenco del server, non
 * si interpreta. Le fasce lecite sono sette e stanno in `lib/quando-arriva.ts`, che è anche
 * l'elenco da cui la cassa costruisce le mattonelle: cassa e server leggono la stessa riga.
 *
 * Un secondo motivo, più banale e altrettanto vero: questa stringa finisce su
 * `orders.delivery_slot` e da lì sotto gli occhi del negoziante e dentro le email. Un campo
 * libero di 120 caratteri scritto da chi ordina non è un posto dove far passare del testo.
 *
 * La fascia resta facoltativa: chi ritira in negozio non ne ha una, e va bene.
 */
export const campoFasciaConsegna = z
  .string()
  .max(120)
  .refine((v) => FASCE_AMMESSE.includes(v), {
    message: 'Scegli di nuovo quando vuoi ricevere l’ordine: quella fascia non è più disponibile.',
  })
  .optional()
  .nullable();
