import type { NextResponse } from 'next/server';
import type { OpzioniAccesso } from '@/lib/api/middleware';
import { apiError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { stradaAManoPerIDiritti, type ModoDellaStrada } from '@/lib/legal/titolare';

/**
 * LA PORTA DI UN DIRITTO QUANDO MANCA LA CHIAVE DI SERVIZIO — UNA COPIA SOLA.
 *
 * R23-002 (13/11/2026). Le porte dei diritti (cancellare l'account, annullare la richiesta,
 * vederne lo stato, scaricare i propri dati) avevano ognuna la sua copia di `senzaChiave` e
 * `sullaPorta`, in due file. Le copie si erano già separate: il 5/11 la riga d'errore della
 * cancellazione aveva imparato a dire chi aveva chiesto e quale diritto, quella
 * dell'esportazione no — quando la chiave tornava, nessuno sapeva chi richiamare.
 *
 * Chi sei lo decide `withAuth` (401 se nessuno); se poi manca la chiave, il gancio
 * `seMancaLaChiave` risponde da qui: 503 con la strada a mano (la casella privacy, o il modulo
 * dei contatti) e il collegamento in `details.recapito`, che la pagina offre come pulsante.
 *
 * `registro` è l'inizio della riga d'errore («[account-delete] cancellazione automatica
 * spenta»); `modo` cambia oggetto e chiusa dell'email (l'annullamento ha 7 giorni, non un mese).
 */
export function sullaPortaDeiDiritti(registro: string, cosa: string, modo?: ModoDellaStrada): OpzioniAccesso {
  return {
    seMancaLaChiave: (chi, e): NextResponse => {
      // Si annota l'identificativo interno (non l'email) e il diritto chiesto.
      logger.error(`${registro}: manca la chiave di servizio`, {
        errore: e instanceof Error ? e.message : 'errore',
        utente: chi.user?.id ?? null,
        diritto: cosa,
      });
      const strada = stradaAManoPerIDiritti(cosa, undefined, undefined, modo);
      return apiError(503, strada.frase, 'SERVICE_UNAVAILABLE', { recapito: strada.recapito });
    },
  };
}
