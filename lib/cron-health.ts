/**
 * Dead-man's switch dei cron (audit 🟠-25).
 *
 * Ogni cron registra un heartbeat (tabella cron_heartbeats, scritta in modo
 * trasparente da withCronAuth); il cron operational-alerts confronta i heartbeat
 * con le soglie qui sotto e segnala quelli che hanno SMESSO di girare (scheduler
 * fermo, deploy rotto, secret cambiato…). È il "ti accorgi alle 3 di notte".
 *
 * Limite noto: operational-alerts NON può vigilare su sé stesso (se muore, niente
 * gira).
 *
 * 30/8/2026 (R183) — QUI C'ERA SCRITTO CHE QUEL CASO ERA COPERTO, E NON LO ERA.
 *
 * La frase diceva: «Quel caso resta coperto dal monitor uptime esterno su
 * /api/health». Ma /api/health guardava soltanto il database e le variabili
 * d'ambiente: dei battiti non sapeva niente. Se il sorvegliante moriva, il
 * monitor esterno restava verde — e con lui smetteva di guardare tutto il
 * resto. Una copertura dichiarata e inesistente è peggio di nessuna copertura:
 * ci si smette di pensare.
 *
 * Adesso è vero: /api/health legge i battiti e li confronta con
 * `SOGLIE_VISTE_DA_FUORI`, che è questo elenco PIÙ il sorvegliante stesso.
 */

export type CronHeartbeat = { name: string; last_run_at: string | null };

/**
 * Massima staleness tollerata per cron (minuti) — qualche volta la cadenza
 * attesa, per non lampeggiare a ogni piccolo ritardo. NB: operational-alerts non
 * è in elenco (non può auto-vigilarsi).
 */
export const CRON_MAX_STALENESS_MIN: Record<string, number> = {
  'release-payouts': 120, // cadenza 15 min
  'send-emails': 120, // cadenza 10 min
  'send-push': 120, // cadenza 5 min
  'expire-checkouts': 180, // cadenza 30 min
  'expire-stale-orders': 180, // cadenza 30 min
  'abandoned-carts': 180, // cadenza 1 h
  'process-deletions': 1560, // cadenza 1×/giorno → 26 h
  // #242 — Mancava: era l'unico lavoro sorvegliabile lasciato fuori
  // dall'elenco. Se si fermava, gli avvisi sui prezzi dei concorrenti
  // smettevano di arrivare e nessuno se ne accorgeva.
  'external-price-alerts': 180, // cadenza 1 h
  // Radiografia 27/8/2026 (R182) — Era rimasta fuori la quadratura della cassa
  // contanti: il controllo che i soldi incassati in mano dai fattorini tornino
  // davvero. Poteva essere ferma da settimane senza che nessuno lo sapesse,
  // perche' un lavoro non sorvegliato e uno sorvegliato che va bene fanno lo
  // stesso identico silenzio. Adesso il buco non si puo' piu' riaprire da solo:
  // lo tiene chiuso tests/unit/ogni-lavoro-periodico-e-sorvegliato.test.ts, che
  // legge le cartelle vere di app/api/cron/ e pretende una soglia per ognuna.
  'riquadra-casse': 1560, // cadenza 1×/giorno → 26 h
};

/**
 * #242 — Un lavoro che non ha MAI battuto un colpo veniva ignorato per sempre.
 * La ragione era buona (non riempire di avvisi prima che lo scheduler sia
 * configurato) ma la conseguenza no: un lavoro configurato male alla nascita
 * restava invisibile per sempre, e sembrava sano. Dopo questa finestra, «mai
 * partito» diventa un problema da segnalare.
 */
export const FINESTRA_PRIMA_ACCENSIONE_MIN = 24 * 60;

export type StaleCron = { name: string; staleMin: number; thresholdMin: number };

/**
 * Cron monitorati il cui ultimo heartbeat supera la soglia. I cron senza alcun
 * heartbeat vengono IGNORATI (mai registrati: evita lo spam prima che lo
 * scheduler sia configurato; la migrazione 095 li seed-a con last_run_at=now()).
 */
export function staleCrons(
  heartbeats: CronHeartbeat[],
  nowMs: number,
  thresholds: Record<string, number> = CRON_MAX_STALENESS_MIN,
  /** Da quando esiste il sistema: serve a distinguere «mai partito» da «appena installato». */
  installatoDaMs?: number,
): StaleCron[] {
  const last = new Map(heartbeats.map((h) => [h.name, h.last_run_at]));
  const out: StaleCron[] = [];
  for (const [name, thresholdMin] of Object.entries(thresholds)) {
    const ts = last.get(name);
    if (!ts) {
      // #242 — Mai partito. Si segnala solo se e' passata la finestra di prima
      // accensione: prima e' rumore, dopo e' un lavoro che non ha mai girato.
      const daQuanto = installatoDaMs != null ? Math.floor((nowMs - installatoDaMs) / 60_000) : 0;
      if (daQuanto > FINESTRA_PRIMA_ACCENSIONE_MIN) {
        out.push({ name, staleMin: daQuanto, thresholdMin: FINESTRA_PRIMA_ACCENSIONE_MIN });
      }
      continue;
    }
    const staleMin = Math.floor((nowMs - new Date(ts).getTime()) / 60_000);
    if (staleMin > thresholdMin) out.push({ name, staleMin, thresholdMin });
  }
  return out;
}

/**
 * 30/8/2026 (R183) — LA SOGLIA DEL SORVEGLIANTE, PER CHI LO GUARDA DA FUORI.
 *
 * `operational-alerts` gira ogni 15 minuti (vercel.json). Non compare in
 * `CRON_MAX_STALENESS_MIN` perché lì l'elenco lo legge lui stesso, e un morto
 * non si segnala da solo. Da /api/health invece si vede, ed è l'unico posto da
 * cui si può vedere.
 *
 * 31/8/2026 (R183, secondo giro) — «SI VEDE DA /api/health» ERA VERO SOLO PER
 * CHI AVEVA IL SEGRETO. Il controllo veniva calcolato dentro `if (autorizzato)`
 * e in produzione l'unico che chiama davvero quella rotta — il monitor esterno
 * — non manda nessuna intestazione: leggeva 200 e «ok» con tutti i lavori
 * fermi. Adesso i battiti si guardano sempre e il risultato esce anche senza
 * segreto: se qualcuno lo rimette dietro l'autorizzazione, questa frase torna a
 * essere una copertura dichiarata e inesistente.
 */
export const SOGLIA_SORVEGLIANTE_MIN = 120;

/** L'elenco completo: i lavori sorvegliati PIÙ il sorvegliante. */
export const SOGLIE_VISTE_DA_FUORI: Record<string, number> = {
  ...CRON_MAX_STALENESS_MIN,
  'operational-alerts': SOGLIA_SORVEGLIANTE_MIN,
};

/**
 * I lavori fermi, a partire dai battiti grezzi.
 *
 * Sta qui e non nei due chiamanti perché la parte delicata è il secondo
 * argomento di `staleCrons`: «da quando esiste il sistema» distingue un lavoro
 * MORTO da uno appena installato, e senza quel valore il ramo «mai partito»
 * calcola zero minuti e non segnala mai niente — il caso peggiore che ci sia.
 * La data d'installazione è il battito più vecchio che esiste.
 */
export function lavoriFermi(
  battiti: CronHeartbeat[],
  nowMs: number,
  soglie: Record<string, number> = CRON_MAX_STALENESS_MIN,
): StaleCron[] {
  const quando = battiti
    .map((h) => (h.last_run_at ? new Date(h.last_run_at).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  const installatoDaMs = quando.length > 0 ? Math.min(...quando) : undefined;
  return staleCrons(battiti, nowMs, soglie, installatoDaMs);
}

/** Il conto di cosa questa lettura ha davvero potuto guardare. */
type CensimentoBattiti = {
  /** Quanti lavori si dovrebbero sorvegliare. */
  attesi: number;
  /** Di quanti si è letto un battito vero (data valida). */
  esaminati: number;
  /** Quelli che un battito ce l'hanno, ma vecchio oltre la loro soglia. */
  fermi: StaleCron[];
  /** Quelli di cui non esiste nessun battito leggibile: non sani, NON VISTI. */
  maiVisti: string[];
};

/**
 * 31/8/2026 (R183, secondo giro) — UN CONTROLLO CHE NON HA GUARDATO NIENTE
 * NON PUÒ USCIRE VERDE.
 *
 * `lavoriFermi` risponde a una domanda sola: «di quelli che ho visto, quali
 * sono indietro?». Con la tabella dei battiti vuota, o con tutte le date a
 * NULL, la risposta è «nessuno» — ed è formalmente giusta, ma chi la legge
 * capisce «va tutto bene» mentre la verità è «non ho guardato niente». Succede
 * da solo a ogni ambiente nuovo e dopo ogni ripristino del database, cioè
 * proprio quando i lavori periodici hanno più probabilità di non essere partiti.
 *
 * Peggio: da fuori un verde su zero lavori e un verde su dieci erano
 * indistinguibili, perché il numero di lavori guardati non usciva da nessuna
 * parte. Questo conto esiste per farlo uscire.
 *
 * Un lavoro «mai visto» non è dichiarato fermo qui — quella resta la parola di
 * `staleCrons`, con la sua finestra di prima accensione, perché è quella che fa
 * partire le email — ma non può nemmeno passare per sano: chi non l'ha mai
 * visto battere non ha niente su cui basarsi per dirlo.
 */
function censimentoBattiti(
  battiti: CronHeartbeat[],
  nowMs: number,
  soglie: Record<string, number> = SOGLIE_VISTE_DA_FUORI,
): CensimentoBattiti {
  const ultimo = new Map(battiti.map((h) => [h.name, h.last_run_at]));
  const sorvegliati = Object.keys(soglie);
  // Una data che non si riesce a leggere vale come battito assente: contarla
  // fra gli esaminati sarebbe un altro modo di dire «guardato» senza aver visto.
  const maiVisti = sorvegliati.filter((nome) => {
    const ts = ultimo.get(nome);
    return !ts || !Number.isFinite(new Date(ts).getTime());
  });
  return {
    attesi: sorvegliati.length,
    esaminati: sorvegliati.length - maiVisti.length,
    fermi: lavoriFermi(battiti, nowMs, soglie),
    maiVisti,
  };
}

/** Quello che /api/health racconta dei battiti, a chiunque lo chieda. */
export type EsitoBattiti = {
  /** Vero solo se ha guardato tutti i lavori e nessuno era indietro. */
  ok: boolean;
  /** Quanti lavori ha davvero guardato. */
  esaminati: number;
  /** Quanti ne doveva guardare. */
  attesi: number;
  /** Nomi e minuti di ritardo: si legge di notte, in fretta. */
  error?: string;
};

/**
 * 31/8/2026 (R183, secondo giro) — IL VERDETTO STA QUI, NON NELLA ROTTA.
 *
 * Perché il caso più insidioso non è un lavoro fermo, è un elenco di soglie
 * vuoto: zero lavori attesi, zero esaminati, «tutti quelli che dovevo guardare
 * li ho guardati» → verde, su niente. Nella rotta quella riga non sarebbe
 * dimostrabile senza un finto database; qui si prova con una chiamata sola.
 */
export function esitoBattiti(
  battiti: CronHeartbeat[],
  nowMs: number,
  soglie: Record<string, number> = SOGLIE_VISTE_DA_FUORI,
): EsitoBattiti {
  const censimento = censimentoBattiti(battiti, nowMs, soglie);
  const lamentele = censimento.fermi.map(
    (c) => `${c.name} fermo da ${c.staleMin}min (soglia ${c.thresholdMin})`,
  );
  // Un lavoro già dichiarato fermo non si nomina due volte: la riga la legge una
  // persona di notte, e due elenchi che si sovrappongono la fanno contare male.
  const giaDetti = new Set(censimento.fermi.map((c) => c.name));
  const mutoli = censimento.maiVisti.filter((nome) => !giaDetti.has(nome));
  if (mutoli.length > 0) lamentele.push(`mai visti battere: ${mutoli.join(', ')}`);
  if (censimento.attesi === 0) lamentele.push('nessun lavoro da sorvegliare: l elenco delle soglie e vuoto');
  return {
    ok: censimento.attesi > 0 && censimento.fermi.length === 0 && censimento.esaminati === censimento.attesi,
    esaminati: censimento.esaminati,
    attesi: censimento.attesi,
    error: lamentele.length > 0 ? lamentele.join('; ') : undefined,
  };
}
