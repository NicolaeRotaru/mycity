import { type NextRequest, type NextResponse } from 'next/server';
import { withSellerAuth, type ClientDiChiChiama } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { writeAudit } from '@/lib/audit';
import {
  salvaProdottoTracciato,
  colonneAmmesse,
  ProdottoNonTuo,
  type ClientDelCatalogo,
} from '@/lib/products/salvataggio-tracciato';

export const runtime = 'nodejs';

/**
 * PATCH /api/seller/products/:id — il venditore salva il suo prodotto.
 *
 * Perche' esiste una rotta per una cosa che il browser sapeva gia' fare da
 * solo: il browser puo' scrivere sul catalogo, ma NON puo' scrivere nel
 * registro delle azioni (`audit_logs` accetta solo il client amministrativo, e
 * deve restare cosi': un registro in cui chiunque puo' scrivere non e' un
 * registro). Finche' il salvataggio restava tutto nella pagina, di quella
 * modifica non restava traccia — ne' chi, ne' cosa c'era prima.
 *
 * Qui dentro non c'e' nessuna decisione: le prende tutte
 * `lib/products/salvataggio-tracciato`, che una prova puo' eseguire. Questa
 * rotta e' solo il filo che collega chi ha chiamato, il database e il registro.
 *
 * Sicurezza: il client e' quello di chi chiama (`supaUtente`), quindi le regole
 * per riga valgono come prima; sopra ci sono il controllo esplicito sul
 * proprietario e la lista chiusa delle colonne, che butta via `seller_id` e
 * qualunque campo non previsto.
 */
async function handler(
  req: NextRequest,
  user: { id: string },
  db: ClientDiChiChiama,
  prodottoId: string,
): Promise<NextResponse> {
  if (!prodottoId) return ApiErrors.invalidRequest('Prodotto mancante.');

  let corpo: { payload?: unknown; origine?: unknown; campiDallAi?: unknown };
  try {
    corpo = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('JSON non valido');
  }

  const payload = colonneAmmesse(corpo.payload);
  if (Object.keys(payload).length === 0) {
    return ApiErrors.invalidRequest('Nessuna modifica da salvare.');
  }
  const origine = typeof corpo.origine === 'string' && corpo.origine ? corpo.origine.slice(0, 60) : 'venditore';
  const campiDallAi = Array.isArray(corpo.campiDallAi)
    ? corpo.campiDallAi.filter((c): c is string => typeof c === 'string')
    : [];

  try {
    const esito = await salvaProdottoTracciato({
      db: db as unknown as ClientDelCatalogo,
      prodottoId,
      attoreId: user.id,
      payload,
      origine,
      campiDallAi,
      scriviTraccia: writeAudit,
    });
    return apiSuccess({ id: prodottoId, campi: esito.campi });
  } catch (errore) {
    if (errore instanceof ProdottoNonTuo) return ApiErrors.forbidden(errore.message);
    return ApiErrors.internal('Non sono riuscito a salvare. Riprova.');
  }
}

export const PATCH = withSellerAuth(({ req, user, supaUtente, params }) =>
  handler(req, user, supaUtente, String(params.id ?? '')),
);
