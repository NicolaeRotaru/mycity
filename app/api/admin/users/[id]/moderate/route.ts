import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { writeAudit, type AuditAction } from '@/lib/audit';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { risultaMinorenne, anniCompiuti, ETA_MINIMA_RIDER } from '@/lib/maggiore-eta';
import { giornoPiacenza } from '@/lib/tempo-piacenza';
import { COLONNE_PER_APPROVARE, motivoPerNonApprovare } from '@/lib/admin/regole-approvazione';
import { sendEmail } from '@/lib/email/client';
import { escapeHtml } from '@/lib/html-escape';
import { DOMINIO_PUBBLICO } from '@/lib/env';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * Moderazione utente (approva/rifiuta/sospendi/riattiva) SERVER-SIDE, così ogni
 * azione finisce nell'audit log (`writeAudit`). Prima questi update erano fatti
 * dal client direttamente su `profiles`: funzionavano (via RLS admin) ma non
 * lasciavano alcuna traccia → il pannello "Audit log" restava vuoto.
 */
const Body = z.object({
  action: z.enum(['approve', 'reject', 'reactivate', 'suspend']),
  reason: z.string().max(500).optional(),
});

type Action = z.infer<typeof Body>['action'];

/**
 * Anche i fattorini si approvano da qui.
 *
 * Il difetto: il pannello mostrava i pulsanti di approvazione SOLO ai negozi,
 * quindi un fattorino iscritto restava «in attesa» per sempre e nessuno poteva
 * sbloccarlo. Su questo database ce n'era uno fermo dal 25 maggio — ed e' il
 * motivo per cui la bacheca delle consegne era vuota: senza un fattorino
 * approvato non c'e' nessuno che possa prendere un ordine.
 *
 * L'endpoint sapeva gia' farlo: non ha mai avuto un filtro sul ruolo. Mancavano
 * i pulsanti nel pannello, e questi testi, che parlavano solo di negozi — un
 * fattorino approvato si vedeva arrivare «Il tuo negozio e' stato approvato».
 */
const TESTI_PER_RUOLO = {
  rider: {
    approve:    { titolo: '✅ Profilo approvato',   corpo: 'Il tuo profilo fattorino è stato approvato! Ora puoi vedere le consegne disponibili e accettarle.', link: '/rider' },
    reject:     { titolo: '❌ Richiesta non approvata', corpo: 'La tua richiesta come fattorino non è stata approvata.', link: '/contact' },
    reactivate: { titolo: '✅ Profilo riattivato',  corpo: 'Il tuo profilo fattorino è di nuovo attivo. Puoi tornare a fare consegne.', link: '/rider' },
    suspend:    { titolo: '⏸️ Profilo sospeso',     corpo: 'Il tuo profilo fattorino è stato temporaneamente sospeso da un amministratore. Contatta il supporto per chiarimenti.', link: '/contact' },
  },
  seller: {
    approve:    { titolo: '✅ Negozio approvato',   corpo: 'Il tuo negozio è stato approvato! Ora puoi accedere alla dashboard e pubblicare prodotti.', link: '/seller/dashboard' },
    reject:     { titolo: '❌ Richiesta non approvata', corpo: 'La tua richiesta non è stata approvata.', link: '/sell' },
    reactivate: { titolo: '✅ Negozio riattivato',  corpo: 'Il tuo negozio è di nuovo operativo. Puoi tornare a vendere su MyCity.', link: '/seller/dashboard' },
    suspend:    { titolo: '⏸️ Negozio sospeso',     corpo: 'Il tuo negozio è stato temporaneamente sospeso da un amministratore. Contatta il supporto per chiarimenti.', link: '/contact' },
  },
} as const;

function buildModeration(action: Action, reason: string | undefined, adminId: string, ruolo: string): {
  patch: Record<string, unknown>;
  note: { title: string; body: string; link: string };
  audit: AuditAction;
} {
  const now = new Date().toISOString();
  const testi = ruolo === 'rider' ? TESTI_PER_RUOLO.rider : TESTI_PER_RUOLO.seller;
  const scheda = testi[action];
  const note = {
    title: scheda.titolo,
    // 5/11/2026 (S05) — Anche chi è sospeso riceve il motivo (prima solo il rifiuto lo portava).
    body: (action === 'reject' || action === 'suspend') && reason ? `${scheda.corpo} Motivo: ${reason}` : scheda.corpo,
    link: scheda.link,
  };

  switch (action) {
    case 'approve':
      return {
        patch: { approval_status: 'approved', is_approved: true, approved_at: now, approved_by: adminId, rejection_reason: null },
        note,
        audit: 'user.approve',
      };
    case 'reject':
      return {
        // 12/11/2026 (R08-007) — L'ora del rifiuto ha una colonna sua. Prima finiva in
        // `approved_at` perché la potatura dei documenti dei respinti contava da lì, e
        // la colonna voleva dire due cose (con accanto un `approved_by` che il rifiuto
        // non toccava). Ora la potatura conta da `rejected_at` (migrations/320) e
        // `approved_at` resta la data dell'approvazione. Se la migrazione non è ancora
        // applicata, vedi rifiutoSenzaColonna().
        patch: { approval_status: 'rejected', is_approved: false, rejection_reason: reason, rejected_at: now },
        note,
        audit: 'user.reject',
      };
    case 'reactivate':
      return {
        patch: { is_approved: true, approval_status: 'approved', rejection_reason: null, approved_at: now, approved_by: adminId },
        note,
        audit: 'user.reactivate',
      };
    case 'suspend':
      return {
        patch: { is_approved: false, approval_status: 'suspended', rejection_reason: null },
        note,
        audit: 'user.suspend',
      };
  }
}

/**
 * Il rifiuto come si scriveva prima della migrazione 320: l'ora in `approved_at`,
 * da cui la potatura dei respinti contava i 90 giorni. Serve solo finché la
 * colonna `rejected_at` non c'è: senza questo ripiego, un rilascio del codice
 * prima della migrazione farebbe fallire ogni rifiuto.
 */
function rifiutoSenzaColonna(patch: Record<string, unknown>): Record<string, unknown> | null {
  if (!('rejected_at' in patch)) return null;
  const { rejected_at: ora, ...resto } = patch;
  return { ...resto, approved_at: ora };
}

/** Colonna che non esiste: 42703 da Postgres, PGRST204 dalla cache dello schema di PostgREST. */
function colonnaMancante(e: { message?: string; code?: string } | null): boolean {
  if (!e) return false;
  return e.code === '42703' || e.code === 'PGRST204';
}

/** L'email dell'esito. `true` inviata, `false` fallita, `null` niente indirizzo o email spenta. */
async function mandaEmailDellEsito(
  admin: ReturnType<typeof getAdminSupabase>,
  userId: string,
  note: { title: string; body: string; link: string },
): Promise<boolean | null> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error) {
      logger.error('[moderate] indirizzo per l email non letto', { target: userId, err: error.message });
      return false;
    }
    const to = data?.user?.email;
    if (!to) return null;
    const url = `${DOMINIO_PUBBLICO}${note.link}`;
    const r = await sendEmail({
      to,
      subject: note.title.replace(/^[^\p{L}]+/u, '').trim() || 'Aggiornamento dal tuo account MyCity',
      html: `<p>${escapeHtml(note.body)}</p><p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
      text: `${note.body}\n\n${url}`,
      tipo: 'transazionale',
    });
    if (r.ok) return true;
    return 'skipped' in r && r.skipped ? null : false;
  } catch (e) {
    logger.error('[moderate] email dell esito non partita', { target: userId, err: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

/** Lo stato «in attesa»: `pending`, o vuoto per le righe nate prima della colonna (migrations/021). */
function inAttesa(stato: unknown): boolean {
  return stato == null || stato === 'pending';
}

/**
 * L'update condizionato allo stato letto. `count` dice quante righe ha toccato:
 * 0 vuol dire che un'altra decisione è arrivata prima.
 */
async function scriviSeLoStatoENoto(
  admin: ReturnType<typeof getAdminSupabase>,
  id: string,
  statoLetto: unknown,
  patch: Record<string, unknown>,
): Promise<{ error: { message: string; code?: string } | null; count: number | null }> {
  const base = admin.from('profiles').update(patch, { count: 'exact' }).eq('id', id);
  const q = statoLetto == null ? base.is('approval_status', null) : base.eq('approval_status', String(statoLetto));
  const { error, count } = await q;
  return { error, count: count ?? null };
}

async function handler(req: NextRequest, user: { id: string }, params: { id: string }): Promise<NextResponse> {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }
  if (body.action === 'reject' && !body.reason?.trim()) {
    return ApiErrors.invalidRequest('Specifica un motivo per il rifiuto.');
  }

  const admin = getAdminSupabase();
  const { data: target } = await admin
    .from('profiles')
    .select(`id, role, store_name, full_name, legal_birth_date, ${COLONNE_PER_APPROVARE}`)
    .eq('id', params.id)
    .single();
  if (!target) return ApiErrors.notFound('Utente non trovato.');

  /**
   * 28/10/2026 — SI MODERANO SOLO NEGOZI E FATTORINI, E MAI SE' STESSI.
   *
   * Prima passava qualunque profilo: un cliente si vedeva arrivare «Il tuo
   * negozio e' stato approvato», e sospendere un amministratore rispondeva
   * `{ok:true}` senza togliergli niente — l'involucro admin guarda il ruolo, non
   * `is_approved`. Meglio un rifiuto chiaro che un «fatto» falso.
   */
  if (target.id === user.id || params.id === user.id) {
    return ApiErrors.forbidden('Non puoi moderare il tuo stesso account.');
  }
  if (target.role !== 'seller' && target.role !== 'rider') {
    return ApiErrors.invalidRequest(
      'Da qui si moderano solo negozi e fattorini: per questo ruolo l\'approvazione non ha effetto.',
    );
  }

  /**
   * 8/9/2026 — LA TERZA PORTA: SI APPROVAVA SENZA MAI GUARDARE L'ETÀ.
   *
   * La schermata di approvazione la data di nascita non la mostra nemmeno, e
   * qui nessuno la leggeva: sul database ricostruito dalle migrazioni il giro
   * completo passava — «fattorino di 15 anni, stato approved, approvato=true».
   * L'unica barriera era l'occhio di chi apre la foto del documento.
   *
   * La regola è al contrario di quella del modulo: qui la data VUOTA non
   * blocca. Da questa rotta passano anche i negozi e le persone iscritte prima
   * che il campo esistesse, e non è questa la schermata dove si chiede una data
   * di nascita. Ma se la data c'è ed è di un ragazzino, non si approva:
   * `risultaMinorenne` dice esattamente questo.
   */
  const approva = body.action === 'approve' || body.action === 'reactivate';
  if (approva && risultaMinorenne(target.legal_birth_date)) {
    const anni = anniCompiuti(String(target.legal_birth_date), giornoPiacenza());
    return ApiErrors.forbidden(
      `Non si approva: la data di nascita dice ${anni} anni. Servono ${ETA_MINIMA_RIDER} anni compiuti (condizioni d'uso, punto 3). Se la data è sbagliata, falla correggere prima di approvare.`,
    );
  }

  /**
   * 1/11/2026 — PARTITA IVA E DOCUMENTI SI GUARDANO QUI, NON NEL BROWSER.
   *
   * Un negozio senza partita IVA e un fattorino senza patente né polizza
   * passavano con un 200. Vale anche per `reactivate`: un respinto si riattiva
   * da qui senza passare da `approve`, e dopo 90 giorni i suoi documenti sono
   * già stati cancellati dalla potatura (migrations/135). Non vale per chi è
   * solo SOSPESO: era già approvato, e un negozio storico senza partita IVA
   * resterebbe fermo per sempre (non ha una pagina per inserirla).
   */
  /**
   * 1/11/2026 (collaudo finale) — SI SOSPENDE SOLO CHI E' APPROVATO.
   *
   * Il «riattiva da sospeso» qui sotto non rifà il controllo, perché un sospeso
   * era già approvato. Ma la rotta accettava `suspend` anche su un profilo in
   * attesa o respinto: due chiamate (sospendi, poi riattiva) portavano ad
   * `approved` un fattorino senza documenti o un negozio senza partita IVA. Il
   * pannello mostra «Sospendi» solo agli approvati, ma il controllo vero e'
   * questo, non il bottone.
   */
  // 12/11/2026 (R08-005) — 409, non 400: la richiesta era giusta, è lo stato che è cambiato.
  if (body.action === 'suspend' && target.approval_status === 'suspended') {
    return ApiErrors.conflict('Questo profilo è già sospeso.');
  }
  if (body.action === 'suspend' && target.approval_status !== 'approved') {
    return ApiErrors.invalidRequest(
      'Si sospende solo un profilo approvato. Questo non lo è: per chi è in attesa o respinto usa «Approva» o «Rifiuta».',
    );
  }

  // 5/11/2026 (S05) — «Riattiva» vale solo per chi è sospeso. Prima portava ad
  // «approvato» anche chi era in attesa o respinto, con la notifica «di nuovo
  // operativo» e una riga 'user.reactivate' per chi non era mai stato approvato.
  if (body.action === 'reactivate' && target.approval_status !== 'suspended') {
    return ApiErrors.invalidRequest('Si riattiva solo un profilo sospeso: chi è in attesa o respinto si esamina dalla sua scheda («Esamina»).');
  }

  // 12/11/2026 (R08-004) — «Approva» e «Rifiuta» decidono una richiesta in attesa, e
  // solo quella. Prima passavano da qualunque stato: una scheda vecchia rimasta aperta
  // rifiutava un negozio appena approvato da un altro amministratore, e il negozio
  // riceveva tutti e due gli esiti. Il pannello li mostra solo a chi è «in attesa».
  if ((body.action === 'approve' || body.action === 'reject') && !inAttesa(target.approval_status)) {
    return ApiErrors.conflict(
      'Questa richiesta è già stata decisa (o lo stato è cambiato nel frattempo): ricarica la pagina e guarda lo stato attuale.',
    );
  }

  if (approva) {
    const motivo = motivoPerNonApprovare(target, body.action === 'reactivate' ? 'reactivate' : 'approve', giornoPiacenza());
    if (motivo) return ApiErrors.invalidRequest(motivo);
  }

  const { patch, note, audit } = buildModeration(body.action, body.reason?.trim(), user.id, target.role);

  // 12/11/2026 (R08-004, R08-005) — LA SCRITTURA VALE SOLO SE LO STATO E' ANCORA QUELLO LETTO.
  //
  // Fra la lettura qui sopra e questa scrittura un altro amministratore (o un doppio
  // clic) può aver già deciso. Prima l'update filtrava solo per id: due sospensioni
  // insieme passavano tutte e due, con due campanelle, due email e due righe nel
  // registro. Ora una sola tocca la riga; l'altra trova zero righe e riceve 409, e
  // da quel ramo non parte niente.
  let { error: updErr, count } = await scriviSeLoStatoENoto(admin, params.id, target.approval_status, patch);
  const ripiego = colonnaMancante(updErr) ? rifiutoSenzaColonna(patch) : null;
  if (ripiego) {
    logger.warn('[moderate] rejected_at non c\'è ancora (migrazione 320 da applicare): rifiuto scritto in approved_at', { target: params.id });
    ({ error: updErr, count } = await scriviSeLoStatoENoto(admin, params.id, target.approval_status, ripiego));
  }
  if (updErr) return ApiErrors.internal('Aggiornamento fallito.');
  if (count === 0) {
    return ApiErrors.conflict('Lo stato di questo profilo è cambiato nel frattempo: ricarica la pagina e riprova.');
  }

  // L'esito della notifica si guarda: chi e' rifiutato deve ricevere il motivo,
  // e se non parte chi ha premuto il pulsante lo deve sapere.
  const { error: notErr } = await admin.from('notifications').insert({ category: 'system', user_id: params.id, ...note });
  if (notErr) logger.error('[moderate] notifica non inviata', { target: params.id, action: body.action, error: notErr.message });

  // 5/11/2026 (S05) — Anche per email: chi non è collegato non vede la campanella,
  // e il negozio approvato giovedì sera lo scopriva giorni dopo.
  const emailInviata = await mandaEmailDellEsito(admin, params.id, note);

  // 5/11/2026 (S05) — Il registro tiene ruolo e id, non il nome: il nome restava
  // scritto anche dopo la cancellazione dell'account.
  await writeAudit({
    actorId: user.id,
    action: audit,
    targetTable: 'profiles',
    targetId: params.id,
    metadata: { role: target.role, reason: body.reason ?? null },
  });

  // 5/11/2026 (S05) — Sospendere un fattorino non gli toglie le consegne già sue:
  // l'amministratore lo deve sapere per riassegnarle.
  // 12/11/2026 (R08-006) — Un conteggio caduto non vale zero: prima diventava `count ?? 0`
  // e l'avviso «riassegnale» spariva proprio quando non si sapeva niente. Ora chi ha
  // premuto il pulsante legge che le consegne non sono state contate.
  let consegneInCorso = 0;
  let consegneNonContate = false;
  if (body.action === 'suspend' && target.role === 'rider') {
    try {
      const { count, error: eConta } = await admin
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('rider_id', params.id)
        .in('delivery_status', ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY']);
      if (eConta || count == null) {
        consegneNonContate = true;
        logger.error('[moderate] consegne in corso non contate', { target: params.id, err: eConta?.message ?? 'conteggio vuoto' });
      } else {
        consegneInCorso = count;
      }
    } catch (e) {
      // La sospensione è già fatta: il conteggio serve all'avviso, e l'avviso deve dire che manca.
      consegneNonContate = true;
      logger.error('[moderate] consegne in corso non contate', { target: params.id, err: e instanceof Error ? e.message : String(e) });
    }
  }

  const avvisi = [
    notErr ? 'la notifica all\'utente non e\' partita' : null,
    emailInviata === false ? 'l\'email all\'utente non e\' partita' : null,
    consegneInCorso > 0 ? `il fattorino ha ancora ${consegneInCorso} consegne in corso: riassegnale dalla pagina Ordini` : null,
    consegneNonContate ? 'non ho potuto contare le consegne in corso del fattorino: controllale nella pagina Ordini e riassegnale' : null,
  ].filter(Boolean);
  return NextResponse.json(
    {
      ok: true,
      notifica_inviata: !notErr,
      email_inviata: emailInviata,
      consegne_in_corso: consegneNonContate ? null : consegneInCorso,
      ...(avvisi.length > 0 ? { avviso: `Stato aggiornato, ma ${avvisi.join('; ')}.` } : {}),
    },
    { status: 200 },
  );
}

// 30/8/2026 (R017) — L'ADATTATORE A MANO NON C'E' PIU'.
//
// Qui c'era la riga che tutte le rotte dinamiche si riscrivevano: prendeva il
// secondo argomento di Next, ne aspettava la promessa e la riportava dentro
// l'involucro. Copiata tredici volte, e in ognuna bastava dimenticare l'`await`
// per far arrivare `undefined` alla query. Adesso i pezzi dell'indirizzo li
// risolve l'involucro, una volta sola, e arrivano gia' pronti nel contesto.
export const POST = withAdminAuth(({ req, user, params }) => handler(req, user, { id: String(params.id) }));
