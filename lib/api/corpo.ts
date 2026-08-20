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
