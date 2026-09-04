/**
 * 3/9/2026 — L'ACCESSO CON GOOGLE NON LASCIAVA NESSUNA RIGA NEL REGISTRO.
 *
 * Il registro degli accessi (`activity_events`, categoria `auth`) è quello che
 * si va a guardare quando a qualcuno rubano l'account: dice da quale indirizzo,
 * con quale dispositivo e a che ora è entrato. Nell'informativa è difeso come
 * sicurezza — legittimo interesse — e infatti si tiene anche per chi rifiuta i
 * cookie statistici.
 *
 * Solo che dentro c'era una parte sola delle persone. L'unico a scriverci era
 * `components/ActivityTracker.tsx`, che manda «accesso» quando vede la sessione
 * passare da «nessuno» a «qualcuno» DENTRO IL BROWSER. Con Google — e con il
 * link di conferma della mail — la sessione la crea il server in
 * `/auth/callback`, e la pagina riparte con la persona già dentro: quel
 * passaggio nel browser non avviene mai, e la riga non si scriveva.
 *
 * Risultato: per ogni accesso con Google non c'era né indirizzo, né dispositivo,
 * né ora. Il cruscotto delle attività contava meno accessi del vero, e proprio
 * quelli della porta più comoda.
 *
 * LA RIPARAZIONE. La riga non nasce più da un cambio di stato del browser: nasce
 * dal FATTO. Chiunque dichiari «questa persona è appena entrata» —
 * `trackSignedIn` e `trackSignupCompleted` in `events.ts`, che le due strade
 * attraversano entrambe — lascia anche la riga nel registro. Un fatto, un posto
 * solo che lo racconta a tutti quelli che devono saperlo.
 *
 * Il consenso non c'entra: l'accesso è sicurezza, non sorveglianza del
 * visitatore. È la stessa regola che applicano già `tracciamento.ts` e la rotta
 * `/api/track` (R064). L'etichetta che seguirebbe la persona — il cookie
 * `mc_vid` — quella sì che resta legata al consenso, e la deposita la rotta.
 *
 * Il doppione è impossibile per costruzione lato server: la rotta tiene un
 * accesso solo per persona e per sessione del browser (`accessoGiaRegistrato`).
 */

/** Dove il browser deposita l'id della sessione: lo stesso che usa ActivityTracker. */
export const CHIAVE_SESSIONE_BROWSER = 'mc_sid';

/** La rotta che riceve i segnali dal browser. */
export const ROTTA_DEL_REGISTRO = '/api/track';

/**
 * L'id della sessione di questo browser, se il browser sa tenerlo. Serve a far
 * riconoscere come UNO SOLO i due segnali che arrivano per lo stesso accesso.
 */
function idSessioneDelBrowser(): string | undefined {
  try {
    return sessionStorage.getItem(CHIAVE_SESSIONE_BROWSER) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Lascia una riga nel registro degli accessi. Non aspetta risposta e non fa mai
 * cadere niente: se non parte, non parte — ma non rompe l'accesso della persona.
 */
export function registraAccessoNelRegistro(metodo: string): void {
  if (typeof window === 'undefined') return;
  const corpo = JSON.stringify({
    event_type: 'login',
    session_id: idSessioneDelBrowser(),
    metadata: { metodo },
  });
  try {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(
        ROTTA_DEL_REGISTRO,
        new Blob([corpo], { type: 'application/json' }),
      );
      if (ok) return;
    }
  } catch {
    /* si riprova con fetch qui sotto */
  }
  try {
    void fetch(ROTTA_DEL_REGISTRO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: corpo,
      keepalive: true,
      credentials: 'include',
    }).catch(() => {});
  } catch {
    /* al massimo manca una riga: non si rompe l'accesso per questo */
  }
}
