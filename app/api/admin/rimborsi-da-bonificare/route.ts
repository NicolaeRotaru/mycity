import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { writeAudit } from '@/lib/audit';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { conRipiegoSchema, senzaColonne } from '@/lib/db/migrazione-124';
import { colonnaNonTrovata, scriviAncheSeMancaUnaColonnaNuova } from '@/lib/db/migrazione-148';
import { COLONNE_162 } from '@/lib/rimborsi/scelta-del-cliente';
import { ibanValido, normalizzaIban } from '@/lib/rimborsi/scelta-del-cliente';
import {
  bonificiDeiResiDagliOrdini,
  cifraDelBonificoDelReso,
  letturaDeiDaFareTagliata,
  notaPerIlRegistro,
  registrazioneMancanteDelBonifico,
  resoDelSegno,
  tabellaDeiBonificiMancante,
  TETTO_DEI_BONIFICI_DA_FARE,
  TETTO_DEI_BONIFICI_FATTI,
  vociDeiBonificiDaFare,
  type OrdineDelBonifico,
  type RigaDelBonificoDelReclamo,
  type RigaDelResoLetta,
} from '@/lib/rimborsi/bonifici-da-fare';
import { rimborsiGiaScritti } from '@/lib/stripe/elenco-dei-rimborsi';
import { IBAN_DEL_RECLAMO_CANCELLATO, IBAN_DEL_RESO_CANCELLATO } from '@/lib/rimborsi/iban-del-rimborso';

export const runtime = 'nodejs';

/**
 * I BONIFICI DI RIMBORSO DA FARE (R71).
 *
 * Il rimborso di un reso pagato in contanti va col bonifico, salvo che il
 * cliente abbia scelto il credito MyCity. Il bonifico lo fa a mano chi
 * amministra: questa rotta gli da' la lista — con l'IBAN, che e' un dato
 * personale e per questo non lo legge nessun browser direttamente (migrazione
 * 162) — e il comando per segnarne uno come fatto.
 *
 * Collaudo del 15/10 — anche i bonifici dei reclami (`bonifici_dei_reclami`,
 * 162): prima la lista leggeva solo i resi, e il bonifico promesso dopo un
 * reclamo viveva solo nell'avviso della campanella.
 *
 * Solo amministratori. L'IBAN esce solo da qui.
 */
const COLONNE =
  'id, order_id, refund_amount_cents, refunded_at, refund_id, refund_iban, refund_intestatario, refund_bonifico_cents, refund_bonifico_fatto_at';
const COLONNE_DEI_RECLAMI = 'dispute_id, order_id, importo_cents, registrato_at, fatto_at, iban, intestatario';

/** Quanti resi si chiedono per volta: l'elenco degli id viaggia nell'indirizzo della richiesta. */
const RESI_PER_LETTURA = 100;
/** Quanti ordini per pagina: lo stesso numero di righe che il database da' al massimo per volta. */
const ORDINI_PER_PAGINA = 1000;

/**
 * Riesame del 16/10, sesto giro — GLI ORDINI COL SEGNO DI UN BONIFICO, TUTTI.
 *
 * Il segno `bonifico:<centesimi>:<chiave>` nell'elenco dei rimborsi dell'ordine lo scrive solo il
 * server (`refundOrder`): e' da li' che nascono le voci dei resi. Si leggono tutti, a pagine, senza
 * tetto: nessuno da fuori puo' aggiungerne, quindi una pagina in piu' e' un bonifico vero in piu'.
 */
async function ordiniColBonifico(
  admin: ReturnType<typeof getAdminSupabase>,
): Promise<{ ordini: OrdineDelBonifico[]; errore: string | null }> {
  const ordini: OrdineDelBonifico[] = [];
  for (let da = 0; ; da += ORDINI_PER_PAGINA) {
    const { data, error } = await admin
      .from('orders')
      .select('id, stripe_refund_id')
      .like('stripe_refund_id', '%bonifico:%')
      .order('id', { ascending: true })
      .range(da, da + ORDINI_PER_PAGINA - 1);
    if (error) return { ordini: [], errore: error.message };
    const pagina = (data ?? []) as unknown as OrdineDelBonifico[];
    ordini.push(...pagina);
    if (pagina.length < ORDINI_PER_PAGINA) return { ordini, errore: null };
  }
}

/** I resi nominati dai segni: per l'IBAN, il nome e il «fatto». Senza la 162 quelle colonne non ci sono. */
async function resiDeiSegni(
  admin: ReturnType<typeof getAdminSupabase>,
  ids: readonly string[],
): Promise<{ resi: RigaDelResoLetta[]; con162: boolean; errore: string | null }> {
  const resi: RigaDelResoLetta[] = [];
  let con162 = true;
  for (let i = 0; i < ids.length; i += RESI_PER_LETTURA) {
    const gruppo = ids.slice(i, i + RESI_PER_LETTURA);
    const leggi = (colonne: string) => admin.from('returns').select(colonne).in('id', gruppo);
    const lettura = await conRipiegoSchema(
      'returns.select (bonifici da fare)',
      () => leggi(COLONNE),
      () => {
        con162 = false;
        return leggi(senzaColonne(COLONNE, COLONNE_162));
      },
    );
    if (lettura.error) return { resi: [], con162, errore: (lettura.error as { message?: string }).message ?? 'lettura caduta' };
    resi.push(...((lettura.data ?? []) as unknown as RigaDelResoLetta[]));
  }
  return { resi, con162, errore: null };
}

async function elenco(): Promise<NextResponse> {
  const admin = getAdminSupabase();

  // ① I bonifici dei resi: dai segni sugli ordini, poi le righe dei resi che nominano.
  const { ordini, errore: erroreOrdini } = await ordiniColBonifico(admin);
  if (erroreOrdini) {
    logger.error('[bonifici da fare] ordini col bonifico non letti', { message: erroreOrdini });
    return ApiErrors.internal('Non riesco a leggere i bonifici da fare');
  }
  const idResi = [
    ...new Set(ordini.flatMap((o) => [...rimborsiGiaScritti(o)].map(resoDelSegno)).filter((id): id is string => !!id)),
  ];
  const letti = await resiDeiSegni(admin, idResi);
  if (letti.errore) {
    logger.error('[bonifici da fare] resi dei bonifici non letti', { message: letti.errore });
    return ApiErrors.internal('Non riesco a leggere i bonifici da fare');
  }
  let con162 = letti.con162;
  // Senza la 162 non c'e' la colonna del «fatto»: ogni bonifico conta come da fare.
  const righe = bonificiDeiResiDagliOrdini(ordini, letti.resi, TETTO_DEI_BONIFICI_FATTI);
  let tagliata = false;

  // I bonifici dei reclami: senza la 162 la tabella non c'e', e quei bonifici
  // restano solo negli avvisi (la pagina lo dice).
  let reclami: RigaDelBonificoDelReclamo[] = [];
  const reclamiDaFare = await admin
    .from('bonifici_dei_reclami')
    .select(COLONNE_DEI_RECLAMI)
    .is('fatto_at', null)
    .order('registrato_at', { ascending: false })
    .limit(TETTO_DEI_BONIFICI_DA_FARE);
  if (reclamiDaFare.error) {
    if (tabellaDeiBonificiMancante(reclamiDaFare.error)) {
      con162 = false;
    } else {
      logger.error('[bonifici da fare] lettura dei reclami fallita', { message: reclamiDaFare.error.message });
      return ApiErrors.internal('Non riesco a leggere i bonifici dei reclami');
    }
  } else {
    reclami = (reclamiDaFare.data ?? []) as unknown as RigaDelBonificoDelReclamo[];
    tagliata = tagliata || letturaDeiDaFareTagliata(reclami.length);
    const reclamiFatti = await admin
      .from('bonifici_dei_reclami')
      .select(COLONNE_DEI_RECLAMI)
      .not('fatto_at', 'is', null)
      .order('fatto_at', { ascending: false })
      .limit(TETTO_DEI_BONIFICI_FATTI);
    if (reclamiFatti.error) {
      logger.warn('[bonifici da fare] storico dei reclami pagati non letto', { message: reclamiFatti.error.message });
    } else {
      reclami = [...reclami, ...((reclamiFatti.data ?? []) as unknown as RigaDelBonificoDelReclamo[])];
    }
  }

  return NextResponse.json({ voci: vociDeiBonificiDaFare(righe, reclami), migrazione162: con162, tagliata }, { status: 200 });
}

/**
 * Due comandi, sulla stessa voce: «fatto» (il bonifico e' partito) e «iban»
 * (chi paga copia l'IBAN che il cliente ha mandato dai Contatti). Una voce e'
 * il reso o il reclamo da cui viene: uno dei due.
 */
const Body = z
  .object({
    resoId: z.string().uuid().optional(),
    reclamoId: z.string().uuid().optional(),
    azione: z.enum(['fatto', 'iban']).default('fatto'),
    iban: z.string().max(64).optional(),
  })
  .refine((b) => !!b.resoId !== !!b.reclamoId, { message: 'Indica il reso oppure il reclamo' });

type Comando = z.infer<typeof Body>;

/**
 * Riesame del 16/10 — FATTO IL BONIFICO, L'IBAN SE NE VA.
 *
 * L'IBAN serve solo a pagare: scritto il «fatto», si cancella insieme al nome
 * dell'intestatario (se il cliente aveva gia' chiuso l'account). La 162 non
 * accetta un «fatto» con l'IBAN ancora scritto: le due cose vanno insieme o
 * non va nessuna (lib/rimborsi/iban-del-rimborso.ts).
 */
async function segnaFatto(body: Comando) {
  const admin = getAdminSupabase();
  const adesso = new Date().toISOString();
  return body.reclamoId
    ? admin
        .from('bonifici_dei_reclami')
        .update({ fatto_at: adesso, ...IBAN_DEL_RECLAMO_CANCELLATO })
        .eq('dispute_id', body.reclamoId)
        .is('fatto_at', null)
        .select('dispute_id')
    : admin
        .from('returns')
        .update({ refund_bonifico_fatto_at: adesso, ...IBAN_DEL_RESO_CANCELLATO })
        .eq('id', body.resoId as string)
        .eq('status', 'REFUNDED')
        .like('refund_id', 'bonifico:%')
        .is('refund_bonifico_fatto_at', null)
        .select('id');
}

/**
 * Riesame del 16/10 — L'IBAN DI UN RECLAMO HA UN POSTO.
 *
 * Il modulo del reclamo non chiede l'IBAN, e un reso puo' arrivare senza: in
 * tutti e due i casi l'email al cliente gli chiede di mandarlo dai Contatti.
 * Chi paga lo copia qui, sulla voce: cosi' vale anche per lui la regola di
 * sempre — resta finche' il bonifico e' da fare, se ne va col «fatto», e se il
 * cliente chiude l'account prima del pagamento resta con il suo nome.
 */
async function registraIban(body: Comando, iban: string) {
  const admin = getAdminSupabase();
  // Riesame del 16/10, sesto giro — SOLO DOVE L'IBAN MANCA. La pagina mostra il campo solo li', ma
  // la rotta accettava anche sopra l'IBAN scritto dal cliente: un conto si sostituiva senza che il
  // registro dicesse quale c'era prima. Adesso un IBAN scritto non si sovrascrive da qui.
  return body.reclamoId
    ? admin
        .from('bonifici_dei_reclami')
        .update({ iban })
        .eq('dispute_id', body.reclamoId)
        .is('fatto_at', null)
        .is('iban', null)
        .select('dispute_id')
    : admin
        .from('returns')
        .update({ refund_method: 'BONIFICO', refund_iban: iban })
        .eq('id', body.resoId as string)
        .eq('status', 'REFUNDED')
        .like('refund_id', 'bonifico:%')
        .is('refund_bonifico_fatto_at', null)
        .is('refund_iban', null)
        .select('id');
}

/**
 * Riesame del 16/10, sesto giro — SU QUALE CONTO, E QUANTO. Col «fatto» l'IBAN si cancella: si
 * legge prima, per lasciare nel registro le sue ultime quattro cifre e la cifra pagata.
 */
async function quelloCheSiPaga(
  body: Comando,
): Promise<{ pagato: { iban: string | null; cifraCents: number | null }; error: { code?: string; message: string } | null }> {
  const admin = getAdminSupabase();
  if (body.reclamoId) {
    const { data, error } = await admin
      .from('bonifici_dei_reclami')
      .select('iban, importo_cents')
      .eq('dispute_id', body.reclamoId)
      .maybeSingle();
    const riga = data as { iban?: string | null; importo_cents?: number | null } | null;
    return { pagato: { iban: riga?.iban ?? null, cifraCents: riga?.importo_cents ?? null }, error };
  }
  const { data, error } = await admin
    .from('returns')
    .select('refund_iban, refund_bonifico_cents, refund_id')
    .eq('id', body.resoId as string)
    .maybeSingle();
  const riga = data as { refund_iban?: string | null; refund_bonifico_cents?: number | null; refund_id?: string | null } | null;
  return {
    pagato: {
      iban: riga?.refund_iban ?? null,
      cifraCents: riga ? cifraDelBonificoDelReso({ refund_bonifico_cents: riga.refund_bonifico_cents, refund_id: riga.refund_id ?? null }) : null,
    },
    error,
  };
}

/**
 * Riesame del 16/10, quarto giro — IL RIMBORSO RIMASTO SOLO SULL'ORDINE SI REGISTRA SUL RESO.
 *
 * La voce di un bonifico la cui scrittura sul reso era caduta viene dall'ordine (vedi `elenco`).
 * Prima di segnarla «fatto», o di scriverci l'IBAN, si scrive sul reso quello che `decide` o
 * `avanza` non erano riusciti a scrivere: rimborsato, col segno e la cifra del bonifico — presi
 * dall'ordine, che scrive solo il server. Su un reso che il segno ce l'ha gia' non fa niente.
 * Restituisce il messaggio del guasto, o `null`.
 */
async function registraIlRimborsoRimastoSullOrdine(resoId: string): Promise<string | null> {
  const admin = getAdminSupabase();
  const { data: reso, error } = await admin
    .from('returns')
    .select('id, order_id, status, refund_id')
    .eq('id', resoId)
    .maybeSingle();
  if (error) return error.message;
  const r = reso as { id: string; order_id: string; status: string | null; refund_id: string | null } | null;
  if (!r || r.refund_id) return null;
  const { data: ordine, error: errOrdine } = await admin
    .from('orders')
    .select('id, stripe_refund_id')
    .eq('id', r.order_id)
    .maybeSingle();
  if (errOrdine) return errOrdine.message;
  const mancante = registrazioneMancanteDelBonifico(r, ordine as OrdineDelBonifico | null);
  if (!mancante) return null;
  const scrittura = await scriviAncheSeMancaUnaColonnaNuova(
    'returns.update (rimborso rimasto sull ordine)',
    { ...mancante, refunded_at: new Date().toISOString() },
    COLONNE_162,
    (campi) =>
      admin.from('returns').update(campi).eq('id', resoId).is('refund_id', null).eq('status', String(r.status)),
  );
  if (scrittura.avviso) logger.warn(`[bonifici da fare] ${scrittura.avviso}`);
  return scrittura.riuscita ? null : (scrittura.avviso ?? 'scrittura non riuscita');
}

async function comando(req: NextRequest, user: { id: string }): Promise<NextResponse> {
  let body: Comando;
  try {
    body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }

  let iban = '';
  if (body.azione === 'iban') {
    iban = normalizzaIban(body.iban ?? '');
    if (!ibanValido(iban)) {
      return ApiErrors.invalidRequest(
        "Questo IBAN non torna: controlla lettere e cifre. Un IBAN italiano comincia con IT e ha 27 caratteri.",
      );
    }
  }

  if (body.resoId) {
    const mancata = await registraIlRimborsoRimastoSullOrdine(body.resoId);
    if (mancata) {
      logger.error('[bonifici da fare] rimborso rimasto sull ordine non registrato sul reso', {
        resoId: body.resoId, message: mancata,
      });
      return ApiErrors.internal('Non riesco a registrare il rimborso sul reso: riprova tra poco.');
    }
  }

  const prima = body.azione === 'fatto' ? await quelloCheSiPaga(body) : null;
  const { data, error } = prima?.error
    ? { data: null, error: prima.error }
    : body.azione === 'iban'
      ? await registraIban(body, iban)
      : await segnaFatto(body);

  if (error) {
    if (colonnaNonTrovata(error) || tabellaDeiBonificiMancante(error)) {
      return ApiErrors.conflict(
        body.azione === 'iban'
          ? 'Per salvare l’IBAN serve la migrazione 162 sul database: finché non c’è, tienilo a parte.'
          : 'Per segnare i bonifici fatti serve la migrazione 162 sul database: finché non c’è, tieni il conto a parte.',
      );
    }
    logger.error('[bonifici da fare] voce non aggiornata', {
      resoId: body.resoId, reclamoId: body.reclamoId, azione: body.azione, message: error.message,
    });
    return ApiErrors.internal(
      body.azione === 'iban' ? "Non riesco a salvare l'IBAN" : 'Non riesco a segnare il bonifico come fatto',
    );
  }
  if (!data || data.length === 0) {
    return ApiErrors.conflict(
      body.azione === 'iban'
        ? 'Qui l’IBAN si scrive solo su un bonifico da fare che non ce l’ha ancora: ricarica la pagina.'
        : 'Questo bonifico è già segnato come fatto, oppure non è un rimborso da bonificare.',
    );
  }

  // Chi ha segnato il bonifico, o copiato l'IBAN, resta scritto: sono soldi che escono a mano.
  // Quinto giro del riesame: copiare un IBAN non rimborsa niente, e ha la sua voce nel registro.
  // Sesto giro: con le ultime quattro cifre del conto e, col «fatto», la cifra pagata.
  await writeAudit({
    actorId: user.id,
    action: body.azione === 'iban' ? 'refund.iban_registrato' : 'order.refund',
    targetTable: body.reclamoId ? 'disputes' : 'returns',
    targetId: (body.reclamoId ?? body.resoId) as string,
    metadata: notaPerIlRegistro(body.azione, body.azione === 'iban' ? { iban } : (prima?.pagato ?? { iban: null })),
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

export const GET = withAdminAuth(() => elenco());
export const POST = withAdminAuth(({ req, user }) => comando(req, user));
