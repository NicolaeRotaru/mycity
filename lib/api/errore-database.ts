import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import type { NextResponse } from 'next/server';

/**
 * 22/8/2026 — «NON HAI I PERMESSI» DETTO A OGNI GUASTO.
 *
 * La chat rispondeva 403 «Impossibile inviare il messaggio» per QUALUNQUE
 * errore del database: permesso negato, connessione caduta, vincolo violato,
 * database in manutenzione. Tutto uguale.
 *
 * Chi legge 403 pensa di non poter scrivere a quella persona e smette di
 * provare. E nei log non resta niente da cui capire cosa sia successo davvero,
 * perché un 403 è una risposta normale: nessuno lo va a guardare.
 *
 * `lib/errors.ts` fa già questa distinzione dalla parte del browser. Qui c'è
 * la stessa, dalla parte del server, in un posto solo — perché la prossima
 * rotta che ne ha bisogno la trovi invece di riscriverla a modo suo.
 */
type ErroreDb = { code?: string; message?: string } | null | undefined;

export function rispostaPerErroreDatabase(
  errore: ErroreDb,
  dove: string,
  messaggioPerChiLegge = 'Operazione non riuscita',
): NextResponse {
  const codice = errore?.code ?? '';
  const testo = errore?.message ?? '';

  // 42501 è il codice PostgreSQL di «permesso negato», ed è anche quello che
  // esce quando una regola per riga rifiuta la scrittura.
  if (codice === '42501' || /row-level security/i.test(testo)) {
    return ApiErrors.forbidden(messaggioPerChiLegge);
  }

  // PGRST116: PostgREST non ha trovato la riga che `.single()` pretendeva.
  if (codice === 'PGRST116') {
    return ApiErrors.notFound('Non trovato');
  }

  // 23505: qualcuno ha già scritto la stessa cosa. Non è un guasto.
  if (codice === '23505') {
    return ApiErrors.conflict('Esiste già');
  }

  // Tutto il resto è un guasto NOSTRO, e va nei log: un 500 qualcuno lo guarda,
  // un 403 no.
  logger.error(`[${dove}] errore del database non previsto`, { codice, message: testo });
  return ApiErrors.internal(messaggioPerChiLegge);
}
