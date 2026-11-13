/**
 * Error messages user-friendly — single source of truth.
 *
 * Esperti consultati:
 * - Content Designer: "Codici SQL/HTTP all'utente = perdita di fiducia istantanea.
 *   Italiano semplice, soluzione concreta, no panic tone."
 * - Trust & Safety: "Mai esporre dettagli interni (table name, column name,
 *   stack trace) all'utente esterno."
 */

import { trackErrorShown } from './analytics/events';
import { PASSWORD_RUBATA, PASSWORD_SEMPLICE } from './auth/errori-nuova-password';
// 13/11/2026 (R24-007) — Importarlo accende anche il traduttore italiano di Zod (z.setErrorMap)
// dove si carica questo file: è voluto, è la stessa lingua.
import { FRASI_ZOD } from './zod-i18n';

const SUPABASE_CODE_MAP: Record<string, string> = {
  '23505': 'Questo valore è già stato usato. Prova con uno diverso.',
  '23503': 'Impossibile completare: l\'elemento collegato non esiste più.',
  '23502': 'Manca un dato obbligatorio.',
  '23514': 'Il valore inserito non è valido.',
  '42501': 'Non hai i permessi per questa azione.',
  'PGRST116': 'Non trovato.',
  'PGRST204': 'Nessun risultato.',
  '22P02': 'Formato non valido.',
};

const GENERIC_FALLBACK = 'Qualcosa non ha funzionato. Riprova fra un momento.';

/**
 * 13/11/2026 (R24-008) — I CODICI DI SUPABASE AUTH. Qui il testo del messaggio vince
 * sul codice, perché dice il MOTIVO: `weak_password` arriva sia per una password
 * rubata sia per una troppo semplice, e il consiglio giusto è diverso. Il codice fa
 * da ripiego quando il testo non si riconosce.
 */
const CODICI_AUTH: Record<string, string> = {
  weak_password: PASSWORD_SEMPLICE,
};

/**
 * LE PAROLE CHE SOLO UN MOTORE SCRIVE — la rete che mancava all'ultimo ramo.
 *
 * 6/9/2026 — L'ULTIMO RAMO DI `friendlyError` DECIDEVA «questa frase e' nostra»
 * dalla LUNGHEZZA e dalla PRIMA LETTERA: meno di 200 caratteri, niente a capo,
 * comincia per lettera. I messaggi di Postgres hanno esattamente quella forma,
 * quindi passavano tali e quali. Provati tre errori normalissimi:
 * «invalid input syntax for type numeric», «canceling statement due to
 * statement timeout», e prima del rattoppo anche «value too long for type
 * character varying». Il negoziante di Piacenza premeva Salva e leggeva
 * quello: non sapeva cosa aveva sbagliato ne' cosa doveva correggere.
 *
 * La cura vera sarebbe marcare alla fonte le frasi scritte per l'utente e
 * fidarsi solo di quelle: tocca il contratto delle rotte e tutti i chiamanti,
 * ed e' un lavoro suo. Qui si chiude il buco dal lato giusto della porta —
 * il vocabolario di un database non e' quello di una frase italiana scritta per
 * un negoziante, e queste parole non compaiono in nessun testo nostro.
 *
 * Il prezzo e' qualche frase inglese legittima buttata sul generico. Si paga
 * volentieri: il generico non aiuta, ma non spaventa e non svela niente.
 */
const PAROLE_DEL_MOTORE =
  /\b(syntax|constraint|relation|column|table|row|query|statement|varchar|varying|violates|null value|does not exist|out of range|deadlock|serializ|unrecognized|operator|integer|numeric|boolean|timestamp|jsonb|uuid|regclass)\b/i;

/**
 * GLI ERRORI DI SUPABASE AUTH, IN ITALIANO — o `null` se non lo riconosco.
 *
 * PERCHÉ ESISTE QUI. Una funzione con lo stesso mestiere viveva dentro
 * `app/sign-in/page.tsx`, non esportata: la usava solo quella pagina. Registrazione,
 * cambio password e cambio email chiamavano `friendlyError`, che di errori Auth non
 * sapeva niente — ha le mappe dei codici Postgres e dei guasti di rete, e nient'altro.
 * Il messaggio grezzo passava i filtri finali (meno di 200 caratteri, una riga sola,
 * comincia per lettera) e usciva tale e quale. L'errore più comune della
 * registrazione, «User already registered», arrivava così al cliente piacentino.
 *
 * PERCHÉ TORNA `null` INVECE DI UNA FRASE DI RIPIEGO. Il ripiego giusto dipende da
 * dove sei: «Accesso non riuscito» sull'accesso, «Registrazione non riuscita» sulla
 * registrazione. Una funzione condivisa che sceglie da sé ne sbaglierebbe due su tre.
 * Qui si traduce solo ciò che si riconosce; il ripiego lo mette chi chiama.
 *
 * PERCHÉ SOLO FRASI SPECIFICHE. La versione dentro sign-in finiva con due reti larghe
 * — `includes('password')`, `includes('email')` — che su quella schermata vanno bene
 * perché lì gli errori possibili sono solo di accesso. Dentro `friendlyError`, che
 * vede ogni errore dell'applicazione, quelle due reti tradurrebbero in «Password non
 * valida» un guasto che con l'accesso non c'entra niente. Qui restano fuori: sono la
 * coda di sign-in, non una regola generale.
 */
export function traduciErroreAuth(msg: string): string | null {
  const m = String(msg || '').toLowerCase();
  if (!m) return null;

  // Il gettone anti-bot vale una volta sola: dopo un tentativo andato male il server
  // lo rifiuta, e il messaggio grezzo parla di captcha su una schermata dove non c'e'
  // niente da premere.
  if (m.includes('captcha') || m.includes('turnstile'))
    return 'Il controllo anti-bot è scaduto: è stato rigenerato, premi di nuovo.';
  if (m.includes('invalid login credentials')) return 'Email o password non corrette';
  if (m.includes('email not confirmed'))
    return 'Email non confermata. Controlla la posta e clicca sul link che ti abbiamo inviato.';
  if (m.includes('user not found')) return 'Nessun account con questa email';

  // I quattro della registrazione e del cambio password, che prima uscivano in inglese.
  if (m.includes('user already registered') || m.includes('already been registered'))
    return 'Esiste già un account con questa email. Prova ad accedere.';
  // 13/11/2026 (R24-008) — «Password is known to be weak and easy to guess» è la password
  // comune o già finita negli elenchi rubati (reasons: pwned): usciva in inglese sotto il
  // campo della registrazione. Le frasi sono quelle di /reset-password, una sola per lo
  // stesso errore (lib/auth/errori-nuova-password.ts). Sta PRIMA della lunghezza, come là:
  // se Supabase dice «corta» e «rubata» insieme, allungare la stessa password non basta.
  if (m.includes('known to be weak') || m.includes('pwned') || m.includes('leaked password'))
    return PASSWORD_RUBATA;
  if (m.includes('password should be at least')) {
    const n = m.match(/at least (\d+)/)?.[1];
    return n ? `La password deve essere di almeno ${n} caratteri` : 'La password è troppo corta';
  }
  if (m.includes('unable to validate email address') || m.includes('invalid email'))
    return 'Questa email non sembra valida. Controlla come l’hai scritta.';
  // 12/11/2026 (R12-011) — È il tetto orario di tutto il progetto, non di un indirizzo:
  // «troppe email a questo indirizzo» lo leggeva anche chi non ne aveva mai ricevuta una.
  if (m.includes('email rate limit exceeded'))
    return 'In questo momento non riusciamo a mandare email: riprova fra qualche minuto.';
  // R24-008 — La password troppo semplice (la rubata è più sopra, prima della lunghezza).
  if (m.includes('weak password') || m.includes('password is too weak') || m.includes('password should contain'))
    return PASSWORD_SEMPLICE;
  if (m.includes('new password should be different'))
    return 'La password nuova deve essere diversa da quella attuale';
  if (m.includes('same password'))
    return 'La password nuova deve essere diversa da quella attuale';

  // `rate limit` generico NON sta qui, ed e' una correzione che mi ha fatto la suite:
  // spostandolo dentro la funzione condivisa rubavo il caso a `friendlyError`, che lo
  // trattava gia' e con parole sue («Troppe richieste in poco tempo»). Una rete larga
  // messa in una funzione che vede TUTTI gli errori si prende anche quelli di altri.
  // Resta qui solo `email rate limit exceeded`, che e' di Auth e sta piu' sopra.
  // La rete larga vive nel ripiego di sign-in, dov'era prima.

  return null;
}

/**
 * 13/11/2026 (R24-004) — LE FRASI CHE UNA NOSTRA ROTTA HA SCRITTO PER IL CLIENTE.
 *
 * Il filtro dell'ultimo ramo di `friendlyError` indovina «questa frase è nostra» dalla
 * forma: comincia per lettera (o cifra, virgolette, apostrofo), niente codice tecnico in
 * testa, niente parole da database. Un rifiuto in cassa comincia col nome del negozio:
 * «Bistrot La Table adesso è chiuso…», «Row Bar…», «1920 Bottega…» finivano nel generico,
 * e il cliente riprovava lo stesso ordine senza sapere perché.
 *
 * Qui il segno lo mette chi la frase la conosce: una rotta che rifiuta con
 * `ApiErrors.conflict` (codice CONFLICT, la forma dei rifiuti «con un motivo» —
 * negozio chiuso, fascia passata, consegna veloce non possibile) scrive per il
 * cliente. `apiErrorMessage` se la ricorda, e `friendlyError` la lascia passare intera,
 * parentesi comprese. I filtri restano per tutto il resto: errori grezzi, 500, testi
 * che non hanno quel segno.
 */
const CODICI_SCRITTI_PER_L_UTENTE = new Set(['CONFLICT']);
const FRASI_DELLE_ROTTE: string[] = [];
const TETTO_FRASI_DELLE_ROTTE = 20;

function ricordaFraseDellaRotta(frase: string): void {
  if (FRASI_DELLE_ROTTE.includes(frase)) return;
  FRASI_DELLE_ROTTE.push(frase);
  if (FRASI_DELLE_ROTTE.length > TETTO_FRASI_DELLE_ROTTE) FRASI_DELLE_ROTTE.shift();
}

/**
 * 13/11/2026 (R24-007) — LE FRASI INGLESI DI ZOD CHE ARRIVANO DAL SERVER.
 *
 * Una rotta che non ha acceso il traduttore (lib/zod-i18n) risponde col testo
 * predefinito di Zod — «String must contain at most 120 character(s)», «Required»,
 * «Expected number, received string» — e l'ultimo ramo lo lasciava passare perché ha
 * la forma di una frase. Qui si riconoscono quei testi e si danno le stesse frasi del
 * traduttore. `frase: null` con `tecnico: true` = ha la forma di un testo di Zod ma
 * non ho una frase pronta: non si mostra così com'è.
 */
function traduciTestoDiZod(messaggio: string): { frase: string | null; tecnico: boolean } {
  const m = messaggio.trim();
  let r: RegExpMatchArray | null;
  if (m === 'Required') return { frase: FRASI_ZOD.obbligatorio, tecnico: true };
  if ((r = m.match(/^Expected (\w+), received (\w+)$/)))
    return { frase: r[2] === 'undefined' || r[2] === 'null' ? FRASI_ZOD.obbligatorio : FRASI_ZOD.tipo(r[1]), tecnico: true };
  if ((r = m.match(/^String must contain (?:at least|over) (\d+) character(?:\(s\))?$/)))
    return { frase: FRASI_ZOD.almenoCaratteri(Number(r[1])), tecnico: true };
  if ((r = m.match(/^String must contain (?:at most|under) (\d+) character(?:\(s\))?$/)))
    return { frase: FRASI_ZOD.massimoCaratteri(Number(r[1])), tecnico: true };
  if ((r = m.match(/^Number must be greater than (?:or equal to )?(-?\d+(?:\.\d+)?)$/)))
    return { frase: FRASI_ZOD.minimo(Number(r[1])), tecnico: true };
  if ((r = m.match(/^Number must be less than (?:or equal to )?(-?\d+(?:\.\d+)?)$/)))
    return { frase: FRASI_ZOD.massimo(Number(r[1])), tecnico: true };
  if ((r = m.match(/^Array must contain (?:at least|more than) (\d+) element(?:\(s\))?$/)))
    return { frase: FRASI_ZOD.almenoElementi(Number(r[1])), tecnico: true };
  if (m === 'Invalid email') return { frase: FRASI_ZOD.email, tecnico: true };
  if (m === 'Invalid url') return { frase: FRASI_ZOD.url, tecnico: true };
  if (m === 'Invalid uuid') return { frase: FRASI_ZOD.uuid, tecnico: true };
  if (m === 'Invalid') return { frase: FRASI_ZOD.formato, tecnico: true };
  if (/^Invalid enum value\. Expected /.test(m)) return { frase: FRASI_ZOD.scelta, tecnico: true };
  const tecnico =
    /^(String must contain|Number must be|Array must contain|Set must contain|Date must be|Invalid (literal value|discriminator value|date|enum value|arguments|return type)\b|Unrecognized key\(s\) in object|Intersection results could not be merged)/.test(
      m,
    );
  return { frase: null, tecnico };
}

/**
 * Trasforma errori Supabase/Stripe/fetch in messaggi user-friendly italiani.
 * Logga il messaggio originale per debugging via PostHog.
 */
export function friendlyError(err: unknown, context?: { page?: string; action?: string }): string {
  if (!err) return GENERIC_FALLBACK;

  // Supabase PostgrestError style
  if (typeof err === 'object' && err !== null) {
    const e = err as { code?: string; message?: string; status?: number };
    if (e.code && SUPABASE_CODE_MAP[e.code]) {
      trackErrorShown(e.code, e.message ?? '', context?.page);
      return SUPABASE_CODE_MAP[e.code];
    }
    if (e.code && CODICI_AUTH[e.code]) {
      trackErrorShown(e.code, e.message ?? '', context?.page);
      return traduciErroreAuth(e.message ?? '') ?? CODICI_AUTH[e.code];
    }
    if (e.message && FRASI_DELLE_ROTTE.includes(e.message)) {
      // R24-004 — Scritta da una nostra rotta per il cliente: passa com'è (vedi sopra).
      trackErrorShown(e.code ?? 'dalla_rotta', e.message, context?.page);
      return e.message;
    }
    if (e.message) {
      /**
       * 3/9/2026 — «LA SESSIONE È SCADUTA» DAVANTI A CHI AVEVA LA CARTA IN MANO.
       *
       * Quando il gateway risponde con la SUA pagina di errore — «504 GATEWAY
       * TIMEOUT» in HTML, o un 502, o un 413 — `res.json()` non trova JSON e
       * lancia «Unexpected token '<'» su Chrome, «JSON Parse error: Unrecognized
       * token '<'» su Safari. La parola «token» accendeva il ramo qui sotto e il
       * cliente leggeva «La sessione è scaduta. Accedi di nuovo.»: usciva
       * dall'account, rientrava, e spesso non tornava. Ordine perso al passo che
       * incassa, per un guasto che con la sessione non c'entra niente.
       *
       * Un errore si riconosce dal TIPO, non da una parola nel testo: qui si
       * guarda `SyntaxError` (ed è quello che lancia il parser) prima di ogni
       * espressione regolare.
       */
      if (err instanceof SyntaxError || /json parse error|unexpected token|unexpected end of json|is not valid json/i.test(e.message)) {
        trackErrorShown('risposta_non_json', e.message, context?.page);
        return 'Il server non ha risposto correttamente. Riprova fra qualche secondo.';
      }
      // Gli errori di Supabase Auth prima non li conosceva nessuno qui dentro, e uscivano
      // in inglese sulla registrazione e sul cambio password. `traduciErroreAuth` torna
      // `null` su tutto ciò che non riconosce, quindi non ruba niente ai rami sotto.
      const inItaliano = traduciErroreAuth(e.message);
      if (inItaliano) {
        trackErrorShown(e.code ?? 'auth', e.message, context?.page);
        return inItaliano;
      }
      // 13/11/2026 (R24-007) — Il testo predefinito di Zod che una rotta senza traduttore
      // rimanda in inglese («String must contain at most 120 character(s)», «Required»):
      // qui esce con le frasi del traduttore; quello senza frase pronta non passa così.
      const daZod = traduciTestoDiZod(e.message);
      if (daZod.tecnico) {
        trackErrorShown(e.code ?? 'validazione', e.message, context?.page);
        return daZod.frase ?? 'Uno dei dati inseriti non va bene: controllalo e riprova.';
      }
      // Fix #17: trackErrorShown in ogni ramo (era tracciato solo per i codici Supabase mappati).
      if (/duplicate key value/i.test(e.message)) {
        trackErrorShown('duplicate_key', e.message, context?.page);
        return SUPABASE_CODE_MAP['23505'];
      }
      if (/foreign key constraint/i.test(e.message)) {
        trackErrorShown('foreign_key', e.message, context?.page);
        return SUPABASE_CODE_MAP['23503'];
      }
      if (/permission denied|insufficient_privilege|row.level security/i.test(e.message)) {
        trackErrorShown('permission_denied', e.message, context?.page);
        return 'Non hai i permessi per questa azione.';
      }
      // Il database che si ferma da solo dopo troppo tempo NON e' un problema di
      // rete: finiva nel ramo qui sotto e il negoziante andava a controllare il
      // wifi mentre il guasto era dall'altra parte. Sta prima apposta.
      if (/canceling statement|statement timeout/i.test(e.message)) {
        trackErrorShown('tempo_scaduto', e.message, context?.page);
        return 'Ci ha messo troppo e si è fermato. Riprova fra qualche secondo.';
      }
      if (/network|fetch|timeout|aborted/i.test(e.message)) {
        trackErrorShown('network', e.message, context?.page);
        return 'Problema di connessione. Controlla la rete e riprova.';
      }
      if (/rate.limit|too many/i.test(e.message)) {
        trackErrorShown('rate_limit', e.message, context?.page);
        return 'Troppe richieste in poco tempo. Aspetta qualche secondo.';
      }
      // La rete era larghissima: bastava la parola «token» o «expired» in un
      // messaggio qualsiasi per mandare fuori l'utente. Adesso si riconoscono le
      // frasi vere di Supabase Auth, non una parola sola.
      if (
        e.status === 401 ||
        /\bjwt\b|refresh token|token (is |has )?expired|session (is |has )?expired|not authenticated|unauthoriz/i.test(e.message)
      ) {
        trackErrorShown('session_expired', e.message, context?.page);
        return 'La sessione è scaduta. Accedi di nuovo.';
      }
      /**
       * 6/9/2026 — IL DEPOSITO DELLE FOTO PARLAVA INGLESE AL NEGOZIANTE.
       *
       * Lo Storage rifiuta un file con frasi sue, in inglese: «mime type
       * image/svg+xml is not supported» quando il formato non va, «The object
       * exceeded the maximum allowed size» quando il file supera i 10 MB. Non
       * hanno un codice, quindi nessuna delle mappe qui sopra le riconosceva:
       * cadevano nell'ultimo ramo, quello che ripulisce il testo e lo lascia
       * passare com'è se è corto e comincia per lettera. Una rete di sicurezza
       * che qui si comportava da porta aperta.
       *
       * Il negoziante leggeva l'inglese, non capiva che gli bastava salvare il
       * logo in PNG, e restava senza logo. Queste quattro righe stanno PRIMA di
       * quel ramo apposta: sono i casi che il ramo lasciava passare.
       */
      if (/mime type|invalid mime type/i.test(e.message)) {
        trackErrorShown('storage_formato', e.message, context?.page);
        return 'Formato non accettato: usa una foto JPG, PNG o WEBP.';
      }
      if (/exceeded the maximum allowed size|payload too large/i.test(e.message)) {
        trackErrorShown('storage_troppo_pesante', e.message, context?.page);
        return 'La foto è troppo pesante: il limite è 10 MB. Riducila o scattane un\'altra.';
      }
      if (/resource already exists/i.test(e.message)) {
        trackErrorShown('storage_gia_esiste', e.message, context?.page);
        return 'Un file con questo nome c\'è già. Rinominalo e riprova.';
      }
      if (/value too long/i.test(e.message)) {
        trackErrorShown('testo_troppo_lungo', e.message, context?.page);
        return 'Testo troppo lungo: accorcialo e riprova.';
      }
      // «invalid input syntax for type numeric», «invalid input value for enum»:
      // e' un campo compilato in un formato che il database non accetta — quasi
      // sempre un numero con la virgola sbagliata o una data storta.
      if (/invalid input\b/i.test(e.message)) {
        trackErrorShown('valore_non_valido', e.message, context?.page);
        return 'Uno dei dati inseriti non è nel formato giusto: controlla numeri e date, poi riprova.';
      }
      trackErrorShown(e.code ?? 'unknown', e.message, context?.page);
      // Strip technical details
      const cleaned = e.message
        .replace(/\b[A-Z_]+\s*=\s*[^\s,]+/g, '')
        // 1/11/2026 — Le parentesi coi soldi dentro sono il PERCHÉ di un rifiuto
        // («prezzo NON applicato (20.00 → 30.00 €: oltre il 30%, va deciso a
        // mano)»), non un dettaglio tecnico: restano. Le altre si tolgono.
        .replace(/\(.*?\)/g, (parentesi) => (parentesi.includes('€') ? parentesi : ''))
        .trim();
      // Le righe multiple sono un segnale forte di stack trace → scarta.
      // Il limite di lunghezza scarta i dump tecnici ma deve lasciar passare i
      // messaggi user-facing dei nostri endpoint (es. "<negozio> è chiuso in
      // questo momento. Riprova durante gli orari di apertura…", ~115 char):
      // con un cap a 100 venivano sostituiti dal generico, nascondendo il vero
      // motivo all'utente. 200 copre le frasi UI legittime, i veri stack trace
      // restano più lunghi.
      if (
        cleaned.length > 0 &&
        cleaned.length < 200 &&
        !cleaned.includes('\n') &&
        // 5/11/2026 — Anche una cifra, le virgolette o l'apostrofo: i rifiuti in cassa cominciano col
        // nome del negozio («3 Archi», «'L Furnè», «Da Mario» fra virgolette) e finivano nel generico.
        /^[a-zA-ZÀ-ſ0-9«"'‘’“]/.test(cleaned) &&
        // ...ma non un codice tecnico in testa («500 Internal Server Error», «23505 …»).
        !/^\d{3,5}\b/.test(cleaned) &&
        // ...e non parla come un motore. Vedi PAROLE_DEL_MOTORE in cima al file.
        !PAROLE_DEL_MOTORE.test(cleaned)
      ) {
        return cleaned;
      }
    }
    if (e.status) {
      // Fix #17: trackErrorShown per i codici HTTP (401/403/404/429/5xx).
      const statusLabel = e.status >= 500 ? 'http_5xx' : `http_${e.status}`;
      trackErrorShown(statusLabel, `HTTP ${e.status}`, context?.page);
      if (e.status === 401) return 'Devi accedere per continuare.';
      if (e.status === 403) return 'Non hai i permessi per questa azione.';
      if (e.status === 404) return 'Non trovato.';
      if (e.status === 429) return 'Troppe richieste. Aspetta un attimo.';
      if (e.status >= 500) return 'Problema del server. Riproveremo tra poco.';
    }
  }

  if (typeof err === 'string') return err;
  return GENERIC_FALLBACK;
}

/**
 * Estrae il messaggio d'errore dal body JSON di una API route, gestendo
 * SIA il formato ApiErrors `{ ok: false, error: { code, message } }` SIA
 * il formato legacy `{ error: "stringa" }`.
 *
 * Necessario perché molti endpoint usano ApiErrors (error = oggetto): fare
 * `new Error(body.error)` darebbe "[object Object]". Usare sempre questo.
 *
 *   const body = await res.json().catch(() => ({}));
 *   if (!res.ok) throw new Error(apiErrorMessage(body, 'Operazione fallita'));
 */
export function apiErrorMessage(body: unknown, fallback = 'Operazione non riuscita'): string {
  if (!body || typeof body !== 'object') return fallback;
  const e = (body as { error?: unknown }).error;
  if (typeof e === 'string' && e.trim()) return e;
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) {
      const codice = (e as { code?: unknown }).code;
      if (typeof codice === 'string' && CODICI_SCRITTI_PER_L_UTENTE.has(codice)) ricordaFraseDellaRotta(m);
      return m;
    }
  }
  return fallback;
}
