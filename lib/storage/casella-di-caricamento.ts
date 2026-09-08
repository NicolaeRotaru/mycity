/**
 * LA CASELLA DOVE SI TRASCINANO LE FOTO: cosa lascia entrare, e cosa dice a chi resta fuori.
 *
 * ── Il difetto che ha prodotto questo file ───────────────────────────────────────────────────
 * Le due caselle della vetrina del negoziante (`components/seller/site/GalleryFields.tsx` e
 * `SingleImageUpload` dentro `ImageUpload.tsx`) si scrivevano addosso, a mano, l'elenco dei file
 * che accettano:
 *
 *     accept: { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] }
 *
 * Tre tipi. Il magazzino `products`, dove quelle foto finiscono davvero, ne accetta SETTE
 * (`migrations/070_storage_and_rls_hardening.sql`, oggi in `lib/storage/regole-secchi.ts`), e fra
 * i quattro che mancavano ci sono HEIC e HEIF — cioe' il formato con cui un iPhone scatta le foto
 * senza chiedere niente a nessuno.
 *
 * ── Perche' era GRAVE e non fastidioso ──────────────────────────────────────────────────────
 * `react-dropzone` non protesta: divide i file in due mucchi e passa a `onDrop` gli accettati come
 * primo argomento e gli scartati come SECONDO. Le due caselle il secondo argomento non lo
 * guardavano nemmeno. Esito misurato sul codice l'8/9/2026: il negoziante trascina la foto del suo
 * negozio scattata col telefono e **non succede niente**. Nessun messaggio, nessuna anteprima,
 * nessun errore nella console. Non ha modo di capire se ha sbagliato lui, se sta caricando, o se
 * il sito e' rotto. La reazione normale e' riprovare due volte e poi lasciare la vetrina vuota.
 *
 * ── Perche' la cura sta qui e non dentro i due componenti ───────────────────────────────────
 * Sono le stesse DUE malattie, e vanno chiuse tutte e due o si ripresentano:
 *
 *   ① l'elenco dei tipi ricopiato a mano. `mappaAccept()` lo costruisce dalla regola del magazzino
 *     (`regolaDelSecchio`), che e' la casa unica nata l'8/9. Il giorno che il deposito accetta un
 *     tipo in piu', le caselle lo accettano insieme a lui, senza che nessuno si ricordi di
 *     aggiornarle. E un tipo nuovo dichiarato senza estensione qui sotto fa LANCIARE `mappaAccept`
 *     invece di nascere zitto: sull'estensione si gioca tutto il caso HEIC (vedi sotto).
 *
 *   ② il silenzio. `decidiCosaFareDelDrop()` e' il cervello di `onDrop`: prende i due mucchi che
 *     `react-dropzone` consegna, decide quali file partono e restituisce **la frase da mostrare**.
 *     La proprieta' che la prova accanto esegue e' una sola e non ammette eccezioni: *se qualcosa
 *     e' rimasto fuori, l'avviso non e' mai vuoto* — anche davanti a un codice d'errore che oggi
 *     non esiste. E' l'unico modo di chiudere «e non lo dicono a nessuno» in un modo che non torni
 *     al prossimo codice d'errore aggiunto da react-dropzone.
 *
 * 🟢 Modulo PURO: nessuna rete, nessun file, nessun React, nessun orologio. Una prova puo'
 *    ESEGUIRLO — che e' esattamente cio' che non si poteva fare finche' la decisione viveva dentro
 *    un `useDropzone` in un componente client.
 */

import { SECCHIO_PUBBLICO } from './percorso-caricamento';
import { regolaDelSecchio } from './regole-secchi';

/**
 * L'ESTENSIONE DI OGNI TIPO, e non e' un di piu': e' meta' della riparazione.
 *
 * `react-dropzone` giudica con `attr-accept`, che guarda `file.type` e, se quello e' vuoto,
 * ripiega sul nome del file. E `file.type` di un HEIC e' vuoto piu' spesso di quanto sembri:
 * Windows e diversi browser desktop non conoscono il tipo MIME di HEIC/HEIF e consegnano stringa
 * vuota. Senza `.heic` scritto qui, un iPhone photo trascinata da un PC resterebbe fuori anche
 * dopo aver aggiunto `image/heic` alla lista dei tipi — cioe' il difetto sarebbe «riparato» e
 * l'utente vedrebbe ancora esattamente niente.
 *
 * Le chiavi devono coprire `TIPI_IMMAGINE` di `regole-secchi.ts`. Se un tipo nuovo arriva la'
 * senza passare di qui, `mappaAccept()` lancia: e' voluto.
 */
export const ESTENSIONI_DEI_TIPI: Readonly<Record<string, readonly string[]>> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/avif': ['.avif'],
  'image/heic': ['.heic'],
  'image/heif': ['.heif'],
};

/**
 * L'oggetto `accept` di `react-dropzone`, costruito dalla regola del magazzino.
 *
 * Forma: `{ 'image/jpeg': ['.jpg', '.jpeg'], … }`. E' diversa dalla stringa di `attributoAccept()`
 * (che serve all'attributo `accept=` di un `<input type="file">` normale) e per questo vive qui:
 * la sostanza — quali file passano — resta una sola, la forma cambia con lo strumento.
 */
export function mappaAccept(secchio: string = SECCHIO_PUBBLICO): Record<string, string[]> {
  const mappa: Record<string, string[]> = {};
  for (const tipo of regolaDelSecchio(secchio).tipiAmmessi) {
    const estensioni = ESTENSIONI_DEI_TIPI[tipo];
    if (!estensioni || estensioni.length === 0) {
      throw new Error(
        `il tipo «${tipo}» e' ammesso dal magazzino «${secchio}» ma non ha estensione dichiarata ` +
          `in lib/storage/casella-di-caricamento.ts: senza estensione un file che arriva col tipo ` +
          `vuoto (succede con HEIC su Windows) resterebbe fuori in silenzio`,
      );
    }
    mappa[tipo] = [...estensioni];
  }
  return mappa;
}

/**
 * Gli stessi valori appiattiti, come li appiattisce `react-dropzone` prima di passarli ad
 * `attr-accept`: prima il tipo, poi le sue estensioni, tutto in fila.
 *
 * ⚠️ E' una COPIA di `acceptPropAsAcceptAttr` di react-dropzone, e va detto: i suoi `exports` non
 * lasciano importare i sotto-moduli, quindi la prova accanto non puo' eseguire la funzione vera.
 * L'operazione pero' e' questa, tre righe, e la prova la da' in pasto ad `attr-accept` — che
 * invece e' la libreria vera, quella che nel browser decide davvero.
 */
export function elencoAccept(secchio: string = SECCHIO_PUBBLICO): string[] {
  return Object.entries(mappaAccept(secchio)).flatMap(([tipo, estensioni]) => [tipo, ...estensioni]);
}

/**
 * I formati detti come li direbbe una persona: «JPG, PNG, WEBP, GIF, AVIF, HEIC o HEIF».
 *
 * Nasce dalle estensioni della regola, non da una frase scritta a mano: il giorno che il magazzino
 * cambia idea, la frase che l'utente legge cambia con lui invece di diventare una bugia gentile.
 */
export function tipiScrittiPerUmani(secchio: string = SECCHIO_PUBBLICO): string {
  const viste = new Set<string>();
  for (const estensioni of Object.values(mappaAccept(secchio))) {
    viste.add(estensioni[0].replace('.', '').toUpperCase());
  }
  const elenco = [...viste];
  if (elenco.length === 1) return elenco[0];
  return `${elenco.slice(0, -1).join(', ')} o ${elenco[elenco.length - 1]}`;
}

/**
 * IL TIPO VERO DEL FILE, quando il browser non lo sa dire — ed è la seconda metà del caso HEIC.
 *
 * ── Perché senza questo la riparazione era finta ────────────────────────────────────────────
 * Far entrare l'HEIC nella casella non basta a farlo arrivare nel magazzino. Nel browser il client
 * Supabase impacchetta il file in una `FormData` e **non usa** il `contentType` che gli passi: il
 * tipo che viaggia è quello del `File`, e per un file con `type` vuoto lo standard impone
 * `application/octet-stream`. Il deposito confronta quello con la sua lista di sette tipi, non lo
 * trova, e rifiuta.
 *
 * Cioè: HEIC trascinato da un telefono (che il tipo lo dichiara) → passava. Lo STESSO file
 * trascinato da un PC — Windows e diversi browser desktop il MIME di HEIC non lo conoscono e
 * consegnano stringa vuota → entrava nella casella e veniva respinto dal deposito, con in mano un
 * errore dello storage in inglese. Un difetto silenzioso scambiato per uno rumoroso: non è chiuso.
 *
 * Qui il tipo si deduce dall'estensione, ma **solo** dentro la lista del magazzino: se l'estensione
 * non è fra quelle ammesse la funzione risponde stringa vuota e non inventa niente. Non è un modo
 * per far entrare di straforo un file che il deposito rifiuta — è il modo di non perdere un file
 * che il deposito accetta.
 */
export function tipoDedotto(
  nomeFile: string,
  tipoDichiarato?: string | null,
  secchio: string = SECCHIO_PUBBLICO,
): string {
  const mappa = mappaAccept(secchio);
  const dichiarato = String(tipoDichiarato ?? '').trim().toLowerCase();
  // Se il browser il tipo lo sa, comanda lui: non si indovina sopra a un dato vero.
  if (dichiarato && Object.prototype.hasOwnProperty.call(mappa, dichiarato)) return dichiarato;
  const nome = String(nomeFile ?? '').toLowerCase();
  for (const [tipo, estensioni] of Object.entries(mappa)) {
    if (estensioni.some((e) => nome.endsWith(e))) return tipo;
  }
  return '';
}

/**
 * Lo stesso file, ma col tipo scritto sopra — o quello di prima se non c'era niente da correggere.
 *
 * Ricostruire il `File` è l'unico punto in cui si può intervenire: il tipo che parte è quello
 * dell'oggetto, non un'opzione della chiamata. Il contenuto non viene copiato — `new File` tiene i
 * pezzi per riferimento — quindi non costa memoria nemmeno su una foto da 10 MB.
 */
export function fileColTipoGiusto(file: File, secchio: string = SECCHIO_PUBBLICO): File {
  const giusto = tipoDedotto(file?.name, file?.type, secchio);
  if (!giusto || giusto === String(file.type ?? '').toLowerCase()) return file;
  return new File([file], file.name, { type: giusto, lastModified: file.lastModified });
}

/**
 * Il tetto di peso del magazzino, in byte, da dare a `maxSize` della casella.
 *
 * Perche' passa di qui e non da `regolaDelSecchio` diretto: cosi' un componente che apre una
 * casella importa UNA riga sola, e non ha nessun motivo per conoscere il nome del magazzino ne'
 * per riscriversi un numero. Il tetto e' lo stesso che poi applica la porta dei caricamenti — qui
 * serve solo ad accorgersene prima, senza far partire il file.
 */
export function pesoMassimo(secchio: string = SECCHIO_PUBBLICO): number {
  return regolaDelSecchio(secchio).maxByte;
}

/** Come `react-dropzone` consegna uno scarto: il file, e i motivi per cui non e' entrato. */
export interface ScartoDellaCasella {
  file?: { name?: string } | null;
  errors?: readonly { code?: string; message?: string }[] | null;
}

export interface EsitoDelDrop<T> {
  /** I file che partono davvero verso il deposito. */
  daCaricare: T[];
  /** La frase da mostrare, o `null` SOLO se non e' rimasto fuori niente. */
  avviso: string | null;
}

export interface OpzioniDelDrop {
  /** Quanti file ci stanno ancora. Sotto 1 non entra piu' niente. */
  postiLiberi: number;
  /** Il magazzino, per dire il tetto giusto e i formati giusti nella frase. */
  secchio?: string;
}

/** Un nome di file da mettere in una frase: accorciato, e mai vuoto. */
function nomeLeggibile(scarto: ScartoDellaCasella): string {
  const grezzo = String(scarto?.file?.name ?? '').trim();
  if (!grezzo) return 'un file senza nome';
  return grezzo.length > 40 ? `${grezzo.slice(0, 37)}…` : grezzo;
}

/** «a.svg», «a.svg e b.txt», «a.svg, b.txt e altri 3». */
function elencaNomi(scarti: readonly ScartoDellaCasella[]): string {
  const nomi = scarti.map(nomeLeggibile);
  if (nomi.length === 1) return `«${nomi[0]}»`;
  if (nomi.length === 2) return `«${nomi[0]}» e «${nomi[1]}»`;
  return `«${nomi[0]}», «${nomi[1]}» e altri ${nomi.length - 2}`;
}

function codiciDi(scarto: ScartoDellaCasella): string[] {
  return (scarto?.errors ?? []).map((e) => String(e?.code ?? '')).filter(Boolean);
}

/**
 * IL CERVELLO DI `onDrop`, tolto da dentro i componenti perche' una prova potesse eseguirlo.
 *
 * Riceve i due mucchi che `react-dropzone` consegna e restituisce che cosa parte e che cosa si
 * dice. La regola che non ammette eccezioni: **se qualcosa e' rimasto fuori — scartato dalla
 * casella o troncato perche' i posti erano finiti — `avviso` non e' `null`**. Anche per un codice
 * d'errore che oggi non esiste: il ramo finale non e' una cortesia, e' l'unico che impedisce al
 * silenzio di tornare quando react-dropzone aggiunge il quinto codice.
 */
export function decidiCosaFareDelDrop<T>(
  accettati: readonly T[],
  scartati: readonly ScartoDellaCasella[],
  { postiLiberi, secchio = SECCHIO_PUBBLICO }: OpzioniDelDrop,
): EsitoDelDrop<T> {
  const entrati = accettati ?? [];
  const fuori = (scartati ?? []).filter(Boolean);

  const posti = Math.max(0, Math.floor(postiLiberi));
  const daCaricare = entrati.slice(0, posti);
  const troncati = entrati.length - daCaricare.length;

  const frasi: string[] = [];

  // ① Formato sbagliato. E' il caso per cui esiste questo file: prima l'HEIC finiva qui dentro e
  //    nessuno lo diceva. Adesso ci finisce solo cio' che il deposito rifiuterebbe davvero.
  const perTipo = fuori.filter((s) => codiciDi(s).includes('file-invalid-type'));
  if (perTipo.length > 0) {
    frasi.push(
      `${elencaNomi(perTipo)}: questo formato non lo accettiamo. ` +
        `Puoi caricare ${tipiScrittiPerUmani(secchio)}.`,
    );
  }

  // ② Troppo pesante. La stessa frase che dice la porta dei caricamenti quando lo scopre lei:
  //    due strade, un messaggio solo, cosi' l'utente non impara due volte la stessa cosa.
  const perPeso = fuori.filter((s) => codiciDi(s).includes('file-too-large'));
  if (perPeso.length > 0) {
    const mb = Math.round(regolaDelSecchio(secchio).maxByte / (1024 * 1024));
    frasi.push(
      `${elencaNomi(perPeso)}: ${perPeso.length === 1 ? 'è troppo pesante' : 'sono troppo pesanti'}, ` +
        `il limite è ${mb} MB. Riducila o scattane un'altra.`,
    );
  }

  // ③ Troppi in una volta (lo dice react-dropzone quando la casella ne vuole uno solo).
  const perQuantita = fuori.filter((s) => codiciDi(s).includes('too-many-files'));
  if (perQuantita.length > 0) {
    frasi.push(
      posti === 1
        ? 'Qui ci sta una foto sola: trascinane una per volta.'
        : `Ne puoi caricare al massimo ${posti} alla volta.`,
    );
  }

  // ④ TUTTO IL RESTO, compreso cio' che non esiste ancora. Senza questo ramo il silenzio torna da
  //    solo il giorno che react-dropzone inventa un codice nuovo: e' il difetto, non un dettaglio.
  const noti = new Set(['file-invalid-type', 'file-too-large', 'too-many-files']);
  const altri = fuori.filter((s) => !codiciDi(s).some((c) => noti.has(c)));
  if (altri.length > 0) {
    frasi.push(
      `${elencaNomi(altri)}: non ${altri.length === 1 ? 'è stato caricato' : 'sono stati caricati'}. ` +
        "Riprova, o scegli un'altra foto.",
    );
  }

  // ⑤ I posti finiti. Il vecchio codice li tagliava con uno `slice` e non lo diceva a nessuno.
  if (troncati > 0) {
    const quante = troncati === 1 ? 'una foto' : `${troncati} foto`;
    frasi.push(
      posti === 0
        ? "Non c'è più posto: rimuovi una foto prima di aggiungerne altre."
        : posti === 1
          ? `Qui ci sta una foto sola: ho tenuto la prima e lasciato fuori ${quante}.`
          : `Ci stanno ancora ${posti} foto: ho tenuto le prime ${posti} e lasciato fuori ${quante}.`,
    );
  }

  return { daCaricare, avviso: frasi.length > 0 ? frasi.join(' ') : null };
}

/**
 * La frase per `onDropRejected`, che e' la convenzione gia' in casa.
 *
 * ⚠️ PERCHE' DUE PORTE E NON UNA. `react-dropzone` chiama `onDrop` sempre e `onDropRejected` solo
 * quando ha buttato fuori qualcosa, e il guardiano
 * `tests/unit/un-riquadro-che-scarta-un-file-lo-dice.test.ts` — nato il 6/9/2026 dallo stesso
 * difetto — pretende che ogni casella con un limite abbia un `onDropRejected` che parla. Le due
 * porte si dividono il lavoro senza sovrapporsi: **gli scartati li racconta questa**, i file buoni
 * tagliati perche' i posti erano finiti li racconta `decidiCosaFareDelDrop` dentro `onDrop`. Se le
 * mettessimo tutte e due nello stesso posto, chi trascina si prenderebbe lo stesso avviso due volte.
 */
export function avvisoPerGliScartati(
  scartati: readonly ScartoDellaCasella[],
  opzioni: OpzioniDelDrop,
): string | null {
  return decidiCosaFareDelDrop([], scartati, opzioni).avviso;
}
