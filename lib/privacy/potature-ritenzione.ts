/**
 * LE POTATURE DEI DATI OLTRE LA FINESTRA DICHIARATA.
 *
 * Ogni notte il giro delle cancellazioni toglie di mezzo i dati personali che
 * hanno superato il tempo scritto nella pagina pubblica della privacy: gli
 * indirizzi di rete dei log, il profilo di navigazione, i messaggi dal modulo
 * contatti, le foto della consegna, l'email di chi ha ricevuto un buono regalo.
 *
 * ── PERCHE' STA QUI E NON DENTRO LA ROTTA ──
 *
 * 8/9/2026 — IL GIRO POTEVA SALTARNE SEI SU OTTO E RISPONDERE «TUTTO A POSTO».
 *
 * Le potature stavano in fila dentro `app/api/cron/process-deletions/route.ts`,
 * dentro UN solo `try` con UN solo `catch` in fondo. Bastava che una lanciasse
 * — un client che rifiuta la promessa, la rete che cade a meta' giro, un metodo
 * che non c'e' — perche' il `catch` ingoiasse tutto e le potature successive non
 * partissero nemmeno. Il conto delle fallite restava a zero, la risposta era
 * 200, nessuno veniva svegliato: i dati oltre la finestra restavano dov'erano e
 * la pagina pubblica continuava a promettere il contrario.
 *
 * La malattia era una sola, e aveva due facce:
 *  ① i modi di fallire erano DUE — l'errore restituito nell'oggetto (PostgREST
 *    non lancia) e l'eccezione vera — e ne veniva contato uno solo;
 *  ② le potature erano legate a filo: la prima che cadeva portava giu' le altre.
 *
 * Qui la cura e' strutturale, non puntuale. Le potature sono un ELENCO di passi
 * indipendenti; il motore le esegue una per una, ognuna nel suo `try`, e
 * converte l'errore-nell'oggetto in un'eccezione: un modo solo di fallire, un
 * posto solo dove si conta. Una potatura nuova aggiunta domani nasce isolata e
 * contata, senza che nessuno debba ricordarsene.
 *
 * Sta fuori dalla rotta anche per una ragione pratica: dentro `route.ts`, in
 * mezzo a `next/server`, questa decisione una prova non la puo' ESEGUIRE.
 */

/** Cosa risponde una scrittura del database: PostgREST non lancia, restituisce. */
type Risposta = { error: { message: string } | null };

/** La catena di filtri che le potature usano davvero, e nient'altro. */
type Filtrabile = PromiseLike<Risposta> & {
  eq(colonna: string, valore: unknown): Filtrabile;
  lt(colonna: string, valore: unknown): Filtrabile;
  is(colonna: string, valore: unknown): Filtrabile;
  not(colonna: string, operatore: string, valore: unknown): Filtrabile;
  or(espressione: string): Filtrabile;
};

/**
 * Il minimo che serve per potare. Scritto a mano e non preso dal client vero
 * perche' una prova deve poterlo costruire in dieci righe: se qui ci fosse il
 * tipo di Supabase intero, il finto database sarebbe impossibile da scrivere e
 * questa decisione tornerebbe a non essere provabile.
 */
export type ClientePotature = {
  from(tabella: string): {
    update(valori: Record<string, unknown>): Filtrabile;
    delete(): Filtrabile;
  };
  rpc(
    nome: string,
    argomenti?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  storage: {
    from(secchio: string): {
      remove(percorsi: string[]): PromiseLike<Risposta>;
    };
  };
};

/** Il registro degli errori: la rotta passa il suo, una prova passa il suo. */
export type Registro = {
  info(messaggio: string, dati?: Record<string, unknown>): void;
  warn(messaggio: string, dati?: Record<string, unknown>): void;
  error(messaggio: string, dati?: Record<string, unknown>): void;
};

/** Una potatura: un nome che si legge e il lavoro da fare. */
export type Potatura = {
  /** Il nome che esce nel registro e nel rapporto. */
  cosa: string;
  /** Fa la potatura. Se non riesce LANCIA: il motore la conta e tira dritto. */
  fai: (admin: ClientePotature, registro: Registro) => Promise<void>;
};

export type EsitoPotatura = { cosa: string; ok: boolean; errore?: string };

export type RapportoPotature = {
  /** Quante sono andate a buon fine. */
  fatte: number;
  /** Quante NON sono riuscite: e' il numero che rende rossa la notte. */
  fallite: number;
  /** Una riga per potatura, in ordine. */
  esiti: EsitoPotatura[];
};

/**
 * Aspetta una scrittura e LANCIA se il database ha detto di no.
 *
 * E' il punto in cui i due modi di fallire diventano uno. PostgREST non lancia:
 * restituisce `{ error: … }`, e un `try/catch` intorno non lo vede. Chi
 * chiamava doveva ricordarsi di guardare dentro l'oggetto — e infatti per mesi
 * nessuno l'ha fatto.
 */
async function esigi(scrittura: PromiseLike<Risposta>): Promise<void> {
  const { error } = await scrittura;
  if (error) throw new Error(error.message);
}

/** La stessa cosa per le funzioni del database, che rispondono anche coi dati. */
async function esigiRpc(
  admin: ClientePotature,
  nome: string,
  argomenti?: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await admin.rpc(nome, argomenti);
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Fa scadere i file di un secchio, con la regola scritta nel database.
 *
 * Il database non puo' parlare con lo storage: sono due mondi separati. Quindi
 * la funzione SQL azzera le colonne e restituisce i percorsi dei file, e qui si
 * tolgono i file veri. Se si facesse il contrario — prima i file, poi le
 * colonne — un guasto a meta' lascerebbe righe che puntano a fotografie che non
 * esistono piu'; cosi' invece il caso peggiore e' un file orfano nello storage,
 * che nessuna pagina sa piu' mostrare.
 */
async function potaFileScaduti(
  admin: ClientePotature,
  registro: Registro,
  funzione: 'documenti_da_cancellare_respinti' | 'foto_consegna_da_cancellare',
  secchio: 'kyc-docs' | 'cod-proof',
  giorni = 90,
): Promise<void> {
  const data = await esigiRpc(admin, funzione, { p_giorni: giorni });
  let tolti = 0;
  const rimasti: string[] = [];
  for (const riga of (data ?? []) as Array<{ percorsi: string[] | null }>) {
    const percorsi = (riga.percorsi ?? []).filter(Boolean);
    if (percorsi.length === 0) continue;
    const { error: errRimozione } = await admin.storage.from(secchio).remove(percorsi);
    if (errRimozione) {
      // I percorsi finiscono nel registro apposta: la colonna che li teneva e'
      // gia' stata azzerata, quindi senza questa riga il file resterebbe nello
      // storage e nessuno saprebbe piu' dove cercarlo.
      registro.warn('[cron-deletions] file scaduti non rimossi', {
        secchio, err: errRimozione.message, percorsi,
      });
      rimasti.push(...percorsi);
      continue;
    }
    tolti += percorsi.length;
  }
  registro.info('[cron-deletions] file scaduti rimossi', { funzione, secchio, tolti });
  // 8/9/2026 — Un file che resta nello storage e' un dato personale oltre la
  // finestra, esattamente come una riga non ripulita: se la rimozione e' stata
  // rifiutata, questa potatura NON e' riuscita e la notte lo deve dire.
  if (rimasti.length > 0) {
    throw new Error(`${rimasti.length} file non rimossi dal secchio ${secchio}`);
  }
}

const mesiFa = (adessoMs: number, m: number) => new Date(adessoMs - m * 30 * 86_400_000).toISOString();
const giorniFa = (adessoMs: number, g: number) => new Date(adessoMs - g * 86_400_000).toISOString();

/**
 * L'elenco delle potature, nell'ordine in cui girano.
 *
 * Prende l'ora come argomento — e non `Date.now()` da dentro — perche' cosi'
 * una prova puo' far finta che sia una notte qualunque e verificare le finestre
 * vere, invece di fidarsi.
 */
export function potatureDiRitenzione(adessoMs: number): Potatura[] {
  const mesi = (m: number) => mesiFa(adessoMs, m);
  const giorni = (g: number) => giorniFa(adessoMs, g);

  return [
    // 🟡-15: enforcement della retention documentata (privacy §3) per i log che
    // contengono PII (IP/user-agent). I periodi sono dichiarati nella privacy:
    // log di sicurezza/accesso 12 mesi, analitica 14 mesi. Qui rimuoviamo
    // l'IP/UA oltre quei periodi (l'azione/evento resta, la PII no).
    //
    // 27/8/2026 (R059) — ERANO 14 MESI, E NE AVEVAMO DICHIARATI 12.
    // Nella tabella della conservazione, sulla riga «Sicurezza, anti-frode»,
    // c'e' scritto «12 mesi (log accessi)». Qui ne stavano quattordici. Un
    // periodo piu' lungo di quello che abbiamo dichiarato noi stessi non e' una
    // svista da poco: in un controllo e' una contestazione che ci siamo scritti
    // da soli, sulla nostra pagina pubblica.
    {
      cosa: 'activity_events.ip',
      fai: (admin) => esigi(admin
        .from('activity_events')
        .update({ ip: null, user_agent: null })
        .lt('created_at', mesi(12))
        .not('ip', 'is', null)),
    },
    // 077 — `consent_log` era l'unica tabella con dati personali che nessuna
    // pulizia toccava: l'indirizzo di rete restava li' per sempre. La PROVA del
    // consenso va conservata (e' l'accountability dell'art. 7.1), l'indirizzo
    // di rete no.
    //
    // 27/8/2026 (R066) — IL NUMERO DI MESI VIVEVA IN DUE POSTI. Adesso sta solo
    // dentro la funzione (migrations/135) e si chiama senza argomenti, cosi'
    // non c'e' un secondo posto da ricordarsi di cambiare.
    {
      cosa: 'consent_log',
      fai: async (admin, registro) => {
        const potati = await esigiRpc(admin, 'pota_consent_log');
        registro.info('[cron-deletions] registro consensi potato', { potati });
      },
    },
    // Fix #33: la retention dichiarata (14 mesi) non annullava
    // anon_id/path/city/referrer. Oltre 14 mesi azzeriamo anche il profilo
    // comportamentale pseudonimo (art. 5.1.e GDPR).
    //
    // 27/8/2026 (R059) — QUI C'ERA UN FILTRO CHE SALTAVA DELLE RIGHE.
    // C'era anche `.not('anon_id','is',null)`, cioe' «ripulisci solo le righe
    // che hanno gia' un identificativo anonimo». Le righe scritte dai trigger
    // del database non ce l'hanno: pagina, referente, citta' e paese restavano
    // li' per sempre proprio sulle righe che nessuno andava a guardare.
    {
      cosa: 'activity_events.profilo',
      fai: (admin) => esigi(admin
        .from('activity_events')
        .update({ anon_id: null, path: null, referrer: null, city: null, country: null })
        .lt('created_at', mesi(14))),
    },
    {
      cosa: 'audit_logs.ip',
      fai: (admin) => esigi(admin
        .from('audit_logs')
        .update({ ip: null, user_agent: null })
        .lt('created_at', mesi(12))
        .not('ip', 'is', null)),
    },
    // `metadata` e `summary` sono i campi che contengono i valori vecchi e nuovi
    // delle colonne cambiate, quindi la parte piu' personale della riga.
    //
    // 30/8/2026 (R169) — IL FILTRO GUARDAVA UNA COLONNA E LA PULIZIA NE TOCCAVA
    // DUE. C'era `.not('metadata','is',null)`. Ma `metadata` lo scrive solo la
    // PRIMA vista di una sessione: quasi tutte le righe ce l'hanno vuoto, e
    // quelle non venivano nemmeno guardate. Il loro `summary` — la frase che
    // racconta cosa e' successo, indirizzi e ricerche comprese — restava li'
    // per sempre. Adesso il filtro guarda le stesse due colonne che azzera.
    {
      cosa: 'activity_events.riassunto',
      fai: (admin) => esigi(admin
        .from('activity_events')
        .update({ metadata: null, summary: null })
        .lt('created_at', mesi(14))
        .or('metadata.not.is.null,summary.not.is.null')),
    },
    {
      cosa: 'audit_logs.metadata',
      fai: (admin) => esigi(admin
        .from('audit_logs')
        .update({ metadata: null })
        .lt('created_at', mesi(12))
        .not('metadata', 'is', null)),
    },
    // 098 — `product_views` cresceva senza fine: una riga per ogni visita a una
    // scheda, per sempre. Ma il negoziante non deve perdere lo storico. La
    // funzione prima SALVA il conto giornaliero, poi cancella le righe singole:
    // la riga grezza dura 90 giorni, il numero resta per sempre.
    {
      cosa: 'product_views',
      fai: async (admin, registro) => {
        const consolidate = await esigiRpc(admin, 'consolida_visite_prodotto', { p_giorni: 90 });
        registro.info('[cron-deletions] visite prodotto consolidate', { consolidate });
      },
    },
    // E le righe di semplice navigazione si cancellano, non si sbiancano: senza
    // questo la tabella cresceva per sempre. Le altre categorie restano perche'
    // servono da traccia di sicurezza e contabile.
    {
      cosa: 'activity_events.navigazione',
      fai: (admin) => esigi(admin
        .from('activity_events')
        .delete()
        .eq('category', 'visitor')
        .lt('created_at', mesi(14))),
    },
    // 27/8/2026 (R059) — LE RIGHE DI ACCESSO NON SE NE ANDAVANO MAI.
    // Si cancellava solo la categoria `visitor`. Gli eventi di accesso —
    // entrata, uscita, registrazione, categoria `auth` — restavano per sempre:
    // chi sei, da che apparecchio, con che programma, in che giorno e a che
    // ora. Un archivio di accessi che cresce senza fine e' anche il bottino
    // peggiore da lasciare in mano a un intruso. La finestra e' la stessa che
    // dichiariamo per i log di accesso: 12 mesi.
    {
      cosa: 'activity_events.accessi',
      fai: (admin) => esigi(admin
        .from('activity_events')
        .delete()
        .eq('category', 'auth')
        .lt('created_at', mesi(12))),
    },
    // I messaggi dal modulo contatti oltre due anni non servono piu' a nessuno.
    {
      cosa: 'contact_messages',
      fai: (admin) => esigi(admin
        .from('contact_messages')
        .delete()
        .lt('created_at', mesi(24))),
    },
    // 6/9/2026 — L'ISCRIZIONE CHE NESSUNO HA MAI CONFERMATO RESTAVA QUI PER
    // SEMPRE. Il modulo della newsletter e' pubblico: chiunque puo' scriverci
    // l'indirizzo di un altro e far partire l'email di conferma. Finche'
    // quell'altro non clicca, la riga resta in piedi con dentro il suo
    // indirizzo, l'indirizzo di rete di chi l'ha scritto e il gettone.
    //
    // I quattro filtri servono tutti, e i due di mezzo sono quelli facili da
    // dimenticare:
    //  · `active` falso — le iscrizioni piu' vecchie della migrazione 115 hanno
    //    `confirmed_at` vuoto perche' quella colonna non esisteva ancora, e
    //    sono iscritti veri (la 015 metteva `active` a vero). Senza questo
    //    filtro la potatura buttava via meta' della lista, e in silenzio.
    //  · `unsubscribed_at` vuoto — chi si e' cancellato dalla lista (la 118
    //    spegne `active` e scrive la data) tiene la sua riga: e' la prova che
    //    non lo vuole piu', e cancellarla vuol dire rischiare di riscrivergli.
    //
    // Trenta giorni: la conferma si clicca lo stesso giorno o mai piu'.
    {
      cosa: 'newsletter_subscribers',
      fai: (admin) => esigi(admin
        .from('newsletter_subscribers')
        .delete()
        .is('confirmed_at', null)
        .is('unsubscribed_at', null)
        .eq('active', false)
        .lt('created_at', giorni(30))),
    },
    // 27/8/2026 (R056) — I DOCUMENTI DI CHI VIENE RESPINTO.
    // La funzione esisteva dalla migrazione 119 col commento «il cron cancella
    // i file dallo storage», e nessun cron la chiamava.
    {
      cosa: 'documenti-kyc-respinti',
      fai: (admin, registro) =>
        potaFileScaduti(admin, registro, 'documenti_da_cancellare_respinti', 'kyc-docs'),
    },
    // 27/8/2026 (R058) — LE FOTO DELLA CONSEGNA IN CONTANTI.
    // I contanti, la firma e «il pacco lasciato» — cioe' quasi sempre la porta
    // di casa del cliente. Stanno nella cartella del FATTORINO, quindi quando
    // il cliente cancellava l'account non venivano nemmeno cercate. Novanta
    // giorni dalla consegna: il tempo della quadratura di cassa e di un
    // reclamo. Dopo, e' la fotografia di una casa e basta.
    {
      cosa: 'foto-consegna',
      fai: (admin, registro) =>
        potaFileScaduti(admin, registro, 'foto_consegna_da_cancellare', 'cod-proof'),
    },
    // 3/9/2026 — IL BUONO REGALO TENEVA PER SEMPRE L'EMAIL DI CHI NON E' NOSTRO
    // CLIENTE. I dati del destinatario servono a recapitare il regalo. Finito
    // quello — buono speso o scaduto da piu' di 12 mesi — non servono a niente,
    // e appartengono a una persona che con noi non ha nessun rapporto.
    //
    // Il credito e il codice restano: si tolgono solo nome, email e messaggio —
    // il messaggio e' il testo privato che una persona ha scritto a un'altra.
    // Il filtro `recipient_email is not null` rende la pulizia idempotente.
    {
      cosa: 'gift_cards',
      fai: (admin) => esigi(admin
        .from('gift_cards')
        .update({ recipient_name: null, recipient_email: null, message: null })
        .lt('expires_at', mesi(12))
        .not('recipient_email', 'is', null)),
    },
    {
      cosa: 'gift_cards_esauriti',
      fai: (admin) => esigi(admin
        .from('gift_cards')
        .update({ recipient_name: null, recipient_email: null, message: null })
        .eq('balance_cents', 0)
        .lt('redeemed_at', mesi(12))
        .not('recipient_email', 'is', null)),
    },
  ];
}

/**
 * Esegue le potature, una per una, ognuna per conto suo.
 *
 * Nessuna puo' portarsi dietro le altre: il `try` sta DENTRO il giro, non
 * intorno. Ed e' l'unico posto dove si conta, cosi' non esiste piu' un modo di
 * fallire che passa per fatto.
 */
export async function eseguiPotature(
  admin: ClientePotature,
  registro: Registro,
  adessoMs: number = Date.now(),
  passi: Potatura[] = potatureDiRitenzione(adessoMs),
): Promise<RapportoPotature> {
  const esiti: EsitoPotatura[] = [];

  for (const passo of passi) {
    try {
      await passo.fai(admin, registro);
      esiti.push({ cosa: passo.cosa, ok: true });
    } catch (e) {
      const errore = e instanceof Error ? e.message : 'errore';
      esiti.push({ cosa: passo.cosa, ok: false, errore });
      registro.error(
        '[cron-deletions] pulizia non riuscita: i dati oltre la finestra restano dove sono',
        { cosa: passo.cosa, message: errore },
      );
    }
  }

  const fallite = esiti.filter((e) => !e.ok).length;
  return { fatte: esiti.length - fallite, fallite, esiti };
}
