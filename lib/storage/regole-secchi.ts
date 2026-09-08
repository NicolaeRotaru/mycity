/**
 * OGNI MAGAZZINO HA UNA REGOLA, E LA REGOLA HA UNA CASA SOLA.
 *
 * ── Il difetto che ha prodotto questo file ───────────────────────────────────────────────────
 * Quattro magazzini di file — `products`, `reviews`, `stories`, `cod-proof` — hanno tutti la
 * stessa forma di regola scritta in SQL: la PRIMA cartella del percorso dev'essere
 * l'identificativo di chi carica. Ma le tre cose che contano — quali tipi di file passano, quanto
 * possono pesare, e se esiste un'eccezione per lo staff — NON sono uguali fra loro, e nel codice
 * non erano scritte da nessuna parte: erano ricopiate a mano in ogni schermata che carica.
 *
 * Il conto vero, misurato sul codice l'8/9/2026:
 *
 *   · `components/PhotoReviewUpload.tsx` diceva 5 MB e tre tipi di file. Il deposito ne accetta
 *     10 MiB e sette. Il cliente si prendeva un rifiuto per una foto che il deposito avrebbe
 *     preso, e la frase «tieniti sotto i 5 MB» era semplicemente falsa.
 *   · `app/seller/stories/page.tsx` non guardava affatto il peso, e l'estensione del file salvato
 *     la sceglieva il nome del file di chi carica.
 *   · `components/rider/CashConfirmDialog.tsx` non guardava ne' il tipo ne' il peso — e il suo
 *     magazzino, `cod-proof`, e' l'UNICO dei quattro che nel deposito non ha ne' tetto di peso ne'
 *     lista di tipi (`migrations/114_hardening_radiografia.sql` lo crea nudo). Li' dentro il
 *     fattorino poteva mettere qualunque file di qualunque peso: ne' il codice ne' il database lo
 *     fermavano.
 *   · e la porta `caricaImmagine` concedeva la cartella dello staff (`home`) su TUTTI i magazzini,
 *     mentre in SQL la concede solo `products`. Un caricamento dello staff su `reviews` sarebbe
 *     partito dal codice e sarebbe stato respinto dal database.
 *
 * Non e' che chi ha scritto quei punti fosse distratto: non c'era niente da chiamare. Con la
 * regola ricopiata a mano in ogni schermata, che una copia resti indietro non e' sfortuna — e'
 * l'esito atteso, ed e' successo su tre magazzini su quattro.
 *
 * ── Perche' la cura sta qui e non dentro i componenti ────────────────────────────────────────
 * Un magazzino nuovo, o un punto di caricamento nuovo, non puo' piu' inventarsi la sua regola:
 * `regolaDelSecchio()` si RIFIUTA di rispondere su un magazzino che non e' dichiarato qui sotto.
 * Non e' che sbagliare diventa improbabile: diventa una cosa che non si puo' dire senza aggiungere
 * una riga in questo file, che e' una modifica visibile in una revisione.
 *
 * 🟢 Modulo PURO: nessuna rete, nessun file, nessun orologio. Una prova puo' ESEGUIRLO.
 */

import { SECCHIO_PUBBLICO } from './percorso-caricamento';

/**
 * I SETTE TIPI CHE I DEPOSITI IMMAGINE ACCETTANO DAVVERO.
 *
 * Copia esatta di `migrations/070_storage_and_rls_hardening.sql` (secchi `products`, `reviews`,
 * `stories`). Comprende HEIC/HEIF, che e' quello che scatta un iPhone; esclude SVG, che e' un
 * documento eseguibile travestito da immagine.
 */
export const TIPI_IMMAGINE = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
] as const;

/** 10 MiB: e' il `file_size_limit` scritto nei depositi immagine. */
export const DIECI_MIB = 10 * 1024 * 1024;

export interface RegolaSecchio {
  /** Il nome del magazzino, come lo conosce il deposito. */
  nome: string;
  /** I tipi che passano. Un file fuori da questa lista non parte nemmeno. */
  tipiAmmessi: readonly string[];
  /** Il tetto di peso, in byte. */
  maxByte: number;
  /**
   * La cartella `home` dello staff: la concede SOLO `products`
   * (`migrations/114_hardening_radiografia.sql`). Altrove il database la rifiuta.
   */
  cartellaStaffAmmessa: boolean;
  /** Se chiunque conosca l'indirizzo puo' leggere il file. Su un magazzino privato non esiste. */
  pubblico: boolean;
  /**
   * Il tetto e la lista dei tipi valgono anche DENTRO il deposito, o li tiene solo il codice?
   *
   * Quando e' `false` il codice e' l'unica difesa: chi scavalca la porta (una chiamata a
   * `.upload()` scritta a mano, o una chiave usata da fuori) carica quello che vuole.
   */
  tettoNelDeposito: boolean;
  /**
   * Se il deposito non ha ancora il tetto, QUALE migrazione glielo dara'. Non e' un promemoria:
   * la prova qui accanto pretende che il file esista e che i suoi numeri combacino con questi.
   */
  migrazioneCheLoDara?: string;
}

/**
 * I QUATTRO MAGAZZINI, e cosa ognuno accetta davvero. Le fonti sono citate riga per riga perche'
 * il giorno in cui una migrazione cambia, questa tabella diventa una bugia — e la prova accanto
 * (`la-regola-di-ogni-magazzino-sta-in-un-posto-solo.test.ts`) rilegge l'SQL e diventa rossa.
 */
const REGOLE: Record<string, RegolaSecchio> = {
  // Le foto di prodotto, i loghi, le copertine, le immagini della home.
  products: {
    nome: 'products',
    tipiAmmessi: TIPI_IMMAGINE,
    maxByte: DIECI_MIB,
    // L'unica eccezione scritta in tutto il sistema: le immagini della home le carica lo staff.
    cartellaStaffAmmessa: true,
    pubblico: true,
    tettoNelDeposito: true,
  },
  // Le foto che un cliente allega a una recensione.
  reviews: {
    nome: 'reviews',
    tipiAmmessi: TIPI_IMMAGINE,
    maxByte: DIECI_MIB,
    cartellaStaffAmmessa: false,
    pubblico: true,
    tettoNelDeposito: true,
  },
  // Le storie del negoziante, che durano 24 ore.
  stories: {
    nome: 'stories',
    tipiAmmessi: TIPI_IMMAGINE,
    maxByte: DIECI_MIB,
    // La scheda del difetto diceva che qui non c'e' vincolo di cartella. Era vero nella 035; la
    // `migrations/119_radiografia_18_agosto.sql` l'ha chiuso: prima cartella = chi carica, come
    // gli altri. Comanda il codice del database, non la scheda.
    cartellaStaffAmmessa: false,
    pubblico: true,
    tettoNelDeposito: true,
  },
  // La foto dei contanti e quella del pacco consegnato. Magazzino PRIVATO: si legge con un link a
  // scadenza, mai con un indirizzo pubblico.
  'cod-proof': {
    nome: 'cod-proof',
    tipiAmmessi: TIPI_IMMAGINE,
    maxByte: DIECI_MIB,
    cartellaStaffAmmessa: false,
    pubblico: false,
    // ⚠️ QUI IL DEPOSITO E' NUDO. La 114 crea il secchio senza `file_size_limit` ne'
    // `allowed_mime_types`: finche' la migrazione qui sotto non e' applicata, l'unica cosa che
    // ferma un file da 300 MB e' il controllo di `caricaImmagine`.
    tettoNelDeposito: false,
    migrazioneCheLoDara: '157_il_magazzino_delle_prove_di_incasso_ha_un_tetto.sql',
  },
};

/** Il magazzino esiste e ha una regola dichiarata? */
export function secchioConosciuto(nome: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGOLE, String(nome));
}

/** Tutti i magazzini dichiarati, per le prove e per gli invarianti di struttura. */
export function secchiConRegola(): RegolaSecchio[] {
  return Object.values(REGOLE);
}

/**
 * La regola di UN magazzino.
 *
 * Su un magazzino non dichiarato NON risponde: e' il punto di tutto il file. Chi ne aggiunge uno
 * deve scriverne qui la regola, e in quel momento decide consapevolmente cosa accetta — invece di
 * ereditare per caso la regola di un altro.
 */
export function regolaDelSecchio(nome: string): RegolaSecchio {
  const r = REGOLE[String(nome)];
  if (!r) {
    throw new Error(
      `magazzino «${nome}» senza regola dichiarata: aggiungila in lib/storage/regole-secchi.ts ` +
        `(tipi ammessi, tetto di peso, cartella dello staff) prima di caricarci dentro.`,
    );
  }
  return r;
}

/**
 * Il valore da mettere in `accept=` sul campo «scegli un file».
 *
 * Nasce dalla stessa lista che poi rifiuta il file: cosi' quello che il campo lascia scegliere e
 * quello che la porta accetta non possono piu' dire due cose diverse. E' questa la divergenza che
 * sulla schermata delle recensioni faceva sparire le foto dell'iPhone.
 */
export function attributoAccept(nome: string = SECCHIO_PUBBLICO): string {
  return regolaDelSecchio(nome).tipiAmmessi.join(',');
}

/** Il tetto detto in MB, per scriverlo nella frase che legge chi carica. */
export function tettoInMB(nome: string = SECCHIO_PUBBLICO): number {
  return Math.round(regolaDelSecchio(nome).maxByte / (1024 * 1024));
}
