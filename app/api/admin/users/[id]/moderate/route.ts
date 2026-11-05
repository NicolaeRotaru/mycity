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
        // `approved_at` qui e' l'ora della DECISIONE, non dell'approvazione: la
        // potatura dei documenti dei respinti (migrations/135) conta i 90 giorni
        // da questo campo e salta chi ce l'ha vuoto. Senza, chi era rifiutato
        // senza mai essere stato approvato teneva i documenti per sempre; e chi
        // era stato approvato anni prima li perdeva la notte stessa.
        patch: { approval_status: 'rejected', is_approved: false, rejection_reason: reason, approved_at: now },
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
  if (body.action === 'suspend' && target.approval_status === 'suspended') {
    return ApiErrors.invalidRequest('Questo profilo è già sospeso.');
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

  if (approva) {
    const motivo = motivoPerNonApprovare(target, body.action === 'reactivate' ? 'reactivate' : 'approve', giornoPiacenza());
    if (motivo) return ApiErrors.invalidRequest(motivo);
  }

  const { patch, note, audit } = buildModeration(body.action, body.reason?.trim(), user.id, target.role);

  const { error: updErr } = await admin.from('profiles').update(patch).eq('id', params.id);
  if (updErr) return ApiErrors.internal('Aggiornamento fallito.');

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
  let consegneInCorso = 0;
  if (body.action === 'suspend' && target.role === 'rider') {
    try {
      const { count, error: eConta } = await admin
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('rider_id', params.id)
        .in('delivery_status', ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY']);
      if (eConta) logger.error('[moderate] consegne in corso non contate', { target: params.id, err: eConta.message });
      consegneInCorso = count ?? 0;
    } catch (e) {
      // Best-effort: la sospensione è già fatta, il conteggio serve solo all'avviso.
      logger.error('[moderate] consegne in corso non contate', { target: params.id, err: e instanceof Error ? e.message : String(e) });
    }
  }

  const avvisi = [
    notErr ? 'la notifica all\'utente non e\' partita' : null,
    emailInviata === false ? 'l\'email all\'utente non e\' partita' : null,
    consegneInCorso > 0 ? `il fattorino ha ancora ${consegneInCorso} consegne in corso: riassegnale dalla pagina Ordini` : null,
  ].filter(Boolean);
  return NextResponse.json(
    {
      ok: true,
      notifica_inviata: !notErr,
      email_inviata: emailInviata,
      consegne_in_corso: consegneInCorso,
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
