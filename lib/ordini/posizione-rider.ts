import { haversineKm, deliveryEtaMinutes } from '@/lib/geo';

/**
 * 3/9/2026 — «ARRIVA TRA ~3 MIN», CALCOLATO SU UNA POSIZIONE FERMA DA MEZZ'ORA.
 *
 * Sul web la posizione del fattorino si aggiorna solo mentre lo schermo è
 * acceso e la pagina è davanti. Appena il telefono va in tasca gli
 * aggiornamenti si fermano — su iPhone la pagina viene proprio sospesa — e le
 * ultime coordinate restano lì, ferme, buone come quelle di un minuto fa.
 *
 * Il conto le prendeva per fresche: distanza dal punto vecchio a casa del
 * cliente, diviso venticinque all'ora, e usciva «~4 min». Il fattorino parte
 * dal negozio alle 14:00 col telefono in tasca; alle 14:25 il cliente apre
 * l'ordine e legge che arriva fra quattro minuti. Non è un'imprecisione: è una
 * bugia detta al minuto, e chi la legge chiama il negozio.
 *
 * La regola, in una riga: **il numero si mostra solo se nasce da un dato
 * fresco; altrimenti si dice da quanto la posizione è ferma.**
 *
 * Il cancello sta qui e non nella pagina, perché le pagine che disegnano un
 * fattorino su una mappa sono più d'una e ognuna rifarebbe il conto a modo suo.
 */

/**
 * Entro quanti minuti una posizione è ancora buona per calcolarci sopra un
 * tempo di arrivo. Tre: in tre minuti uno scooter in città fa poco più di un
 * chilometro, cioè l'errore resta dentro il minuto dichiarato. Oltre, il
 * numero non descrive più niente.
 */
export const POSIZIONE_FRESCA_MIN = 3;

/**
 * Oltre quanti minuti la posizione non si disegna nemmeno più sulla mappa.
 * Mezz'ora: un puntino di mezz'ora fa non è dove si trova il fattorino, è dove
 * si trovava — e un puntino su una mappa lo si legge come «è qui adesso».
 */
export const POSIZIONE_SCADUTA_MIN = 30;

export type LetturaPosizione = {
  lat: number | null | undefined;
  lng: number | null | undefined;
  /** Quando il fattorino ha mandato l'ultima volta le sue coordinate. */
  aggiornataIl: string | null | undefined;
};

export type StatoPosizioneRider = {
  /** Da quanti minuti la posizione è ferma. `null` = non lo sappiamo. */
  minuti: number | null;
  /** Abbastanza fresca da poterci calcolare sopra un tempo di arrivo. */
  fresca: boolean;
  /** Si può ancora disegnare il puntino sulla mappa. */
  mostraPin: boolean;
  /** Cosa legge il cliente: mai un orario secco quando il dato è vecchio. */
  testo: string | null;
};

/** «adesso», «1 minuto fa», «12 minuti fa», «più di un'ora fa». */
export function daQuantoTempo(minuti: number): string {
  if (minuti <= 0) return 'adesso';
  if (minuti === 1) return '1 minuto fa';
  if (minuti < 60) return `${minuti} minuti fa`;
  if (minuti < 120) return "più di un'ora fa";
  return `più di ${Math.floor(minuti / 60)} ore fa`;
}

/** Quanti minuti sono passati da un orario scritto. `null` se l'orario non c'è o non si legge. */
export function minutiDa(iso: string | null | undefined, adesso: number): number | null {
  if (!iso) return null;
  const quando = new Date(iso).getTime();
  if (!Number.isFinite(quando)) return null;
  // Un orologio del telefono indietro di qualche secondo darebbe un numero
  // negativo: vale zero, non «nel futuro».
  return Math.max(0, Math.round((adesso - quando) / 60_000));
}

export function statoPosizioneRider(
  lettura: LetturaPosizione,
  adesso: number = Date.now(),
): StatoPosizioneRider {
  const haCoordinate = lettura.lat != null && lettura.lng != null;
  if (!haCoordinate) {
    return { minuti: null, fresca: false, mostraPin: false, testo: null };
  }

  const minuti = minutiDa(lettura.aggiornataIl, adesso);
  if (minuti == null) {
    // Coordinate senza orario: non sappiamo di quando sono, quindi non ci si
    // calcola sopra niente. Il puntino resta, ma dice che non è aggiornato.
    return { minuti: null, fresca: false, mostraPin: true, testo: 'Posizione non aggiornata' };
  }

  const fresca = minuti <= POSIZIONE_FRESCA_MIN;
  return {
    minuti,
    fresca,
    mostraPin: minuti <= POSIZIONE_SCADUTA_MIN,
    testo: fresca
      ? `Posizione aggiornata ${daQuantoTempo(minuti)}`
      : `Ultima posizione ${daQuantoTempo(minuti)}`,
  };
}

/**
 * Fra quanti minuti arriva, se si può dire senza inventare.
 *
 * Torna `null` — e chi disegna la pagina non scrive nessun numero — quando il
 * fattorino non è in viaggio, quando manca una delle due coppie di coordinate,
 * o quando la posizione non è fresca.
 */
export function stimaArrivoMinuti(
  lettura: LetturaPosizione,
  destinazione: { lat: number | null | undefined; lng: number | null | undefined },
  opzioni: { inViaggio: boolean; adesso?: number },
): number | null {
  if (!opzioni.inViaggio) return null;
  if (destinazione.lat == null || destinazione.lng == null) return null;

  const stato = statoPosizioneRider(lettura, opzioni.adesso ?? Date.now());
  if (!stato.fresca) return null;

  const km = haversineKm(lettura.lat as number, lettura.lng as number, destinazione.lat, destinazione.lng);
  // prep = 0: il fattorino è già in strada, non deve preparare niente.
  return Math.max(1, deliveryEtaMinutes(km, 0));
}
