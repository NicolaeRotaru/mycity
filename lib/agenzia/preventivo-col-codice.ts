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
import { ORA_GIA_PRESA, scriviVisita } from '@/lib/agenzia/visita-sdg';
import { creaOrdineSdg } from '@/lib/agenzia/ordine-sdg';
import { ETICHETTE_SERVIZI, leggiServiziScelti, type ServizioAgenzia } from '@/lib/agenzia/servizi-scelti';

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
 *
 * 27/11/2026 verso le 17:40 — Nicola: nello stesso passo il titolare sceglie anche giorno e ora in cui il team
 * creativo di SDG passa da lui (piano editoriale, foto e video). La scelta (`visita`, già controllata da chi
 * chiama con lib/agenzia/visita-sdg.ts) si salva sul preventivo nella stessa scrittura che lo prende
 * (`visita_il`, migrazione 999b): se l'ora l'ha appena presa un'altra attività, niente si accetta e il titolare
 * ne sceglie un'altra. Senza la 999b nel database si accetta lo stesso e il giorno arriva a Nicola nell'avviso.
 *
 * 28/11/2026 verso le 01:40 — Nicola: i servizi li sceglie il venditore in anticipo, «però lo deve poter fare
 * anche» il cliente. Il link mostra i servizi segnati dal venditore (`serviziScelti`), il titolare li può cambiare
 * e all'accettazione valgono quelli confermati da lui (`servizi`, già controllati da chi chiama): si scrivono sul
 * preventivo prima che nasca l'ordine (lib/agenzia/ordine-sdg.ts), e all'ordine si passano anche direttamente
 * (collaudo 28/11): se la scrittura non riesce (o manca la 999h) valgono lo stesso quelli confermati dal titolare,
 * non quelli del venditore riletti dal preventivo. Senza scelta di nessuno valgono tutti e quattro.
 */

export const CODICE_VALIDO = /^[0-9a-f]{64}$/;

export type PreventivoColCodice = {
  sellerId: string;
  stato: 'aperto' | 'accettato' | 'chiuso';
  fasciaScelta: Abbonamento | null;
  nomeAttivita: string;
  /** 28/11 — I servizi segnati dal venditore (999h), o `null` se non li ha segnati o la colonna non c'è. */
  serviziScelti?: ServizioAgenzia[] | null;
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
  // I servizi segnati dal venditore, a parte: prima della 999h la colonna non c'è e il link deve aprirsi lo stesso.
  let serviziScelti: ServizioAgenzia[] | null = null;
  try {
    const s = await admin.from('preventivi_con_codice').select('servizi_scelti').eq('codice', codice).maybeSingle();
    if (!s.error) serviziScelti = leggiServiziScelti((s.data as { servizi_scelti?: unknown } | null)?.servizi_scelti, null).servizi;
  } catch {
    serviziScelti = null;
  }
  return { sellerId: riga.seller_id, stato: riga.stato, fasciaScelta: riga.fascia_scelta, nomeAttivita: String(profilo?.store_name ?? '').trim() || 'La tua attività', serviziScelti };
}

export type EsitoAccettazione =
  | { ok: true; sellerId: string; accessoInviato: boolean; entrato: boolean }
  | { ok: false; motivo: 'GIA_ACCETTATO' | 'CHIUSO' | 'EMAIL_GIA_USATA' | 'ORA_PRESA' | 'GUASTO'; messaggio: string };

/**
 * La colonna della visita non c'è ancora (migrazione 999b non applicata): PostgREST o Postgres. Solo allora si
 * ritenta senza la visita; ogni altro errore (ora già presa, database giù) non si ritenta.
 */
function colonnaVisitaMancante(e: { code?: string; message?: string }): boolean {
  if (e.code === '23505') return false;
  return e.code === 'PGRST204' || e.code === '42703' || /visita_il/.test(e.message ?? '') && /column|colonna|schema/i.test(e.message ?? '');
}

/** Cosa legge il titolare quando la sua email ha già un altro account su MyCity. */
export const EMAIL_DI_UN_ALTRO_ACCOUNT =
  'Questa email ha già un account su MyCity, per esempio da cliente, e non può essere anche quella della tua attività. Tocca «ho sbagliato email» e scrivine un’altra: ti mandiamo un codice nuovo. Se vuoi usare proprio questa, scrivici e la sistemiamo noi.';

/** Quanti utenti si guardano al massimo (10 pagine da 1000): si cerca solo dopo un errore, il tetto c'è. */
const PAGINE_UTENTI = 10;
const PER_PAGINA = 1000;

/**
 * L'email è già di un utente diverso dal negozio? `null` se non si sa (lettura non riuscita o tetto toccato):
 * allora resta il messaggio prudente di sempre. Ci si ferma sulla pagina vuota, non su quella corta.
 */
async function emailDiUnAltroUtente(admin: ReturnType<typeof getAdminSupabase>, email: string, sellerId: string): Promise<boolean | null> {
  const cercata = email.trim().toLowerCase();
  try {
    for (let page = 1; page <= PAGINE_UTENTI; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGINA });
      if (error || !data) return null;
      if (data.users.some((u) => u.id !== sellerId && (u.email ?? '').toLowerCase() === cercata)) return true;
      if (data.users.length === 0) return false;
    }
  } catch (e) {
    // Una risposta illeggibile non deve far cadere la conferma con un 500: resta il messaggio prudente (collaudo).
    logger.warn('[preventivo-codice] utenti non letti cercando l email', { sellerId, errore: String(e) });
  }
  return null;
}

/** Il titolare accetta dal link: email, profilo compilato, revisione, avvisi. Il pagamento lo apre chi chiama. */
export async function accettaPreventivoColCodice(input: {
  preventivo: PreventivoColCodice;
  codice: string;
  email: string;
  fascia: Abbonamento;
  /** L'inizio della visita di SDG scelto dal titolare (ISO, già controllato da chi chiama). */
  visita?: string;
  /** 28/11 — I servizi confermati dal titolare (già controllati da chi chiama). Assenti: restano quelli del venditore. */
  servizi?: ServizioAgenzia[];
  /** Apre la sessione del titolare col gettone monouso; vero se è entrato. Assente: entra dall'email. */
  entraSubito?: (gettone: string) => Promise<boolean>;
}): Promise<EsitoAccettazione> {
  const { preventivo, codice, email, fascia, visita } = input;
  const servizi = input.servizi?.length ? leggiServiziScelti(input.servizi, null).servizi : null;
  if (preventivo.stato === 'accettato') {
    return { ok: false, motivo: 'GIA_ACCETTATO', messaggio: 'Questo preventivo è già stato accettato: controlla la tua email per entrare.' };
  }
  if (preventivo.stato === 'chiuso') {
    return { ok: false, motivo: 'CHIUSO', messaggio: 'Questo preventivo non è più valido. Scrivici e te ne prepariamo uno nuovo.' };
  }
  const admin = getAdminSupabase();
  const id = preventivo.sellerId;

  // Il preventivo si prende per primo, e solo se è ancora aperto: due invii insieme non fanno due account.
  // Con la visita di SDG nella stessa scrittura: l'indice unico della 999b non dà la stessa ora a due attività.
  const ora = new Date().toISOString();
  const valori = { stato: 'accettato', fascia_scelta: fascia, accettato_il: ora, condizioni_accettate_il: ora };
  // Anche il ritentativo senza la visita prende il preventivo solo se è ancora aperto, e conta le righe tornate.
  const prendi = (v: Record<string, unknown>) =>
    admin.from('preventivi_con_codice').update(v).eq('codice', codice).eq('stato', 'aperto').select('seller_id');
  let visitaSalvata = Boolean(visita);
  let presa = await prendi(visita ? { ...valori, visita_il: visita } : valori);
  if (presa.error && visita && colonnaVisitaMancante(presa.error)) {
    logger.warn('[preventivo-codice] visita non salvata: manca la migrazione 999b, va solo nell avviso', { sellerId: id });
    visitaSalvata = false;
    presa = await prendi(valori);
  }
  if (presa.error && visita && (presa.error as { code?: string }).code === '23505') {
    return { ok: false, motivo: 'ORA_PRESA', messaggio: ORA_GIA_PRESA };
  }
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
    // Anche la visita torna libera: quell'ora la può prendere un'altra attività.
    const indietro = { stato: 'aperto', fascia_scelta: preventivo.fasciaScelta, accettato_il: null, condizioni_accettate_il: null };
    const riapertura = await admin.from('preventivi_con_codice').update(visitaSalvata ? { ...indietro, visita_il: null } : indietro).eq('codice', codice);
    const riaperto = !riapertura.error;
    if (!riaperto) logger.error('[preventivo-codice] preventivo non riaperto dopo l email non collegata', { sellerId: id, message: riapertura.error?.message });
    // 27/11/2026 23:34 — Nicola, su Luna Rossa: codice giusto, e la pagina diceva solo «non sono riuscito a
    // collegare questa email». L'email aveva già un account da cliente. Supabase non lo dice col suo codice:
    // risponde 500 «Error updating user» (dentro, il doppione sull'indice unico delle email), quindi la parola
    // nel messaggio non basta e si guarda negli utenti se l'email è già di un altro.
    const giaUsata =
      /already|exists|registered|email_exists/i.test(`${utente.error.message} ${(utente.error as { code?: string }).code ?? ''}`) ||
      (await emailDiUnAltroUtente(admin, email, id)) === true;
    logger.warn('[preventivo-codice] email non collegata', { sellerId: id, giaUsata, message: utente.error.message });
    if (giaUsata) {
      // Qui si arriva solo col codice dell'email giusto (app/api/preventivo/[codice]/accetta): chi legge questo
      // messaggio ha dimostrato che la casella è sua, quindi dirgli che quell'email ha già un account non svela
      // niente a un estraneo. Il messaggio uguale per tutti dei collaudi del 24/11 valeva prima del codice.
      await notifyAdmins(
        `${preventivo.nomeAttivita} non è riuscito ad accettare il preventivo`,
        `Il titolare ha scritto il codice giusto, ma la sua email (${email}) ha già un account su MyCity, per esempio da cliente. ${
          riaperto
            ? "Il preventivo è ancora aperto: chiamalo, può confermare con un'altra email."
            : 'ATTENZIONE: il preventivo NON è tornato aperto (risulta accettato ma senza email): riaprilo a mano, poi chiamalo.'
        }`,
        '/admin/preventivi',
        { unaVoltaPer: `preventivo-email-usata:${id}` },
      ).catch((e: unknown) => logger.warn('[preventivo-codice] avviso email già usata non partito', { sellerId: id, errore: String(e) }));
      // Se il preventivo non si è riaperto, un codice nuovo non partirebbe (risulta già accettato): solo «scrivici».
      return {
        ok: false,
        motivo: 'EMAIL_GIA_USATA',
        messaggio: riaperto ? EMAIL_DI_UN_ALTRO_ACCOUNT : 'Questa email ha già un account su MyCity, per esempio da cliente. Scrivici e la sistemiamo noi.',
      };
    }
    return { ok: false, motivo: 'EMAIL_GIA_USATA', messaggio: 'Non sono riuscito a collegare questa email. Prova con un’altra, oppure scrivici e lo sistemiamo noi.' };
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

  // 1-bis) 28/11 — I servizi confermati dal titolare vanno sul preventivo prima che nasca l'ordine. Prima della 999h
  // la colonna non c'è: si va avanti, e all'ordine arrivano lo stesso (creaOrdineSdg qui sotto).
  const serviziValidi = servizi ?? preventivo.serviziScelti ?? null;
  if (servizi) {
    const scritti = await admin.from('preventivi_con_codice').update({ servizi_scelti: servizi }).eq('codice', codice).then((r) => r, (e: unknown) => ({ error: { message: String(e) } }));
    if (scritti.error) logger.warn('[preventivo-codice] servizi confermati non scritti: controlla la migrazione 999h', { sellerId: id, message: scritti.error.message });
  }

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
      serviziValidi ? `Servizi confermati: ${serviziValidi.map((x) => ETICHETTE_SERVIZI[x]).join(', ')}.` : 'Servizi: tutti e quattro (nessuna scelta).',
      ...(visita
        ? [`Il team di SDG passa da lui ${scriviVisita(visita)} (piano editoriale, foto e video)${visitaSalvata ? '.' : ': ATTENZIONE, il giorno NON è salvato nel database (manca la migrazione 999b), segnalo a mano a SDG.'}`]
        : ['Non ha scelto il giorno della visita di SDG: chiamalo per fissarlo.']),
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
  // 27/11/2026 — L'ordine di servizio arriva a SDG (lib/agenzia/ordine-sdg.ts): non lancia mai. Collaudo 28/11: i
  // servizi confermati passano anche qui, così valgono loro anche se la scrittura qui sopra non è riuscita.
  await creaOrdineSdg({ sellerId: id, codice, fascia, visitaIl: visita ?? null, servizi });

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
    const posta = accessoDopoIlPreventivoTemplate({ negozio: preventivo.nomeAttivita, link: azione, visita: visita ? scriviVisita(visita) : null });
    const inviata = await sendEmail({ to: email, ...posta });
    accessoInviato = inviata.ok;
    if (!inviata.ok) logger.warn('[preventivo-codice] email di accesso non partita', { sellerId: id });
  } catch (e) {
    logger.error('[preventivo-codice] link di accesso non creato', { sellerId: id, errore: String(e) });
  }
  return { ok: true, sellerId: id, accessoInviato, entrato };
}
