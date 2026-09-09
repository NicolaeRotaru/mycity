import {
  SECCHIO_PUBBLICO,
  casoNuovo,
  percorsoAmmesso,
  percorsoStaff,
  percorsoUtente,
} from './percorso-caricamento';
import { DIECI_MIB, TIPI_IMMAGINE, regolaDelSecchio } from './regole-secchi';

/**
 * L'UNICA PORTA per caricare nel secchio pubblico — e il punto è che i chiamanti non possano più
 * costruire il percorso da sé.
 *
 * ── Perché una funzione che sa la regola non bastava ─────────────────────────────────────────
 * Il primo tentativo era un modulo che SA quale percorso il database accetta, da chiamare dai nove
 * punti che caricano. Provato: rimettendo a mano la stringa sbagliata dentro un componente, la
 * prova restava verde. Provava che la regola sa giudicare, non che chi carica ci passi — cioè
 * esattamente la distinzione che aveva lasciato passare il difetto in origine.
 *
 * Il commento in cima a `components/seller/site/ImageUpload.tsx` lo dice meglio di me: qualcuno la
 * regola la sapeva, l'ha scritta lì, e quella conoscenza è rimasta dentro quel file. I tre punti
 * rotti sono quelli dove nessuno l'ha ricopiata.
 *
 * Qui il chiamante passa una CARTELLA («logos», «store-media», «events») e non vede mai la prima
 * cartella, quella su cui il database decide. Non è che sbagliarla diventa improbabile: diventa una
 * cosa che non si può dire. E per tornare a sbagliare bisogna riscrivere una chiamata a `.upload()`
 * a mano, che è una modifica visibile in una revisione, non una stringa cambiata di nascosto.
 */

/**
 * Il minimo che serve da un client Supabase: così una prova può passarne uno finto.
 *
 * Il tipo del corpo del file è ELENCATO invece che `unknown`, e non è pedanteria: i parametri di
 * una funzione si confrontano al contrario (contravarianza), quindi con `unknown` il client vero
 * non risulta assegnabile a questa interfaccia e il typecheck si ferma. Qui stanno i corpi che i
 * chiamanti passano davvero — un File dal browser, un Buffer dal server.
 */
export type CorpoFile = File | Blob | ArrayBuffer | Uint8Array;

export interface ClientDiCaricamento {
  storage: {
    from: (secchio: string) => {
      upload: (
        percorso: string,
        file: CorpoFile,
        opzioni?: Record<string, unknown>,
      ) => Promise<{ error: { message: string } | null }>;
      getPublicUrl: (percorso: string) => { data: { publicUrl: string } };
    };
  };
}

export interface RichiestaCaricamento {
  /** Il file da caricare: serve il nome (per l'estensione) e il corpo. */
  file: CorpoFile & { name: string; type?: string };
  /** Chi carica. Obbligatorio salvo che sia un caricamento dello staff. */
  userId?: string | null;
  /** Il raggruppamento dentro la cartella di chi carica: «logos», «site», «store-media», … */
  cartella?: string;
  /** Caricamento dello staff: finisce nella cartella `home`, l'unica eccezione della regola. */
  staff?: boolean;
  secchio?: string;
  upsert?: boolean;
  cacheControl?: string;
  /** Coda leggibile da appendere al nome («bg-white», il nome ripulito del file originale). */
  etichetta?: string;
  /** Tipo dichiarato, quando non è quello del file in ingresso (es. un'immagine rielaborata). */
  contentType?: string;
  /** Iniettabili per rendere la prova ripetibile: fuori dalle prove non si passano. */
  quando?: number;
  caso?: string;
}

export interface EsitoCaricamento {
  percorso: string;
  publicUrl: string;
}

/**
 * I SETTE TIPI CHE IL DEPOSITO ACCETTA DAVVERO, e i 10 MB che non supera.
 *
 * ⚠️ 8/9/2026 — QUESTE DUE COSTANTI NON SONO PIU' LA REGOLA: sono la regola DEL MAGAZZINO DI
 * SERIE (`products`), tenute qui perche' i chiamanti che gia' le importavano continuino a
 * funzionare. La regola vera vive in `lib/storage/regole-secchi.ts`, una casa per magazzino, e la
 * porta qui sotto la legge da li'.
 *
 * Perche' e' stata spostata: erano scritte qui come se i quattro magazzini avessero tutti la
 * stessa regola, e non ce l'hanno. `cod-proof` nel deposito non ha ne' tetto ne' lista di tipi, e
 * la cartella dello staff la concede solo `products`. Una costante sola per quattro magazzini e'
 * la stessa malattia che questo file cura sui percorsi: una regola ricopiata, che quando cambia
 * in un posto resta vecchia negli altri.
 *
 * ⚠️ COSA QUESTO CONTROLLO NON FA, detto chiaro: guarda solo i tipi `image/…`. Un video passa come
 * prima — StoreMediaManager ne carica uno per negozio — anche se il deposito lo rifiuta comunque,
 * perche' nella sua lista i video non ci sono. Quello e' un guasto piu' grande di questa riga e va
 * riparato dove nasce, non nascosto qui dentro.
 */
export const TIPI_IMMAGINE_AMMESSI = TIPI_IMMAGINE;

/** 10 MiB: e' il `file_size_limit` dei secchi immagine. */
export const MAX_BYTE_CARICAMENTO = DIECI_MIB;

/**
 * UN ANNO, ed e' il tempo giusto per un file che non cambia mai.
 *
 * Ogni caricamento scriveva `3600` — un'ora — su un indirizzo che e' unico per caricamento:
 * quella foto, a quell'indirizzo, e' sempre la stessa. La facevamo riscaricare ogni ora per
 * niente, e ogni riscaricamento e' un lampeggio in piu' su una connessione lenta. Chi non lo
 * passa affatto (ImageUrlField) prendeva il valore di serie dello storage, che e' ancora piu'
 * corto: adesso il valore giusto e' il DEFAULT della porta, cosi' non si dimentica piu'.
 */
export const ANNO_IN_SECONDI = '31536000';

/** Quanto pesa il corpo, che arrivi dal browser (`File.size`) o dal server (`Buffer.byteLength`). */
function pesoDi(file: unknown): number | null {
  const c = file as { size?: unknown; byteLength?: unknown };
  if (typeof c?.size === 'number') return c.size;
  if (typeof c?.byteLength === 'number') return c.byteLength;
  return null;
}

export async function caricaImmagine(
  client: ClientDiCaricamento,
  richiesta: RichiestaCaricamento,
): Promise<EsitoCaricamento> {
  const {
    file,
    userId,
    cartella = '',
    staff = false,
    secchio = SECCHIO_PUBBLICO,
    upsert = false,
    cacheControl = ANNO_IN_SECONDI,
    etichetta,
    contentType,
    quando = Date.now(),
    caso = casoNuovo(),
  } = richiesta;

  if (!file) throw new Error('caricaImmagine senza file');

  /**
   * LA REGOLA LA DECIDE IL MAGAZZINO, NON QUESTA FUNZIONE.
   *
   * Prima qui c'erano due costanti di modulo: una lista di tipi e un tetto, uguali per tutti. Ma i
   * quattro magazzini non hanno la stessa regola — `cod-proof` nel deposito non ha nessun tetto, e
   * la cartella dello staff la concede solo `products` — e una regola sola per quattro magazzini e'
   * esattamente la copia che invecchia in un posto e resta vecchia negli altri.
   *
   * Su un magazzino non dichiarato questa riga LANCIA, e non e' un incidente: e' il modo di non
   * far nascere il prossimo punto di caricamento con una regola ereditata per caso.
   */
  const regola = regolaDelSecchio(secchio);

  // I due controlli che il deposito fa alla fine, fatti qui all'inizio: cosi' il file che verrebbe
  // rifiutato non parte, e chi carica legge una frase che dice cosa fare invece dell'inglese dello
  // storage. Le stesse frasi le conosce anche `friendlyError`, per i casi che arrivano da la'.
  //
  // ⚠️ Su `cod-proof` questo NON e' un anticipo di cortesia: e' l'unica difesa che c'e'. Il
  // deposito accetterebbe qualunque file di qualunque peso finche' la migrazione 157 non e'
  // applicata.
  const tipoDichiarato = String(contentType || file.type || '').toLowerCase();
  if (tipoDichiarato.startsWith('image/') && !regola.tipiAmmessi.includes(tipoDichiarato)) {
    throw new Error('Formato non accettato: usa una foto JPG, PNG o WEBP.');
  }
  const peso = pesoDi(file);
  if (peso !== null && peso > regola.maxByte) {
    const mb = Math.round(regola.maxByte / (1024 * 1024));
    throw new Error(`La foto è troppo pesante: il limite è ${mb} MB. Riducila o scattane un'altra.`);
  }

  // Lo staff ha una cartella sua su UN magazzino solo. Chiederla altrove e' un percorso che il
  // database rifiuta: meglio fermarsi qui con una frase leggibile che scoprirlo dallo storage.
  if (staff && !regola.cartellaStaffAmmessa) {
    throw new Error(
      `il magazzino «${regola.nome}» non ha una cartella dello staff: ogni file va sotto ` +
        `l'identificativo di chi carica`,
    );
  }

  const codaPulita = String(etichetta ?? '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const marchio = codaPulita ? `${caso}-${codaPulita}` : caso;
  const percorso = staff
    ? percorsoStaff(cartella, file.name, { quando, caso: marchio })
    : percorsoUtente(String(userId ?? ''), cartella, file.name, { quando, caso: marchio });

  // La cintura, e non è ridondanza: il percorso lo costruisce la casa, ma se un giorno la regola nel
  // database cambia e questo modulo resta indietro, meglio fermarsi qui con una frase leggibile che
  // consegnare all'utente il messaggio di errore dello storage, che lui legge come «non funziona».
  const v = percorsoAmmesso(percorso, {
    userId,
    staff,
    cartellaStaffAmmessa: regola.cartellaStaffAmmessa,
  });
  if (!v.ammesso) throw new Error(`percorso non ammesso (${v.motivo})`);

  const opzioni: Record<string, unknown> = { upsert };
  const tipo = contentType || file.type;
  if (tipo) opzioni.contentType = tipo;
  if (cacheControl) opzioni.cacheControl = cacheControl;

  const { error } = await client.storage.from(secchio).upload(percorso, file, opzioni);
  if (error) throw error;

  /**
   * DA UN MAGAZZINO PRIVATO NON ESCE UN INDIRIZZO PUBBLICO.
   *
   * `getPublicUrl` costruisce comunque una stringa, anche su un secchio chiuso: e' solo un
   * indirizzo messo insieme, non una domanda al deposito. Restituirla invitava a salvarla — ed e'
   * cosi' che la foto dei contanti e quella della porta di casa del cliente sono finite per mesi
   * su un indirizzo indovinabile, prima della `migrations/114_hardening_radiografia.sql`. Qui
   * torna vuota: chi ha diritto di vedere quel file chiede un link a scadenza, e chi si dimentica
   * di farlo se ne accorge subito invece che dopo.
   */
  const publicUrl = regola.pubblico
    ? client.storage.from(secchio).getPublicUrl(percorso).data.publicUrl
    : '';

  return { percorso, publicUrl };
}
