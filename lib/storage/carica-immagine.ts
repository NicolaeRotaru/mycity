import {
  SECCHIO_PUBBLICO,
  casoNuovo,
  percorsoAmmesso,
  percorsoStaff,
  percorsoUtente,
} from './percorso-caricamento';

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
 * Sono la copia esatta di quello che sta scritto in `migrations/070_storage_and_rls_hardening.sql`
 * (secchi `products`, `reviews`, `stories`) e in `migrations/127_minori_22_agosto.sql`. Il
 * controllo stava in un punto solo — il caricamento delle foto di prodotto — invece che qui, nella
 * porta che tutti attraversano: chi ha aggiunto gli altri punti ha chiamato la porta, che è la cosa
 * giusta, e si e' portato via l'assenza del controllo.
 *
 * Il caso che si vede in negozio: il grafico consegna il logo in SVG, il negoziante lo trascina,
 * aspetta il caricamento e alla fine si prende un errore. Adesso il file sbagliato non parte
 * nemmeno, e la frase che legge e' in italiano.
 *
 * ⚠️ COSA QUESTO CONTROLLO NON FA, detto chiaro: guarda solo i tipi `image/…`. Un video passa come
 * prima — StoreMediaManager ne carica uno per negozio — anche se il deposito lo rifiuta comunque,
 * perche' nella sua lista i video non ci sono. Quello e' un guasto piu' grande di questa riga e va
 * riparato dove nasce, non nascosto qui dentro.
 */
export const TIPI_IMMAGINE_AMMESSI = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
] as const;

/** 10 MiB: e' il `file_size_limit` dei secchi immagine. */
export const MAX_BYTE_CARICAMENTO = 10 * 1024 * 1024;

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

  // I due controlli che il deposito fa alla fine, fatti qui all'inizio: cosi' il file che verrebbe
  // rifiutato non parte, e chi carica legge una frase che dice cosa fare invece dell'inglese dello
  // storage. Le stesse frasi le conosce anche `friendlyError`, per i casi che arrivano da la'.
  const tipoDichiarato = String(contentType || file.type || '').toLowerCase();
  if (
    tipoDichiarato.startsWith('image/') &&
    !(TIPI_IMMAGINE_AMMESSI as readonly string[]).includes(tipoDichiarato)
  ) {
    throw new Error('Formato non accettato: usa una foto JPG, PNG o WEBP.');
  }
  const peso = pesoDi(file);
  if (peso !== null && peso > MAX_BYTE_CARICAMENTO) {
    throw new Error("La foto è troppo pesante: il limite è 10 MB. Riducila o scattane un'altra.");
  }

  const codaPulita = String(etichetta ?? '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const marchio = codaPulita ? `${caso}-${codaPulita}` : caso;
  const percorso = staff
    ? percorsoStaff(cartella, file.name, { quando, caso: marchio })
    : percorsoUtente(String(userId ?? ''), cartella, file.name, { quando, caso: marchio });

  // La cintura, e non è ridondanza: il percorso lo costruisce la casa, ma se un giorno la regola nel
  // database cambia e questo modulo resta indietro, meglio fermarsi qui con una frase leggibile che
  // consegnare all'utente il messaggio di errore dello storage, che lui legge come «non funziona».
  const v = percorsoAmmesso(percorso, { userId, staff });
  if (!v.ammesso) throw new Error(`percorso non ammesso (${v.motivo})`);

  const opzioni: Record<string, unknown> = { upsert };
  const tipo = contentType || file.type;
  if (tipo) opzioni.contentType = tipo;
  if (cacheControl) opzioni.cacheControl = cacheControl;

  const { error } = await client.storage.from(secchio).upload(percorso, file, opzioni);
  if (error) throw error;

  return { percorso, publicUrl: client.storage.from(secchio).getPublicUrl(percorso).data.publicUrl };
}
