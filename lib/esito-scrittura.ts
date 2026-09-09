/**
 * È SUCCESSO DAVVERO? — l'esito di una scrittura, prima che qualcuno scriva «fatto» in verde.
 *
 * ── Il difetto che ha prodotto questo file ───────────────────────────────────────────────────
 * In `/admin/coupons` il pulsante Elimina faceva così:
 *
 *     mutationFn: async (id) => { await supabase.from('coupons').delete().eq('id', id); }
 *     onSuccess: () => toast.success('Coupon eliminato')
 *
 * Quella funzione non può fallire. La risposta di Supabase la butta via intera: non guarda
 * `error`, e non guarda nemmeno quante righe ha toccato. Qualunque cosa vada storta — sessione
 * scaduta, rete caduta a metà, regola del database che rifiuta — finisce senza lanciare, quindi
 * parte `onSuccess` e a schermo compare il verde. L'amministratore chiude la pagina convinto che
 * lo sconto sia spento; il codice resta spendibile dai clienti e si scopre a fine mese guardando
 * i margini. Lo stesso valeva per il pulsante Attivo/Disattivato.
 *
 * ── Le DUE cose che possono andare storte, non una ───────────────────────────────────────────
 * ① `error` valorizzato: il database ha detto di no. Questa la vede chiunque guardi `error`.
 * ② `error` nullo e ZERO righe toccate. Questa non la vede nessuno, ed è quella che fa più male:
 *    con le regole di riga attive, una `delete` che non ha il permesso non è un errore — è un
 *    comando che non trova niente da cancellare. Il database risponde «ok, zero righe». La pagina
 *    scriveva «Coupon eliminato» e il coupon era vivo.
 * Per questo qui una scrittura non è «riuscita» quando non è fallita: è riuscita quando ha una
 * PROVA di aver toccato qualcosa. Senza prova non si afferma — si ammette di non sapere.
 *
 * ── La trappola da cui nasce la malattia ─────────────────────────────────────────────────────
 * `const { data } = await q` e `const { count } = await q` buttano via `error` per costruzione:
 * una lettura caduta diventa identica a una lettura vuota. Qui la risposta si passa INTERA, e
 * chi scrive non ha un ramo da ricordarsi — quindi non ha un ramo da dimenticare.
 *
 * 🟢 Puro: nessuna rete, nessun React, nessun orologio. Una prova lo ESEGUE.
 */

/**
 * La parte di una risposta di Supabase che serve per sapere com'è andata.
 *
 * Non è il tipo di `supabase-js`: è il minimo che descrive una scrittura, così la funzione si
 * prova senza fingere una libreria intera.
 */
export type RispostaScrittura = {
  error?: unknown;
  data?: unknown;
  count?: number | null;
  status?: number;
};

/** Perché non possiamo dire che è andata. */
export type MotivoFallita = 'nessuna_risposta' | 'errore' | 'nessuna_riga' | 'senza_prova';

export interface EsitoScrittura {
  /** Vero solo se il database ha confermato di aver toccato almeno una riga. */
  riuscita: boolean;
  motivo: MotivoFallita | null;
  /** Quante righe risultano toccate. `null` vuol dire «non l'ha detto», che non è zero. */
  righeToccate: number | null;
  /** Cosa dire a chi guarda, in italiano. Vuoto quando è andata. */
  messaggio: string;
  /** L'errore originale, così chi chiama può tradurlo con le mappe che ha già. */
  errore: unknown;
}

/**
 * Quante righe ha toccato la scrittura — e `null` quando la risposta non lo dice.
 *
 * `null` NON è zero: è la differenza fra «non ha cancellato niente» e «non me l'ha detto». Una
 * `delete` senza `.select()` risponde `data: null`, e su quella risposta nessuno può affermare
 * niente. Serve chiedere le righe indietro — `.select('id')` — oppure il conteggio esatto.
 */
export function righeDellaRisposta(res: RispostaScrittura | null | undefined): number | null {
  if (!res) return null;
  if (typeof res.count === 'number' && Number.isFinite(res.count)) return Math.max(0, Math.trunc(res.count));
  if (Array.isArray(res.data)) return res.data.length;
  if (res.data !== undefined && res.data !== null && typeof res.data === 'object') return 1;
  return null;
}

/** Un errore c'è quando c'è: `null`, `undefined` e `false` non sono errori. */
function cE(errore: unknown): boolean {
  return errore !== undefined && errore !== null && errore !== false;
}

export interface DomandaScrittura {
  /** Di che cosa stiamo parlando, per la frase a schermo. Es. «Il coupon». */
  cosa: string;
  /**
   * Pretendi la prova delle righe toccate. Acceso di default, ed è il punto del file: senza
   * prova non si afferma. Spegnilo solo dove le righe non si possono chiedere indietro, e
   * scrivi lì perché.
   */
  pretendiRighe?: boolean;
}

export function esitoDellaScrittura(
  res: RispostaScrittura | null | undefined,
  d: DomandaScrittura,
): EsitoScrittura {
  const cosa = d.cosa.trim();
  const pretendiRighe = d.pretendiRighe !== false;
  const righe = righeDellaRisposta(res);

  // ① NESSUNA RISPOSTA. Non c'è niente da leggere, quindi non c'è niente da affermare.
  if (!res) {
    return {
      riuscita: false,
      motivo: 'nessuna_risposta',
      righeToccate: null,
      messaggio: `Non ho ricevuto risposta: non so se ${cosa} sia cambiato. Ricarica la pagina e controlla.`,
      errore: null,
    };
  }

  // ② IL DATABASE HA DETTO DI NO. È il caso che il codice vecchio ignorava per primo.
  if (cE(res.error)) {
    return {
      riuscita: false,
      motivo: 'errore',
      righeToccate: righe,
      messaggio: `Non sono riuscito a salvare: ${cosa} è rimasto come prima.`,
      errore: res.error,
    };
  }

  // ③ NESSUN ERRORE E ZERO RIGHE. Il caso silenzioso, e il più caro: il comando è passato senza
  // toccare niente — quasi sempre una regola di riga che non dà il permesso, oppure una riga che
  // qualcun altro ha già cambiato. Senza questo ramo la pagina scrive il verde su un nulla di fatto.
  if (pretendiRighe && righe === 0) {
    return {
      riuscita: false,
      motivo: 'nessuna_riga',
      righeToccate: 0,
      messaggio: `Nessuna riga è cambiata: ${cosa} è ancora come prima. Forse non hai i permessi, o qualcun altro l'ha già cambiato.`,
      errore: null,
    };
  }

  // ④ NESSUN ERRORE, MA NEMMENO UNA PROVA. Chi chiama non ha chiesto le righe indietro: la
  // scrittura può essere andata benissimo, ma da qui non si vede. Si ammette, non si afferma.
  if (pretendiRighe && righe === null) {
    return {
      riuscita: false,
      motivo: 'senza_prova',
      righeToccate: null,
      messaggio: `Non so dire se ${cosa} sia cambiato: il database non ha detto quante righe ha toccato. Ricarica e controlla.`,
      errore: null,
    };
  }

  return { riuscita: true, motivo: null, righeToccate: righe, messaggio: '', errore: null };
}

/**
 * La scrittura non è andata, e questo è il motivo — in una forma che si può lanciare.
 *
 * Esiste perché React Query decide fra `onSuccess` e `onError` su una cosa sola: se la funzione
 * ha lanciato. Finché non lancia, il messaggio verde parte.
 */
export class ScritturaNonRiuscita extends Error {
  readonly motivo: MotivoFallita;
  readonly causa: unknown;

  constructor(esito: EsitoScrittura) {
    super(esito.messaggio);
    this.name = 'ScritturaNonRiuscita';
    this.motivo = esito.motivo ?? 'senza_prova';
    this.causa = esito.errore;
  }
}

/**
 * Pretende che la scrittura sia andata: torna l'esito se è andata, altrimenti LANCIA.
 *
 * Quando il database ha risposto con un errore suo, lancia quell'errore tale e quale: porta il
 * codice — `42501` è «non hai i permessi» — e chi lo raccoglie ha già le mappe per tradurlo. Negli
 * altri due casi l'errore non esiste, e la frase italiana la mettiamo noi.
 */
export function pretendiScrittura(
  res: RispostaScrittura | null | undefined,
  d: DomandaScrittura,
): EsitoScrittura {
  const esito = esitoDellaScrittura(res, d);
  if (esito.riuscita) return esito;
  if (esito.motivo === 'errore' && (typeof esito.errore === 'object' || typeof esito.errore === 'string')) {
    throw esito.errore;
  }
  throw new ScritturaNonRiuscita(esito);
}

/**
 * Esegui la scrittura e pretendi che sia andata.
 *
 * È il corpo intero di una `mutationFn`: si passa il comando, non il suo risultato smontato. Così
 * la risposta arriva INTERA a chi la deve giudicare, e la riga che buttava via `error` non si può
 * più scrivere.
 *
 *   mutationFn: (id: string) => scrivi(
 *     () => supabase.from('coupons').delete().eq('id', id).select('id'),
 *     { cosa: 'Il coupon' },
 *   )
 */
export async function scrivi(
  comando: () => PromiseLike<RispostaScrittura>,
  d: DomandaScrittura,
): Promise<EsitoScrittura> {
  const res = await comando();
  return pretendiScrittura(res, d);
}
