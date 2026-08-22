/**
 * Leggere il corpo di una richiesta con un tetto vero.
 *
 * Il difetto (#180). Il tetto si controllava leggendo l'intestazione
 * `content-length` — che la manda chi chiama. Ometterla, o dichiarare un numero
 * più piccolo del vero, bastava per saltare il controllo: il corpo veniva poi
 * caricato tutto in memoria da `req.json()` o `req.formData()`. Un solo utente,
 * con una richiesta da qualche centinaio di megabyte, poteva far cadere
 * l'istanza — e con lei il sito per tutti.
 *
 * Qui il corpo si legge a pezzi e ci si ferma davvero appena si supera il
 * limite: nessuna intestazione da credere sulla parola.
 */

/** Legge il corpo fino a `maxBytes`. Oltre, restituisce null senza continuare. */
export async function leggiCorpoConTetto(req: Request, maxBytes: number): Promise<Buffer | null> {
  const body = req.body as ReadableStream<Uint8Array> | null | undefined;

  // Nessuno stream (ambienti di prova, corpi già in memoria): si legge e si
  // controlla subito dopo. Meno buono, ma il tetto vale lo stesso.
  if (!body || typeof body.getReader !== 'function') {
    const buf = Buffer.from(await req.arrayBuffer());
    return buf.byteLength > maxBytes ? null : buf;
  }

  const reader = body.getReader();
  const pezzi: Uint8Array[] = [];
  let letti = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      letti += value.byteLength;
      if (letti > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      pezzi.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(pezzi.map((p) => Buffer.from(p)));
}

/** Il JSON del corpo, con lo stesso tetto. `undefined` = corpo troppo grande. */
export async function jsonConTetto(req: Request, maxBytes: number): Promise<unknown | undefined> {
  const buf = await leggiCorpoConTetto(req, maxBytes);
  if (buf === null) return undefined;
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null; // JSON non valido: il chiamante decide come rispondere
  }
}

/**
 * Ricostruisce la richiesta dopo aver letto il corpo entro il tetto, così si
 * può usare `formData()` senza rinunciare al limite.
 */
export async function richiestaConTetto(req: Request, maxBytes: number): Promise<Request | null> {
  const buf = await leggiCorpoConTetto(req, maxBytes);
  if (buf === null) return null;
  return new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: new Uint8Array(buf),
  });
}


/**
 * 22/8/2026 — IL TETTO C'ERA, E QUASI NESSUNA ROTTA LO USAVA.
 *
 * Questo file esisteva dal 20 agosto, con un tetto vero che legge il corpo a
 * pezzi. Poi cinquantatre rotte sotto `app/api` continuavano a chiamare
 * `req.json()` nudo, che carica tutto in memoria prima di guardare quanto e'
 * grande. Fra quelle: la cassa in contanti, il checkout con carta, le rotte che
 * ricevono foto in base64. Un solo utente, con una richiesta da qualche
 * centinaio di megabyte, faceva cadere l'istanza — e con lei il sito per tutti.
 *
 * Questa funzione e' la porta da cui deve passare ogni corpo JSON. Lancia
 * invece di restituire, cosi' entra nel `try` che quasi tutte le rotte hanno
 * gia' attorno alla lettura del corpo, senza riscriverle una per una.
 *
 * Il guardiano che impedisce alla cinquantaquattresima di nascere nuda sta in
 * `tests/unit/nessun-corpo-senza-tetto.test.ts`: legge i file e diventa rosso.
 */

/** Un JSON normale: dati, non file. */
export const TETTO_JSON = 1024 * 1024;          // 1 MB
/** Le rotte che ricevono foto dentro il JSON (base64). */
export const TETTO_JSON_CON_FOTO = 12 * 1024 * 1024;  // 12 MB

export class CorpoTroppoGrande extends Error {
  readonly status = 413;
  constructor(maxBytes: number) {
    super(`Corpo della richiesta troppo grande (oltre ${Math.round(maxBytes / 1024)} KB)`);
    this.name = 'CorpoTroppoGrande';
  }
}

/**
 * Il JSON del corpo entro il tetto. Lancia `CorpoTroppoGrande` se sfora.
 *
 * Il tipo di ritorno e' `any` di proposito: e' lo stesso di `req.json()`, che
 * questa funzione sostituisce ovunque. Restituire `unknown` avrebbe obbligato a
 * riscrivere cinquantatre punti di lettura per una cosa che non cambia il
 * comportamento — e ogni riscrittura in piu' e' un'occasione in piu' di
 * sbagliare su rotte che toccano i soldi.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function jsonRichiesta(req: Request, maxBytes: number = TETTO_JSON): Promise<any> {
  const dati = await jsonConTetto(req, maxBytes);
  if (dati === undefined) throw new CorpoTroppoGrande(maxBytes);
  // `req.json()` LANCIA su un JSON malformato, e le rotte contano su quello per
  // rispondere «dati non validi». Restituire `null` avrebbe fatto proseguire la
  // rotta con un corpo vuoto: si deve comportare come quello che sostituisce.
  if (dati === null) throw new SyntaxError('Corpo della richiesta non è JSON valido');
  return dati;
}
