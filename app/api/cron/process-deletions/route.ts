import { NextResponse, type NextRequest } from 'next/server';
import { ApiErrors } from '@/lib/api/responses';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { cancellaAccount } from '@/lib/account/cancellazione';
import {
  verdettoDelGiro,
  type TentativoCancellazione,
  type VerdettoGiro,
} from '@/lib/cron-cancellazioni';
import {
  eseguiPotature,
  type ClientePotature,
  type RapportoPotature,
} from '@/lib/privacy/potature-ritenzione';

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
 * A mano si chiama così:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://yourapp.com/api/cron/process-deletions
 *
 * Schedule consigliato: ogni giorno alle 04:00 Europe/Rome.
 */




type Admin = ReturnType<typeof getAdminSupabase>;

export const POST = withCronAuth(async (_req: NextRequest): Promise<NextResponse> => {
  const admin = getAdminSupabase();

  // 8/9/2026 — LE POTATURE NON STANNO PIU' QUI DENTRO.
  //
  // Erano quindici scritture in fila dentro UN solo `try`, con UN solo `catch`
  // in fondo. Bastava che una lanciasse — un client che rifiuta la promessa, la
  // rete che cade a meta' giro — perche' le altre non partissero nemmeno, il
  // conto delle fallite restasse a zero e la notte rispondesse «tutto a posto».
  // Adesso ogni potatura gira per conto suo e chi fallisce si conta: la regola
  // sta in `lib/privacy/potature-ritenzione.ts`, dove una prova la puo' ESEGUIRE
  // senza tirarsi dietro `next/server` e mezzo Next.
  const potature = await eseguiPotature(admin as unknown as ClientePotature, logger);

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

  // Chiama la function SQL che ritorna gli userId scaduti
  const { data: expired, error: rpcErr } = await admin.rpc('process_expired_deletions');
  if (rpcErr) {
    logger.error('[cron-deletions] RPC failed', rpcErr);
    return ApiErrors.internal(rpcErr.message);
  }

  const scadute = (expired ?? []) as Array<{ user_id: string; deleted_at: string | null }>;
  const userIds: string[] = scadute.map((r) => r.user_id);
  if (userIds.length === 0) {
    // Le notti senza cancellazioni da fare sono la maggioranza: se il conto
    // delle potature non riuscite non pesa QUI, non pesa quasi mai.
    return NextResponse.json(
      { processed: 0, message: 'No accounts to process', retentionFallite: potature.fallite },
      { status: potature.fallite > 0 ? 500 : 200 },
    );
  }

  const results = { ok: 0, errors: [] as string[] };
  const tentativi: TentativoCancellazione[] = [];

  for (const riga of scadute) {
    const userId = riga.user_id;
    // #178 — La stessa pipeline che usa la cancellazione fatta
    // dall'amministratore: anonimizza il profilo e i dati di verifica
    // identita', anonimizza il testo libero, toglie dalla newsletter, cancella
    // i file dallo storage e infine l'account. Prima erano due elenchi di passi
    // scritti in due file, e uno dei due era piu' corto.
    const esito = await cancellaAccount(admin, userId);
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
      results.errors.push(`${userId}: ${esito.errore ?? 'errore'}`);
      continue;
    }

    results.ok++;
    logger.info('[cron-deletions] processed', { userId, fileRimossi: esito.fileRimossi });
  }

  const verdetto = verdettoDelGiro(tentativi, Date.now());
  if (verdetto.daSvegliare) await sveglia(admin, verdetto);

  return NextResponse.json(
    {
      processed: results.ok,
      // 3/9/2026 — `failed` conta SOLO i guasti. Prima contava ogni «non
      // cancellato», rinvii compresi: chi leggeva la risposta vedeva un
      // fallimento dove c'era una regola che stava funzionando.
      failed: verdetto.fallite,
      errors: results.errors,
      total: userIds.length,
      // R169 — Quante pulizie di ritenzione non sono riuscite: senza questo numero
      // il lavoro rispondeva «fatto» anche quando non aveva pulito niente.
      retentionFallite: potature.fallite,
      // 3/9/2026 — Un rinvio deciso da noi non e' un fallimento, ma non e'
      // nemmeno un successo: se non ha un posto suo nella risposta, sparisce
      // dentro `failed` (e allora l'allarme suona ogni notte) oppure dentro
      // `processed` (e allora non suona mai).
      rinviate: verdetto.rinviate,
      scadute: verdetto.scadute,
    },
    // 3/9/2026 — LA NOTTE CHE FALLISCE FINISCE ROSSA.
    //
    // Qui si rispondeva 200 con `failed: 3` nel corpo, e il corpo non lo legge
    // nessuno: ne' Vercel, che guarda il codice di stato, ne' il freno
    // anti-silenzio, che scrive il battito solo se la risposta e' buona
    // (`withCronAuth`). Un 500 fa due cose insieme: rende rossa l'esecuzione
    // nel pannello dei lavori periodici, e NON scrive il battito — cosi' se la
    // cosa va avanti anche il sorvegliante se ne accorge da solo.
    { status: verdetto.daSvegliare || potature.fallite > 0 ? 500 : 200 },
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
  await avvisaAmministratori(
    admin,
    'Cancellazioni account non eseguite',
    verdetto.riga ?? 'Il giro notturno delle cancellazioni non e andato a buon fine.',
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
  await avvisaAmministratori(
    admin,
    'Dati vecchi non cancellati',
    `${quali} I dati che dovevamo cancellare sono ancora al loro posto, oltre il tempo che ` +
      'promettiamo nella pagina della privacy. Non si sistema da sola: se il database ha detto di ' +
      'no stanotte, dirà di no anche domani.',
  );
}

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
async function avvisaAmministratori(admin: Admin, titolo: string, riga: string): Promise<void> {
  try {
    const { data: amministratori } = await admin
      .from('profiles').select('id').eq('role', 'admin').limit(10);
    if (!amministratori || amministratori.length === 0) {
      logger.error('[cron-deletions] nessun amministratore a cui dirlo: allarme non recapitato', { titolo });
      return;
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
  } catch (e) {
    logger.error('[cron-deletions] avviso agli amministratori non partito', { e });
  }
}

// I lavori periodici di Vercel bussano in GET, sempre — non c'è modo di
// chiedergli un POST. Questa rotta nasceva POST-e-basta, dai tempi del cron
// esterno: su Vercel avrebbe risposto «405 metodo non ammesso» a ogni giro, e
// il lavoro non sarebbe mai partito. Stesso identico handler, stesso controllo
// del segreto: cambia solo la porta da cui si entra. Il POST resta valido
// perché il cron esterno continua a girare finché non lo spegni.
export const GET = POST;
