import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { ApiErrors } from '@/lib/api/responses';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { logger } from '@/lib/logger';
import { withAdminAuth } from '@/lib/api/middleware';
import { comunicaEsito, MOTIVAZIONE_MINIMA } from './esito/comunica';
import { motivoLeggibile, oggettoConArticolo } from '@/lib/admin/segnalazioni-testi';
import { sendEmail } from '@/lib/email/client';
import { escapeHtml } from '@/lib/html-escape';
import { verifyTurnstileToken } from '@/lib/captcha';

export const runtime = 'nodejs';

/**
 * Segnalare un contenuto illecito.
 *
 * 22/8/2026 — QUESTO CANALE NON ESISTEVA. Sul sito non c'era nessun modo di
 * dirci che un prodotto è contraffatto, pericoloso o illecito: nessun pulsante,
 * nessuna rotta, nessun registro. Il regolamento europeo sui servizi digitali
 * lo chiede a ogni piattaforma che ospita contenuti di terzi — e per un
 * marketplace non è burocrazia: è il modo in cui un titolare di marchio, o un
 * cliente che vede una cosa pericolosa, ce lo può dire prima che la compri
 * qualcun altro.
 *
 * Si può segnalare anche senza account: una segnalazione che pretende la
 * registrazione è una segnalazione che non arriva. Chi lascia un recapito ha
 * diritto a un esito motivato.
 */
const Corpo = z.object({
  tipo: z.enum(['prodotto', 'negozio', 'recensione', 'messaggio']),
  oggettoId: z.string().uuid(),
  motivo: z.enum([
    'contraffatto', 'illecito', 'pericoloso', 'ingannevole',
    'proprieta_intellettuale', 'odio_o_molestie', 'altro',
  ]),
  dettaglio: z.string().max(2000).optional(),
  emailContatto: z.string().email().max(320).optional(),
  // 13/11/2026 (R21-014) — Nome e dichiarazione di buona fede, tutti e due facoltativi.
  // Il nome sta su una riga sola: vedi `nomeSuUnaRiga`.
  nomeSegnalante: z.string().max(120).transform((n) => nomeSuUnaRiga(n)).optional(),
  buonaFede: z.boolean().optional(),
  // 13/11/2026 (R21-008, correzione) — Il gettone del controllo anti-robot del modulo.
  captchaToken: z.string().max(2048).optional(),
});

/**
 * 13/11/2026 (R21-014) — IL MODULO NON PERMETTEVA DI DARE IL NOME NÉ DI DICHIARARE LA BUONA FEDE.
 *
 * Il regolamento europeo sui servizi digitali (art. 16.2, lettere c e d) chiede che il canale
 * consenta il nome di chi segnala e la dichiarazione che quanto scrive è, in buona fede, esatto e
 * completo. Non chiede di rifiutare chi non li dà: restano facoltativi.
 *
 * Viaggiano dentro il testo della segnalazione, in fondo, in righe scritte da noi: così li legge
 * l'amministratore che la esamina (la pagina admin mostra il testo), e se ne vanno con il testo
 * quando la potatura o la cancellazione lo tolgono. Nessuna colonna nuova da aspettare nel database.
 */
const LIMITE_DEL_TESTO = 2000; // il vincolo della colonna `dettaglio` (migrazione 126)
const DICHIARAZIONE_DI_BUONA_FEDE =
  'Dichiara in buona fede che le informazioni e le accuse di questa segnalazione sono esatte e complete.';

/**
 * 13/11/2026 (R21-014, correzione) — LE RIGHE DEL SITO SI RICONOSCONO.
 *
 * Le righe che cominciano con la lineetta lunga «— » le scrive solo il sito. Il nome sta su una
 * riga sola: a capo, caratteri di controllo e caratteri invisibili diventano spazi, e le lineette
 * diventano trattini. Nel testo di chi segnala, una riga che comincia con una lineetta (o con un
 * segno che le somiglia) comincia con il trattino corto «-». Così una riga scritta a mano non è
 * mai uguale a una riga del sito.
 */
const INVISIBILI = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;
const LINEETTE = /[\p{Pd}\u2212\u23AF\u2500\u2501]/gu;
const LINEETTA_IN_TESTA = /(^|\r\n|[\n\r\u0085\u2028\u2029])([\s\p{Cf}]*)([\p{Pd}\u2212\u23AF\u2500\u2501]+)/gu;

function nomeSuUnaRiga(nome: string): string {
  return nome.replace(INVISIBILI, ' ').replace(LINEETTE, '-').replace(/\s+/g, ' ').trim();
}

function senzaRigheDelSito(testo: string): string {
  return testo.replace(LINEETTA_IN_TESTA, (tutto, aCapo: string, spazi: string, lineette: string) =>
    /^-+$/.test(lineette) ? tutto : `${aCapo}${spazi}-`,
  );
}

function testoDellaSegnalazione(c: z.infer<typeof Corpo>): string | null {
  const firma = [
    c.nomeSegnalante ? `— Chi segnala: ${c.nomeSegnalante}` : null,
    c.buonaFede ? `— ${DICHIARAZIONE_DI_BUONA_FEDE}` : null,
  ].filter(Boolean);
  const testo = c.dettaglio === undefined ? undefined : senzaRigheDelSito(c.dettaglio);
  if (firma.length === 0) return testo ?? null;
  return [testo?.trim() || null, firma.join('\n')].filter(Boolean).join('\n\n');
}

/**
 * 13/11/2026 (R21-008) — CHI LASCIAVA L'EMAIL NON RICEVEVA NESSUNA CONFERMA.
 *
 * Dopo l'inserimento la rotta avvisava solo gli amministratori: chi aveva segnalato vedeva un
 * avviso a schermo che spariva, e restava senza prova né numero. Il regolamento europeo sui
 * servizi digitali (art. 16.4) chiede una conferma di ricezione al recapito elettronico lasciato.
 *
 * Il testo è tutto nostro: numero, oggetto, motivo e data. Niente testo libero di chi segnala,
 * perché l'indirizzo lo può scrivere chiunque e la conferma non deve poter portare parole altrui.
 * L'esito dell'invio si legge: torna nella risposta e, se fallisce, nei registri.
 */
type Conferma = 'inviata' | 'fallita' | 'non_inviata' | 'nessun_recapito';

/**
 * 13/11/2026 (R21-008, correzione) — QUANDO LA CONFERMA PARTE.
 *
 * Parte solo se il controllo anti-robot del modulo è passato, come nei contatti e nella
 * newsletter, e arriva al massimo una volta ogni 10 minuti e tre volte al giorno allo stesso
 * indirizzo. Il contatore usa un'impronta dell'indirizzo, non l'indirizzo in chiaro. Quando la
 * conferma non parte la segnalazione resta registrata, la risposta dice `non_inviata` e il modulo
 * mostra il numero della segnalazione.
 */
const PAUSA_FRA_CONFERME_MS = 10 * 60_000;
const CONFERME_AL_GIORNO = 3;

async function motivoPerNonConfermare(
  email: string,
  gettone: string | undefined,
  ip: string,
): Promise<'anti_robot' | 'pausa' | null> {
  const antiRobot = await verifyTurnstileToken(gettone, ip);
  if (!antiRobot.ok) return 'anti_robot';
  const impronta = createHash('sha256').update(`segnalazioni:${email.trim().toLowerCase()}`).digest('hex');
  const pausa = await rateLimitAsync({ key: `segnalazioni-conferma:${impronta}`, max: 1, windowMs: PAUSA_FRA_CONFERME_MS });
  if (!pausa.allowed) return 'pausa';
  const giorno = await rateLimitAsync({
    key: `segnalazioni-conferma-giorno:${impronta}`,
    max: CONFERME_AL_GIORNO,
    windowMs: 24 * 60 * 60_000,
  });
  return giorno.allowed ? null : 'pausa';
}

async function mandaConferma(
  a: string,
  s: { id: string; tipo: string; motivo: string; quando: Date },
): Promise<Conferma> {
  const quando = s.quando.toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'long', timeStyle: 'short' });
  const righe = [
    `Numero della segnalazione: ${s.id}`,
    `Che cosa hai segnalato: ${oggettoConArticolo(s.tipo)}`,
    `Motivo: ${motivoLeggibile(s.motivo)}`,
    `Ricevuta il: ${quando}`,
  ];
  const chiusura = 'La esaminiamo e ti scriviamo a questo indirizzo la decisione, con la motivazione.';
  const seNonSeiTu = 'Se non hai fatto tu questa segnalazione, ignora questa email.';
  try {
    const r = await sendEmail({
      to: a,
      subject: 'Abbiamo ricevuto la tua segnalazione',
      html:
        '<p>Abbiamo ricevuto la tua segnalazione.</p>' +
        `<p>${righe.map(escapeHtml).join('<br>')}</p>` +
        `<p>${escapeHtml(chiusura)}</p>` +
        `<p>${escapeHtml(seNonSeiTu)}</p>`,
      text: `Abbiamo ricevuto la tua segnalazione.\n\n${righe.join('\n')}\n\n${chiusura}\n\n${seNonSeiTu}`,
      tipo: 'transazionale',
    });
    if (r.ok) return 'inviata';
    logger.error(new Error('[segnalazioni] conferma di ricezione non partita'), {
      context: 'segnalazioni',
      segnalazione: s.id,
      motivo: 'error' in r ? r.error : r.reason,
    });
  } catch (e) {
    logger.error(new Error('[segnalazioni] conferma di ricezione non partita'), {
      context: 'segnalazioni',
      segnalazione: s.id,
      motivo: e instanceof Error ? e.message : 'errore',
    });
  }
  return 'fallita';
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  {
    // Il canale deve restare aperto a chi non ha un account, quindi il freno
    // e' sull'indirizzo di rete: dieci segnalazioni all'ora bastano a chiunque
    // in buona fede e fermano chi vuole intasarlo.
    const rl = await rateLimitAsync({ key: `segnalazioni:${ip}`, max: 10, windowMs: 60 * 60_000 });
    if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);
  }
  {
    let corpo;
    try {
      corpo = Corpo.parse(await jsonRichiesta(req, TETTO_JSON));
    } catch (e) {
      return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
    }

    const dettaglio = testoDellaSegnalazione(corpo);
    if (dettaglio && dettaglio.length > LIMITE_DEL_TESTO) {
      return ApiErrors.invalidRequest('Il testo della segnalazione è troppo lungo: accorcialo un po’.');
    }

    // Chi è loggato viene riconosciuto, ma non è obbligatorio.
    let autoreId: string | null = null;
    try {
      const supa = await getServerSupabase();
      autoreId = (await supa.auth.getUser()).data.user?.id ?? null;
    } catch {
      autoreId = null;
    }

    const admin = getAdminSupabase();

    // 5/11/2026 (S05) — Si segnala qualcosa che esiste: prima un codice qualunque
    // (anche di prodotti o negozi inventati) creava la riga e un avviso per ogni
    // amministratore.
    const TABELLA_DELL_OGGETTO: Record<string, string> = { prodotto: 'products', negozio: 'seller_public_profiles' };
    const tabellaOggetto = TABELLA_DELL_OGGETTO[corpo.tipo];
    if (tabellaOggetto) {
      const { data: oggetto, error: erroreOggetto } = await admin
        .from(tabellaOggetto)
        .select('id')
        .eq('id', corpo.oggettoId)
        .maybeSingle();
      if (erroreOggetto) {
        logger.error('[segnalazioni] oggetto non controllato', { message: erroreOggetto.message });
        return ApiErrors.internal('Segnalazione non registrata: riprova');
      }
      if (!oggetto) return ApiErrors.notFound('Il contenuto segnalato non esiste più.');
    }

    const { data, error } = await admin
      .from('segnalazioni')
      .insert({
        tipo: corpo.tipo,
        oggetto_id: corpo.oggettoId,
        motivo: corpo.motivo,
        dettaglio,
        segnalante_id: autoreId,
        email_contatto: corpo.emailContatto ?? null,
      })
      .select('id, created_at')
      .single();

    if (error) {
      logger.error('[segnalazioni] non registrata', { message: error.message });
      return ApiErrors.internal('Segnalazione non registrata: riprova');
    }

    /**
     * Gli amministratori la devono vedere, non scoprirla.
     *
     * 3/9/2026 — L'AVVISO NON PARTIVA, E NESSUNO LO SAPEVA.
     *
     * Qui la riga di avviso nasceva con categoria «moderation», e il database
     * ammette solo `order`, `promo`, `group`, `newsletter`, `system`
     * (migrazione 115): la scrittura veniva rifiutata. Peggio: il campo
     * `error` che il client Supabase restituisce non veniva letto — e quel
     * client non solleva eccezioni, quindi il `try/catch` qui attorno non
     * scattava mai. La rotta rispondeva «ricevuto» e la segnalazione restava
     * in tabella finche' qualcuno non apriva a mano /admin/segnalazioni.
     * Nessuna campanella, nessuna riga nei registri. E' il canale che il
     * regolamento europeo sui servizi digitali obbliga ad avere e a lavorare
     * in tempi ragionevoli.
     *
     * La categoria giusta e' `system`: sono gli avvisi di servizio, gli unici
     * che l'amministratore non puo' spegnere dalle preferenze — e una
     * segnalazione di prodotto pericoloso non deve poter essere silenziata.
     * L'esito dell'inserimento adesso si legge sempre.
     */
    try {
      const { data: capi } = await admin.from('profiles').select('id').eq('role', 'admin');
      const righe = (capi ?? []).map((c) => ({
        user_id: c.id as string,
        title: '🚩 Nuova segnalazione',
        body: `Segnalato ${oggettoConArticolo(corpo.tipo)} per «${motivoLeggibile(corpo.motivo)}». Va esaminata e chiusa con un esito motivato.`,
        link: '/admin/segnalazioni',
        category: 'system',
      }));
      if (righe.length > 0) {
        const { error: erroreAvviso } = await admin.from('notifications').insert(righe);
        if (erroreAvviso) {
          logger.error(new Error(`[segnalazioni] avviso agli amministratori non scritto: ${erroreAvviso.message}`), {
            context: 'segnalazioni',
            segnalazione: data.id,
            destinatari: righe.length,
          });
        }
      } else {
        logger.error(new Error('[segnalazioni] nessun amministratore a cui mandare l avviso'), {
          context: 'segnalazioni',
          segnalazione: data.id,
        });
      }
    } catch (e) {
      logger.warn('[segnalazioni] avviso agli amministratori non partito', { e });
    }

    let conferma: Conferma = 'nessun_recapito';
    if (corpo.emailContatto) {
      const nonParte = await motivoPerNonConfermare(corpo.emailContatto, corpo.captchaToken, ip);
      if (nonParte) {
        conferma = 'non_inviata';
        logger.info('[segnalazioni] conferma di ricezione non inviata', {
          context: 'segnalazioni',
          segnalazione: data.id,
          motivo: nonParte,
        });
      } else {
        conferma = await mandaConferma(corpo.emailContatto, {
          id: data.id,
          tipo: corpo.tipo,
          motivo: corpo.motivo,
          quando: data.created_at ? new Date(data.created_at) : new Date(),
        });
      }
    }

    return NextResponse.json({ ok: true, id: data.id, conferma }, { status: 201 });
  }
}

/**
 * PATCH /api/segnalazioni — solo amministratori: comunica l'esito deciso.
 *
 * 1/11/2026 — La pagina /admin/segnalazioni salvava stato ed esito_motivato,
 * ma nessun codice li mandava: ne' a chi aveva segnalato (regolamento sui
 * servizi digitali, art. 16.5) ne' al venditore toccato (art. 17). Questa
 * rotta li manda (vedi `esito/comunica.ts`): email a chi ha lasciato il
 * recapito, notifica a chi ha un account e al venditore. Risponde 502 se un
 * canale previsto e' fallito, cosi' l'amministratore lo vede invece di
 * credere che sia partito. La pagina admin la chiama dopo aver salvato.
 */
const CorpoEsito = z.object({ id: z.string().uuid() });

/**
 * 12/11/2026 (R02-003) — «ACCOLTA» DICE «RIMOSSO»: PRIMA SI GUARDA CHE SIA VERO.
 *
 * L'esito di una segnalazione accolta dice a chi ha segnalato e al venditore «il contenuto è stato
 * rimosso». La pagina admin toglie il contenuto prima di registrare la decisione, ma la garanzia
 * vera sta qui, dove l'esito parte: se il prodotto è ancora in vetrina, o il negozio ancora
 * approvato, o il contenuto è di un tipo che da qui non si toglie, non parte niente.
 * Restituisce il motivo per fermarsi, o null se si può comunicare.
 */
async function contenutoAncoraOnline(
  admin: ReturnType<typeof getAdminSupabase>,
  id: string,
): Promise<string | null> {
  // Dopo il collaudo: una lettura caduta NON vuol dire «tolto». Si ferma (fallisce chiuso): meglio
  // rimandare un esito che scrivere «rimosso» di un contenuto che forse è ancora online.
  const NON_VERIFICATO = 'Non riesco a verificare che il contenuto sia stato tolto: riprova fra poco.';
  const { data, error } = await admin.from('segnalazioni').select('stato, tipo, oggetto_id').eq('id', id).maybeSingle();
  if (error) return NON_VERIFICATO;
  const s = data as { stato?: string; tipo?: string; oggetto_id?: string } | null;
  if (!s || s.stato !== 'accolta') return null;
  if (s.tipo === 'prodotto') {
    const { data: p, error: e } = await admin.from('products').select('status').eq('id', s.oggetto_id).maybeSingle();
    if (e) return NON_VERIFICATO;
    return (p as { status?: string } | null)?.status === 'available'
      ? 'Il prodotto è ancora in vetrina: toglilo prima di comunicare «rimosso».'
      : null;
  }
  if (s.tipo === 'negozio') {
    const { data: n, error: e } = await admin.from('profiles').select('approval_status').eq('id', s.oggetto_id).maybeSingle();
    if (e) return NON_VERIFICATO;
    return (n as { approval_status?: string } | null)?.approval_status === 'approved'
      ? 'Il negozio è ancora attivo: sospendilo prima di comunicare «rimosso».'
      : null;
  }
  return 'Questo tipo di contenuto non si toglie da qui: l\'esito «rimosso» non può partire.';
}

export const PATCH = withAdminAuth(async ({ req }) => {
  let corpo;
  try {
    corpo = CorpoEsito.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }
  const admin = getAdminSupabase();
  const ancoraOnline = await contenutoAncoraOnline(admin, corpo.id);
  if (ancoraOnline) return ApiErrors.conflict(ancoraOnline);
  const r = await comunicaEsito(admin, corpo.id);
  if (!r.ok) {
    if (r.motivo === 'non_trovata') return ApiErrors.notFound('Segnalazione non trovata');
    if (r.motivo === 'non_decisa') {
      return ApiErrors.conflict(`Prima registra la decisione e una motivazione di almeno ${MOTIVAZIONE_MINIMA} caratteri`);
    }
    return ApiErrors.internal('Segnalazione non letta: riprova');
  }
  const { segnalanteEmail, segnalanteNotifica, venditore } = r;
  const fallito = [segnalanteEmail, segnalanteNotifica, venditore].includes('fallita');
  if (fallito) logger.error('Esito della segnalazione non comunicato a tutti', { id: corpo.id, segnalanteEmail, segnalanteNotifica, venditore });
  return NextResponse.json(
    { ok: !fallito, segnalanteEmail, segnalanteNotifica, venditore },
    { status: fallito ? 502 : 200 },
  );
});
