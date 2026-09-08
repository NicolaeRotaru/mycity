/**
 * QUALE FOTO VA SULLA TESSERA DI UNA CATEGORIA — E CHI LO DECIDE.
 *
 * 8/9/2026 (lotto gravi, corsia 17).
 *
 * COM'ERA. Le undici foto delle tessere in home stavano scritte a mano dentro
 * `components/CategoryShowcase.tsx`, in un elenco che si chiamava `IMG_MAP`, e
 * il commento sopra l'elenco lo ammetteva: «Scelte "a stima" e NON verificabili
 * dalla sandbox». Erano foto d'archivio Pexels: le stesse che può avere in home
 * qualunque altro sito al mondo, su un mercato che si presenta come i negozi di
 * Piacenza. E per cambiarne una — una sola — bisognava riscrivere il codice e
 * ripubblicare il sito, perché la tabella `categories` non aveva nessuna colonna
 * per l'immagine.
 *
 * COS'È CAMBIATO. La foto adesso è un DATO, non una riga di codice: sta nella
 * colonna `categories.image_url` (migrazione 159) e si cambia da dove si cambiano
 * gli altri campi della categoria. Il componente non sceglie più niente: chiede
 * qui, e qui si guarda solo cosa c'è scritto nel dato.
 *
 * FINCHÉ NON C'È UNA FOTO, non se ne inventa una: la tessera resta il gradiente
 * di categoria col nome e l'icona sopra. È il colore del marchio, ed è vero —
 * meglio di una foto di un negozio che non è il nostro.
 *
 * L'ALTRA METÀ DEL DIFETTO ERA IL SILENZIO. Quando una foto non si caricava, la
 * tessera tornava gradiente e non lo sapeva nessuno: l'immagine rotta veniva
 * semplicemente messa a `display:none`. Qui un indirizzo inservibile non torna
 * mai come un `null` muto: torna col MOTIVO, e chi chiama può dirlo nei log
 * (`motivoDaSegnalare`). Un guasto che nessuno vede è un guasto che resta.
 */

import { indirizzoTravestito, percorsoDelSito } from '@/lib/indirizzo-immagine-ammesso';

/**
 * GLI HOST DA CUI IL BROWSER PUÒ DAVVERO SCARICARE UNA FOTO.
 *
 * ⚠️ Questo elenco non è un'opinione: è la copia di `img-src` nella regola di
 * sicurezza del sito (`middleware.ts`, riga della Content-Security-Policy). Un
 * indirizzo su un host fuori da lì il browser lo BLOCCA — e si vedrebbe
 * esattamente quello che si vedeva prima: una tessella col gradiente e nessuno
 * che capisce perché. Meglio dirlo subito e non mandare in pagina un indirizzo
 * che sappiamo già che non passerà.
 *
 * `tests/unit/la-foto-della-categoria-la-decide-il-dato-non-il-codice.test.ts`
 * tiene i due elenchi allineati: se qualcuno toglie un host dalla CSP, la prova
 * diventa rossa invece di lasciare qui un permesso che non vale più.
 */
export const HOST_FOTO_AMMESSI = ['images.pexels.com', 'placehold.co'] as const;

/**
 * Lo Storage di Supabase: il posto dove finiscono le foto caricate da noi.
 *
 * Nella CSP il permesso è scritto col host del NOSTRO progetto, non col suffisso
 * (`https://${supaHost}`, che senza configurazione ricade su `*.supabase.co`).
 * Qui il confronto è sul suffisso, cioè un filo più largo: l'indirizzo dello
 * Storage di un ALTRO progetto passerebbe di qui e verrebbe bloccato dal
 * browser. Non è più il buco di prima, perché in quel caso l'immagine fallisce e
 * il fallimento finisce nei log invece di sparire.
 */
export const SUFFISSO_HOST_STORAGE = '.supabase.co';

/**
 * Perché una tessera resta senza foto.
 *
 * `nessuna` è la normalità del momento — la colonna è vuota, la foto vera non
 * c'è ancora — e NON è un guasto: non va segnalata. Gli altri tre sono errori di
 * chi ha compilato il campo, e vanno detti.
 */
export type MotivoSenzaFoto =
  | 'nessuna'
  | 'schema-non-ammesso'
  | 'host-non-ammesso'
  | 'indirizzo-travestito';

export type FotoDiCategoria = {
  /** L'indirizzo da mettere nel tag `img`, oppure `null`: allora si vede il gradiente. */
  src: string | null;
  /** `null` quando la foto c'è. Altrimenti dice perché non c'è. */
  motivo: MotivoSenzaFoto | null;
  /** L'indirizzo scartato, così chi legge il log sa quale correggere. */
  scartato?: string;
};

/**
 * La riga di categoria come arriva dal database.
 *
 * `image_url` è dichiarato `unknown` di proposito: `select('*')` porta a casa
 * quello che c'è nella tabella, e finché la migrazione 159 non è applicata quel
 * campo non esiste proprio. Una funzione che decide cosa mostrare a un
 * visitatore non può fidarsi della forma: la controlla.
 */
export type CategoriaConFoto = { slug?: string | null; image_url?: unknown };

/**
 * Decide la foto di una tessera di categoria. Pura: stesso dato, stessa risposta.
 */
export function fotoDiCategoria(categoria: CategoriaConFoto | null | undefined): FotoDiCategoria {
  const grezzo = categoria?.image_url;
  if (typeof grezzo !== 'string') return { src: null, motivo: 'nessuna' };

  const indirizzo = grezzo.trim();
  // Uno spazio bianco salvato per sbaglio dal pannello vale come «non c'è»: non
  // è un errore da segnalare, è un campo vuoto scritto male.
  if (indirizzo === '') return { src: null, motivo: 'nessuna' };

  // ⚠️ QUI IL CONTROLLO DI PRIMA NON BASTAVA (riparato l'8/9/2026).
  // Diceva: comincia per barra ma non per due barre. Chiudeva `//altro-sito/x.jpg`, ed è vero;
  // ma il browser, PRIMA di leggere un indirizzo, toglie tabulazioni, a capo e ritorni carrello,
  // e legge la barra rovescia come una barra. Quindi passavano di qui e finivano dentro il `src`
  // di una pagina pubblica quattro travestimenti — provati eseguendo questa funzione, e riletti
  // con il lettore di indirizzi vero (`new URL`), che per tutti e quattro risponde `evil.com`:
  //
  //     /<TAB>//evil.com/x.jpg       /<A CAPO>//evil.com/x.jpg
  //     /<RITORNO>//evil.com/x.jpg   /\evil.com/x.jpg
  //
  // La regola giusta non si riscrive qui: è la stessa del vincolo del database (migrazione 159)
  // e vive in `lib/indirizzo-immagine-ammesso.ts`. Una casa sola: il giorno che si stringe
  // ancora, si stringe in un posto e vale su tutti e due i campi immagine del sito.
  if (indirizzoTravestito(indirizzo)) {
    return { src: null, motivo: 'indirizzo-travestito', scartato: indirizzo };
  }

  // Un percorso del sito («/immagini/categorie/alimentari.jpg»): `'self'` è il
  // primo permesso della CSP, quindi si carica sempre.
  if (indirizzo.startsWith('/')) {
    if (percorsoDelSito(indirizzo)) return { src: indirizzo, motivo: null };
    return { src: null, motivo: 'indirizzo-travestito', scartato: indirizzo };
  }

  let url: URL;
  try {
    url = new URL(indirizzo);
  } catch {
    return { src: null, motivo: 'schema-non-ammesso', scartato: indirizzo };
  }

  // Solo `https:`. Fuori restano `javascript:` (che dentro un `src` non è
  // un'immagine, è un tentativo), `data:` (una foto intera dentro una riga di
  // database: pesa e non si può rimpicciolire) e `http:` (contenuto misto,
  // bloccato comunque dal browser su un sito in https).
  if (url.protocol !== 'https:') {
    return { src: null, motivo: 'schema-non-ammesso', scartato: indirizzo };
  }

  // Un nome utente prima della chiocciola sposta il dominio senza che si veda.
  // `https://images.pexels.com@evil.com/x.jpg` è già fermato qui sotto dall'elenco degli host
  // (il dominio vero, quello che legge il browser, è `evil.com`), ma
  // `https://evil.com@images.pexels.com/x.jpg` passerebbe: l'host è ammesso davvero. Nessuna
  // foto ha bisogno di un nome utente, quindi si scarta. Il vincolo del database questo non lo
  // vede — guarda la forma, e questa forma è regolare.
  if (url.username !== '' || url.password !== '') {
    return { src: null, motivo: 'indirizzo-travestito', scartato: indirizzo };
  }

  const host = url.hostname.toLowerCase();
  const ammesso =
    (HOST_FOTO_AMMESSI as readonly string[]).includes(host) || host.endsWith(SUFFISSO_HOST_STORAGE);
  if (!ammesso) return { src: null, motivo: 'host-non-ammesso', scartato: indirizzo };

  return { src: indirizzo, motivo: null };
}

/**
 * La frase da scrivere nei log quando una tessera resta senza foto per un
 * ERRORE — non quando semplicemente la foto non c'è ancora.
 *
 * Torna `null` nei due casi in cui non c'è niente da dire: la foto c'è, oppure
 * il campo è vuoto (che è lo stato normale di oggi, su tutte le categorie: se lo
 * segnalassimo, il log direbbe sei volte per pagina una cosa che sappiamo già).
 */
export function motivoDaSegnalare(esito: FotoDiCategoria): string | null {
  switch (esito.motivo) {
    case 'indirizzo-travestito':
      // Questo non è un errore di battitura: è un indirizzo che sembra una foto di casa nostra e
      // porta altrove. Va scritto nei log con parole sue, o si perde in mezzo ai refusi.
      return `l'indirizzo della foto sembra un percorso di questo sito ma porta su un altro sito: il browser lo leggerebbe in modo diverso da come è scritto (scartato: ${esito.scartato ?? ''})`;
    case 'schema-non-ammesso':
      return `l'indirizzo della foto non è utilizzabile: serve un indirizzo che comincia per https:// oppure un percorso del sito che comincia per / (scartato: ${esito.scartato ?? ''})`;
    case 'host-non-ammesso':
      return `la foto sta su un sito che il browser bloccherà: ammessi solo ${HOST_FOTO_AMMESSI.join(', ')} e lo Storage ${SUFFISSO_HOST_STORAGE} (scartato: ${esito.scartato ?? ''})`;
    default:
      return null;
  }
}
