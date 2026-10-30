import { finestraDellaFascia } from '@/lib/quando-arriva';
import { romeNow, ultimoRitiroDellaFascia } from '@/lib/store-hours';
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

/*
 * 30/10/2026 (ondata 23) — LA FASCIA SI LEGGE DALLA CASA UNICA.
 *
 * Qui c'era un `finestraDellaFascia` suo, omonimo di quello di `lib/quando-arriva.ts` e con regole
 * diverse: cercava la parola «domani» e due orari dentro il testo, quindi leggeva come fascia
 * anche un'etichetta che la cassa non propone e le rotte rifiutano («Domani · 10:00–14:00»), e su
 * quella spostava la scadenza. Adesso giorno e minuti vengono dalla tabella che scrive le
 * etichette: un'etichetta che non è una fascia nota non sposta niente, vale la regola delle tre ore.
 */

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
 * È l’ora del giro notturno; il negozio legge `entroQuandoAccettare` (l’ultimo ritiro possibile, qui sotto). La regola delle tre ore resta solo
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
  return istanteDiParete(nato, finestra.giorno === 'domani' ? 1 : 0, Math.max(finestra.daMinuti, finestra.aMinuti));
}

/**
 * L'istante UTC di un'ora da parete di Piacenza: `minuti` dalla mezzanotte del giorno di Piacenza
 * della nascita, più `piuGiorni`.
 */
function istanteDiParete(nato: Date, piuGiorni: number, minuti: number): Date {
  const [anno, mese, giorno] = giornoPiacenza(nato).split('-').map(Number);
  // L'ora letta come se Piacenza fosse UTC; poi si toglie lo scarto del fuso.
  // Due passate: lo scarto giusto è quello dell'istante vero, non di quello «finto UTC».
  const comeSeFosseUtc = Date.UTC(anno, mese - 1, giorno + piuGiorni, 0, minuti);
  let istante = comeSeFosseUtc - scartoFusoMinuti(new Date(comeSeFosseUtc)) * 60_000;
  istante = comeSeFosseUtc - scartoFusoMinuti(new Date(istante)) * 60_000;
  return new Date(istante);
}

/**
 * 30/10/2026 (ondata 23) — ENTRO QUANDO IL NEGOZIO DEVE ACCETTARE: L'ULTIMO RITIRO POSSIBILE.
 *
 * Il difetto: l'ora detta al negozio era la FINE della fascia. Con la regola del ritiro (ondata
 * 22) la merce si ritira quando il negozio è aperto, anche prima della fascia. Lunedì alle 12:00
 * Maria ordina da Pane Quotidiano (9-13, 16:30-19:30) per «Oggi · 13:00–16:30»: il forno chiude
 * alle 13 e riapre alle 16:30, quindi la spesa si ritira entro le 12:45. Il forno però leggeva
 * «accettalo entro le 16:30», e se accettava alle 14 nessuno poteva più ritirarla.
 *
 * La regola: l'ora è l'ultimo momento in cui il ritiro per quella fascia si può ancora cominciare,
 * dalla STESSA funzione delle rotte e della cassa (`ultimoRitiroDellaFascia` in lib/store-hours.ts),
 * col quarto d'ora di negozio aperto. Il minuto dell'ultimo ritiro vale tutto (le rotte leggono i
 * minuti, non i secondi): «entro le 12:45» regge fino alle 12:45:59. Se il negozio è aperto di fila
 * fino alla fine della fascia, l'ora resta la fine della fascia, come prima.
 *
 * Senza orari del negozio (`orari` non passato o mai impostato), con la veloce o senza una fascia
 * leggibile: la fine della fascia, come prima. `null` senza fascia.
 */
export function entroQuandoAccettare(ordine: OrdineDaScadere, orari?: unknown): Date | null {
  const fine = fineDellaFascia(ordine);
  if (!fine || !ordine.created_at) return fine;
  const nato = new Date(ordine.created_at);
  const ritiro = ultimoRitiroDellaFascia(orari, ordine.delivery_slot, romeNow(nato));
  if (!ritiro || ritiro.apertoFinoAllaFine) return fine;
  const inizio = istanteDiParete(nato, ritiro.giorno === 'domani' ? 1 : 0, ritiro.minuto);
  return new Date(Math.min(fine.getTime(), inizio.getTime() + 59_999));
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
export function rigaScadenzaPerIlNegozio(
  ordine: OrdineDaScadere,
  adesso: Date = new Date(),
  /** Gli orari del negozio (`profiles.store_hours`): senza, l'ora resta la fine della fascia. */
  orari?: unknown,
): string | null {
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
      // Niente «passa alla prima fascia oraria libera» detto come certo: sabato sera, col negozio chiuso
      // la domenica, il freno non trova nessuna fascia e l'ordine resta com'è (nonSiSposta).
      return (
        `È una consegna veloce: accettala entro le ${oraDaParete(freno)}. ` +
        `Dopo ${MINUTI_PER_CONFERMARE_LA_VELOCE} minuti senza conferma la veloce cade: se c’è una fascia oraria libera la spesa passa lì da sola.`
      );
    }
    return (
      `Sono passati i ${MINUTI_PER_CONFERMARE_LA_VELOCE} minuti per confermare la consegna veloce: se c’è una fascia ` +
      // Niente «il cliente non paga l'euro della veloce»: quando la veloce è compresa nella spesa
      // piccola non c'è nessun euro da togliere, e se il freno non trova una fascia l'euro resta.
      // Al negozio serve sapere cosa succede all'ordine, non il conto del cliente.
      `oraria libera la spesa passa lì da sola. ${allAnnullo}`
    );
  }
  const entro = entroQuandoAccettare(ordine, orari) ?? annullo;
  if (adesso.getTime() < entro.getTime()) return `Accettalo o rifiutalo entro ${scadenzaLeggibile(entro, adesso)}.`;
  const fine = fineDellaFascia(ordine);
  if (fine && adesso.getTime() < fine.getTime()) {
    // L'ultimo ritiro è passato ma la fascia no: il negozio ha chiuso (o chiude) prima della fascia.
    return `Il negozio chiude prima della fascia e il tempo per preparare la spesa è finito: accettalo solo se può partire subito, altrimenti rifiutalo. ${allAnnullo}`;
  }
  return `La fascia di consegna è finita: accettalo solo se puoi consegnarlo subito, altrimenti rifiutalo. ${allAnnullo}`;
}

/**
 * 30/10/2026 (collaudo dell'ondata 20) — COME LE PAGINE ORDINI DEL NEGOZIO RILEGGONO GLI ORDINI.
 *
 * La riga di `rigaScadenzaPerIlNegozio` si scrive con l'ora dell'ULTIMA LETTURA. Col telefono
 * bloccato la ricarica automatica si ferma (`refetchIntervalInBackground: false` nel
 * QueryProvider) e al ritorno sulla pagina non si rileggeva niente (`refetchOnWindowFocus: false`,
 * sempre nel QueryProvider): la pagina lasciata aperta venerdì alle 20:30, sabato alle 8:30 diceva
 * ancora «entro le 12:00 di domani» per un ordine che scadeva quella mattina, fino al giro dopo
 * (90 secondi sulla lista, 30 sul dettaglio) — e mostrava anche gli ordini di ieri sera, magari
 * già annullati di notte.
 *
 * `always` e non `true`: con `true` si rilegge solo se il dato ha più di 30 secondi (staleTime del
 * QueryProvider), e quattro secondi a cavallo della fine della fascia bastano per dire «entro le
 * 12:00 di oggi» alle 12:00:01. Il costo è una lettura ogni volta che il negoziante torna sulla
 * pagina; da nascosta continua a non leggere niente.
 * Prova: tests/unit/entro-quando-accettare-si-rilegge-quando-il-telefono-si-riapre.test.tsx
 */
export const LETTURA_ORDINI_DEL_NEGOZIO = { refetchOnWindowFocus: 'always' } as const;
