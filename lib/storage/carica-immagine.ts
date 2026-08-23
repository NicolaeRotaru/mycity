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
    cacheControl,
    etichetta,
    contentType,
    quando = Date.now(),
    caso = casoNuovo(),
  } = richiesta;

  if (!file) throw new Error('caricaImmagine senza file');

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
