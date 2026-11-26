import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { ApiErrors } from '@/lib/api/responses';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { logger } from '@/lib/logger';
import { withAdminAuth } from '@/lib/api/middleware';
import { comunicaEsito, MOTIVAZIONE_MINIMA, type Canale } from './esito/comunica';
import { COME_CONTESTARE, motivoLeggibile, oggettoConArticolo } from '@/lib/admin/segnalazioni-testi';
import { sendEmail } from '@/lib/email/client';
import { escapeHtml } from '@/lib/html-escape';

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
/** I limiti dei campi di chi segnala (R02-016: vedi sotto `dettaglioConDatiDiChiSegnala`). */
const NOME_MASSIMO = 100;
const DETTAGLIO_MASSIMO = 2000;
const RISERVA_DATI = 300;
const Corpo = z.object({
  // R18-014 — anche una domanda sotto un prodotto (il database la accetta dalla migrazione 364).
  tipo: z.enum(['prodotto', 'negozio', 'recensione', 'messaggio', 'domanda']),
  oggettoId: z.string().uuid(),
  motivo: z.enum([
    'contraffatto', 'illecito', 'pericoloso', 'ingannevole',
    'proprieta_intellettuale', 'odio_o_molestie', 'altro',
  ]),
  dettaglio: z.string().max(2000).optional(),
  emailContatto: z.string().email().max(320).optional(),
  // 26/11/2026 (R02-016) — Nome e dichiarazione di buona fede, tutti e due facoltativi.
  nomeSegnalante: z.string().max(NOME_MASSIMO).optional(),
  buonaFede: z.boolean().optional(),
});

/**
 * 26/11/2026 (R02-016) — CHI SEGNALA PUÒ DARE IL SUO NOME E DICHIARARE LA BUONA FEDE.
 *
 * Il regolamento sui servizi digitali (art. 16.2, lettere c e d) chiede che il canale consenta il
 * nome di chi segnala e la dichiarazione di buona fede; non chiede di rifiutare chi non li dà.
 * Prima il modulo aveva solo motivo, testo ed email.
 *
 * Dove si salvano: in testa al testo della segnalazione (`dettaglio`), senza colonne nuove. Una
 * colonna nuova farebbe cadere OGNI segnalazione finché la migrazione non è applicata (il
 * database rifiuta la scrittura intera), e il testo ha già il suo tempo di conservazione (la
 * potatura delle segnalazioni lo azzera con l'email) e lo legge solo l'amministrazione e chi l'ha
 * scritto (esportazione dei dati). Senza nome né dichiarazione il testo resta esattamente com'era.
 * Le due righe sono dichiarazioni di chi segnala, come il resto del testo: il server non aggiunge
 * niente che lui non abbia scritto o spuntato, quindi non c'è un «timbro» da falsificare.
 *
 * La lunghezza: il database tiene al massimo `DETTAGLIO_MASSIMO` caratteri. Con nome o
 * dichiarazione il modulo lascia al testo `DETTAGLIO_MASSIMO - RISERVA_DATI` caratteri (le righe
 * aggiunte non arrivano mai alla riserva), e qui un testo che insieme alle righe non ci sta si
 * rifiuta con un 400 che dice di quanto accorciare, invece di un guasto alla scrittura.
 */
const DICHIARAZIONE_BUONA_FEDE =
  'Chi segnala dichiara in buona fede che le informazioni e le accuse di questa segnalazione sono esatte e complete.';

/** Il nome su una riga sola: a capo e caratteri di controllo diventano spazi. */
function nomeSuUnaRiga(nome: string | undefined): string | null {
  const pulito = (nome ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return pulito || null;
}

function dettaglioConDatiDiChiSegnala(
  dettaglio: string | undefined,
  nome: string | null,
  buonaFede: boolean,
): string | null {
  const righe: string[] = [];
  if (nome) righe.push(`Nome di chi segnala: ${nome}`);
  if (buonaFede) righe.push(DICHIARAZIONE_BUONA_FEDE);
  if (righe.length === 0) return dettaglio ?? null;
  const testo = (dettaglio ?? '').trim();
  return testo ? `${righe.join('\n')}\n\n${testo}` : righe.join('\n');
}

/**
 * 26/11/2026 (R02-010) — CHI LASCIA L'EMAIL RICEVE LA RICEVUTA.
 *
 * Il regolamento sui servizi digitali (art. 16.4) chiede una conferma di ricezione al recapito
 * elettronico lasciato. Prima la rotta avvisava solo gli amministratori: chi segnalava una borsa
 * contraffatta chiudeva la pagina senza nessuna prova né numero della segnalazione.
 *
 * Il modulo è aperto a tutti e l'indirizzo lo scrive chi segnala, quindi la ricevuta non deve
 * diventare un modo per mandare email a un altro: dice solo numero, oggetto, motivo e data (mai il
 * testo libero di chi ha scritto), e ogni indirizzo ne riceve al massimo `RICEVUTE_PER_INDIRIZZO`
 * al giorno, contate sull'indirizzo normalizzato (maiuscole, «+etichetta», punti di Gmail) così
 * le scritture diverse dello stesso indirizzo contano insieme. La segnalazione resta registrata
 * anche se la ricevuta non parte: l'esito si legge, si scrive nei log e torna nella risposta.
 */
const RICEVUTE_PER_INDIRIZZO = 3;
const FINESTRA_RICEVUTE_MS = 24 * 60 * 60_000;

type ConfermaRicevuta = 'inviata' | 'fallita' | 'rinviata' | 'nessun_recapito';

/** Lo stesso indirizzo scritto in modi diversi dà la stessa chiave. */
function indirizzoNormalizzato(email: string): string {
  const pulito = email.trim().toLowerCase();
  const at = pulito.lastIndexOf('@');
  if (at < 0) return pulito;
  let locale = pulito.slice(0, at).split('+')[0];
  let dominio = pulito.slice(at + 1).replace(/\.+$/, '');
  if (dominio === 'googlemail.com') dominio = 'gmail.com';
  if (dominio === 'gmail.com') locale = locale.replace(/\./g, '');
  return `${locale}@${dominio}`;
}

async function mandaRicevuta(
  segnalazione: { id: string; tipo: string; motivo: string; ricevutaIl: Date },
  email: string,
): Promise<ConfermaRicevuta> {
  const impronta = createHash('sha256').update(indirizzoNormalizzato(email)).digest('hex');
  const tetto = await rateLimitAsync({
    key: `segnalazioni-ricevuta:${impronta}`,
    max: RICEVUTE_PER_INDIRIZZO,
    windowMs: FINESTRA_RICEVUTE_MS,
  });
  if (!tetto.allowed) {
    logger.warn('[segnalazioni] ricevuta non mandata: troppe allo stesso indirizzo oggi', { segnalazione: segnalazione.id });
    return 'rinviata';
  }
  const quando = segnalazione.ricevutaIl.toLocaleString('it-IT', {
    timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const oggetto = oggettoConArticolo(segnalazione.tipo);
  const motivo = motivoLeggibile(segnalazione.motivo);
  const ignora = 'Se non hai fatto tu questa segnalazione, ignora questa email: qualcuno ha scritto il tuo indirizzo per errore.';
  try {
    const r = await sendEmail({
      to: email,
      subject: `Abbiamo ricevuto la tua segnalazione n. ${segnalazione.id}`,
      html:
        `<p>Abbiamo ricevuto la tua segnalazione: la esaminiamo e ti scriviamo qui l'esito motivato.</p>` +
        `<ul><li><strong>Numero:</strong> ${escapeHtml(segnalazione.id)}</li>` +
        `<li><strong>Cosa hai segnalato:</strong> ${escapeHtml(oggetto)}</li>` +
        `<li><strong>Motivo:</strong> ${escapeHtml(motivo)}</li>` +
        `<li><strong>Ricevuta il:</strong> ${escapeHtml(quando)}</li></ul>` +
        `<p>${escapeHtml(ignora)}</p>`,
      text:
        `Abbiamo ricevuto la tua segnalazione: la esaminiamo e ti scriviamo qui l'esito motivato.\n\n` +
        `Numero: ${segnalazione.id}\nCosa hai segnalato: ${oggetto}\nMotivo: ${motivo}\nRicevuta il: ${quando}\n\n${ignora}`,
      tipo: 'transazionale',
      idempotencyKey: `segnalazione-ricevuta-${segnalazione.id}`,
    });
    if (!r.ok) {
      logger.error(new Error('[segnalazioni] ricevuta a chi ha segnalato non partita'), { segnalazione: segnalazione.id });
      return 'fallita';
    }
    return 'inviata';
  } catch (e) {
    logger.error(new Error('[segnalazioni] ricevuta a chi ha segnalato non partita'), {
      segnalazione: segnalazione.id,
      err: e instanceof Error ? e.message : String(e),
    });
    return 'fallita';
  }
}

/**
 * Gli avvisi che partono da questa rotta sono di servizio: `system` è la categoria che nessuna
 * preferenza spegne (vedi sotto, 3/9/2026). R18-003: lo stesso per l'avviso a chi ha scritto una
 * recensione tolta, quindi la categoria si scrive in un posto solo.
 */
function avvisoDiServizio(riga: { user_id: string; title: string; body: string; link: string }) {
  return { ...riga, category: 'system' };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  {
    // Il canale deve restare aperto a chi non ha un account, quindi il freno
    // e' sull'indirizzo di rete: dieci segnalazioni all'ora bastano a chiunque
    // in buona fede e fermano chi vuole intasarlo.
    const ip = getClientIp(req);
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

    // Chi è loggato viene riconosciuto, ma non è obbligatorio.
    let autoreId: string | null = null;
    try {
      const supa = await getServerSupabase();
      autoreId = (await supa.auth.getUser()).data.user?.id ?? null;
    } catch {
      autoreId = null;
    }

    const nome = nomeSuUnaRiga(corpo.nomeSegnalante);
    const dettaglio = dettaglioConDatiDiChiSegnala(corpo.dettaglio, nome, corpo.buonaFede === true);
    if (dettaglio !== null && dettaglio.length > DETTAGLIO_MASSIMO) {
      return ApiErrors.invalidRequest(
        `Con il nome o la dichiarazione il testo può avere al massimo ${DETTAGLIO_MASSIMO - RISERVA_DATI} caratteri: ` +
        `accorcialo di ${dettaglio.length - DETTAGLIO_MASSIMO} o più.`,
      );
    }

    const admin = getAdminSupabase();

    // 5/11/2026 (S05) — Si segnala qualcosa che esiste: prima un codice qualunque
    // (anche di prodotti o negozi inventati) creava la riga e un avviso per ogni
    // amministratore.
    // R03-003 — Il controllo vale per tutti e quattro i tipi. «recensione» è una sola voce per due
    // tabelle (le recensioni dei prodotti e quelle dei negozi: il pulsante c'è su tutte e due le
    // pagine), quindi basta che l'id sia in una delle due. Si legge col client di servizio, lo stesso
    // già usato per prodotto e negozio: nessuna regola RLS cambia.
    const TABELLE_DELL_OGGETTO: Record<string, string[]> = {
      prodotto: ['products'],
      negozio: ['seller_public_profiles'],
      recensione: ['reviews', 'store_reviews'],
      messaggio: ['messages'],
      domanda: ['product_questions'],
    };
    let oggettoEsiste = false;
    for (const tabellaOggetto of TABELLE_DELL_OGGETTO[corpo.tipo]) {
      const { data: oggetto, error: erroreOggetto } = await admin
        .from(tabellaOggetto)
        .select('id')
        .eq('id', corpo.oggettoId)
        .maybeSingle();
      if (erroreOggetto) {
        logger.error('[segnalazioni] oggetto non controllato', { message: erroreOggetto.message });
        return ApiErrors.internal('Segnalazione non registrata: riprova');
      }
      if (oggetto) { oggettoEsiste = true; break; }
    }
    if (!oggettoEsiste) return ApiErrors.notFound('Il contenuto segnalato non esiste più.');

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
      const righe = (capi ?? []).map((c) => avvisoDiServizio({
        user_id: c.id as string,
        title: '🚩 Nuova segnalazione',
        body: `Segnalato ${oggettoConArticolo(corpo.tipo)} per «${motivoLeggibile(corpo.motivo)}». Va esaminata e chiusa con un esito motivato.`,
        link: '/admin/segnalazioni',
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

    const creata = typeof (data as { created_at?: unknown }).created_at === 'string'
      ? new Date((data as { created_at: string }).created_at)
      : new Date();
    const conferma: ConfermaRicevuta = corpo.emailContatto
      ? await mandaRicevuta(
        { id: data.id, tipo: corpo.tipo, motivo: corpo.motivo, ricevutaIl: Number.isNaN(creata.getTime()) ? new Date() : creata },
        corpo.emailContatto,
      )
      : 'nessun_recapito';

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
  if (s.tipo === 'domanda') {
    // R18-014 — Una domanda si toglie nascondendola (is_public = false: la regola della migrazione 364
    // lo permette all'amministratore). Finché è visibile sotto il prodotto, «rimosso» non parte.
    const { data: d, error: e } = await admin.from('product_questions').select('is_public').eq('id', s.oggetto_id).maybeSingle();
    if (e) return NON_VERIFICATO;
    return (d as { is_public?: boolean } | null)?.is_public === true
      ? 'La domanda è ancora visibile: nascondila prima di comunicare «rimosso».'
      : null;
  }
  if (s.tipo === 'recensione') {
    // R18-003 — `togliRecensioneAccolta` l'ha già tolta: qui si guarda che sia fuori davvero.
    for (const tabella of TABELLE_RECENSIONI) {
      const { data: r, error: e } = await admin.from(tabella).select('id').eq('id', s.oggetto_id).maybeSingle();
      if (e) return NON_VERIFICATO;
      if (r) return 'La recensione è ancora online: toglila prima di comunicare «rimosso».';
    }
    return null;
  }
  return 'Questo tipo di contenuto non si toglie da qui: l\'esito «rimosso» non può partire.';
}

/**
 * 26/11/2026 (R18-003) — UNA RECENSIONE SEGNALATA E ACCOLTA SI TOGLIE DAVVERO, E CHI L'HA SCRITTA LO SA.
 *
 * I Termini (16-bis, «Cosa rimuoviamo») promettono di togliere le recensioni non genuine e sotto ogni
 * recensione c'è «Segnala», ma nessuna strada del sito ne toglieva una: la regola del database non dà
 * all'amministratore né DELETE né UPDATE su `reviews` e `store_reviews`, quindi il pannello (che scrive
 * col client del browser) non può, e «Accolta» restava spenta. La recensione si toglie qui, col client
 * di servizio, quando parte l'esito di una segnalazione accolta: prima la riga e le sue foto (il secchio
 * `reviews` è pubblico: una foto rimasta lì si apre ancora da chi ha l'indirizzo), poi l'avviso a chi
 * l'ha scritta con la motivazione e la via per contestare (regolamento sui servizi digitali, art. 17),
 * e solo dopo l'esito «rimosso» a chi ha segnalato.
 *
 * Senza motivazione non si toglie niente (l'esito non partirebbe e la recensione sarebbe sparita senza
 * una ragione scritta). Una recensione che non si trova più conta come tolta solo se il registro attività
 * ne ha la cancellazione, che il database scrive da sé nella stessa operazione (migrazione 073): è il caso
 * del secondo invio dopo un esito non partito. Senza quella traccia l'esito non parte.
 */
const TABELLE_RECENSIONI = ['reviews', 'store_reviews'] as const;
const SECCHIO_FOTO_RECENSIONI = 'reviews';
const FOTO_NEL_SECCHIO = /\/storage\/v1\/object\/public\/reviews\/([^?#]+)/;

/** Il percorso nel secchio di una foto della recensione, dall'indirizzo pubblico salvato. */
function percorsoFotoRecensione(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const m = url.match(FOTO_NEL_SECCHIO);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

type RecensioneTolta = { ferma: string; autore?: undefined } | { ferma: null; autore: Canale };

async function togliRecensioneAccolta(
  admin: ReturnType<typeof getAdminSupabase>,
  id: string,
): Promise<RecensioneTolta> {
  const NON_VERIFICATO = 'Non riesco a verificare che la recensione sia stata tolta: riprova fra poco.';
  const NON_TOLTA = 'La recensione non è stata tolta: l\'esito non parte. Riprova fra poco.';
  const { data, error } = await admin
    .from('segnalazioni').select('stato, tipo, oggetto_id, esito_motivato').eq('id', id).maybeSingle();
  if (error) return { ferma: NON_VERIFICATO };
  const s = data as { stato?: string; tipo?: string; oggetto_id?: string; esito_motivato?: string | null } | null;
  if (!s || s.stato !== 'accolta' || s.tipo !== 'recensione' || !s.oggetto_id) return { ferma: null, autore: 'non_previsto' };
  const motivazione = (s.esito_motivato ?? '').trim();
  if (motivazione.length < MOTIVAZIONE_MINIMA) {
    return { ferma: `Prima registra la decisione e una motivazione di almeno ${MOTIVAZIONE_MINIMA} caratteri` };
  }

  for (const tabella of TABELLE_RECENSIONI) {
    const { data: trovata, error: erroreLettura } = await admin
      .from(tabella).select('id, user_id, photo_urls').eq('id', s.oggetto_id).maybeSingle();
    if (erroreLettura) return { ferma: NON_VERIFICATO };
    if (!trovata) continue;
    const r = trovata as { user_id?: string | null; photo_urls?: unknown };
    const { data: tolte, error: erroreTolta } = await admin.from(tabella).delete().eq('id', s.oggetto_id).select('id');
    if (erroreTolta || !tolte || tolte.length === 0) {
      logger.error(new Error('[segnalazioni] recensione accolta non tolta'), { segnalazione: id, tabella, err: erroreTolta?.message });
      return { ferma: NON_TOLTA };
    }

    const percorsi = (Array.isArray(r.photo_urls) ? r.photo_urls : [])
      .map(percorsoFotoRecensione)
      .filter((p): p is string => p !== null);
    if (percorsi.length > 0) {
      try {
        const { error: erroreFoto } = await admin.storage.from(SECCHIO_FOTO_RECENSIONI).remove(percorsi);
        if (erroreFoto) throw new Error(erroreFoto.message);
      } catch (e) {
        logger.error(new Error('[segnalazioni] foto della recensione tolta rimaste nel secchio'), {
          segnalazione: id, foto: percorsi.length, err: e instanceof Error ? e.message : String(e),
        });
      }
    }

    let autore: Canale = 'nessun_recapito';
    if (r.user_id) {
      try {
        const { error: erroreAvviso } = await admin.from('notifications').insert(avvisoDiServizio({
          user_id: r.user_id,
          title: 'Abbiamo tolto una tua recensione',
          body: `Dopo una segnalazione abbiamo tolto una tua recensione. Motivazione: ${motivazione}\n\n${COME_CONTESTARE}`,
          link: '/terms#segnalazioni',
        }));
        autore = erroreAvviso ? 'fallita' : 'inviata';
      } catch {
        autore = 'fallita';
      }
      if (autore === 'fallita') {
        logger.error(new Error('[segnalazioni] avviso a chi ha scritto la recensione tolta non partito'), { segnalazione: id });
      }
    }
    return { ferma: null, autore };
  }

  // Non c'è più in nessuna delle due tabelle: vale come tolta solo con la traccia della cancellazione.
  try {
    const { data: tracce, error: erroreTracce } = await admin
      .from('activity_events').select('id').eq('target_id', s.oggetto_id).eq('action', 'delete');
    if (erroreTracce) return { ferma: NON_VERIFICATO };
    if (Array.isArray(tracce) && tracce.length > 0) return { ferma: null, autore: 'non_previsto' };
  } catch {
    return { ferma: NON_VERIFICATO };
  }
  return { ferma: 'La recensione segnalata non si trova e non risulta tolta: l\'esito «rimosso» non può partire.' };
}

export const PATCH = withAdminAuth(async ({ req }) => {
  let corpo;
  try {
    corpo = CorpoEsito.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }
  const admin = getAdminSupabase();
  const recensione = await togliRecensioneAccolta(admin, corpo.id);
  if (recensione.ferma) return ApiErrors.conflict(recensione.ferma);
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
  // R18-003 — L'avviso a chi ha scritto la recensione tolta conta come gli altri canali.
  const autore = recensione.autore;
  const fallito = [segnalanteEmail, segnalanteNotifica, venditore, autore].includes('fallita');
  if (fallito) logger.error('Esito della segnalazione non comunicato a tutti', { id: corpo.id, segnalanteEmail, segnalanteNotifica, venditore, autore });
  return NextResponse.json(
    { ok: !fallito, segnalanteEmail, segnalanteNotifica, venditore, ...(autore !== 'non_previsto' ? { autore } : {}) },
    { status: fallito ? 502 : 200 },
  );
});
