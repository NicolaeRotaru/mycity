// lib/ai/decisioneTettoSpesa.ts
/**
 * LA DECISIONE «POSSO ANCORA SPENDERE?», SEPARATA DA DOVE IL NUMERO E'
 * CONSERVATO.
 *
 * 8/9/2026 (lotto gravi, corsia 11) — IL TETTO SI MOLTIPLICAVA PER IL NUMERO
 * DI COPIE, E NESSUNO SE NE ACCORGEVA.
 *
 * COSA SUCCEDEVA DAVVERO. Il conto della spesa AI vive in un posto solo — la
 * tabella `ai_spend_daily`, migrazione 131 — perche' su Vercel «la macchina»
 * non esiste: ogni richiesta puo' finire su una copia diversa della funzione.
 * Ma quella migrazione in produzione non e' mai stata applicata (il registro
 * delle migrazioni della produzione e' nato prima della cartella
 * `migrations/`: vedi `scripts/applica-migrazioni-mancanti.sh`). Quindi ogni
 * lettura del conto condiviso falliva, ogni chiamata ripiegava sul contatore
 * in memoria della singola copia, e `AI_GLOBAL_DAILY_BUDGET_EUR = 20` voleva
 * dire venti euro PER COPIA. Con tre copie in aria il tetto valeva sessanta.
 *
 * Il pezzo che mancava non era un numero da alzare o abbassare: era che la
 * decisione cambiasse quando il conto non e' piu' condiviso. Prima il confronto
 * era una riga dentro `lib/ai/run.ts` — `spesiCents >= euroInCents(limitEur)` —
 * che si comportava allo stesso identico modo nei due mondi opposti:
 *
 * · conto condiviso vivo   → «venti euro per il sito»       ✅
 * · conto condiviso morto  → «venti euro per copia», cioe' quanti euro non lo
 *                            sa nessuno                       ❌
 *
 * COSA FA ADESSO. Se il ripiego e' DUREVOLE — il conto condiviso non esiste
 * proprio, oppure non risponde da piu' di un'ora — il tetto di questa copia
 * diventa il tetto del sito diviso le copie che possono essere in aria
 * (`AI_COPIE_ATTESE`, tre se non detto). Cosi' la somma di quello che escono a
 * spendere N copie resta intorno al tetto scritto, invece di moltiplicarlo.
 * Un guasto di passaggio (pochi minuti) non stringe niente: li' un freno largo
 * e' meglio di nessun freno, ed e' giusto ripiegare.
 *
 * Il prezzo di questa scelta, detto chiaro: finche' il conto condiviso manca,
 * una copia sola puo' spendere un terzo del tetto e non di piu' — cioe' l'AI si
 * puo' fermare prima di quanto Nicola si aspetti. E' la direzione giusta in cui
 * sbagliare quando dall'altra parte escono soldi veri, ed e' rumorosa invece che
 * silenziosa: `allarmiTettoSpesaAi` accende la spia che dice cosa fare.
 *
 * Qui dentro NON si importa niente: nessun database, nessun registro, nessun
 * `next/server`. Sono funzioni pure che un test puo' ESEGUIRE, e la prova di
 * questo file gira in millisecondi senza toccare nulla.
 */

/** Come sta il conto condiviso, visto da questa copia. */
export type ContoCondivisoStato = {
  /** Vero quando il conto in comune risponde: allora il tetto e' quello scritto. */
  condiviso: boolean;
  /** L'errore dice che il conto NON ESISTE (funzione/tabella mancante): non passa da solo. */
  permanente: boolean;
  /** Le parole vere del database, per chi legge i registri. */
  motivo: string;
  /** Da quanti minuti questa copia sta contando in casa propria. */
  daMinuti: number;
};

/**
 * Quante copie della funzione possono essere in aria insieme. Tre e' la stima
 * prudente per un progetto Vercel piccolo: si cambia con `AI_COPIE_ATTESE`
 * senza toccare il codice.
 */
export const COPIE_ATTESE_PREDEFINITE = 3;

/**
 * Quanto si tollera un ripiego prima di considerarlo lo stato del mondo.
 * Un'ora: sotto e' un guasto, sopra e' una configurazione sbagliata.
 */
export const RIPIEGO_TOLLERATO_MINUTI = 60;

/** Da euro a centesimi, senza perdere le chiamate che costano pochissimo. */
export function euroInCents(eur: number): number {
  if (!Number.isFinite(eur) || eur <= 0) return 0;
  return Math.max(1, Math.round(eur * 100));
}

/** Legge `AI_COPIE_ATTESE` senza fidarsi: mai meno di una copia. */
export function leggiCopieAttese(grezzo: string | number | undefined | null): number {
  const n = Number(grezzo);
  if (!Number.isFinite(n) || n < 1) return COPIE_ATTESE_PREDEFINITE;
  return Math.floor(n);
}

/**
 * Il ripiego e' diventato lo stato del mondo, non un inciampo?
 *
 * Due strade portano allo stesso «si'», e sono diverse apposta:
 * · l'errore dice che il conto condiviso non esiste → non passera' MAI da solo;
 * · dura da piu' di un'ora → qualunque cosa sia, non e' un guasto di passaggio.
 */
export function ripiegoDurevole(
  conto: ContoCondivisoStato,
  tolleranzaMinuti: number = RIPIEGO_TOLLERATO_MINUTI,
): boolean {
  if (conto.condiviso) return false;
  return conto.permanente || conto.daMinuti > tolleranzaMinuti;
}

export type MotivoDecisione =
  | 'nessun_tetto'
  | 'sotto_il_tetto'
  | 'tetto_superato'
  | 'quota_di_ripiego_superata'
  | 'spesa_sconosciuta';

export type DecisioneSpesa = {
  /** Si puo' chiamare il modello a pagamento? */
  consentito: boolean;
  /** Il tetto scritto nella variabile d'ambiente, in centesimi. */
  tettoCents: number;
  /** Quello che vale per QUESTA copia adesso: piu' stretto se il conto non e' condiviso. */
  tettoEffettivoCents: number;
  /** Su quante copie e' stato diviso il tetto (1 = conto condiviso vivo). */
  copieAttese: number;
  /** Il conto non e' condiviso e non lo sara' a breve. */
  ripiegoDurevole: boolean;
  motivo: MotivoDecisione;
};

/**
 * La decisione, tutta qui: nessun giro di rete, nessuno stato nascosto.
 * Chi chiama porta il tetto, quanto risulta speso e come sta il conto.
 */
export function decidiSpesaAi(input: {
  /** `AI_GLOBAL_DAILY_BUDGET_EUR`. Zero o assente = nessun tetto configurato. */
  tettoEur: number;
  /** Quanto risulta speso oggi, in centesimi (condiviso se c'e', altrimenti in casa). */
  spesaCents: number;
  conto: ContoCondivisoStato;
  copieAttese?: number;
  tolleranzaRipiegoMinuti?: number;
}): DecisioneSpesa {
  const tettoCents = euroInCents(input.tettoEur);
  const copieGrezze = input.copieAttese ?? COPIE_ATTESE_PREDEFINITE;
  const copie = Number.isFinite(copieGrezze) ? Math.max(1, Math.floor(copieGrezze)) : COPIE_ATTESE_PREDEFINITE;
  const durevole = ripiegoDurevole(input.conto, input.tolleranzaRipiegoMinuti);

  if (tettoCents <= 0) {
    return {
      consentito: true,
      tettoCents: 0,
      tettoEffettivoCents: 0,
      copieAttese: 1,
      ripiegoDurevole: durevole,
      motivo: 'nessun_tetto',
    };
  }

  // Il tetto del sito diviso le copie che possono spenderlo in parallelo. Mai
  // sotto un centesimo: un tetto di zero fermerebbe tutto per un arrotondamento.
  const tettoEffettivoCents = durevole ? Math.max(1, Math.floor(tettoCents / copie)) : tettoCents;
  const base = {
    tettoCents,
    tettoEffettivoCents,
    copieAttese: durevole ? copie : 1,
    ripiegoDurevole: durevole,
  };

  // Un numero che non e' un numero non e' «zero speso»: e' «non lo so». Con
  // dei soldi dall'altra parte, «non lo so» si tratta come «basta».
  if (!Number.isFinite(input.spesaCents)) {
    return { ...base, consentito: false, motivo: 'spesa_sconosciuta' };
  }

  const spesa = Math.max(0, input.spesaCents);
  if (spesa < tettoEffettivoCents) {
    return { ...base, consentito: true, motivo: 'sotto_il_tetto' };
  }
  return {
    ...base,
    consentito: false,
    motivo: durevole ? 'quota_di_ripiego_superata' : 'tetto_superato',
  };
}

/** Una riga d'allarme, nella forma che il cron degli avvisi gia' spedisce. */
export type AllarmeTetto = {
  /** Chiave stabile per il dedup: dentro non ci vanno parti che cambiano (i minuti). */
  key: string;
  type: string;
  detail: string;
  url?: string;
};

export const TIPO_ALLARME_TETTO_AI = 'AI_TETTO_NON_CONDIVISO';

/**
 * La spia rossa: il conto della spesa AI non e' piu' in comune.
 *
 * Va chiamata da chi sorveglia (`app/api/cron/operational-alerts`) passando lo
 * stato che torna da `sondaContoCondiviso()`. Torna una lista vuota quando non
 * c'e' niente da dire — cosi' chi chiama fa `alerts.push(...allarmi)` e basta.
 *
 * Il limite, detto qui e non taciuto: `daMinuti` lo sa solo la copia che sta
 * ripiegando, e la copia che gira il cron non e' la stessa che serve le
 * richieste AI. Per questo l'assenza PERMANENTE (la funzione non esiste) e'
 * rossa subito: quella la sonda la vede da qualunque copia, e non passa da
 * sola. L'ora di tolleranza vale per il guasto di rete, dove ha senso.
 */
export function allarmiTettoSpesaAi(
  conto: ContoCondivisoStato,
  opzioni: {
    tettoEur?: number;
    copieAttese?: number;
    tolleranzaRipiegoMinuti?: number;
  } = {},
): AllarmeTetto[] {
  const tettoEur = opzioni.tettoEur ?? 0;
  // Nessun tetto configurato = nessuna promessa da mantenere, niente da urlare.
  if (!(tettoEur > 0)) return [];
  if (!ripiegoDurevole(conto, opzioni.tolleranzaRipiegoMinuti)) return [];

  const copie = leggiCopieAttese(opzioni.copieAttese);
  const quotaEur = (Math.max(1, Math.floor(euroInCents(tettoEur) / copie)) / 100).toFixed(2);
  const causa = conto.permanente ? 'assente' : 'irraggiungibile';
  const da = conto.permanente
    ? 'non esiste in questo database'
    : `non risponde da ${conto.daMinuti} min`;

  return [
    {
      key: `${TIPO_ALLARME_TETTO_AI}|${causa}`,
      type: TIPO_ALLARME_TETTO_AI,
      detail:
        `Il conto della spesa AI in comune ${da}: ogni copia del sito conta per se'. ` +
        `Il tetto di ${tettoEur.toFixed(2)} € al giorno e' sceso a ${quotaEur} € per copia per non moltiplicarsi. ` +
        `Rimedio: applicare la migrazione del conto condiviso (131 / 158). Detto dal database: ${conto.motivo || 'nessun messaggio'}.`,
      url: '/admin/today',
    },
  ];
}
