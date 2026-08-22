import { timingSafeEqual } from 'node:crypto';

/**
 * 22/8/2026 — CONFRONTARE UN SEGRETO CON `===` DICE QUANTI CARATTERI HAI
 * AZZECCATO.
 *
 * `===` su due stringhe esce al primo carattere diverso. Il tempo di risposta
 * dipende quindi da quanti caratteri iniziali sono giusti: provando un
 * carattere alla volta e misurando i tempi, il segreto si ricostruisce da
 * fuori senza mai vederlo.
 *
 * `timingSafeEqual` confronta tutti i byte comunque, sempre nello stesso
 * tempo. Il progetto lo usava già dentro il guardiano dei lavori periodici, ma
 * la funzione stava chiusa in `lib/api/middleware.ts`: la rotta di stato,
 * che ha lo stesso identico bisogno, si era riscritta il confronto con `===`.
 *
 * Sta qui perché i chiamanti sono due, e una funzione di sicurezza copiata è
 * una funzione di sicurezza che prima o poi diverge.
 */
export function segretiCombaciano(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // La lunghezza sì, si può confrontare: `timingSafeEqual` pretende due buffer
  // della stessa misura, e la lunghezza di un segreto non è il segreto.
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Estrae il gettone da un'intestazione `Authorization: Bearer …`. */
export function gettoneBearer(intestazione: string | null | undefined): string | null {
  if (!intestazione) return null;
  if (!intestazione.toLowerCase().startsWith('bearer ')) return null;
  const gettone = intestazione.slice(7).trim();
  return gettone || null;
}
