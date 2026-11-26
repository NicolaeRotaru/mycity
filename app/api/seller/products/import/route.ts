import { type NextRequest, type NextResponse } from 'next/server';
import { withSellerAnchePendingRateLimit, type ClientDiChiChiama } from '@/lib/api/middleware';
import { rateLimitAsync } from '@/lib/rate-limit';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { writeAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { CARICAMENTO_DA_FILE_ACCESO } from '@/lib/funzioni-al-lancio';
import { erroreDiSalvataggio } from '@/lib/products/prontoPerLaVendita';
import {
  erroriDellaRiga,
  MASSIMO_RIGHE_DAL_FILE,
  rigaPulita,
  statoDellaRiga,
  type CategoriaDelFile,
  type RigaDalFile,
} from '@/lib/products/righe-dal-file';

export const runtime = 'nodejs';

/**
 * POST /api/seller/products/import — IL CARICAMENTO DA FILE PASSA DA QUI (12/11/2026, R09-006).
 *
 * Prima la pagina scriveva i prodotti dal browser (`supabase.from('products').insert`):
 * l'interruttore `CARICAMENTO_DA_FILE_ACCESO` poteva solo nascondere la pagina, e lo stato
 * «in vendita» lo decideva il browser. Qui:
 *  ① con l'interruttore spento la rotta risponde no, qualunque cosa mandi il browser;
 *  ② ogni riga si ricontrolla (tipi, categoria vera) e lo stato lo decide la regola del modulo
 *    (`statoDellaRiga`): lo stato che arriva dal browser non conta. Il file non porta foto, quindi
 *    oggi ogni riga nasce bozza;
 *  ③ si scrive col client di chi chiama (le regole per riga del database valgono uguale) e
 *    nel registro delle azioni resta chi ha caricato e quanti prodotti.
 * Il freno vale per questa porta. Finché la regola di scrittura dei prodotti nel database resta
 * larga (voce R09-002), da sola non basta a impedire una scrittura dal browser.
 */
async function handler(req: NextRequest, user: { id: string }, db: ClientDiChiChiama): Promise<NextResponse> {
  if (!CARICAMENTO_DA_FILE_ACCESO) return ApiErrors.unavailable('Il caricamento da file non è ancora attivo.');

  let corpo: { righe?: unknown };
  try {
    corpo = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('JSON non valido');
  }
  const righe = Array.isArray(corpo.righe) ? (corpo.righe as Partial<RigaDalFile>[]) : [];
  if (righe.length === 0) return ApiErrors.invalidRequest('Nessuna riga da caricare.');
  if (righe.length > MASSIMO_RIGHE_DAL_FILE) {
    return ApiErrors.invalidRequest(`Al massimo ${MASSIMO_RIGHE_DAL_FILE} righe per caricamento.`);
  }
  const { data: categorie, error: erroreCategorie } = await db.from('categories').select('id, slug, parent_id, richiede_dichiarazioni_alimentari');
  if (erroreCategorie) {
    logger.error('[seller-products-import] categorie non lette', { userId: user.id, message: erroreCategorie.message });
    return ApiErrors.internal('Non sono riuscito a leggere le categorie. Riprova.');
  }
  const elenco = (categorie ?? []) as CategoriaDelFile[];
  const sbagliata = righe.findIndex((r) => erroriDellaRiga(r, elenco).length > 0);
  if (sbagliata >= 0) {
    return ApiErrors.invalidRequest(`Riga ${sbagliata + 1}: ${erroriDellaRiga(righe[sbagliata], elenco).join(', ')}.`);
  }

  let bozze = 0;
  const perMotivo: Record<string, number> = {};
  const daScrivere = righe.map((r) => {
    const pulita = rigaPulita(r as RigaDalFile);
    const { status, mancanti } = statoDellaRiga(pulita, elenco);
    if (status === 'draft') {
      bozze++;
      for (const m of mancanti) perMotivo[m] = (perMotivo[m] ?? 0) + 1;
    }
    return { ...pulita, seller_id: user.id, status };
  });

  const { error } = await db.from('products').insert(daScrivere);
  if (error) {
    const esito = erroreDiSalvataggio(error as { code?: string | null; message?: string | null });
    if (esito.tipo === 'regola') return ApiErrors.invalidRequest(esito.messaggio);
    logger.error('[seller-products-import] caricamento fallito', { userId: user.id, code: error.code ?? null, message: error.message });
    return ApiErrors.internal(esito.messaggio);
  }

  await writeAudit({
    actorId: user.id,
    action: 'product.create',
    targetTable: 'products',
    metadata: { origine: 'caricamento-da-file', quanti: daScrivere.length, bozze },
  });
  return apiSuccess({ importati: daScrivere.length, bozze, perMotivo });
}

/**
 * 24/11/2026 (modalità demo, dal collaudo) — Il negozio in verifica carica i prodotti da file, ma non è
 * ancora stato verificato da nessuno: un tetto più basso (un caricamento al minuto) e al massimo
 * PRODOTTI_MAX_IN_VERIFICA prodotti finché lo staff non lo approva, perché un account appena iscritto
 * non riempia il catalogo di migliaia di righe.
 */
const PRODOTTI_MAX_IN_VERIFICA = 200;

export const POST = withSellerAnchePendingRateLimit(
  { name: 'seller-products-import', max: 10, windowMs: 60_000 },
  async ({ req, user, profile, supaUtente }) => {
    const approvato = (profile as { role?: string; is_approved?: boolean }).role === 'admin'
      || (profile as { is_approved?: boolean }).is_approved === true;
    if (!approvato) {
      const rl = await rateLimitAsync({ key: `seller-products-import-in-verifica:${user.id}`, max: 1, windowMs: 60_000 });
      if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);
      const { count, error } = await supaUtente.from('products').select('id', { count: 'exact', head: true }).eq('seller_id', user.id);
      if (error) return ApiErrors.unavailable('Non riesco a contare i tuoi prodotti. Riprova fra poco.');
      if ((count ?? 0) >= PRODOTTI_MAX_IN_VERIFICA) {
        return ApiErrors.conflict(`Finché il negozio è in verifica puoi preparare fino a ${PRODOTTI_MAX_IN_VERIFICA} prodotti. Gli altri li carichi appena è approvato.`);
      }
    }
    return handler(req, user, supaUtente);
  },
);
