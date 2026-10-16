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
  bonificiRimastiSoloSullOrdine,
  letturaDeiDaFareTagliata,
  registrazioneMancanteDelBonifico,
  smistaLeVoci,
  STATI_DEL_RESO_COL_RIMBORSO_FORSE_PARTITO,
  tabellaDeiBonificiMancante,
  TETTO_DEI_BONIFICI_DA_FARE,
  TETTO_DEI_BONIFICI_FATTI,
  vociDeiBonificiDaFare,
  type OrdineDelBonifico,
  type ResoSenzaSegno,
  type RigaDelBonificoDelReclamo,
  type RigaDelReso,
} from '@/lib/rimborsi/bonifici-da-fare';
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
/** I resi senza il segno del rimborso: servono anche lo stato e l'id del rimborso (vuoto). */
const COLONNE_SENZA_SEGNO = `${COLONNE}, status`;

/** Quanti ordini si chiedono per volta: l'elenco degli id viaggia nell'indirizzo della richiesta. */
const ORDINI_PER_LETTURA = 100;

/**
 * Riesame del 16/10, terzo giro — GLI ORDINI DEI RESI, PER CONFERMARE I BONIFICI.
 *
 * La riga del reso, in produzione senza la 153, la puo' scrivere anche il
 * cliente: un bonifico e' confermato solo se il suo segno sta nell'elenco dei
 * rimborsi dell'ordine, che scrive solo il server
 * (`bonificoRegistratoSullOrdine` in lib/rimborsi/bonifici-da-fare.ts).
 */
async function ordiniDeiResi(
  admin: ReturnType<typeof getAdminSupabase>,
  idOrdini: readonly string[],
): Promise<{ ordini: OrdineDelBonifico[]; errore: string | null }> {
  const unici = [...new Set(idOrdini.filter(Boolean))];
  const ordini: OrdineDelBonifico[] = [];
  for (let i = 0; i < unici.length; i += ORDINI_PER_LETTURA) {
    const { data, error } = await admin
      .from('orders')
      .select('id, stripe_refund_id')
      .in('id', unici.slice(i, i + ORDINI_PER_LETTURA));
    if (error) return { ordini: [], errore: error.message };
    ordini.push(...((data ?? []) as unknown as OrdineDelBonifico[]));
  }
  return { ordini, errore: null };
}

/**
 * Riesame del 16/10 — DUE LETTURE, NON UNA FINESTRA SOLA.
 *
 * Prima si leggevano gli ultimi 200 rimborsi col bonifico, fatti compresi:
 * con 200 bonifici gia' pagati registrati dopo, un bonifico ancora da fare
 * usciva dalla finestra e non lo vedeva piu' nessuno, mentre l'ordine diceva
 * gia' «rimborsato». Adesso i bonifici DA FARE si leggono a parte, fino a un
 * tetto alto (e se lo si tocca la pagina lo dice); di quelli fatti si mostrano
 * solo gli ultimi, come storico.
 */
async function elenco(): Promise<NextResponse> {
  const admin = getAdminSupabase();
  let con162 = true;
  const resiColBonifico = (colonne: string) =>
    admin.from('returns').select(colonne).eq('status', 'REFUNDED').like('refund_id', 'bonifico:%');

  const daFare = await conRipiegoSchema(
    'returns.select (bonifici da fare)',
    () =>
      resiColBonifico(COLONNE)
        .is('refund_bonifico_fatto_at', null)
        .order('refunded_at', { ascending: false })
        .limit(TETTO_DEI_BONIFICI_DA_FARE),
    () => {
      // Senza la 162 la lista c'e' lo stesso, senza IBAN e senza «fatto»: e
      // senza la colonna del «fatto», ogni bonifico conta come da fare.
      con162 = false;
      return resiColBonifico(senzaColonne(COLONNE, COLONNE_162))
        .order('refunded_at', { ascending: false })
        .limit(TETTO_DEI_BONIFICI_DA_FARE);
    },
  );
  if (daFare.error) {
    logger.error('[bonifici da fare] lettura fallita', { message: (daFare.error as { message?: string }).message });
    return ApiErrors.internal('Non riesco a leggere i bonifici da fare');
  }
  const righeDaFare = (daFare.data ?? []) as unknown as RigaDelReso[];
  let tagliata = letturaDeiDaFareTagliata(righeDaFare.length);

  let righeFatte: RigaDelReso[] = [];
  if (con162) {
    const fatti = await resiColBonifico(COLONNE)
      .not('refund_bonifico_fatto_at', 'is', null)
      .order('refund_bonifico_fatto_at', { ascending: false })
      .limit(TETTO_DEI_BONIFICI_FATTI);
    // Lo storico e' un di piu': se non si legge, la lista dei da fare resta intera.
    if (fatti.error) {
      logger.warn('[bonifici da fare] storico dei bonifici fatti non letto', { message: fatti.error.message });
    } else {
      righeFatte = (fatti.data ?? []) as unknown as RigaDelReso[];
    }
  }

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

  // Riesame del 16/10, quarto giro — i resi SENZA segno, dove il rimborso puo' essere partito: se
  // la scrittura dell'esito sul reso era caduta, il bonifico sta solo sull'ordine. Si leggono qui e
  // si confrontano con l'elenco dei rimborsi dell'ordine (`bonificiRimastiSoloSullOrdine`).
  const resiSenzaSegno = (colonne: string) =>
    admin
      .from('returns')
      .select(colonne)
      .is('refund_id', null)
      .in('status', [...STATI_DEL_RESO_COL_RIMBORSO_FORSE_PARTITO])
      .limit(TETTO_DEI_BONIFICI_DA_FARE);
  const senzaSegno = await conRipiegoSchema(
    'returns.select (bonifici rimasti sull ordine)',
    () => resiSenzaSegno(COLONNE_SENZA_SEGNO),
    () => resiSenzaSegno(senzaColonne(COLONNE_SENZA_SEGNO, COLONNE_162)),
  );
  if (senzaSegno.error) {
    logger.error('[bonifici da fare] resi senza segno non letti', {
      message: (senzaSegno.error as { message?: string }).message,
    });
    return ApiErrors.internal('Non riesco a leggere i bonifici da fare');
  }
  const righeSenzaSegno = (senzaSegno.data ?? []) as unknown as ResoSenzaSegno[];
  tagliata = tagliata || letturaDeiDaFareTagliata(righeSenzaSegno.length);

  const conSegno = [...righeDaFare, ...righeFatte];
  const { ordini, errore: erroreOrdini } = await ordiniDeiResi(
    admin,
    [...conSegno, ...righeSenzaSegno].map((r) => r.order_id),
  );
  if (erroreOrdini) {
    logger.error('[bonifici da fare] ordini dei resi non letti', { message: erroreOrdini });
    return ApiErrors.internal('Non riesco a controllare i bonifici sugli ordini');
  }
  const righe = [...conSegno, ...bonificiRimastiSoloSullOrdine(righeSenzaSegno, ordini)];

  // Fra i bonifici da pagare solo quelli che l'ordine conferma; gli altri a parte, da controllare.
  const { daPagare, daControllare } = smistaLeVoci(vociDeiBonificiDaFare(righe, reclami, ordini));
  return NextResponse.json({ voci: daPagare, daControllare, migrazione162: con162, tagliata }, { status: 200 });
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
  return body.reclamoId
    ? admin
        .from('bonifici_dei_reclami')
        .update({ iban })
        .eq('dispute_id', body.reclamoId)
        .is('fatto_at', null)
        .select('dispute_id')
    : admin
        .from('returns')
        .update({ refund_method: 'BONIFICO', refund_iban: iban })
        .eq('id', body.resoId as string)
        .eq('status', 'REFUNDED')
        .like('refund_id', 'bonifico:%')
        .is('refund_bonifico_fatto_at', null)
        .select('id');
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

  const { data, error } = body.azione === 'iban' ? await registraIban(body, iban) : await segnaFatto(body);

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
    return ApiErrors.conflict('Questo bonifico è già segnato come fatto, oppure non è un rimborso da bonificare.');
  }

  // Chi ha segnato il bonifico, o copiato l'IBAN, resta scritto: sono soldi che escono a mano.
  await writeAudit({
    actorId: user.id,
    action: 'order.refund',
    targetTable: body.reclamoId ? 'disputes' : 'returns',
    targetId: (body.reclamoId ?? body.resoId) as string,
    metadata: { passo: body.azione === 'iban' ? 'iban_del_bonifico_registrato' : 'bonifico_di_rimborso_fatto' },
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

export const GET = withAdminAuth(() => elenco());
export const POST = withAdminAuth(({ req, user }) => comando(req, user));
