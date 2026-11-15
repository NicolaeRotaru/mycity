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

import {
  GIORNI_DI_SICUREZZA_ORFANI,
  TETTO_ORFANI_PER_NOTTE,
  potaOrfaniKyc,
  type ClienteOrfani,
  type VoceSecchio,
} from './orfani-kyc';

/** Cosa risponde una scrittura del database: PostgREST non lancia, restituisce. */
type Risposta = { error: { message: string } | null };

/**
 * Quanti mesi restano i messaggi del modulo Contatti. Sta qui, una volta sola:
 * la potatura qui sotto e l'informativa sull'IBAN del rimborso — che il cliente
 * ci manda rispondendo alla nostra email, ma a volte scrive lo stesso in un
 * messaggio dai Contatti — leggono lo stesso numero.
 */
export const MESI_DEI_MESSAGGI_DEI_CONTATTI = 24;

/**
 * 13/11/2026 (R21-007) — Quanti mesi restano email e testo di una segnalazione dopo la decisione.
 * L'informativa (app/privacy/page.tsx) scrive lo stesso numero: la prova
 * `riparazione-r21-segnalazioni-email` fa girare la potatura e pretende che coincidano.
 */
const MESI_DELLE_SEGNALAZIONI_DECISE = 12;

/**
 * 13/11/2026 (R21-012) — Quanti mesi resta un prodotto fra gli «Ultimi visti» dall'ultima volta
 * che lo si è guardato. Gli «Ultimi visti» si scrivono solo col consenso ai cookie statistici:
 * sono un dato di analitica, e per l'analitica l'informativa promette 14 mesi (gli stessi delle
 * potature di `activity_events` qui sotto). L'informativa (app/privacy/page.tsx) scrive lo stesso
 * numero: la prova `riparazione-r21-ultimi-visti` fa girare la potatura e pretende che coincidano.
 */
const MESI_DEGLI_ULTIMI_VISTI = 14;

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
  /**
   * Il lavoro sui FILE delle righe che `fai` ha appena toccato (lo storage non
   * si puo' rigirare a vuoto). Gira dopo `fai`, nello stesso passo; il conto
   * senza cancellare non lo fa girare, perche' le righe che contano sono quelle
   * di `fai`: i file le seguono.
   */
  poi?: (admin: ClientePotature, registro: Registro) => Promise<void>;
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
  funzione:
    | 'documenti_da_cancellare_respinti'
    | 'kyc_file_da_togliere_prendi'
    | 'foto_consegna_da_cancellare',
  secchio: 'kyc-docs' | 'cod-proof',
  argomenti: Record<string, unknown> = { p_giorni: 90 },
): Promise<void> {
  const data = await esigiRpc(admin, funzione, argomenti);
  let tolti = 0;
  const rimasti: string[] = [];
  for (const riga of (data ?? []) as Array<{ percorsi: string[] | null; user_id?: string | null }>) {
    const percorsi = (riga.percorsi ?? []).filter(Boolean);
    if (percorsi.length === 0) continue;
    const { error: errRimozione } = await admin.storage.from(secchio).remove(percorsi);
    if (errRimozione) {
      // 5/11/2026 — La coda dei documenti d'identità si svuota PRIMA della rimozione
      // (DELETE … RETURNING): se lo storage rifiuta, i percorsi tornano in coda, così la
      // notte dopo ci si riprova invece di lasciarli solo nel registro (migrazione 215).
      if (funzione === 'kyc_file_da_togliere_prendi' && riga.user_id) {
        const { error: errRimessa } = await admin.rpc('kyc_file_da_togliere_rimetti', {
          p_profilo: riga.user_id, p_percorsi: percorsi,
        });
        if (errRimessa) registro.warn('[cron-deletions] percorsi non rimessi in coda', { err: errRimessa.message, percorsi });
      }
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

/**
 * 31/10/2026 — Scelta di Nicola (registro dei fatti, `kyc.documenti-iscrizione-a-meta`):
 * i documenti di chi carica carta e selfie e poi non finisce l'iscrizione si
 * cancellano dopo 30 giorni. Se torna, li ricarica.
 */
export const GIORNI_DOCUMENTI_ISCRIZIONE_A_META = 30;

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
        .lt('created_at', mesi(14))
        // 5/11/2026 — Senza filtro riscriveva ogni notte tutte le righe già pulite più
        // vecchie di 14 mesi (tuple morte, un UPDATE che cresce da solo dentro un lavoro
        // da 300 secondi). Si toccano solo le righe con ancora qualcosa da togliere.
        .or('anon_id.not.is.null,path.not.is.null,referrer.not.is.null,city.not.is.null,country.not.is.null')),
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
    // 13/11/2026 (R21-012) — GLI «ULTIMI VISTI» RESTAVANO PER SEMPRE.
    // `product_views` si consolida e si cancella, `recently_viewed` no: la cronologia dei
    // prodotti guardati, legata all'account, non scadeva mai. Ogni prodotto se ne va passati i
    // mesi dichiarati dall'ultima volta che la persona l'ha aperto (`viewed_at` si rinfresca a
    // ogni visita). Chi toglie il consenso perde la sua lista subito (migrazione 450).
    {
      cosa: 'recently_viewed',
      fai: (admin) => esigi(admin
        .from('recently_viewed')
        .delete()
        .lt('viewed_at', mesi(MESI_DEGLI_ULTIMI_VISTI))),
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
        .lt('created_at', mesi(MESI_DEI_MESSAGGI_DEI_CONTATTI))),
    },
    // 13/11/2026 (R21-007) — CHI SEGNALAVA UN CONTENUTO LASCIAVA LA SUA EMAIL LI' PER SEMPRE.
    // Email di contatto e testo libero di una segnalazione servono a esaminarla e a dire
    // com'e' finita. Passati i mesi dichiarati dalla decisione si tolgono; la riga resta, senza
    // dati personali, come traccia di cosa e' stato segnalato e deciso. Il filtro sui campi
    // ancora pieni rende la potatura ripetibile senza riscrivere ogni notte le righe gia' pulite.
    {
      cosa: 'segnalazioni',
      fai: (admin) => esigi(admin
        .from('segnalazioni')
        .update({ email_contatto: null, dettaglio: null })
        .lt('deciso_at', mesi(MESI_DELLE_SEGNALAZIONI_DECISE))
        .or('email_contatto.not.is.null,dettaglio.not.is.null')),
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
    // 31/10/2026 — I DOCUMENTI DI CHI SI FERMA A META' ISCRIZIONE.
    // `approval_status` nasce 'pending' e la potatura qui sopra guarda solo i
    // respinti: chi caricava carta d'identita' e selfie e poi abbandonava
    // restava 'pending' per sempre, coi documenti nel secchio. Chi e' «a meta'»
    // lo dice la vista della migrazione 171 (mai inviata, ultimo documento
    // caricato da piu' di 30 giorni). Cancellare dalla vista azzera le colonne
    // del profilo e mette i percorsi in coda (lo fa il database, riga per
    // riga, ricontrollando la regola); `poi` prende la coda e toglie i file.
    // Essendo una `delete` filtrata, il conto senza cancellare la conta come
    // le altre: stessa vista, stesso filtro.
    //
    // 12/11/2026 (R02-007) — Nel database vero la 171 non c'è ancora: vista, coda e funzione
    // mancano, il passo lanciava ogni notte e la rotta rispondeva 500 (fallite > 0) anche se
    // tutto il resto era andato. Senza la migrazione non c'è niente da potare qui: il passo lo
    // scrive nel registro come avviso e si salta, invece di far fallire la notte. Il giorno in
    // cui la 171 è applicata, il passo torna a lavorare senza toccare niente.
    potaturaKycIscrizioneAMeta(giorni(GIORNI_DOCUMENTI_ISCRIZIONE_A_META)),
    // 27/8/2026 (R058) — LE FOTO DELLA CONSEGNA IN CONTANTI.
    // I contanti, la firma e «il pacco lasciato» — cioe' quasi sempre la porta
    // di casa del cliente. Stanno nella cartella del FATTORINO, quindi quando
    // il cliente cancellava l'account non venivano nemmeno cercate. Novanta
    // giorni dalla consegna: il tempo della quadratura di cassa e di un
    // reclamo. Dopo, e' la fotografia di una casa e basta.
    // 13/11/2026 (R21-013) — Se qui lo storage rifiuta la rimozione, le colonne sono già azzerate:
    // la notte dopo quei file sono orfani e li ritoglie `potaturaDegliOrfaniDelleProve`.
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
 * 1/11/2026 — LE COPIE ORFANE DEL SECCHIO DEI DOCUMENTI (lib/privacy/orfani-kyc.ts).
 *
 * Sta FUORI da `potatureDiRitenzione` di proposito: e' l'unica potatura che
 * ELENCA lo storage e LEGGE i profili, e il conto senza cancellare
 * (`contaPotature`) non sa fare nessuna delle due cose senza scrivere. La notte
 * vera la prende da `potatureNotturne`, che e' l'elenco di prima piu' questa.
 */
export function potaturaDegliOrfaniKyc(adessoMs: number): Potatura {
  return {
    cosa: 'documenti-kyc-orfani',
    fai: async (admin, registro) => {
      await potaOrfaniKyc(admin as unknown as ClienteOrfani, registro, adessoMs);
    },
  };
}

/**
 * 1/11/2026 — IL CONTO DELLE COPIE ORFANE, SENZA TOGLIERNE NESSUNA.
 *
 * Il conto a mano (`contaPotature`) non sa elencare lo storage, e taceva sui
 * documenti d'identita': acceso il giro vero, la prima notte ne sparivano fino
 * a `TETTO_ORFANI_PER_NOTTE` da un secchio senza backup, senza che nessuno
 * l'avesse visto prima. Qui il passo gira in «solo conta» (elencare e leggere
 * i profili sono letture), e lo storage passato ha `remove` che rifiuta: anche
 * se un giorno la modalita' si rompesse, non si toglie niente.
 * Il numero sono FILE, non righe: quelli che la notte toglierebbe, tetto
 * compreso. Per questo ha un tipo suo e non sta nell'elenco delle righe
 * toccate, dove si confronterebbe con le scritture del database.
 */
export type ContoFile =
  | { cosa: string; file: number }
  | { cosa: string; file: null; nonContata: string };

export async function contaOrfaniKyc(admin: ClienteOrfani, adessoMs: number = Date.now()): Promise<ContoFile> {
  const cosa = 'documenti-kyc-orfani';
  const senzaTogliere: ClienteOrfani = {
    from: (tabella) => admin.from(tabella),
    storage: {
      from: (secchio) => {
        const vero = admin.storage.from(secchio);
        return {
          list: (prefisso, opzioni) => vero.list(prefisso, opzioni),
          remove: () => Promise.reject(new Error(NON_SI_CONTA_SENZA_FARLA)),
        };
      },
    },
  };
  try {
    const r = await potaOrfaniKyc(senzaTogliere, registroMuto, adessoMs, { soloConta: true });
    return { cosa, file: r.daTogliere };
  } catch (e) {
    return { cosa, file: null, nonContata: e instanceof Error ? e.message : 'errore' };
  }
}

/**
 * 12/11/2026 (R02-007) — «Questa tabella o funzione non esiste»: PostgREST lo dice con PGRST205
 * (tabella o vista) o PGRST202 (funzione), Postgres con 42P01. Vuol dire migrazione non applicata,
 * non un guasto della notte.
 */
export function mancaLaMigrazione(errore: { message?: string; code?: string } | null | undefined): boolean {
  if (!errore) return false;
  // Solo i codici di «relazione o funzione che non esiste», e solo se parlano degli oggetti della
  // 171: una colonna mancante (42703, PGRST204), un ruolo o un permesso sono guasti veri.
  const codice = errore.code === 'PGRST205' || errore.code === 'PGRST202' || errore.code === '42P01';
  return codice && /documenti_iscrizione_a_meta|kyc_file_da_togliere/.test(errore.message ?? '');
}

/** I documenti di chi si ferma a metà iscrizione (migrazione 171), saltati se la 171 manca. */
function potaturaKycIscrizioneAMeta(prima: string): Potatura {
  let saltato = false;
  const salta = (registro: Registro, dove: string, errore: { message: string }) => {
    saltato = true;
    registro.warn('[cron-deletions] passo saltato: manca la migrazione 171 nel database', {
      cosa: 'documenti-kyc-iscrizione-a-meta',
      dove,
      message: errore.message,
    });
  };
  return {
    cosa: 'documenti-kyc-iscrizione-a-meta',
    fai: async (admin, registro) => {
      saltato = false;
      const { error } = await admin.from('documenti_iscrizione_a_meta').delete().lt('caricati_at', prima);
      if (!error) return;
      if (mancaLaMigrazione(error)) return salta(registro, 'documenti_iscrizione_a_meta', error);
      throw new Error(error.message);
    },
    poi: async (admin, registro) => {
      if (saltato) return;
      await potaFileScaduti(admin, registro, 'kyc_file_da_togliere_prendi', 'kyc-docs', {});
    },
  };
}

/**
 * 13/11/2026 (R21-013) — LE FOTO DELLA PORTA DI CASA RIFATTE DAL FATTORINO RESTAVANO PER SEMPRE.
 *
 * Ogni volta che il fattorino sceglie una foto (contanti, pacco lasciato), il file va subito in
 * `cod-proof/<fattorino>/<ordine>/` con un nome nuovo (lib/storage/carica-immagine.ts). Se la
 * rifà o chiude il pannello, il file di prima non lo indica nessuna colonna: la scadenza dei 90
 * giorni (`foto_consegna_da_cancellare`) e la cancellazione dell'account trovano i file solo
 * attraverso le colonne dell'ordine, e il fattorino non può cancellare dal magazzino (nessuna
 * regola glielo permette, apposta: una prova d'incasso non la deve poter togliere chi l'ha fatta).
 * E se lo storage rifiutava la rimozione nella potatura dei 90 giorni, le colonne erano già
 * azzerate e nessuno riprovava.
 *
 * Qui il giro al contrario, sul modello di lib/privacy/orfani-kyc.ts: si ELENCA il magazzino, si
 * leggono i percorsi vivi negli ordini, e si tolgono i file che nessun ordine indica più. Così se
 * ne vanno le foto rifatte, quelle di un pannello chiuso senza confermare, e quelle che la
 * potatura dei 90 giorni non è riuscita a togliere (la notte dopo sono orfane: si riprova qui).
 * Le stesse prudenze: un file più giovane di `GIORNI_DI_SICUREZZA_ORFANI` non si tocca (si carica
 * PRIMA della conferma), un tetto per notte, e prima di togliere si rilegge l'ordine della
 * cartella: se la rilettura non riesce, o l'ordine non c'è, quella cartella non si tocca.
 */
const SECCHIO_PROVE = 'cod-proof';
/**
 * TUTTE le colonne dell'ordine che possono indicare un file di cod-proof: un file indicato da una
 * qualsiasi non è orfano. `delivery_signature_url` (migrations/024:33) oggi non la scrive nessuno,
 * ma se un giorno la si scrive i suoi file non devono sparire come orfani (collaudo del lotto 2).
 */
const COLONNE_PROVE = ['cash_photo_url', 'delivery_photo_url', 'cash_signature_url', 'delivery_signature_url'] as const;
const COLONNE_PROVE_LETTE = ['id', ...COLONNE_PROVE].join(', ');
const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Dal valore della colonna al percorso nel magazzino («<fattorino>/<ordine>/<file>»). */
function percorsoDellaProva(valore: unknown): string | null {
  if (typeof valore !== 'string' || valore.trim() === '') return null;
  let p = valore.trim();
  if (/^https?:\/\//i.test(p)) {
    const i = p.indexOf(`/${SECCHIO_PROVE}/`);
    if (i < 0) return null;
    p = p.slice(i + SECCHIO_PROVE.length + 2).split('?')[0];
    try { p = decodeURIComponent(p); } catch { /* resta com'e' */ }
  }
  p = p.replace(/^\/+/, '');
  if (p.startsWith(`${SECCHIO_PROVE}/`)) p = p.slice(SECCHIO_PROVE.length + 1);
  return p || null;
}

function percorsiDellOrdine(riga: Record<string, unknown>, dove: Set<string>): void {
  for (const c of COLONNE_PROVE) {
    const p = percorsoDellaProva(riga[c]);
    if (p) dove.add(p);
  }
}

async function elencaProve(admin: ClienteOrfani, prefisso: string, pagina: number): Promise<VoceSecchio[]> {
  const voci: VoceSecchio[] = [];
  for (let offset = 0; ; offset += pagina) {
    const { data, error } = await admin.storage.from(SECCHIO_PROVE).list(prefisso, {
      limit: pagina, offset, sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`elenco del secchio ${SECCHIO_PROVE}/${prefisso} non letto: ${error.message}`);
    const lette = data ?? [];
    voci.push(...lette);
    if (lette.length < pagina) return voci;
  }
}

function etaDellaProva(voce: VoceSecchio): number | null {
  const tempi = [voce.created_at, voce.updated_at].map((t) => (t ? Date.parse(t) : NaN)).filter(Number.isFinite);
  return tempi.length > 0 ? Math.max(...tempi) : null;
}

export type RiepilogoOrfaniProve = { listati: number; orfani: number; daTogliere: number; rimossi: number; rinviati: number };

async function potaOrfaniDelleProve(
  admin: ClienteOrfani,
  registro: Registro,
  adessoMs: number,
  opzioni: { soloConta?: boolean; pagina?: number } = {},
): Promise<RiepilogoOrfaniProve> {
  const pagina = opzioni.pagina ?? 100;
  const limite = adessoMs - GIORNI_DI_SICUREZZA_ORFANI * 86_400_000;

  // ① L'elenco: <fattorino>/<ordine>/<file>. Quello che non sta a quella profondità non si tocca.
  const file: Array<{ percorso: string; ordine: string; eta: number | null }> = [];
  for (const fattorino of await elencaProve(admin, '', pagina)) {
    if (fattorino.id !== null) continue;
    for (const ordine of await elencaProve(admin, fattorino.name, pagina)) {
      if (ordine.id !== null || !FORMA_UUID.test(ordine.name)) continue;
      for (const f of await elencaProve(admin, `${fattorino.name}/${ordine.name}`, pagina)) {
        if (f.id === null) continue;
        file.push({ percorso: `${fattorino.name}/${ordine.name}/${f.name}`, ordine: ordine.name, eta: etaDellaProva(f) });
      }
    }
  }

  // ② I percorsi vivi negli ordini, letti DOPO l'elenco, a chiave.
  const vivi = new Set<string>();
  const filtro = COLONNE_PROVE.map((c) => `${c}.not.is.null`).join(',');
  let ultimo: string | null = null;
  for (;;) {
    let q = admin.from('orders').select(COLONNE_PROVE_LETTE).or(filtro).order('id', { ascending: true });
    if (ultimo !== null) q = q.gt('id', ultimo);
    const { data, error } = await q.limit(pagina);
    if (error) throw new Error(`riferimenti alle prove di consegna non letti: ${error.message}`);
    if (!Array.isArray(data)) throw new Error('riferimenti alle prove di consegna non letti: nessuna riga restituita');
    for (const riga of data) percorsiDellOrdine(riga, vivi);
    if (data.length < pagina) break;
    const id = data[data.length - 1]?.id;
    if (typeof id !== 'string' || (ultimo !== null && id <= ultimo)) {
      throw new Error('riferimenti alle prove di consegna non letti: la pagina non avanza');
    }
    ultimo = id;
  }

  // ③ Gli orfani abbastanza vecchi, i più vecchi per primi, fino al tetto.
  const orfani = file.filter((f) => !vivi.has(f.percorso));
  const maturi = orfani
    .filter((f): f is { percorso: string; ordine: string; eta: number } => f.eta !== null && f.eta < limite)
    .sort((a, b) => a.eta - b.eta);
  const scelti = maturi.slice(0, TETTO_ORFANI_PER_NOTTE);

  // ③-bis L'ultimo controllo: si rilegge l'ordine della cartella.
  const perOrdine = new Map<string, string[]>();
  for (const f of scelti) perOrdine.set(f.ordine, [...(perOrdine.get(f.ordine) ?? []), f.percorso]);
  const daTogliere: string[] = [];
  for (const [ordine, candidati] of perOrdine) {
    try {
      const { data, error } = await admin.from('orders').select(COLONNE_PROVE_LETTE).eq('id', ordine);
      if (error || !Array.isArray(data) || data.length !== 1) {
        registro.warn('[cron-deletions] orfani cod-proof: ordine non riletto, non si tocca niente', {
          ordine, err: error?.message ?? `${Array.isArray(data) ? data.length : 0} righe`,
        });
        continue;
      }
      const ancoraVivi = new Set<string>();
      percorsiDellOrdine(data[0], ancoraVivi);
      daTogliere.push(...candidati.filter((p) => !ancoraVivi.has(p)));
    } catch (e) {
      registro.warn('[cron-deletions] orfani cod-proof: ordine non riletto, non si tocca niente', {
        ordine, err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ④ La rimozione, a gruppi. In «solo conta» lo storage non si chiama.
  let rimossi = 0;
  const rifiutati: string[] = [];
  for (let i = 0; !opzioni.soloConta && i < daTogliere.length; i += pagina) {
    const gruppo = daTogliere.slice(i, i + pagina);
    const { error } = await admin.storage.from(SECCHIO_PROVE).remove(gruppo);
    if (error) {
      registro.warn('[cron-deletions] orfani cod-proof non rimossi', { err: error.message, percorsi: gruppo });
      rifiutati.push(...gruppo);
      continue;
    }
    rimossi += gruppo.length;
  }
  const riepilogo = {
    listati: file.length, orfani: orfani.length, daTogliere: daTogliere.length, rimossi, rinviati: maturi.length - scelti.length,
  };
  registro.info('[cron-deletions] orfani del secchio cod-proof', riepilogo);
  if (rifiutati.length > 0) throw new Error(`${rifiutati.length} orfani non rimossi dal secchio ${SECCHIO_PROVE}`);
  return riepilogo;
}

/** Il passo della notte per le prove di consegna orfane. Fuori da `potatureDiRitenzione` come quello di kyc-docs. */
export function potaturaDegliOrfaniDelleProve(adessoMs: number): Potatura {
  return {
    cosa: 'prove-di-consegna-orfane',
    fai: async (admin, registro) => {
      await potaOrfaniDelleProve(admin as unknown as ClienteOrfani, registro, adessoMs);
    },
  };
}

/**
 * Il conto delle prove orfane, senza toglierne nessuna (elencare e leggere gli ordini sono
 * letture; lo storage passato rifiuta `remove`), per il giro a mano che conta prima di cancellare.
 */
export async function contaOrfaniDelleProve(admin: ClienteOrfani, adessoMs: number = Date.now()): Promise<ContoFile> {
  const cosa = 'prove-di-consegna-orfane';
  const senzaTogliere: ClienteOrfani = {
    from: (tabella) => admin.from(tabella),
    storage: {
      from: (secchio) => {
        const vero = admin.storage.from(secchio);
        return {
          list: (prefisso, opzioni) => vero.list(prefisso, opzioni),
          remove: () => Promise.reject(new Error(NON_SI_CONTA_SENZA_FARLA)),
        };
      },
    },
  };
  try {
    const r = await potaOrfaniDelleProve(senzaTogliere, registroMuto, adessoMs, { soloConta: true });
    return { cosa, file: r.daTogliere };
  } catch (e) {
    return { cosa, file: null, nonContata: e instanceof Error ? e.message : 'errore' };
  }
}

/** Tutto quello che la notte deve potare: le finestre dichiarate e gli orfani di kyc-docs e di cod-proof. */
export function potatureNotturne(adessoMs: number): Potatura[] {
  return [...potatureDiRitenzione(adessoMs), potaturaDegliOrfaniKyc(adessoMs), potaturaDegliOrfaniDelleProve(adessoMs)];
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
      if (passo.poi) await passo.poi(admin, registro);
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

/**
 * 31/10/2026 — CONTARE QUELLO CHE LA NOTTE TOGLIEREBBE, SENZA TOGLIERLO.
 *
 * Il primo giro di `process-deletions` si fa a mano (lib/cron/fermo-dei-lavori.ts),
 * e prima di cancellare qualcosa che non torna indietro si vuole sapere quanto.
 * Qui le potature girano DAVVERO — la stessa lista, gli stessi filtri, lo stesso
 * ordine — ma contro un client che non sa scrivere: ogni `update` e ogni
 * `delete` diventa una lettura che conta le righe con quei filtri. Nessun
 * secondo elenco di filtri da tenere allineato a mano.
 *
 * Quello che non si puo' contare senza farlo resta fuori, e lo dice: le
 * funzioni del database (azzerano le colonne mentre restituiscono i file) e lo
 * storage. Il client finto le rifiuta PRIMA di chiamarle.
 *
 * Il conto e' «righe toccate», non «righe con dati personali»: una potatura che
 * riscrive NULL su righe gia' pulite le conta lo stesso, come la notte le tocca.
 * E ogni conto guarda i dati di ADESSO: una riga che due potature toccano (un
 * buono regalo scaduto ed esaurito) entra in tutte e due, mentre la notte vera
 * la trova gia' pulita alla seconda. I numeri non si sommano.
 */
type RispostaConConto = { count: number | null; error: { message: string } | null };

type FiltrabileConConto = PromiseLike<RispostaConConto> & {
  eq(colonna: string, valore: unknown): FiltrabileConConto;
  lt(colonna: string, valore: unknown): FiltrabileConConto;
  is(colonna: string, valore: unknown): FiltrabileConConto;
  not(colonna: string, operatore: string, valore: unknown): FiltrabileConConto;
  or(espressione: string): FiltrabileConConto;
};

/** Il minimo che serve per contare: leggere, e nient'altro. */
export type ClienteCheConta = {
  from(tabella: string): {
    select(colonne: string, opzioni: { count: 'exact'; head: true }): FiltrabileConConto;
  };
};

export type ContoPotatura =
  | { cosa: string; righe: number }
  | { cosa: string; righe: null; nonContata: string };

export const NON_SI_CONTA_SENZA_FARLA =
  'si conta solo eseguendola: una funzione del database o lo storage, che scrivono mentre leggono';

const registroMuto: Registro = { info: () => {}, warn: () => {}, error: () => {} };

export async function contaPotature(
  admin: ClienteCheConta,
  adessoMs: number = Date.now(),
  passi: Potatura[] = potatureDiRitenzione(adessoMs),
): Promise<ContoPotatura[]> {
  const conti: ContoPotatura[] = [];

  for (const passo of passi) {
    let righe = 0;
    const contando = (q: FiltrabileConConto): Filtrabile => ({
      eq: (colonna, valore) => contando(q.eq(colonna, valore)),
      lt: (colonna, valore) => contando(q.lt(colonna, valore)),
      is: (colonna, valore) => contando(q.is(colonna, valore)),
      not: (colonna, operatore, valore) => contando(q.not(colonna, operatore, valore)),
      or: (espressione) => contando(q.or(espressione)),
      // La lettura parte solo quando la potatura aspetta la risposta, cioe'
      // dopo che ha messo tutti i filtri: come la scrittura vera.
      then: (riuscita, fallita) =>
        Promise.resolve(q)
          .then(({ count, error }): Risposta => {
            if (error) return { error };
            if (typeof count !== 'number') return { error: { message: 'il database non ha restituito il conto' } };
            righe += count;
            return { error: null };
          })
          .then(riuscita, fallita),
    });
    const leggi = (tabella: string) => contando(admin.from(tabella).select('*', { count: 'exact', head: true }));
    const senzaScrivere: ClientePotature = {
      from: (tabella) => ({ update: () => leggi(tabella), delete: () => leggi(tabella) }),
      rpc: () => Promise.reject(new Error(NON_SI_CONTA_SENZA_FARLA)),
      storage: { from: () => ({ remove: () => Promise.reject(new Error(NON_SI_CONTA_SENZA_FARLA)) }) },
    };

    try {
      await passo.fai(senzaScrivere, registroMuto);
      conti.push({ cosa: passo.cosa, righe });
    } catch (e) {
      conti.push({ cosa: passo.cosa, righe: null, nonContata: e instanceof Error ? e.message : 'errore' });
    }
  }

  return conti;
}
