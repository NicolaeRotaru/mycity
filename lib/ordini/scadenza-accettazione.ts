import { romeNow } from '@/lib/store-hours';

/**
 * ENTRO QUANDO IL NEGOZIO DEVE ACCETTARE L'ORDINE.
 *
 * ── Il difetto che ha prodotto questo file ──────────────────────────────────
 * Oggi le due rotte d'ordine sono passate da «il negozio è aperto ADESSO?» a
 * «in quella fascia il negozio è aperto?» (`negozioPuoServire`): dalle 20:00 la
 * cassa propone «Domani · 9:00–12:00» e l'ordine passa anche se il negozio in
 * questo momento è chiuso. Giusto — la sera è proprio l'ora in cui si compra
 * per il giorno dopo.
 *
 * Nessuno però l'ha detto al lavoro notturno. `app/api/cron/expire-stale-orders`
 * annulla OGNI ordine fermo in NEW da più di tre ore, e gira ogni 30 minuti: la
 * sua ricerca guarda `delivery_status` e `created_at`, e la fascia non la legge
 * nemmeno. L'ordine del pane fatto alle 21:15 per domani alle 9 nasce, il
 * cliente riceve la conferma, e alle 00:15 l'ordine muore da solo — mentre il
 * negozio dorme e nessuno poteva accettarlo. Se era pagato con carta, addebito
 * e rimborso nella stessa notte.
 *
 * ── La regola ───────────────────────────────────────────────────────────────
 * «Fermo da tre ore» ha senso quando la consegna è per adesso. Quando la
 * consegna è per una fascia, la domanda giusta è un'altra: **quella fascia è
 * passata?** Finché la finestra promessa non è finita il negozio può ancora
 * accettare e consegnare in tempo, e annullare distruggerebbe un ordine ancora
 * buono. Quando la finestra è passata senza che nessuno l'abbia accettato,
 * l'appuntamento è saltato per davvero: lì l'ordine si annulla, come prima.
 *
 * ── L'invariante che tiene in piedi la ricerca del lavoro notturno ──────────
 * La scadenza non è MAI prima di `created_at + ORE_PER_ACCETTARE` (c'è un
 * `Math.max`). Questo permette al cron di continuare a scremare in SQL con
 * `created_at < adesso − 3h`: un ordine che quel filtro scarta non poteva
 * comunque essere scaduto. Se un giorno la regola qui dentro potesse scadere
 * PRIMA delle tre ore, quel filtro comincerebbe a saltare ordini da annullare.
 *
 * 🟢 Puro: nessuna rete. L'ora di «adesso» si passa da fuori, così una prova
 * può mettersi alle 00:15 senza aspettare le 00:15.
 */

/** Ore minime che il venditore ha comunque per accettare, qualunque sia la fascia. */
export const ORE_PER_ACCETTARE = 3;

export type FinestraDiConsegna = {
  /** La consegna è per il giorno dopo quello in cui l'ordine è nato. */
  domani: boolean;
  daMinuti: number;
  /** La fine della finestra, in minuti dalla mezzanotte del giorno di consegna. */
  aMinuti: number;
};

/**
 * La fascia scritta sull'ordine, letta come giorno + finestra.
 *
 * Le etichette le scrive `lib/quando-arriva.ts` («Domani · 9:00–12:00»,
 * «Stasera · 18:00–20:00», «Adesso · arrivo in …»). `leggiFasciaConsegna` in
 * `lib/store-hours.ts` fa metà di questo lavoro, ma di proposito risponde solo
 * su «domani»: a lei serve sapere se guardare gli orari di domani, qui serve
 * anche la fine delle fasce di oggi.
 *
 * `null` = non c'è nessun appuntamento da rispettare (ritiro, consegna
 * immediata, fascia che non si sa leggere): vale la regola delle tre ore.
 */
export function finestraDellaFascia(etichetta?: string | null): FinestraDiConsegna | null {
  const testo = String(etichetta ?? '').trim();
  if (!testo) return null;
  const domani = /domani/i.test(testo);
  // Il trattino delle etichette è quello lungo (–), ma si accettano anche il
  // trattino normale e quello medio, come fa già `leggiFasciaConsegna`.
  const orari = testo.match(/(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/);
  if (!orari) {
    // «Domani» senza orari: l'appuntamento è comunque domani, e finisce con la
    // giornata. «Adesso · arrivo in 30-60 min» non ha orari e non dice domani:
    // resta la regola delle tre ore.
    return domani ? { domani: true, daMinuti: 0, aMinuti: 24 * 60 } : null;
  }
  const da = Number(orari[1]) * 60 + Number(orari[2]);
  const a = Number(orari[3]) * 60 + Number(orari[4]);
  return { domani, daMinuti: da, aMinuti: Math.max(da, a) };
}

type OrdineDaScadere = {
  created_at?: string | Date | null;
  delivery_slot?: string | null;
};

/**
 * L'istante oltre il quale un ordine mai accettato va annullato.
 *
 * `null` quando la data di nascita non si può leggere: in quel caso non c'è
 * niente da rinviare e decide chi chiama (nel cron: si annulla come prima).
 */
export function scadenzaAccettazione(
  ordine: OrdineDaScadere,
  oreMinime: number = ORE_PER_ACCETTARE,
): Date | null {
  const nato = ordine.created_at ? new Date(ordine.created_at) : null;
  if (!nato || Number.isNaN(nato.getTime())) return null;

  const minimo = nato.getTime() + oreMinime * 3_600_000;
  const finestra = finestraDellaFascia(ordine.delivery_slot);
  if (!finestra) return new Date(minimo);

  // Quanto manca dalla nascita dell'ordine alla fine della finestra promessa.
  // Si conta in DURATA, non costruendo una data locale: gli orari delle fasce
  // sono l'orologio da parete italiano mentre `created_at` è un istante UTC, e
  // una differenza di minuti attraversa i due mondi senza conversioni. (Nelle
  // due notti in cui l'ora legale cambia il conto balla di un'ora: su una
  // finestra di consegna non sposta niente.)
  const oraItaliana = romeNow(nato);
  const minutiDallaMezzanotte = oraItaliana.getHours() * 60 + oraItaliana.getMinutes();
  const minutiAllaFineDellaFinestra =
    (finestra.domani ? 24 * 60 : 0) + finestra.aMinuti - minutiDallaMezzanotte;

  return new Date(Math.max(minimo, nato.getTime() + minutiAllaFineDellaFinestra * 60_000));
}

/**
 * L'ordine è ancora nei tempi, cioè NON va annullato adesso?
 *
 * È la domanda che fa il lavoro notturno prima di toccare un ordine.
 */
export function ancoraNeiTempi(ordine: OrdineDaScadere, adesso: Date = new Date()): boolean {
  const scadenza = scadenzaAccettazione(ordine);
  if (!scadenza) return false;
  return adesso.getTime() < scadenza.getTime();
}
