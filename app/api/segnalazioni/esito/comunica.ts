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

  let segnalanteEmail: Canale = 'nessun_recapito';
  if (s.email_contatto) {
    const r = await sendEmail({
      to: s.email_contatto,
      subject: 'Esito della tua segnalazione',
      html:
        `<p>Abbiamo esaminato la tua segnalazione (motivo: ${escapeHtml(motivoLeggibile(s.motivo))}).</p>` +
        `<p><strong>Decisione:</strong> ${escapeHtml(decisione)}.</p>` +
        `<p><strong>Motivazione:</strong> ${escapeHtml(motivazione)}</p>` +
        `<p>${escapeHtml(COME_CONTESTARE)}</p>`,
      text: `Decisione: ${decisione}.\nMotivazione: ${motivazione}\n\n${COME_CONTESTARE}`,
      tipo: 'transazionale',
    });
    segnalanteEmail = r.ok ? 'inviata' : 'fallita';
    if (!r.ok) logger.error(new Error('[segnalazioni] email dell\'esito non partita'), { segnalazione: s.id });
  }

  const segnalanteNotifica: Canale = s.segnalante_id
    ? await notifica(admin, s.segnalante_id, 'Esito della tua segnalazione', `Decisione ${decisione}. ${motivazione}\n\n${COME_CONTESTARE}`, link, s)
    : 'nessun_recapito';

  let venditore: Canale = 'non_previsto';
  if (s.tipo === 'prodotto' || s.tipo === 'negozio') {
    const sellerId = await venditoreDi(admin, s);
    venditore = sellerId === 'nessuno'
      ? 'nessun_recapito'
      : sellerId
        ? await notifica(
            admin, sellerId,
            s.tipo === 'prodotto' ? 'Decisione su una segnalazione di un tuo prodotto' : 'Decisione su una segnalazione del tuo negozio',
            `Una segnalazione per «${motivoLeggibile(s.motivo)}» è stata ${decisione}. Motivazione: ${motivazione}\n\n${COME_CONTESTARE}`,
            link, s,
          )
        : 'fallita';
  }

  return { ok: true, segnalanteEmail, segnalanteNotifica, venditore };
}
