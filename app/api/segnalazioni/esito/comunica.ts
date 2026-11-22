import { createHash } from 'node:crypto';
import { sendEmail } from '@/lib/email/client';
import { escapeHtml } from '@/lib/html-escape';
import { logger } from '@/lib/logger';
import { motivoLeggibile, COME_CONTESTARE } from '@/lib/admin/segnalazioni-testi';

/**
 * Comunicare l'esito motivato di una segnalazione.
 *
 * 1/11/2026 — L'ESITO RESTAVA IN TABELLA. La pagina /admin/segnalazioni
 * registra la decisione (accolta o respinta) e la sua motivazione, ma nessun
 * codice la leggeva per dirla a qualcuno: chi aveva segnalato non sapeva come
 * era finita, il venditore non sapeva perche' il suo prodotto era stato tolto
 * o lasciato. Il regolamento europeo sui servizi digitali chiede entrambe le
 * cose (art. 16.5 a chi segnala, art. 17 a chi subisce la decisione).
 *
 * Qui si manda l'esito, una volta che la decisione c'e':
 *  - a chi ha segnalato: email se ha lasciato il recapito, notifica nel sito
 *    se era collegato col suo account;
 *  - al venditore del prodotto o del negozio segnalato: notifica nel sito.
 * Ogni scrittura legge il suo `error` (il client Supabase non solleva): un
 * canale fallito torna nel risultato e nei log, non sparisce.
 */

/** Una motivazione è una frase che si possa capire, non «ok» (stessa soglia della pagina admin). */
export const MOTIVAZIONE_MINIMA = 20;
const DECISIONI_FINALI = ['accolta', 'respinta'] as const;

export type Canale = 'inviata' | 'fallita' | 'nessun_recapito' | 'non_previsto';

export type EsitoComunicato =
  | { ok: true; segnalanteEmail: Canale; segnalanteNotifica: Canale; venditore: Canale }
  | { ok: false; motivo: 'non_trovata' | 'non_decisa' | 'lettura_fallita' };

type Risposta<T> = { data: T | null; error: { message: string } | null };
// Il client di servizio: tipizzato in modo largo per non legarsi allo schema generato.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClientServizio = { from: (tabella: string) => any };

type Segnalazione = {
  id: string;
  tipo: string;
  oggetto_id: string;
  motivo: string;
  segnalante_id: string | null;
  email_contatto: string | null;
  stato: string;
  esito_motivato: string | null;
};

const NOME_DECISIONE: Record<string, string> = {
  accolta: 'accolta: il contenuto è stato rimosso o corretto',
  respinta: 'respinta: il contenuto resta online',
};

function linkOggetto(s: Segnalazione): string | null {
  if (s.tipo === 'prodotto') return `/product/${s.oggetto_id}`;
  if (s.tipo === 'negozio') return `/store/${s.oggetto_id}`;
  return null;
}

/**
 * Il venditore da avvisare. `null` = lettura fallita; `'nessuno'` = il prodotto non
 * c'è più (cancellato): non c'è nessuno da avvisare, e non è un guasto. Prima i due
 * casi erano uguali e la rotta rispondeva 502 a ogni tentativo.
 */
async function venditoreDi(admin: ClientServizio, s: Segnalazione): Promise<string | null | 'nessuno'> {
  if (s.tipo === 'negozio') return s.oggetto_id; // la vetrina /store/<id> è il profilo del venditore
  if (s.tipo !== 'prodotto') return null;
  const { data, error }: Risposta<{ seller_id: string | null }> = await admin
    .from('products').select('seller_id').eq('id', s.oggetto_id).maybeSingle();
  if (error) {
    logger.error(new Error(`[segnalazioni] venditore non letto: ${error.message}`), { segnalazione: s.id });
    return null;
  }
  return data?.seller_id ?? 'nessuno';
}

async function notifica(admin: ClientServizio, userId: string, title: string, body: string, link: string | null, s: Segnalazione): Promise<Canale> {
  const { error } = await admin.from('notifications').insert({
    user_id: userId, title, body, link, category: 'system',
  });
  if (error) {
    logger.error(new Error(`[segnalazioni] notifica dell'esito non scritta: ${error.message}`), { segnalazione: s.id });
    return 'fallita';
  }
  return 'inviata';
}

/**
 * 22/11/2026 — OGNI CANALE RICORDA COSA HA GIÀ PORTATO.
 *
 * Comunicare due volte rimandava email e notifiche; e dopo un errore parziale la pagina chiede di
 * registrare di nuovo la decisione, e ripartivano tutti i canali, anche quelli già arrivati. Ora
 * ogni canale arrivato lascia una riga in `audit_logs` (tabella che c'è già: nessuna colonna
 * nuova) con l'impronta di destinatario, decisione e motivazione. Un canale riparte solo se la sua
 * ULTIMA comunicazione di QUESTA segnalazione è diversa: la stessa decisione registrata di nuovo
 * non riparte, accolta → respinta → accolta riparte ogni volta, due segnalazioni con la stessa
 * motivazione non si confondono. Se la memoria non si legge si manda come prima: un esito doppio
 * è un fastidio, un esito perso è un obbligo mancato (DSA).
 */
const AZIONE_ARRIVATO = 'segnalazione_esito_comunicato';
type NomeCanale = 'segnalante_email' | 'segnalante_notifica' | 'venditore';

function impronta(destinatario: string, s: Segnalazione, motivazione: string): string {
  return createHash('sha256').update(`${destinatario}\n${s.stato}\n${motivazione}`).digest('hex');
}

async function giaArrivate(admin: ClientServizio, id: string): Promise<Map<string, string>> {
  const ultime = new Map<string, { quando: number; impronta: string }>();
  try {
    const { data, error } = await admin
      .from('audit_logs').select('metadata, created_at')
      .eq('action', AZIONE_ARRIVATO).eq('target_table', 'segnalazioni').eq('target_id', id);
    if (error) throw new Error(error.message);
    for (const r of (Array.isArray(data) ? data : []) as Array<{ metadata: Record<string, unknown> | null; created_at: string }>) {
      const canale = r.metadata?.canale, imp = r.metadata?.impronta;
      if (typeof canale !== 'string' || typeof imp !== 'string') continue;
      const quando = Date.parse(r.created_at);
      const prima = ultime.get(canale);
      if (!prima || quando >= prima.quando) ultime.set(canale, { quando, impronta: imp });
    }
  } catch (e) {
    logger.warn('[segnalazioni] canali già arrivati non letti: si manda tutto', { segnalazione: id, e });
    ultime.clear();
  }
  return new Map([...ultime].map(([c, v]) => [c, v.impronta]));
}

async function unaVolta(
  admin: ClientServizio, memoria: Map<string, string>, s: Segnalazione,
  canale: NomeCanale, imp: string, manda: () => Promise<Canale>,
): Promise<Canale> {
  if (memoria.get(canale) === imp) return 'inviata'; // già arrivata, con questa stessa decisione
  const esito = await manda();
  if (esito !== 'inviata') return esito;
  try {
    const { error } = await admin.from('audit_logs').insert({
      action: AZIONE_ARRIVATO, target_table: 'segnalazioni', target_id: s.id,
      metadata: { canale, stato: s.stato, impronta: imp },
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    logger.error(new Error(`[segnalazioni] esito arrivato ma non ricordato: ${e instanceof Error ? e.message : 'errore'}`), { segnalazione: s.id, canale });
  }
  return esito;
}

export async function comunicaEsito(admin: ClientServizio, id: string): Promise<EsitoComunicato> {
  const { data: s, error }: Risposta<Segnalazione> = await admin
    .from('segnalazioni')
    .select('id, tipo, oggetto_id, motivo, segnalante_id, email_contatto, stato, esito_motivato')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    logger.error(new Error(`[segnalazioni] lettura per l'esito fallita: ${error.message}`), { segnalazione: id });
    return { ok: false, motivo: 'lettura_fallita' };
  }
  if (!s) return { ok: false, motivo: 'non_trovata' };
  const motivazione = (s.esito_motivato ?? '').trim();
  if (!(DECISIONI_FINALI as readonly string[]).includes(s.stato) || motivazione.length < MOTIVAZIONE_MINIMA) {
    return { ok: false, motivo: 'non_decisa' };
  }

  const decisione = NOME_DECISIONE[s.stato];
  const link = linkOggetto(s);
  const memoria = await giaArrivate(admin, s.id);

  let segnalanteEmail: Canale = 'nessun_recapito';
  if (s.email_contatto) {
    const to = s.email_contatto;
    segnalanteEmail = await unaVolta(admin, memoria, s, 'segnalante_email', impronta(to, s, motivazione), async () => {
      const r = await sendEmail({
        to,
        subject: 'Esito della tua segnalazione',
        html:
          `<p>Abbiamo esaminato la tua segnalazione (motivo: ${escapeHtml(motivoLeggibile(s.motivo))}).</p>` +
          `<p><strong>Decisione:</strong> ${escapeHtml(decisione)}.</p>` +
          `<p><strong>Motivazione:</strong> ${escapeHtml(motivazione)}</p>` +
          `<p>${escapeHtml(COME_CONTESTARE)}</p>`,
        text: `Decisione: ${decisione}.\nMotivazione: ${motivazione}\n\n${COME_CONTESTARE}`,
        tipo: 'transazionale',
      });
      if (!r.ok) logger.error(new Error('[segnalazioni] email dell\'esito non partita'), { segnalazione: s.id });
      return r.ok ? 'inviata' : 'fallita';
    });
  }

  const segnalanteId = s.segnalante_id;
  const segnalanteNotifica: Canale = segnalanteId
    ? await unaVolta(admin, memoria, s, 'segnalante_notifica', impronta(segnalanteId, s, motivazione), () =>
        notifica(admin, segnalanteId, 'Esito della tua segnalazione', `Decisione ${decisione}. ${motivazione}\n\n${COME_CONTESTARE}`, link, s))
    : 'nessun_recapito';

  let venditore: Canale = 'non_previsto';
  if (s.tipo === 'prodotto' || s.tipo === 'negozio') {
    const sellerId = await venditoreDi(admin, s);
    venditore = sellerId === 'nessuno'
      ? 'nessun_recapito'
      : sellerId
        ? await unaVolta(admin, memoria, s, 'venditore', impronta(sellerId, s, motivazione), () => notifica(
            admin, sellerId,
            s.tipo === 'prodotto' ? 'Decisione su una segnalazione di un tuo prodotto' : 'Decisione su una segnalazione del tuo negozio',
            `Una segnalazione per «${motivoLeggibile(s.motivo)}» è stata ${decisione}. Motivazione: ${motivazione}\n\n${COME_CONTESTARE}`,
            link, s,
          ))
        : 'fallita';
  }

  return { ok: true, segnalanteEmail, segnalanteNotifica, venditore };
}
