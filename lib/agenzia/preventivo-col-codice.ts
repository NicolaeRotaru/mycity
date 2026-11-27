import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/email/client';
import { accessoDopoIlPreventivoTemplate } from '@/lib/email/templates';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { env } from '@/lib/env';
import { FASCE, type Abbonamento } from '@/lib/agenzia/preventivo';
import { PERCORSO_ABBONAMENTO } from '@/lib/agenzia/indirizzi-servizi';
import { campiPerIlProfilo, leggiSchedaSalvata } from '@/lib/agenzia/scheda-cliente';
import { leggiSchedaEPagellaAperte, schedaPerIlSito } from '@/lib/agenzia/scheda-dopo-abbonamento';
import { pagamentoOnlineAttivo } from '@/lib/agenzia/pagamento-servizi';
import { sbloccaInContanti, sbloccoRiuscito } from '@/lib/agenzia/abbonamento-contanti';

/**
 * IL PREVENTIVO COL LINK COL CODICE — 24/11/2026.
 *
 * Nicola, su Ora del Gusto: «è solo in modalità preventivo, quando il cliente accetta, si
 * recupereranno tutti i dati del cliente che si ha recuperato con n8n e compila tutto quello che
 * bisogna compilare». Alla domanda sulla forma ha scelto «link col codice» (24/11).
 *
 * Un'attività senza accesso ha un codice (tabella preventivi_con_codice, migrazione 708): il link
 * /preventivo/<codice> apre solo il suo preventivo. Quando il titolare accetta:
 *  1. la sua email va sull'utente segnaposto dell'attività, che si sblocca (stesso id, così la
 *     scheda di n8n e l'eventuale abbonamento restano attaccati);
 *  2. il profilo si compila coi soli dati CONFERMATI della scheda di n8n, e passa in revisione
 *     (approval_status 'pending'); il resto lo conferma il titolare dalla sua pagina;
 *  3. il preventivo diventa «accettato» (il link non accetta una seconda volta);
 *  4. Nicola riceve l'avviso, il titolare il link per entrare (link di Supabase, una volta sola).
 * Il pagamento si apre subito dopo (lib/agenzia/cassa-servizi.ts); se non lo chiude, paga dalla
 * sua pagina quando entra.
 *
 * 26/11/2026 — Nicola: per ora si paga in contanti, di persona. Con il pagamento online spento
 * (lib/agenzia/pagamento-servizi.ts) non si apre nessuna cassa e l'avviso a Nicola lo ricorda.
 *
 * 27/11/2026 02:26 — Nicola: «in automatico deve sbloccarsi la pagina del venditore in base all'abbonamento»,
 * subito e fino alla disdetta. Con il pagamento online spento, chi accetta ha la pagina sbloccata nella fascia
 * che accetta (lib/agenzia/abbonamento-contanti.ts): se l'agente ne aveva scelta un'altra, si allinea a questa.
 *
 * 27/11/2026 — Nicola: «dopo il click entra nella sua pagina venditore con l'abbonamento che ha scelto», e sul
 * rischio trovato dal collaudo della sicurezza «codice dall'email». Chi chiama (app/api/preventivo/[codice]/accetta)
 * accetta solo dopo che il titolare ha scritto il codice giusto (lib/agenzia/codice-dal-link.ts): fino a lì
 * l'utente del negozio resta bloccato e senza email. Con `entraSubito` chi chiama apre poi la sessione del
 * titolare nella stessa risposta (lib/agenzia/entra-dal-link.ts): qui si crea il gettone d'accesso monouso e
 * glielo si passa, PRIMA del link dell'email, perché un gettone nuovo dello stesso tipo può annullare quello
 * di prima, e il link dell'email deve restare buono.
 */

export const CODICE_VALIDO = /^[0-9a-f]{64}$/;

export type PreventivoColCodice = {
  sellerId: string;
  stato: 'aperto' | 'accettato' | 'chiuso';
  fasciaScelta: Abbonamento | null;
  nomeAttivita: string;
};

/** Il preventivo di un codice, o `null` se il codice non è nella forma giusta o non esiste. */
export async function leggiPreventivoColCodice(codice: string): Promise<PreventivoColCodice | null> {
  if (!CODICE_VALIDO.test(codice)) return null;
  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from('preventivi_con_codice')
    .select('seller_id, stato, fascia_scelta, profiles!inner(store_name)')
    .eq('codice', codice)
    .maybeSingle();
  if (error) throw new Error(`preventivo col codice non letto: ${error.message}`);
  if (!data) return null;
  const riga = data as unknown as {
    seller_id: string;
    stato: PreventivoColCodice['stato'];
    fascia_scelta: Abbonamento | null;
    profiles: { store_name: string | null } | { store_name: string | null }[];
  };
  const profilo = Array.isArray(riga.profiles) ? riga.profiles[0] : riga.profiles;
  return { sellerId: riga.seller_id, stato: riga.stato, fasciaScelta: riga.fascia_scelta, nomeAttivita: String(profilo?.store_name ?? '').trim() || 'La tua attività' };
}

export type EsitoAccettazione =
  | { ok: true; sellerId: string; accessoInviato: boolean; entrato: boolean }
  | { ok: false; motivo: 'GIA_ACCETTATO' | 'CHIUSO' | 'EMAIL_GIA_USATA' | 'GUASTO'; messaggio: string };

/** Il titolare accetta dal link: email, profilo compilato, revisione, avvisi. Il pagamento lo apre chi chiama. */
export async function accettaPreventivoColCodice(input: {
  preventivo: PreventivoColCodice;
  codice: string;
  email: string;
  fascia: Abbonamento;
  /** Apre la sessione del titolare col gettone monouso; vero se è entrato. Assente: entra dall'email. */
  entraSubito?: (gettone: string) => Promise<boolean>;
}): Promise<EsitoAccettazione> {
  const { preventivo, codice, email, fascia } = input;
  if (preventivo.stato === 'accettato') {
    return { ok: false, motivo: 'GIA_ACCETTATO', messaggio: 'Questo preventivo è già stato accettato: controlla la tua email per entrare.' };
  }
  if (preventivo.stato === 'chiuso') {
    return { ok: false, motivo: 'CHIUSO', messaggio: 'Questo preventivo non è più valido. Scrivici e te ne prepariamo uno nuovo.' };
  }
  const admin = getAdminSupabase();
  const id = preventivo.sellerId;

  // Il preventivo si prende per primo, e solo se è ancora aperto: due invii insieme non fanno due account.
  const presa = await admin
    .from('preventivi_con_codice')
    .update({ stato: 'accettato', fascia_scelta: fascia, accettato_il: new Date().toISOString(), condizioni_accettate_il: new Date().toISOString() })
    .eq('codice', codice)
    .eq('stato', 'aperto')
    .select('seller_id');
  if (presa.error) {
    logger.error('[preventivo-codice] accettazione non salvata', { sellerId: id, message: presa.error.message });
    return { ok: false, motivo: 'GUASTO', messaggio: 'Non sono riuscito a salvare la tua risposta. Riprova fra un momento.' };
  }
  if (!presa.data || presa.data.length === 0) {
    return { ok: false, motivo: 'GIA_ACCETTATO', messaggio: 'Questo preventivo è già stato accettato: controlla la tua email per entrare.' };
  }

  // 1) L'email del titolare sull'utente dell'attività, che si sblocca.
  const utente = await admin.auth.admin.updateUserById(id, { email, email_confirm: true, ban_duration: 'none' });
  if (utente.error) {
    // Il preventivo torna aperto: il titolare può riprovare con un'altra email.
    // La scelta dell'agente (se c'era) torna com'era: il link riapre il preventivo su quella fascia.
    await admin.from('preventivi_con_codice').update({ stato: 'aperto', fascia_scelta: preventivo.fasciaScelta, accettato_il: null, condizioni_accettate_il: null }).eq('codice', codice);
    const giaUsata = /already|exists|registered|email_exists/i.test(`${utente.error.message} ${(utente.error as { code?: string }).code ?? ''}`);
    logger.warn('[preventivo-codice] email non collegata', { sellerId: id, giaUsata, message: utente.error.message });
    // Stesso messaggio e stesso codice (409) nei due casi: non si deve poter scoprire da qui se un'email
    // è già su MyCity (collaudi del 24/11). Il log, che legge solo chi gestisce il sito, li distingue.
    return giaUsata
      ? { ok: false, motivo: 'EMAIL_GIA_USATA', messaggio: 'Non sono riuscito a collegare questa email. Prova con un’altra, oppure scrivici e lo sistemiamo noi.' }
      : { ok: false, motivo: 'EMAIL_GIA_USATA', messaggio: 'Non sono riuscito a collegare questa email. Prova con un’altra, oppure scrivici e lo sistemiamo noi.' };
  }

  // 2) Il profilo coi soli dati confermati della scheda di n8n, e in revisione.
  const scheda = await admin.from('schede_clienti').select('scheda').eq('id_attivita', id).maybeSingle();
  if (scheda.error) logger.warn('[preventivo-codice] scheda non letta: il profilo resta coi dati che ha', { sellerId: id, message: scheda.error.message });
  // 25/11/2026 — Nicola: la scheda del cliente nasce solo dopo l'abbonamento. Chi accetta il preventivo
  // non ha ancora pagato: l'indirizzo della scheda entra nel profilo al primo pagamento
  // (lib/agenzia/abbonamento-attivo-n8n.ts), qui solo se il negozio è già abbonato.
  const aperta = await leggiSchedaEPagellaAperte(admin, id);
  const dati = campiPerIlProfilo(schedaPerIlSito(leggiSchedaSalvata(scheda.data?.scheda), aperta));
  const profilo = await admin
    .from('profiles')
    .update({ ...dati, approval_status: 'pending', approval_requested_at: new Date().toISOString() })
    .eq('id', id);
  if (profilo.error) logger.error('[preventivo-codice] profilo non compilato', { sellerId: id, message: profilo.error.message });
  const profiloCompilato = !profilo.error;

  // 2-bis) Con il pagamento online spento, la pagina del negozio si sblocca nella fascia accettata: i contanti
  // si ritirano al primo servizio. Con il pagamento online acceso la sblocca il webhook di Stripe, come prima.
  const sblocco = pagamentoOnlineAttivo() ? null : await sbloccaInContanti(admin, id, fascia);
  if (sblocco && !sbloccoRiuscito(sblocco)) logger.error('[preventivo-codice] pagina non sbloccata', { sellerId: id, fascia, dettaglio: sblocco.dettaglio });

  // 3) Gli avvisi: a Nicola sempre, al titolare il link per entrare.
  // L'email non è verificata prima di collegarla: chi ha il link può darne una sua. Per questo l'avviso
  // a Nicola la dice, così la controlla col titolare prima di approvare (collaudo del 24/11).
  await notifyAdmins(
    `${preventivo.nomeAttivita} ha accettato il preventivo`,
    [
      `Abbonamento ${FASCE[fascia].nome}. Email data dal titolare: ${email} — controlla col titolare che sia la sua.`,
      profiloCompilato
        ? 'Il negozio è in revisione, ma arriva dal preventivo: mancano i dati dell’iscrizione (IBAN, documenti). Non approvarlo prima di averli.'
        : 'ATTENZIONE: il profilo non si è aggiornato (non è in revisione): sistemalo a mano.',
      // 26/11/2026 — Per ora niente pagamento online (lib/agenzia/pagamento-servizi.ts).
      ...(sblocco === null
        ? []
        : sblocco.esito === 'gia-online'
          ? [`Ha già un abbonamento ${FASCE[sblocco.fascia].nome} pagato online: resta quello.`]
          : sbloccoRiuscito(sblocco)
            ? [`La sua pagina è sbloccata col ${FASCE[fascia].nome}${sblocco.esito === 'cambiata' ? ` (l'agente aveva scelto il ${FASCE[sblocco.da].nome})` : ''}, fino alla disdetta. Pagamento in contanti, al primo servizio: accordati col titolare per incassarlo.`]
            : [`ATTENZIONE: la sua pagina NON si è sbloccata col ${FASCE[fascia].nome}: sistemalo a mano. Pagamento in contanti, di persona.`]),
    ].join(' '),
    '/admin/preventivi',
    { unaVoltaPer: `preventivo-codice:${id}` },
  ).catch((e: unknown) => logger.warn('[preventivo-codice] avviso a Nicola non partito', { sellerId: id, errore: String(e) }));

  // 4) Il titolare entra subito, se chi chiama lo sa fare. Se non riesce, resta l'email qui sotto.
  let entrato = false;
  if (input.entraSubito) {
    try {
      const gettone = await admin.auth.admin.generateLink({ type: 'magiclink', email });
      const hash = (gettone.data as { properties?: { hashed_token?: string } } | null)?.properties?.hashed_token;
      if (gettone.error || !hash) throw new Error(gettone.error?.message ?? 'gettone senza codice');
      entrato = await input.entraSubito(hash);
    } catch (e) {
      logger.warn('[preventivo-codice] ingresso subito non riuscito: entra dall email', { sellerId: id, errore: String(e) });
    }
  }

  let accessoInviato = false;
  try {
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: `${env.appUrl()}${PERCORSO_ABBONAMENTO}` } });
    const azione = (link.data as { properties?: { action_link?: string } } | null)?.properties?.action_link;
    if (link.error || !azione) throw new Error(link.error?.message ?? 'link senza indirizzo');
    const posta = accessoDopoIlPreventivoTemplate({ negozio: preventivo.nomeAttivita, link: azione });
    const inviata = await sendEmail({ to: email, ...posta });
    accessoInviato = inviata.ok;
    if (!inviata.ok) logger.warn('[preventivo-codice] email di accesso non partita', { sellerId: id });
  } catch (e) {
    logger.error('[preventivo-codice] link di accesso non creato', { sellerId: id, errore: String(e) });
  }
  return { ok: true, sellerId: id, accessoInviato, entrato };
}
