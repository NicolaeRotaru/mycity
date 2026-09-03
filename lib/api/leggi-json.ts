/**
 * LEGGERE LA RISPOSTA DI UNA ROTTA SENZA FIDARSI CHE SIA JSON.
 *
 * ── Il difetto che ha prodotto questo file ──────────────────────────────────
 * Quando la rotta non risponde in tempo, quello che torna al browser non è la
 * nostra risposta: è la pagina di errore del gateway, in HTML («504 GATEWAY
 * TIMEOUT», o un 502, o un 413 se il file caricato è troppo grosso). Fare
 * `await res.json()` su quella pagina lancia un errore del parser, e quel testo
 * — «Unexpected token '<'» — finiva nell'imbuto dei messaggi per l'utente.
 *
 * Qui la lettura non esplode mai: se non c'è JSON torna `null`, e chi chiama sa
 * che deve guardare lo stato HTTP invece di cercare un messaggio che non c'è.
 */

export async function leggiJson<T = unknown>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Cosa dire quando la risposta non è nostra: si parla dello stato HTTP, che è
 * l'unica cosa vera che abbiamo in mano.
 */
export function messaggioDiRete(status: number): string {
  if (status === 413) return 'Il file è troppo grande. Riprova con uno più leggero.';
  if (status === 429) return 'Troppe richieste in poco tempo. Aspetta qualche secondo.';
  if (status >= 500) return 'Il server non ha risposto. Riprova fra qualche secondo.';
  return 'Qualcosa non ha funzionato. Riprova fra un momento.';
}
