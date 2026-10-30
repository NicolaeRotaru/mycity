import { romeNow } from '@/lib/store-hours';
import { giornoPiacenza, scartoFusoMinuti } from '@/lib/tempo-piacenza';

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
  const fine = fineDellaFascia(ordine);
  return new Date(fine ? Math.max(minimo, fine.getTime()) : minimo);
}

/**
 * La fine della fascia promessa, come istante; `null` senza una fascia leggibile («Adesso», ritiro).
 * È l'ora che il negozio legge come «entro quando accettare»: la regola delle tre ore resta solo
 * nel giro notturno (`scadenzaAccettazione`), che annulla dopo.
 *
 * Gli orari delle fasce sono l'orologio da parete di Piacenza, `created_at` è un istante UTC.
 * 30/10/2026 (collaudo dell'ondata 17) — prima si contava in DURATA dai minuti di parete della
 * nascita: nelle due notti in cui l'ora legale cambia il conto sbagliava di un'ora, e al negozio
 * l'email diceva «entro le 13:00» (marzo) o «entro le 11:00» (ottobre) su una fascia 9-12.
 * Adesso si prende il giorno di Piacenza della nascita (più uno per «Domani»), l'ora di fine
 * della fascia su quel giorno, e la si converte in UTC con lo scarto del fuso di QUEL momento.
 */
export function fineDellaFascia(ordine: OrdineDaScadere): Date | null {
  const nato = ordine.created_at ? new Date(ordine.created_at) : null;
  if (!nato || Number.isNaN(nato.getTime())) return null;
  const finestra = finestraDellaFascia(ordine.delivery_slot);
  if (!finestra) return null;
  const [anno, mese, giorno] = giornoPiacenza(nato).split('-').map(Number);
  // La fine della fascia letta come se Piacenza fosse UTC; poi si toglie lo scarto del fuso.
  // Due passate: lo scarto giusto è quello dell'istante vero, non di quello «finto UTC».
  const comeSeFosseUtc = Date.UTC(anno, mese - 1, giorno + (finestra.domani ? 1 : 0), 0, finestra.aMinuti);
  let istante = comeSeFosseUtc - scartoFusoMinuti(new Date(comeSeFosseUtc)) * 60_000;
  istante = comeSeFosseUtc - scartoFusoMinuti(new Date(istante)) * 60_000;
  return new Date(istante);
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

/**
 * 30/10/2026 — IL SECONDO FRENO DELLA VELOCE (carta #220, scelta di Nicola delle 16:13).
 *
 * La veloce promette 30-60 minuti DALLA CONFERMA del negozio. Se il negozio non conferma entro
 * questi minuti la promessa non si può più mantenere: il carrello passa alla prima fascia ancora
 * possibile e l'euro della veloce non si paga (lib/ordini/veloce-non-confermata.ts).
 */
export const MINUTI_PER_CONFERMARE_LA_VELOCE = 10;

/** L'etichetta della veloce, come la scrive lib/quando-arriva.ts («Adesso · arrivo in …»). */
function eFasciaVeloce(etichetta?: string | null): boolean {
  return /^adesso\b/i.test(String(etichetta ?? '').trim());
}

function oraDaParete(d: Date): string {
  const ora = romeNow(d);
  return `${ora.getHours()}:${String(ora.getMinutes()).padStart(2, '0')}`;
}

/**
 * Un istante scritto come lo legge una persona a Piacenza: «le 12:00 di domani», «le 20:00 di
 * oggi», «le 9:00 di lunedì 2/11». Il giorno si conta rispetto ad `adesso`, sull'orologio da
 * parete italiano: l'istante è UTC, la persona legge l'ora di Piacenza.
 */
export function scadenzaLeggibile(quando: Date, adesso: Date = new Date()): string {
  const lui = romeNow(quando);
  const oggi = romeNow(adesso);
  const giorno = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const fra = Math.round((giorno(lui) - giorno(oggi)) / 86_400_000);
  const ora = oraDaParete(quando);
  if (fra === 0) return `le ${ora} di oggi`;
  if (fra === 1) return `le ${ora} di domani`;
  const nome = lui.toLocaleDateString('it-IT', { weekday: 'long' });
  return `le ${ora} di ${nome} ${lui.getDate()}/${lui.getMonth() + 1}`;
}

/**
 * La riga che dice al negoziante entro quando accettare. È la stessa nell'email «Nuovo ordine» e
 * nelle pagine ordini del venditore, perché viene dalla stessa `scadenzaAccettazione` che usa il
 * giro che annulla. Prima l'email diceva «entro 15 minuti» e il sito aspettava tre ore o la fine
 * della fascia: l'ordine della sera per domani mattina sembrava già perso.
 *
 * Per la veloce la scadenza che conta è un'altra: i 10 minuti del freno.
 * `null` quando la nascita dell'ordine non si legge: niente scadenza inventata.
 */
export function rigaScadenzaPerIlNegozio(ordine: OrdineDaScadere, adesso: Date = new Date()): string | null {
  const nato = ordine.created_at ? new Date(ordine.created_at) : null;
  if (!nato || Number.isNaN(nato.getTime())) return null;
  const annullo = scadenzaAccettazione(ordine);
  if (!annullo) return null;
  // 30/10/2026 (ondata 17) — Mai una scadenza già passata: dopo l'ora scritta la riga dice cosa
  // succede adesso. E sulle fasce l'ora da dire è la FINE della fascia, non le tre ore del giro
  // notturno: la veloce spostata su 18:00–20:00 non si accetta alle 20:38.
  if (adesso.getTime() >= annullo.getTime()) return 'Il tempo per accettarlo è finito: l’ordine si sta annullando da solo.';
  const allAnnullo = `Se non fai niente, si annulla da solo alle ${scadenzaLeggibile(annullo, adesso).replace(/^le /, '')}.`;
  if (eFasciaVeloce(ordine.delivery_slot)) {
    const freno = new Date(nato.getTime() + MINUTI_PER_CONFERMARE_LA_VELOCE * 60_000);
    if (adesso.getTime() < freno.getTime()) {
      return (
        `È una consegna veloce: accettala entro le ${oraDaParete(freno)}. ` +
        `Dopo ${MINUTI_PER_CONFERMARE_LA_VELOCE} minuti senza conferma la spesa passa alla prima fascia oraria libera.`
      );
    }
    return (
      `Sono passati i ${MINUTI_PER_CONFERMARE_LA_VELOCE} minuti per confermare la consegna veloce: se c’è una fascia ` +
      `oraria libera la spesa passa lì da sola, e il cliente non paga l’euro della veloce. ${allAnnullo}`
    );
  }
  const entro = fineDellaFascia(ordine) ?? annullo;
  if (adesso.getTime() < entro.getTime()) return `Accettalo o rifiutalo entro ${scadenzaLeggibile(entro, adesso)}.`;
  return `La fascia di consegna è finita: accettalo solo se puoi consegnarlo subito, altrimenti rifiutalo. ${allAnnullo}`;
}
