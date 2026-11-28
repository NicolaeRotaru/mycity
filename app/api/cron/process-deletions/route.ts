import { NextResponse, type NextRequest } from 'next/server';
import { ApiErrors } from '@/lib/api/responses';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import {
  chiamataDelCalendario,
  chiamataDelCalendarioFerma,
  giroCheSoloConta,
  rispostaDelFermo,
  segnaGiroNonFatto,
} from '@/lib/cron/fermo-dei-lavori';
import { logger } from '@/lib/logger';
import { cancellaAccount } from '@/lib/account/cancellazione';
import {
  chiaveAvviso,
  verdettoDelGiro,
  type TentativoCancellazione,
  type VerdettoGiro,
  type TappaAvviso,
} from '@/lib/cron-cancellazioni';
import {
  emailRisultaPartita,
  identificativoAvviso,
  recapitaAvvisi,
  rispondiAChiAspetta,
  type ClienteAvvisi,
  type RapportoAvvisi,
} from '@/lib/privacy/avvisi-a-chi-aspetta';
import {
  contaOrfaniDelleProve,
  contaOrfaniKyc,
  contaPotature,
  eseguiPotature,
  potatureNotturne,
  type ClienteCheConta,
  type ClientePotature,
  type RapportoPotature,
} from '@/lib/privacy/potature-ritenzione';
import type { ClienteOrfani } from '@/lib/privacy/orfani-kyc';

export const runtime = 'nodejs';

/**
 * Cron job giornaliero: processa account deletion scadute (cooldown 7gg).
 *
 * Esperti consultati:
 * - SRE: "Cron giornaliero ore 04:00 UTC = traffico minimo, no impatto utenti."
 * - GDPR Compliance: "Hard delete dopo 7gg = soddisfa Art.17 'senza
 *   giustificato ritardo' con grace period documentato."
 *
 * Pipeline per ogni account scaduto:
 *  1) Anonimizza profilo (rimuove PII)
 *  2) Cancella riga auth.users (sessione invalidata)
 *  3) Log audit per compliance
 *
 * Cadenza: ogni notte alle 4. Chi la fa partire sta in `vercel.json` → `crons`.
 * A mano si chiama così (finché LAVORI_A_ORARIO non è «accesi» serve ?a_mano=1).
 * Una chiamata a mano CONTA e non cancella niente — il primo giro si fa così:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://yourapp.com/api/cron/process-deletions?a_mano=1"
 * Cancella davvero solo con `&cancella=1` scritto esatto, dopo aver letto il conto.
 * La chiamata del calendario cancella solo con CANCELLAZIONI_A_ORARIO=accese: finché
 * manca, ogni notte conta e basta, anche con gli altri lavori accesi.
 *
 * Schedule consigliato: ogni giorno alle 04:00 Europe/Rome.
 */




type Admin = ReturnType<typeof getAdminSupabase>;

/**
 * 21/11/2026 (R03-005) — IL CICLO DELLE CANCELLAZIONI HA UN TETTO DI TEMPO.
 *
 * La piattaforma dà a un giro al massimo 300 secondi, contati dall'inizio. Il ciclo degli account
 * scaduti non aveva tetto: con una notte lunga (molti account, Stripe o lo storage lenti) si
 * mangiava tutto il tempo, e quello che viene dopo — la sveglia, le risposte dovute alle persone
 * in attesa, le loro email — non partiva. Dopo questo tempo dall'inizio del giro non si prende in
 * carico un account nuovo: la sua richiesta resta lì e la riprende la notte dopo. La metà del
 * tempo resta a quello che viene dopo (ogni email può aspettare la posta fino a due volte dieci
 * secondi).
 */
const TETTO_CANCELLAZIONI_MS = 150_000;

/**
 * 21/11/2026 (R01-002) — LE EMAIL DELLA NOTTE HANNO UN TETTO LORO.
 *
 * Il tetto qui sopra si guarda prima di prendere un account, ma un account preso può durare a
 * lungo: con due account lenti il ciclo finiva a ridosso dei 300 secondi e le email partivano lo
 * stesso; se la piattaforma fermava la funzione, si perdeva anche l'allarme delle email ferme.
 * Dopo questo tempo dall'inizio del giro non si tenta un'email nuova: quelle rimaste si contano,
 * si dicono con un allarme, la notte è rossa e la notte dopo si riprovano da sole. Il margine:
 * un'email può aspettare la posta fino a due volte dieci secondi, e dopo restano gli allarmi.
 */
const TETTO_EMAIL_MS = 240_000;

/**
 * 24/11/2026 (R02-001) — LA CHIUSURA DI «SCRIVILE TU» HA UN TETTO SUO.
 *
 * La chiusura degli allarmi «scrivile tu» e «Persone non avvisate» gira dopo le email, quindi dopo
 * il loro tetto, e non ne aveva uno: con molti allarmi aperti (per ognuno una lettura del profilo e
 * una scrittura) allungava la notte oltre i 300 secondi della piattaforma, che la ferma senza
 * risposta e senza battito. Adesso ha un tetto suo, contato dall'inizio del giro e non legato a
 * quello delle email: dopo questo tempo non si guarda un allarme nuovo, quelli rimasti aperti li
 * chiude la notte dopo. Viene dopo il caso peggiore delle email (il tetto più due attese della
 * posta), così anche quella notte la chiusura ha il suo tempo, e lascia venti secondi alla risposta.
 */
const TETTO_CHIUSURE_MS = 280_000;

/**
 * Il conto del giro senza il giro: gli account che la notte cancellerebbe e le
 * righe che le potature toccherebbero. Non scrive niente e non lascia il
 * battito, perche' il lavoro non e' stato fatto.
 *
 * `process_expired_deletions` qui si puo' chiamare: e' una SELECT sui profili
 * con la richiesta scaduta (migrations/040_account_deletion_cooldown.sql), non
 * tocca niente. Restano fuori dal conto, e la risposta lo dice, le cose che
 * per ogni account si scoprono solo cancellando: i file nello storage, le prove
 * di consegna, i dati da togliere su Stripe.
 */
async function contaSenzaCancellare(admin: Admin, dalCalendario: boolean): Promise<NextResponse> {
  const { data, error } = await admin.rpc('process_expired_deletions');
  if (error) {
    logger.error('[cron-deletions] conto: RPC fallita', error);
    return segnaGiroNonFatto(ApiErrors.internal(), 'solo_conta');
  }
  const scadute = (data ?? []) as Array<{ user_id: string; deleted_at: string | null }>;
  // 1/11/2026 — Nel conto entrano anche i documenti d'identita' orfani che la
  // notte toglierebbe: sono file di un secchio senza backup, e chi accende le
  // cancellazioni deve vederli prima.
  // Sono FILE, non righe: stanno in una voce loro, accanto alle potature.
  // 26/11/2026 (R02-006) — Anche le foto di consegna orfane (cod-proof) che la notte toglie
  // (`potaturaDegliOrfaniDelleProve` in potatureNotturne): prima il conto mostrava solo i
  // documenti d'identità, e la prima notte accesa ne spariva fino a un tetto senza preavviso.
  const potature = await contaPotature(admin as unknown as ClienteCheConta);
  const fileDaTogliere = [
    await contaOrfaniKyc(admin as unknown as ClienteOrfani),
    await contaOrfaniDelleProve(admin as unknown as ClienteOrfani),
  ];

  const conto = NextResponse.json({
      ok: true,
      soloConta: true,
      nienteCancellato: true,
      ...(dalCalendario ? { motivo: 'CANCELLAZIONI_A_ORARIO non è «accese»: la notte conta e non cancella' } : {}),
      account: {
        quanti: scadute.length,
        // 5/11/2026 — È un tetto, non una promessa: la notte vera salta chi ha ancora contanti
        // incassati da versare (o un guasto), quindi può cancellarne meno di così.
        nota: 'Al massimo questi: la notte salta chi ha ancora contanti da versare o incontra un guasto, e quelli restano in attesa.',
        elenco: scadute.map((r) => ({ userId: r.user_id, chiestaIl: r.deleted_at })),
      },
      potature,
      fileDaTogliere,
      nonContati:
        "Per ogni account, i file nello storage, le prove di consegna e i dati su Stripe: si vedono solo cancellando. " +
        "I documenti d'identità orfani e le foto di consegna orfane invece sono contati: «fileDaTogliere» dice quanti file la notte toglierebbe.",
    });

  // 31/10/2026 — LA NOTTE CHE CONTA È LA NOTTE DI QUESTO LAVORO, E LASCIA IL BATTITO.
  // Finché le cancellazioni sono spente, il conto del calendario È il giro della
  // notte: senza battito, dopo 26 ore il sorvegliante direbbe «process-deletions
  // fermo» ogni 6 ore, per settimane, e insegnerebbe a ignorare gli allarmi.
  // Il conto a mano invece non è il giro di nessuno: niente battito.
  return dalCalendario ? conto : segnaGiroNonFatto(conto, 'solo_conta');
}

export const POST = withCronAuth(async (req: NextRequest): Promise<NextResponse> => {
  // 31/10/2026 — Il fermo dei lavori a orario: dopo il segreto, prima di tutto il resto (lib/cron/fermo-dei-lavori.ts).
  if (chiamataDelCalendarioFerma(req)) return rispostaDelFermo();
  const admin = getAdminSupabase();

  // 31/10/2026 — UN GIRO A MANO CONTA PRIMA DI CANCELLARE, PER DIFETTO.
  // Una chiamata a mano (o con `solo_conta`) legge e basta: quali account sono
  // scaduti e quante righe toccherebbero le potature. Cancella solo con
  // `cancella=1` scritto esatto, o dal calendario con CANCELLAZIONI_A_ORARIO=accese.
  // Sta prima di qualunque scrittura, quindi prima delle potature, che sono la
  // prima cosa che la notte cancella.
  if (giroCheSoloConta(req)) return contaSenzaCancellare(admin, chiamataDelCalendario(req));

  // 8/9/2026 — LE POTATURE NON STANNO PIU' QUI DENTRO.
  //
  // Erano quindici scritture in fila dentro UN solo `try`, con UN solo `catch`
  // in fondo. Bastava che una lanciasse — un client che rifiuta la promessa, la
  // rete che cade a meta' giro — perche' le altre non partissero nemmeno, il
  // conto delle fallite restasse a zero e la notte rispondesse «tutto a posto».
  // Adesso ogni potatura gira per conto suo e chi fallisce si conta: la regola
  // sta in `lib/privacy/potature-ritenzione.ts`, dove una prova la puo' ESEGUIRE
  // senza tirarsi dietro `next/server` e mezzo Next.
  // 1/11/2026 — La notte vera pota anche le copie orfane dei documenti
  // d'identita' (lib/privacy/orfani-kyc.ts): l'elenco di prima piu' quel passo.
  // Il conto senza cancellare conta anche quelle copie (`contaOrfaniKyc`, nella voce
  // «fileDaTogliere» del conto).
  const adesso = Date.now();
  const potature = await eseguiPotature(
    admin as unknown as ClientePotature,
    logger,
    adesso,
    potatureNotturne(adesso),
  );

  // 6/9/2026 — ANCHE QUESTO NUMERO NON LO GUARDAVA NESSUNO.
  //
  // `retentionFallite` usciva solo nel corpo della risposta, ed e' parola per
  // parola il difetto chiuso tre giorni fa una riga piu' sotto, sulle
  // cancellazioni: il corpo lo riceve lo scheduler, che guarda il codice di
  // stato e lo butta via.
  //
  // Una potatura che non passa non e' un dettaglio tecnico: sono indirizzi di
  // rete, foto della porta di casa e email di persone che con noi non hanno
  // nessun rapporto, tenute oltre il tempo che dichiariamo nella pagina
  // pubblica. E non si aggiusta da sola: se il database rifiuta stanotte,
  // rifiutera' anche domani.
  if (potature.fallite > 0) await svegliaPerLaRitenzione(admin, potature);
  // R02-002 — Tutte le pulizie riuscite: il guasto è finito, il suo allarme si toglie (vedi sotto).
  else await chiudiGliAllarmiDellaRitenzione(admin);

  // Chiama la function SQL che ritorna gli userId scaduti
  const { data: expired, error: rpcErr } = await admin.rpc('process_expired_deletions');
  if (rpcErr) {
    logger.error('[cron-deletions] RPC failed', rpcErr);
    // 5/11/2026 — Il testo grezzo del database resta nel registro, non nel corpo per chi chiama.
    return ApiErrors.internal();
  }

  // R24-005 — Dal più vecchio. La RPC non ordina, e il tetto di tempo qui sotto lascia indietro chi
  // viene per ultimo: chi era già oltre il mese poteva restare in fondo ogni notte, fuori dai tentativi
  // e senza l'avviso del termine scaduto. Adesso passa per primo chi ha chiesto da più tempo; una data
  // che manca o non si legge va in fondo (non può essere oltre il termine).
  const chiestaDa = (r: { deleted_at: string | null }) => {
    const t = r.deleted_at ? new Date(r.deleted_at).getTime() : NaN;
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  const scadute = [...((expired ?? []) as Array<{ user_id: string; deleted_at: string | null }>)].sort((a, b) => {
    const da = chiestaDa(a);
    const db = chiestaDa(b);
    return da === db ? 0 : da < db ? -1 : 1;
  });
  const userIds: string[] = scadute.map((r) => r.user_id);
  // R33-014 — Chi ha chiesto la cancellazione da più di 7 giorni ma non è nella lista: un
  // negozio con un ordine aperto o soldi da incassare (migrazione 572). Non si prende in
  // carico: si rimanda alla notte dopo e si segnala agli amministratori.
  const rinviatePerOrdiniAperti = await segnalaLeCancellazioniRinviate(admin, new Set(userIds));
  if (userIds.length === 0) {
    // R03-006 — Anche la notte senza nessuno in lista: chi ne è appena uscito ha ancora il suo «scrivile tu».
    await chiudiGliAllarmiDiChiNonAspettaPiu(admin, adesso);
    // R03-003 — E il suo «Persone non avvisate», se non aspetta più o la spiegazione è arrivata.
    await chiudiGliAllarmiDiChiNonAspettaPiu(admin, adesso, TITOLO_NON_AVVISATE, 'non-avvisata');
    // Le notti senza cancellazioni da fare sono la maggioranza: se il conto
    // delle potature non riuscite non pesa QUI, non pesa quasi mai.
    return NextResponse.json(
      { processed: 0, message: 'No accounts to process', retentionFallite: potature.fallite, rinviatePerOrdiniAperti },
      { status: potature.fallite > 0 ? 500 : 200 },
    );
  }

  const results = { ok: 0, errors: [] as string[] };
  let annullateNelFrattempo = 0;
  const tentativi: TentativoCancellazione[] = [];
  let presiInCarico = 0;
  // R24-006 — Il tetto del ciclo è rigido: è anche la scadenza di ogni account preso (vedi `entroLaScadenza`).
  const scadenzaDelCiclo = adesso + TETTO_CANCELLAZIONI_MS;

  for (const riga of scadute) {
    // R03-005 — Il tetto si guarda prima di prendere in carico un account, dall'inizio del giro.
    if (Date.now() - adesso >= TETTO_CANCELLAZIONI_MS) break;
    presiInCarico++;
    const userId = riga.user_id;
    // #178 — La stessa pipeline che usa la cancellazione fatta
    // dall'amministratore: anonimizza il profilo e i dati di verifica
    // identita', anonimizza il testo libero, toglie dalla newsletter, cancella
    // i file dallo storage e infine l'account. Prima erano due elenchi di passi
    // scritti in due file, e uno dei due era piu' corto.
    // 5/11/2026 — La lista si legge una volta a inizio notte: chi intanto ha annullato la richiesta
    // (deletion_requested_at tornato vuoto) non si cancella. Se la rilettura non riesce si va avanti
    // come prima: la richiesta letta dalla RPC era valida.
    // R24-006 — L'account preso ha un tempo suo, che finisce col tetto del ciclo: prima un account
    // preso a ridosso del tetto poteva durare quanto voleva, e la notte sforava i 300 secondi della
    // piattaforma prima di arrivare alla sveglia e alle email. Finito il tempo non lo si aspetta più:
    // conta come non preso in carico (la richiesta resta, la riprende la notte dopo, il tetto lo
    // dice agli amministratori) e cancellaAccount, con la stessa scadenza, non comincia altri passi.
    const annullata = await entroLaScadenza(haAnnullatoNelFrattempo(admin, userId), scadenzaDelCiclo);
    if (annullata === null) {
      presiInCarico--;
      break;
    }
    if (annullata) {
      annullateNelFrattempo++;
      logger.info('[cron-deletions] richiesta annullata durante il giro: account saltato', { userId });
      continue;
    }
    const esito = await entroLaScadenza(cancellaAccount(admin, userId, { scadenza: scadenzaDelCiclo }), scadenzaDelCiclo);
    if (esito === null || esito.tempoFinito) {
      presiInCarico--;
      logger.warn('[cron-deletions] tetto di tempo raggiunto durante una cancellazione: account rimandato', { userId });
      break;
    }
    tentativi.push({
      userId,
      ok: esito.ok,
      motivo: esito.motivo,
      errore: esito.errore,
      // La RPC restituisce anche il giorno in cui la persona ha chiesto di
      // sparire: e' l'unica cosa che dice da quanto sta aspettando, e quindi
      // l'unica che distingue un rinvio di ieri da un termine di legge scaduto.
      chiestaIl: riga.deleted_at,
    });
    if (!esito.ok) {
      logger.error('[cron-deletions] cancellazione fallita', {
        userId, errore: esito.errore, motivo: esito.motivo ?? null,
      });
      // 5/11/2026 — Nel corpo della risposta (lo legge chi chiama, anche il cron esterno) solo il
      // conto: niente identificativi delle persone né motivi (importi dei contanti, messaggi di
      // Stripe). Il dettaglio sta nel logger.error qui sopra.
      results.errors.push('cancellazione non riuscita');
      continue;
    }

    results.ok++;
    logger.info('[cron-deletions] processed', { userId, fileRimossi: esito.fileRimossi });
  }

  // R03-005 — Chi il tetto ha lasciato fuori stanotte: la richiesta resta, la riprende la notte dopo.
  const rimandateAlGiroDopo = scadute.length - presiInCarico;
  // R03-006 — Il tetto che taglia del lavoro non resta un numero nella risposta: lo si dice subito,
  // prima delle email (che adesso hanno il loro tempo, perché il ciclo si è fermato al tetto).
  if (rimandateAlGiroDopo > 0) {
    await avvisaDelTettoDiTempo(admin, presiInCarico, scadute.slice(presiInCarico).map((r) => r.user_id));
  }

  const verdetto = verdettoDelGiro(tentativi, Date.now());

  // 27/10/2026 — LA RISPOSTA DOVUTA ESCE DI CASA.
  //
  // `verdetto.dovuti` era calcolato ogni notte e non lo leggeva nessuno: chi
  // aveva chiesto di sparire e restava (un fattorino con contanti da versare)
  // vedeva un conto alla rovescia fermo a zero, e il motivo restava nei log.
  // L'art. 12.3-12.4 chiede di dirglielo, col motivo e la strada del reclamo.
  // Ogni avviso ha un identificativo ricavato dalla sua chiave: trenta notti di
  // rinvio scrivono UNA riga, e due giri partiti insieme non ne scrivono due.
  //
  // 27/10/2026 (quarto giro, fase 2) — PRIMA LA SVEGLIA, POI LE EMAIL. Ogni
  // email può aspettare Resend fino a due volte dieci secondi: con la posta
  // appesa e quindici persone in attesa la notte sforava i 300 secondi prima
  // di arrivare alla sveglia, e le cancellazioni ferme non le sapeva nessuno.
  if (verdetto.daSvegliare) await sveglia(admin, verdetto);
  // R01-002 — Le spiegazioni una alla volta, col tetto delle email: l'allarme di un'email ferma si
  // scrive subito (vedi più sotto), quelle senza tempo si contano e si dicono.
  const { avvisi, allarmiEmail, senzaTempo } = await rispondiEntroIlTetto(admin, verdetto, adesso);
  // R03-003 — Un allarme per avviso non recapitato, non uno a notte: come per le email ferme,
  // l'identificativo si ricava dall'avviso (la notte dopo la riga c'è già) e il testo dice chi aspetta.
  // Si contano come quelli delle email: nuovi stanotte, o non scritti (vedi lo stato della risposta).
  const allarmiNonAvvisate = { nuovi: 0, nonScritti: 0 };
  for (const e of avvisi.esiti) {
    if (e.esito !== 'fallito') continue;
    const dovuto = verdetto.dovuti.find((d) => d.chiave === e.chiave);
    const quale =
      dovuto?.tappa === 'termine-scaduto'
        ? ' La spiegazione non recapitata è quella del termine di legge scaduto.'
        : dovuto?.tappa === 'rinviata'
          ? ' La spiegazione non recapitata è quella del rinvio.'
          : '';
    const allarme = await avvisaAmministratori(
      admin,
      TITOLO_NON_AVVISATE,
      "Stanotte una persona che aspetta la cancellazione non ha ricevuto il motivo dell'attesa. La legge chiede di dirglielo entro un mese. " +
        'Il giro riprova da solo ogni notte; questo avviso non si ripete per la stessa spiegazione. ' +
        `Chi aspetta: l'utente ${dovuto?.userId ?? 'sconosciuto'}.${quale}`,
      `${identificativoAvviso(e.chiave)}:non-avvisata`,
    );
    if (allarme.nuovo) allarmiNonAvvisate.nuovi++;
    else if (allarme.nonScritto) allarmiNonAvvisate.nonScritti++;
  }
  // 27/10/2026 (terzo giro) — LA SPIEGAZIONE PER EMAIL CHE NON PARTE NON È UNA
  // NOTTE VERDE. La prima volta che la posta dice di no si riprova la notte
  // dopo senza svegliare nessuno: un intoppo di una notte si sistema da solo.
  // Quando non parte di nuovo — o non si può nemmeno tentare — chi vuole
  // andarsene non ha ricevuto niente fuori dal sito, e non lo saprà se non
  // glielo scrive qualcuno. Prima qui c'era solo un numero nel corpo.
  //
  // 27/10/2026 (quarto giro) — UN ALLARME PER STATO, NON PER NOTTE.
  // Con la posta spenta la stessa spiegazione resta ferma per settimane: qui
  // ogni notte nasceva un allarme nuovo, uguale al precedente, e la notte
  // finiva rossa. Il pannello si riempiva di copie, non c'era modo di dire
  // «lo so», e il 500 non scriveva il battito: il sorvegliante dava per morto
  // un lavoro vivo. Adesso ogni spiegazione ferma ha UN allarme, con un
  // identificativo ricavato dall'avviso: la notte in cui si ferma è rossa e
  // sveglia qualcuno; le notti dopo l'allarme c'è già, il numero resta nella
  // risposta (`avvisiEmailBloccate`) e la notte torna verde. Se l'allarme non
  // si riesce a scrivere, la notte resta rossa.
  // 5/11/2026 — Ogni allarme dice QUALE spiegazione è ferma (rinvio o termine scaduto): oltre il
  // mese la stessa persona ne ha due, e prima i due allarmi erano identici.
  // R01-002 — Questi allarmi li scrive `rispondiEntroIlTetto`, uno appena l'email risulta ferma.
  // R02-001 — Le chiusure hanno il loro tetto di tempo (TETTO_CHIUSURE_MS), dall'inizio del giro.
  await chiudiGliAllarmiDelleEmailPartite(admin, avvisi.emailPartiteAvvisi, adesso);
  await chiudiGliAllarmiDiChiNonAspettaPiu(admin, adesso);
  await chiudiGliAllarmiDiChiNonAspettaPiu(admin, adesso, TITOLO_NON_AVVISATE, 'non-avvisata');

  return NextResponse.json(
    {
      processed: results.ok,
      // 3/9/2026 — `failed` conta SOLO i guasti. Prima contava ogni «non
      // cancellato», rinvii compresi: chi leggeva la risposta vedeva un
      // fallimento dove c'era una regola che stava funzionando.
      failed: verdetto.fallite,
      errors: results.errors.length,
      total: userIds.length,
      annullateNelFrattempo,
      rimandateAlGiroDopo,
      // R169 — Quante pulizie di ritenzione non sono riuscite: senza questo numero
      // il lavoro rispondeva «fatto» anche quando non aveva pulito niente.
      retentionFallite: potature.fallite,
      // 3/9/2026 — Un rinvio deciso da noi non e' un fallimento, ma non e'
      // nemmeno un successo: se non ha un posto suo nella risposta, sparisce
      // dentro `failed` (e allora l'allarme suona ogni notte) oppure dentro
      // `processed` (e allora non suona mai).
      rinviate: verdetto.rinviate,
      scadute: verdetto.scadute,
      // 27/10/2026 — Quante persone hanno ricevuto il motivo dell'attesa, e
      // quante no: un avviso dovuto per legge che non parte è un guasto.
      avvisiRecapitati: avvisi.recapitati,
      avvisiFalliti: avvisi.falliti,
      // 27/10/2026 (secondo giro) — La spiegazione scritta nel pannello è
      // partita anche per email? Qui quante no stanotte: la notte dopo si riprova.
      avvisiEmailNonPartite: avvisi.emailNonPartite,
      // 27/10/2026 (terzo giro) — Di quelle, quante non si sistemano da sole
      // (non partite di nuovo, o registro degli invii illeggibile): sono loro
      // a rendere rossa la notte e a svegliare un amministratore.
      avvisiEmailBloccate: avvisi.emailBloccate,
      // 27/10/2026 (quarto giro) — Di quelle, quante sono ferme da stanotte
      // (allarme nuovo): le altre l'amministratore le sa già.
      allarmiEmailNuovi: allarmiEmail.nuovi,
      // R03-003 — Lo stesso per le persone non avvisate nel pannello: gli allarmi nati stanotte.
      allarmiNonAvvisateNuovi: allarmiNonAvvisate.nuovi,
      // 27/10/2026 (quarto giro, fase 2) — Quante email stanotte non si sono
      // tentate perché il turno l'aveva già preso un altro giro da poco.
      avvisiEmailRimandate: avvisi.emailRimandate,
      // R01-002 — Quante spiegazioni stanotte non hanno tentato l'email perché il giro aveva finito
      // il tempo delle email: si riprovano la notte dopo.
      avvisiEmailSenzaTempo: senzaTempo,
      rinviatePerOrdiniAperti,
    },
    // 3/9/2026 — LA NOTTE CHE FALLISCE FINISCE ROSSA.
    //
    // Qui si rispondeva 200 con `failed: 3` nel corpo, e il corpo non lo legge
    // nessuno: ne' Vercel, che guarda il codice di stato, ne' il freno
    // anti-silenzio, che scrive il battito solo se la risposta e' buona
    // (`withCronAuth`). Un 500 fa due cose insieme: rende rossa l'esecuzione
    // nel pannello dei lavori periodici, e NON scrive il battito — cosi' se la
    // cosa va avanti anche il sorvegliante se ne accorge da solo.
    {
      status:
        verdetto.daSvegliare ||
        potature.fallite > 0 ||
        // R03-003 — Come le email ferme: la persona non avvisata fa rossa la notte in cui nasce il suo
        // allarme (o se l'allarme non si scrive); le notti dopo l'amministratore lo sa già, il numero
        // resta nella risposta (`avvisiFalliti`) e il battito si scrive.
        allarmiNonAvvisate.nuovi > 0 ||
        allarmiNonAvvisate.nonScritti > 0 ||
        allarmiEmail.nuovi > 0 ||
        allarmiEmail.nonScritti > 0 ||
        senzaTempo > 0
          ? 500
          : 200,
    },
  );
});

/**
 * Sveglia un amministratore quando delle cancellazioni non sono state eseguite.
 * Il testo dell'avviso lo prepara `lib/cron-cancellazioni.ts`: e' una decisione,
 * e le decisioni si provano senza far girare tutta la notte.
 */
async function sveglia(admin: Admin, verdetto: VerdettoGiro): Promise<void> {
  logger.error('[cron-deletions] richieste di cancellazione non eseguite', {
    fallite: verdetto.fallite,
    scadute: verdetto.scadute,
    riga: verdetto.riga,
  });
  // 5/11/2026 — Quando a svegliare sono solo i termini scaduti (nessun guasto stanotte), la sveglia
  // ha un identificativo ricavato da CHI è oltre il termine: la notte dopo, con le stesse persone,
  // trova la riga e non ne scrive un'altra a ogni amministratore. Un guasto sveglia ogni notte.
  const oltreIlTermine = [...new Set(verdetto.dovuti.filter((d) => d.tappa === 'termine-scaduto').map((d) => d.userId))].sort();
  const chiave = verdetto.fallite === 0 && oltreIlTermine.length > 0 ? `sveglia-termine-scaduto:${oltreIlTermine.join(',')}` : undefined;
  await avvisaAmministratori(
    admin,
    'Cancellazioni account non eseguite',
    verdetto.riga ?? 'Il giro notturno delle cancellazioni non e andato a buon fine.',
    chiave,
  );
}

/**
 * 26/11/2026 (R24-006) — Un passo del ciclo delle cancellazioni si aspetta al massimo fino alla
 * scadenza: dopo, `null`, e il ciclo va avanti senza di lui. Il passo lasciato indietro non diventa
 * un rifiuto senza padrone se poi cade; e non fa altro, perché cancellaAccount ha la stessa scadenza.
 */
async function entroLaScadenza<T>(passo: Promise<T>, scadenza: number): Promise<T | null> {
  passo.catch(() => undefined);
  let sveglia: ReturnType<typeof setTimeout> | undefined;
  const tempo = new Promise<null>((risolvi) => {
    sveglia = setTimeout(() => risolvi(null), Math.max(0, scadenza - Date.now()));
  });
  try {
    return await Promise.race([passo, tempo]);
  } finally {
    clearTimeout(sveglia);
  }
}

/**
 * 21/11/2026 (R03-006) — IL TETTO DI TEMPO HA TAGLIATO DEL LAVORO: LO SI DICE.
 *
 * Gli account lasciati fuori ripartono da soli la notte dopo, ma se succede tutte le notti la coda
 * cresce e il termine di un mese si avvicina senza che nessuno lo sappia: per loro stanotte non si
 * è nemmeno guardato se il termine è passato. Errore nel registro (arriva a Sentry) e avviso nel
 * pannello degli amministratori.
 */
async function avvisaDelTettoDiTempo(admin: Admin, prese: number, rimandati: string[]): Promise<void> {
  const rimandate = rimandati.length;
  logger.error('[cron-deletions] tetto di tempo raggiunto: cancellazioni rimandate alla notte dopo', {
    prese,
    rimandate,
    tettoMs: TETTO_CANCELLAZIONI_MS,
  });
  const quante =
    rimandate === 1
      ? '1 richiesta di cancellazione è rimandata alla notte dopo'
      : `${rimandate} richieste di cancellazione sono rimandate alla notte dopo`;
  // R01-002 — Un allarme per stato, non per notte: l'identificativo si ricava da CHI è rimandato
  // (come la sveglia dei termini scaduti). La notte dopo, con gli stessi account indietro, la riga
  // c'è già e non se ne scrive un'altra a ogni amministratore; con un arretrato diverso sì.
  const chiave = `tetto-cancellazioni:${[...new Set(rimandati)].sort().join(',')}`;
  await avvisaAmministratori(
    admin,
    'Cancellazioni rimandate: il giro notturno ha finito il tempo',
    `Stanotte il giro delle cancellazioni ha raggiunto il suo tetto di tempo dopo ${prese} account: ${quante}. ` +
      'Le richieste restano in attesa e ripartono da sole; se succede ogni notte la coda cresce e il termine ' +
      'di un mese per rispondere si avvicina.',
    chiave,
  );
}

/**
 * 21/11/2026 (R01-002) — LE SPIEGAZIONI DELLA NOTTE, UNA ALLA VOLTA, COL TETTO DELLE EMAIL.
 *
 * Prima partivano tutte in una chiamata sola, e gli allarmi delle email ferme si scrivevano dopo
 * l'ultima: con la posta lenta e il giro a ridosso dei 300 secondi, la funzione fermata dalla
 * piattaforma li perdeva. Adesso:
 *  · prima di ogni spiegazione si guarda il tetto delle email (dall'inizio del giro);
 *  · l'allarme di un'email ferma si scrive subito, prima di tentare quella dopo;
 *  · passato il tetto, le spiegazioni rimaste si dicono con un allarme, poi si scrivono solo nel
 *    pannello della persona (è veloce) senza tentare l'email, che si riprova la notte dopo.
 */
async function rispondiEntroIlTetto(
  admin: Admin,
  verdetto: VerdettoGiro,
  inizio: number,
): Promise<{ avvisi: RapportoAvvisi; allarmiEmail: { nuovi: number; nonScritti: number }; senzaTempo: number }> {
  const avvisi: RapportoAvvisi = {
    recapitati: 0, giaDetti: 0, falliti: 0, emailNonPartite: 0, emailBloccate: 0, emailBloccateAvvisi: [],
    emailPartiteAvvisi: [], emailRimandate: 0, esiti: [],
  };
  const somma = (uno: RapportoAvvisi) => {
    avvisi.recapitati += uno.recapitati;
    avvisi.giaDetti += uno.giaDetti;
    avvisi.falliti += uno.falliti;
    avvisi.emailNonPartite += uno.emailNonPartite;
    avvisi.emailBloccate += uno.emailBloccate;
    avvisi.emailRimandate += uno.emailRimandate;
    avvisi.emailBloccateAvvisi.push(...uno.emailBloccateAvvisi);
    avvisi.emailPartiteAvvisi.push(...uno.emailPartiteAvvisi);
    avvisi.esiti.push(...uno.esiti);
  };
  const allarmiEmail = { nuovi: 0, nonScritti: 0 };
  const dovuti = verdetto.dovuti;
  for (let i = 0; i < dovuti.length; i++) {
    if (Date.now() - inizio >= TETTO_EMAIL_MS) {
      const rimaste = dovuti.slice(i);
      // R03-008 — Una spiegazione arrivata per email in una notte prima non è «non partita»: fuori
      // dal conto, dal testo e dalla chiave dell'allarme. Nel pannello si scrivono tutte, come prima.
      const nonPartite: typeof rimaste = [];
      // R08-008 (onda 2) — Lo chiede alla libreria degli avvisi: il registro e il segno «partita» restano suoi.
      for (const d of rimaste) {
        if (!(await emailRisultaPartita(admin as unknown as ClienteAvvisi, identificativoAvviso(d.chiave)))) nonPartite.push(d);
      }
      if (nonPartite.length > 0) await avvisaDelleEmailSenzaTempo(admin, nonPartite.map((d) => identificativoAvviso(d.chiave)));
      somma(await recapitaAvvisi(admin as unknown as ClienteAvvisi, rimaste, logger));
      return { avvisi, allarmiEmail, senzaTempo: nonPartite.length };
    }
    const uno = await rispondiAChiAspetta(admin, { dovuti: [dovuti[i]] }, logger);
    somma(uno);
    const allarmi = await avvisaUnaVoltaPerAvviso(
      admin,
      uno.emailBloccateAvvisi.map((x) => ({ ...x, tappa: dovuti[i].tappa })),
    );
    allarmiEmail.nuovi += allarmi.nuovi;
    allarmiEmail.nonScritti += allarmi.nonScritti;
  }
  return { avvisi, allarmiEmail, senzaTempo: 0 };
}

/*
 * 28/11/2026 (R08-008, onda 2) — Qui c'era una copia del segno «partita» che la libreria degli avvisi
 * scrive nel registro degli invii (lì è una costante privata), con la sua lettura. Se la libreria
 * cambiava il segno o il registro, la copia smetteva di vederlo senza dirlo, e l'allarme contava
 * «non partite» email già arrivate. Adesso si chiede a lei: `emailRisultaPartita` (R14-002).
 */

/**
 * 21/11/2026 (R01-002) — Le spiegazioni rimaste senza il tempo delle email: errore nel registro
 * (arriva a Sentry) e un avviso agli amministratori, uno per stato (identificativo ricavato dalle
 * spiegazioni rimaste), non uno a notte. La notte resta rossa (il 500 sta nella rotta).
 */
async function avvisaDelleEmailSenzaTempo(admin: Admin, idAvvisi: string[]): Promise<void> {
  const quante = idAvvisi.length;
  logger.error('[cron-deletions] tetto di tempo delle email raggiunto: spiegazioni non tentate per email', {
    quante,
    tettoMs: TETTO_EMAIL_MS,
  });
  const chiave = `email-senza-tempo:${[...new Set(idAvvisi)].sort().join(',')}`;
  await avvisaAmministratori(
    admin,
    'Spiegazioni non partite per email: il giro notturno ha finito il tempo',
    (quante === 1
      ? "Stanotte 1 spiegazione dell'attesa per la cancellazione non è partita per email: "
      : `Stanotte ${quante} spiegazioni dell'attesa per la cancellazione non sono partite per email: `) +
      'il giro aveva finito il tempo delle email. Sono scritte nel pannello del sito della persona e la notte ' +
      'dopo si riprova da sola; se succede ogni notte, chi vuole andarsene non riceve niente fuori dal sito.',
    chiave,
  );
}

/**
 * 6/9/2026 — La stessa sveglia, per le pulizie dei dati vecchi.
 *
 * Non e' una cancellazione mancata, ma il difetto e' identico: un conto esatto
 * che restava dentro una risposta HTTP. Qui si dice cosa e' successo con parole
 * che si leggono di notte, e la notte finisce rossa (il 500 sta nella rotta):
 * cosi' l'esecuzione diventa rossa nel pannello dei lavori periodici e il
 * battito non viene scritto, quindi se ne accorge anche il sorvegliante.
 */
async function svegliaPerLaRitenzione(admin: Admin, rapporto: RapportoPotature): Promise<void> {
  const quante = rapporto.fallite;
  logger.error('[cron-deletions] pulizie di ritenzione non riuscite: i dati oltre la finestra restano dove sono', {
    quante,
    // 8/9/2026 — QUALI, non solo quante. Prima usciva un numero e basta: chi si
    // alzava di notte non sapeva se erano gli indirizzi di rete o le foto della
    // porta di casa, e doveva rileggersi tutto il lavoro per scoprirlo.
    quali: rapporto.esiti.filter((e) => !e.ok).map((e) => `${e.cosa}: ${e.errore}`),
  });
  const quali = quante === 1
    ? 'Stanotte una pulizia dei dati vecchi non è riuscita.'
    : `Stanotte ${quante} pulizie dei dati vecchi non sono riuscite.`;
  // R03-004 — Un allarme per stato, non per notte: l'identificativo si ricava da QUALI pulizie non
  // riescono. La notte dopo, con lo stesso guasto, la riga c'è già; con un guasto diverso se ne scrive una.
  const chiave = `ritenzione-non-riuscita:${[...new Set(rapporto.esiti.filter((e) => !e.ok).map((e) => e.cosa))].sort().join(',')}`;
  await avvisaAmministratori(
    admin,
    TITOLO_RITENZIONE,
    `${quali} I dati che dovevamo cancellare sono ancora al loro posto, oltre il tempo che ` +
      'promettiamo nella pagina della privacy. Non si sistema da sola: se il database ha detto di ' +
      'no stanotte, dirà di no anche domani.',
    chiave,
  );
}

/** Il titolo dell'allarme delle pulizie non riuscite: lo scrive `svegliaPerLaRitenzione`, lo toglie la chiusura qui sotto. */
const TITOLO_RITENZIONE = 'Dati vecchi non cancellati';

/**
 * 24/11/2026 (R02-002) — «DATI VECCHI NON CANCELLATI» VALE FINCHÉ IL GUASTO DURA.
 *
 * L'allarme ha un identificativo ricavato da quali pulizie non riescono: la notte dopo, con lo
 * stesso guasto, la riga c'è già e non se ne scrive un'altra. Ma nessuno la toglieva: se il guasto
 * si sistemava e settimane dopo tornava uguale, la riga di allora (già letta) bloccava l'allarme
 * nuovo e gli amministratori non sapevano niente. La notte in cui tutte le pulizie riescono il
 * guasto è finito: gli allarmi «Dati vecchi non cancellati» degli amministratori si tolgono, così
 * se torna se ne scrive uno nuovo. Il guasto di allora resta nel registro degli errori (Sentry) e
 * nella notte rossa. Non lancia: un allarme non tolto è un fastidio da annotare, non un guasto.
 */
async function chiudiGliAllarmiDellaRitenzione(admin: Admin): Promise<void> {
  try {
    const { data, error } = await admin.from('profiles').select('id').eq('role', 'admin').limit(10);
    if (error) throw new Error(error.message);
    for (const a of (data ?? []) as { id: string }[]) {
      const tolti = await admin.from('notifications').delete().eq('user_id', a.id).eq('title', TITOLO_RITENZIONE);
      if (tolti.error) throw new Error(tolti.error.message);
    }
  } catch (e) {
    logger.warn('[cron-deletions] allarme «Dati vecchi non cancellati» non tolto dopo le pulizie riuscite', {
      errore: e instanceof Error ? e.message : 'errore',
    });
  }
}

/**
 * 27/10/2026 (quarto giro) — L'allarme per una spiegazione ferma, uno per
 * avviso e per amministratore: l'identificativo si ricava dall'avviso, quindi
 * la seconda notte trova la riga e non ne scrive un'altra (e due giri insieme
 * sbattono sulla chiave primaria). `nuovi`: avvisi fermi da stanotte, la notte
 * è rossa. `nonScritti`: allarme che non si riesce a scrivere, la notte resta
 * rossa perché nessuno lo sa.
 */
/**
 * R33-014 — LA CANCELLAZIONE DEL NEGOZIO ASPETTA I SUOI ORDINI APERTI.
 *
 * Dalla migrazione 572 `process_expired_deletions` non restituisce il negozio che ha ancora
 * un ordine aperto (pagato, o in contanti, e non consegnato né annullato) o soldi da
 * incassare (bonifico trattenuto, in attesa, in corso, fallito, o contanti non ancora
 * versati): la notte non lo prende in carico e non lo cancella. Qui si trovano quelle
 * richieste scadute rimaste fuori dalla lista, e gli amministratori ricevono un avviso per
 * negozio (uno solo, non uno a notte). Una lettura che non riesce non ferma il giro.
 *
 * 21/11/2026 (R01-003) — Prima si leggevano al massimo 200 profili, senza ordine, e quelli presi
 * in carico si toglievano DOPO il limite: con più di 200 richieste scadute il negozio rinviato
 * poteva restare fuori per sempre. Adesso si legge a pagine, in ordine di richiesta e poi di id,
 * finché finiscono, e i presi in carico si tolgono pagina per pagina. Due tetti, detti nel
 * registro quando scattano: le pagine (`RINVIATE_PAGINE_MASSIME`) e il tempo
 * (`TETTO_RINVIATE_MS`), perché questo passo viene prima del ciclo delle cancellazioni e il
 * tempo di quel ciclo si conta dall'inizio del giro.
 */
const RINVIATE_PER_PAGINA = 200;
const RINVIATE_PAGINE_MASSIME = 25;
const TETTO_RINVIATE_MS = 45_000;

async function segnalaLeCancellazioniRinviate(admin: Admin, prese: Set<string>): Promise<number> {
  const inizio = Date.now();
  let rinviate = 0;
  try {
    const soglia = new Date(Date.now() - 7 * 86_400_000).toISOString();
    type Richiesta = { id: string; deletion_requested_at: string };
    const leggi = async (pagina: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
      const { data, error } = await pagina;
      if (error || !Array.isArray(data)) throw new Error(error?.message ?? 'risposta senza righe');
      return data as Richiesta[];
    };
    let dopo: Richiesta | null = null;
    for (let pagina = 0; ; pagina++) {
      if (pagina === RINVIATE_PAGINE_MASSIME) {
        logger.warn('[cron-deletions] richieste rinviate: tetto di pagine raggiunto, le altre si guardano la notte dopo', {
          righeLette: pagina * RINVIATE_PER_PAGINA,
        });
        break;
      }
      // Prima chi ha la stessa ora di richiesta dell'ultima riga letta e un id più grande (a pari
      // merito sul confine della pagina), poi chi ha chiesto dopo.
      let righe: Richiesta[] = [];
      let ultimaPagina = false;
      if (dopo) {
        righe = await leggi(
          admin.from('profiles').select('id, deletion_requested_at')
            .eq('deletion_requested_at', dopo.deletion_requested_at).gt('id', dopo.id)
            .order('id').limit(RINVIATE_PER_PAGINA),
        );
      }
      if (righe.length === 0) {
        let q = admin.from('profiles').select('id, deletion_requested_at').lt('deletion_requested_at', soglia);
        if (dopo) q = q.gt('deletion_requested_at', dopo.deletion_requested_at);
        righe = await leggi(q.order('deletion_requested_at').order('id').limit(RINVIATE_PER_PAGINA));
        ultimaPagina = righe.length < RINVIATE_PER_PAGINA;
      }
      for (const r of righe) {
        if (!r?.id || prese.has(r.id)) continue;
        if (Date.now() - inizio >= TETTO_RINVIATE_MS) {
          logger.warn('[cron-deletions] richieste rinviate: tempo finito, le altre si avvisano la notte dopo', {
            avvisate: rinviate,
            tettoMs: TETTO_RINVIATE_MS,
          });
          return rinviate;
        }
        rinviate++;
        logger.warn('[cron-deletions] cancellazione rinviata: il negozio ha ordini aperti o soldi da incassare', { userId: r.id });
        await avvisaAmministratori(
          admin,
          'Cancellazione rinviata: ordini o soldi ancora aperti',
          `L'account ${r.id.slice(0, 8)} ha chiesto la cancellazione da più di 7 giorni, ma come negozio ha ancora ` +
            'un ordine aperto o soldi da incassare: la notte non la prende in carico e riprova ogni notte. ' +
            'Chiusi ordini e bonifici, la cancellazione parte da sola.',
          `cancellazione-rinviata-ordini:${r.id}`,
        );
      }
      if (ultimaPagina || righe.length === 0) break;
      dopo = righe[righe.length - 1];
    }
    return rinviate;
  } catch (e) {
    logger.warn('[cron-deletions] richieste rinviate non lette', { message: e instanceof Error ? e.message : 'errore' });
    return rinviate;
  }
}

/** Chi ha annullato la richiesta dopo la lettura della lista: la riga del profilo non la porta più. */
async function haAnnullatoNelFrattempo(admin: Admin, userId: string): Promise<boolean> {
  try {
    const { data, error } = await admin.from('profiles').select('deletion_requested_at').eq('id', userId).maybeSingle();
    if (error || !data || typeof data !== 'object') return false;
    return !(data as { deletion_requested_at?: string | null }).deletion_requested_at;
  } catch {
    return false;
  }
}

async function avvisaUnaVoltaPerAvviso(
  admin: Admin,
  avvisiFermi: Array<{ id: string; userId: string; tappa?: TappaAvviso; forsePartita?: true; registroIlleggibile?: true }>,
): Promise<{ nuovi: number; nonScritti: number }> {
  const conto = { nuovi: 0, nonScritti: 0 };
  if (avvisiFermi.length === 0) return conto;
  let amministratori: { id: string }[];
  try {
    const { data, error } = await admin.from('profiles').select('id').eq('role', 'admin').limit(10);
    if (error) throw new Error(error.message);
    amministratori = (data ?? []) as { id: string }[];
  } catch (e) {
    logger.error('[cron-deletions] allarme per la spiegazione ferma non scritto', { e });
    return { nuovi: 0, nonScritti: avvisiFermi.length };
  }
  if (amministratori.length === 0) {
    logger.error('[cron-deletions] nessun amministratore a cui dirlo: allarme non recapitato', { avvisiFermi: avvisiFermi.length });
    return { nuovi: 0, nonScritti: avvisiFermi.length };
  }
  for (const { id: idAvviso, userId, tappa, forsePartita, registroIlleggibile } of avvisiFermi) {
    const quale =
      tappa === 'termine-scaduto'
        ? ' La spiegazione ferma è quella del termine di legge scaduto.'
        : tappa === 'rinviata'
          ? ' La spiegazione ferma è quella del rinvio.'
          : '';
    let nuovo = false;
    let rotto = false;
    for (const a of amministratori) {
      const id = identificativoAvviso(`${idAvviso}:email-ferma:${a.id}`);
      const gia = await admin.from('notifications').select('id').eq('id', id);
      if (gia.error) {
        rotto = true;
        continue;
      }
      if (Array.isArray(gia.data) && gia.data.length > 0) continue;
      const { error } = await admin.from('notifications').insert({
        id,
        user_id: a.id,
        category: 'system',
        title: TITOLO_EMAIL_FERMA,
        body:
          // R09-001 — Se una notte prima l'email è stata spedita ma il registro non l'ha segnata, può
          // essere arrivata: l'allarme non può dire «non è partita».
          // 28/11/2026 (R08-011) — Se il registro degli invii non si è letto (o non ha preso il turno),
          // l'email stanotte non si è tentata e non si sa niente: né se una notte prima è partita, né se
          // è la prima notte. lib/privacy/avvisi-a-chi-aspetta.ts lo segnava già (`registroIlleggibile`,
          // R25-005), ma qui nessuno lo leggeva e l'allarme diceva «non è partita, non è un intoppo di
          // una notte sola» anche alla prima notte e per un'email forse già arrivata.
          (registroIlleggibile
            ? "Non si sa se una spiegazione dell'attesa per la cancellazione sia partita per email: il registro degli invii non si è potuto leggere, quindi stanotte l'email non è stata tentata (per non mandarla due volte). Può essere la prima notte, e un'email di una notte prima può essere arrivata. "
            : forsePartita
              ? "Una spiegazione dell'attesa per la cancellazione non risulta partita per email: una notte prima è stata spedita ma il registro non l'ha segnata, quindi può essere arrivata. "
              : "Una spiegazione dell'attesa per la cancellazione non è partita per email, e non è un intoppo di una notte sola. ") +
          "È scritta nel pannello del sito della persona, ma chi vuole andarsene può non rientrarci più: " +
          'controlla la posta del sito oppure scrivile tu. Il giro riprova da solo ogni notte; ' +
          'questo avviso non si ripete finché la spiegazione resta ferma, e si chiude da solo quando parte. ' +
          // 27/10/2026 (quarto giro, fase 2) — «Scrivile tu», ma a chi: con più
          // persone in attesa l'amministratore non lo sapeva.
          `Chi aspetta: l'utente ${userId}.${quale}`,
        link: '/admin/users',
      });
      if (!error) nuovo = true;
      else if (!/duplicate key|23505|already exists/i.test(error.message)) {
        rotto = true;
        logger.error('[cron-deletions] allarme per la spiegazione ferma non scritto', { message: error.message });
      }
    }
    if (nuovo) conto.nuovi++;
    else if (rotto) conto.nonScritti++;
  }
  return conto;
}

/**
 * 27/10/2026 (quarto giro, fase 2) — L'ALLARME SI CHIUDE QUANDO L'EMAIL PARTE.
 *
 * «Scrivile tu» è vero finché la spiegazione è ferma. La notte in cui parte,
 * gli allarmi di quell'avviso (uno per amministratore, stesso identificativo
 * di `avvisaUnaVoltaPerAvviso`) si segnano letti. Non lancia: un allarme
 * rimasto aperto è un fastidio da annotare, non un guasto della notte.
 */
async function chiudiGliAllarmiDelleEmailPartite(admin: Admin, partite: string[], inizio: number): Promise<void> {
  if (partite.length === 0) return;
  try {
    const { data, error } = await admin.from('profiles').select('id').eq('role', 'admin').limit(10);
    if (error) throw new Error(error.message);
    for (const idAvviso of partite) {
      if (chiusureSenzaTempo(inizio, 'email partite')) return;
      for (const a of (data ?? []) as { id: string }[]) {
        const chiuso = await admin
          .from('notifications')
          .update({ is_read: true })
          .eq('id', identificativoAvviso(`${idAvviso}:email-ferma:${a.id}`));
        if (chiuso.error) throw new Error(chiuso.error.message);
      }
    }
  } catch (e) {
    logger.warn('[cron-deletions] allarme della spiegazione partita non chiuso', {
      errore: e instanceof Error ? e.message : 'errore',
    });
  }
}

/** Il titolo dell'allarme «scrivile tu»: lo scrive `avvisaUnaVoltaPerAvviso`, lo cerca la chiusura qui sotto. */
const TITOLO_EMAIL_FERMA = "Spiegazione dell'attesa non partita per email";
/** Il titolo dell'allarme «Persone non avvisate»: lo scrive il giro, lo cerca la stessa chiusura. */
const TITOLO_NON_AVVISATE = 'Persone non avvisate del rinvio della cancellazione';
const ALLARMI_PER_PAGINA = 200;

/**
 * 21/11/2026 (R03-006, R03-007) — «SCRIVILE TU» SI CHIUDE ANCHE QUANDO LA PERSONA NON ASPETTA PIÙ.
 *
 * L'allarme si chiudeva solo la notte in cui l'email partiva, e solo per gli avvisi di quella notte.
 * Chi esce dall'elenco (cancellato, richiesta annullata, richiesta rifatta con un'altra data) non ha
 * più un avviso, quindi il suo allarme restava aperto per sempre col suo id. Ogni notte, anche quella
 * senza nessuno in lista, si leggono gli allarmi APERTI di ogni amministratore (solo quelli, in
 * ordine di id, a pagine fino in fondo: nessuno resta fuori oltre i primi duecento) e si chiude chi
 * non aspetta più: profilo sparito o senza richiesta, o un allarme che non è di nessuna spiegazione
 * della richiesta di oggi. Chi aspetta ancora lo tiene, anche se stanotte non è stato guardato (tetto
 * di tempo, ordini aperti). Una lettura che non riesce lascia aperto; non lancia mai.
 *
 * R03-003 — Con `titolo` e `segno` di «Persone non avvisate» chiude allo stesso modo quell'allarme
 * (stesso identificativo con cui nasce: `<idAvviso>:non-avvisata:<amministratore>`), e lo chiude
 * anche quando la spiegazione è ormai nel pannello della persona. Ogni giro legge solo il suo titolo:
 * uno non chiude mai gli allarmi dell'altro.
 *
 * R02-001 — Tutto dentro il tetto delle chiusure (`TETTO_CHIUSURE_MS`, dall'inizio del giro): passato
 * quello non si legge né si chiude un allarme nuovo, e i rimasti li chiude la notte dopo.
 */
async function chiudiGliAllarmiDiChiNonAspettaPiu(
  admin: Admin,
  inizio: number,
  titolo: string = TITOLO_EMAIL_FERMA,
  segno: 'email-ferma' | 'non-avvisata' = 'email-ferma',
): Promise<void> {
  try {
    const { data: amministratori, error } = await admin.from('profiles').select('id').eq('role', 'admin').limit(10);
    if (error) throw new Error(error.message);
    // Chi aspetta → la sua richiesta: una data, null se non aspetta più, undefined se non si è letta.
    const richieste = new Map<string, string | null | undefined>();
    for (const { id: amministratore } of (amministratori ?? []) as { id: string }[]) {
      let dopo: string | null = null;
      for (;;) {
        if (chiusureSenzaTempo(inizio, segno)) return;
        let q = admin.from('notifications').select('id, body')
          .eq('user_id', amministratore).eq('title', titolo).eq('is_read', false);
        if (dopo) q = q.gt('id', dopo);
        const { data, error: errLettura } = await q.order('id').limit(ALLARMI_PER_PAGINA);
        if (errLettura) throw new Error(errLettura.message);
        const righe = (Array.isArray(data) ? data : []) as Array<{ id: string; body: string | null }>;
        for (const r of righe) {
          if (chiusureSenzaTempo(inizio, segno)) return;
          const chi = /Chi aspetta: l'utente ([^\s.]+)\./.exec(String(r.body ?? ''))?.[1];
          if (!chi) continue;
          if (!richieste.has(chi)) richieste.set(chi, await richiestaDi(admin, chi));
          const richiesta = richieste.get(chi);
          if (richiesta === undefined) continue;
          const suaTappa =
            richiesta === null
              ? undefined
              : (['rinviata', 'termine-scaduto'] as const).find(
                  (tappa) => identificativoAvviso(`${identificativoAvviso(chiaveAvviso(chi, richiesta, tappa))}:${segno}:${amministratore}`) === r.id,
                );
          // Senza tappa non aspetta più, o l'allarme è di una richiesta di prima: si chiude.
          if (richiesta !== null && suaTappa !== undefined) {
            if (segno !== 'non-avvisata') continue;
            // «Persone non avvisate» resta finché la spiegazione non è nel pannello (se non si legge, resta).
            if ((await nelPannello(admin, identificativoAvviso(chiaveAvviso(chi, richiesta, suaTappa)))) !== true) continue;
          }
          const chiuso = await admin.from('notifications').update({ is_read: true }).eq('id', r.id);
          if (chiuso.error) throw new Error(chiuso.error.message);
        }
        if (righe.length < ALLARMI_PER_PAGINA) break;
        const ultimo = righe[righe.length - 1].id;
        // Il cursore deve avanzare: una risposta che non rispetta l'ordine non fa girare a vuoto.
        if (dopo !== null && ultimo <= dopo) break;
        dopo = ultimo;
      }
    }
  } catch (e) {
    logger.warn('[cron-deletions] allarmi «scrivile tu» di chi non aspetta più non chiusi', {
      errore: e instanceof Error ? e.message : 'errore',
    });
  }
}

/** R02-001 — Il tetto delle chiusure è passato? Lo dice nel registro: gli allarmi rimasti li chiude la notte dopo. */
function chiusureSenzaTempo(inizio: number, quale: string): boolean {
  if (Date.now() - inizio < TETTO_CHIUSURE_MS) return false;
  logger.warn('[cron-deletions] tetto di tempo delle chiusure raggiunto: gli allarmi rimasti si chiudono la notte dopo', {
    quale,
    tettoMs: TETTO_CHIUSURE_MS,
  });
  return true;
}

/** R03-003 — La spiegazione è nel pannello della persona? undefined se non si legge. */
async function nelPannello(admin: Admin, idAvviso: string): Promise<boolean | undefined> {
  const { data, error } = await admin.from('notifications').select('id').eq('id', idAvviso);
  if (error || !Array.isArray(data)) return undefined;
  return data.length > 0;
}

/** La richiesta di cancellazione di oggi: la data, null se non c'è (o il profilo non c'è più), undefined se non si legge. */
async function richiestaDi(admin: Admin, userId: string): Promise<string | null | undefined> {
  const { data, error } = await admin.from('profiles').select('deletion_requested_at').eq('id', userId);
  if (error || !Array.isArray(data)) return undefined;
  return (data[0] as { deletion_requested_at?: string | null } | undefined)?.deletion_requested_at ?? null;
}

/** R03-003 — Com'è andato un allarme: scritto stanotte (nuovo), oppure non scritto per un guasto. */
type EsitoAllarme = { nuovo: boolean; nonScritto: boolean };

/**
 * Scrive l'avviso nel pannello degli amministratori.
 *
 * Best-effort di proposito: se la notifica non riesce, la notte resta rossa lo
 * stesso (il 500 non dipende da questa funzione) — un allarme che non parte non
 * deve poter cancellare il guasto che doveva annunciare.
 *
 * Perche' la notifica in-app e non l'email: la posta ce l'ha gia' in mano il
 * sorvegliante (`operational-alerts`), che manda un messaggio solo ogni sei ore
 * per la stessa cosa. Qui si scrive nel pannello, che e' il posto dove un
 * amministratore guarda comunque, e nel registro degli errori, che arriva a
 * Sentry.
 */
async function avvisaAmministratori(admin: Admin, titolo: string, riga: string, chiave?: string): Promise<EsitoAllarme> {
  try {
    const { data: amministratori } = await admin
      .from('profiles').select('id').eq('role', 'admin').limit(10);
    if (!amministratori || amministratori.length === 0) {
      logger.error('[cron-deletions] nessun amministratore a cui dirlo: allarme non recapitato', { titolo });
      return { nuovo: false, nonScritto: true };
    }
    if (chiave) {
      // Un allarme per stato: identificativo ricavato dalla chiave, uno per amministratore. La
      // notte dopo il doppione sbatte sulla chiave primaria e non si scrive.
      let nuovo = false;
      let rotto = false;
      for (const a of amministratori as { id: string }[]) {
        const id = identificativoAvviso(`${chiave}:${a.id}`);
        const gia = await admin.from('notifications').select('id').eq('id', id);
        if (!gia.error && Array.isArray(gia.data) && gia.data.length > 0) continue;
        const { error } = await admin.from('notifications').insert({
          id,
          user_id: a.id,
          category: 'system',
          title: titolo,
          body: riga,
          link: '/admin/users',
        });
        if (!error) nuovo = true;
        else if (!/duplicate key|23505|already exists/i.test(error.message)) {
          rotto = true;
          logger.error('[cron-deletions] avviso agli amministratori non scritto', { message: error.message });
        }
      }
      return { nuovo, nonScritto: !nuovo && rotto };
    }
    const { error } = await admin.from('notifications').insert(
      (amministratori as { id: string }[]).map((a) => ({
        user_id: a.id,
        // Categoria di sistema: non e' una promozione e non si spegne con gli
        // interruttori del marketing (#33).
        category: 'system',
        title: titolo,
        body: riga,
        link: '/admin/users',
      })),
    );
    if (error) {
      logger.error('[cron-deletions] avviso agli amministratori non scritto', { message: error.message });
    }
    return { nuovo: !error, nonScritto: !!error };
  } catch (e) {
    logger.error('[cron-deletions] avviso agli amministratori non partito', { e });
    return { nuovo: false, nonScritto: true };
  }
}

// I lavori periodici di Vercel bussano in GET, sempre — non c'è modo di
// chiedergli un POST. Questa rotta nasceva POST-e-basta, dai tempi del cron
// esterno: su Vercel avrebbe risposto «405 metodo non ammesso» a ogni giro, e
// il lavoro non sarebbe mai partito. Stesso identico handler, stesso controllo
// del segreto: cambia solo la porta da cui si entra. Il POST resta valido
// perché il cron esterno continua a girare finché non lo spegni.
export const GET = POST;
