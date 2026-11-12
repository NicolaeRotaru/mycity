import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { riepilogoNegozio, riepilogoContanti, type OrdineNegozio } from '@/lib/guadagni/negozio';

/**
 * R11-004 — IL BONIFICO DEL LUNEDÌ AL NEGOZIO SI PUÒ SEGNARE.
 *
 * Al lancio i contanti li versa Nicola a mano ogni lunedì. Prima nessuno stato
 * registrava quel bonifico: l'ordine restava HELD, il negozio leggeva «0,00 €
 * già versati» e l'«in arrivo» cresceva ogni settimana. Ora la migrazione 350
 * porta l'ordine a PAID_MANUALLY, e la pagina Guadagni lo conta come versato.
 */

const contanti = (payout_status: string, netto = 1800): OrdineNegozio => ({
  total_price: 20,
  payment_method: 'cod',
  payout_status,
  seller_payout_cents: netto,
  seller_payout_reversed_cents: 0,
  refunded_amount_cents: 0,
  application_fee_cents: 200,
});

describe('R11-004 — il bonifico a mano conta come versato', () => {
  it('un ordine pagato a mano è fra i versati, non fra quelli in arrivo', () => {
    const r = riepilogoNegozio([contanti('PAID_MANUALLY'), contanti('HELD', 1000)]);
    expect(r.versatiCents, 'il negozio ha i soldi in banca e il sito dice 0,00 € già versati').toBe(1800);
    expect(r.inArrivoCents).toBe(1000);
  });

  it('il riquadro dei contanti dice «già versato» anche per il bonifico a mano', () => {
    const r = riepilogoContanti([contanti('PAID_MANUALLY')], () => true);
    expect(r.giaVersatoCents).toBe(1800);
  });

  it('la migrazione 350 ammette lo stato e lo scrive solo un amministratore, solo su contanti HELD di quel negozio', () => {
    const sql = readFileSync(join(process.cwd(), 'migrations/350_il_bonifico_del_lunedi_si_segna.sql'), 'utf8');
    expect(sql).toMatch(/'PAID_MANUALLY'\s*\)\);/);
    expect(sql).toMatch(/IF NOT public\.is_admin\(\) THEN/);
    expect(sql).toMatch(/seller_id = p_seller/);
    expect(sql).toMatch(/payment_method = 'cod'/);
    expect(sql).toMatch(/payout_status = 'HELD'/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.segna_bonifico_manuale\(uuid, uuid\[\], text\) FROM PUBLIC, anon/);
  });
});
