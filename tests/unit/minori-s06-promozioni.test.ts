import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { statoDellaPromo } from '@/app/seller/promotions/stato-promo';

/**
 * S06 — Le promozioni del negozio.
 * 356: cancellare chiede conferma, si disattiva durante l'invio, dice l'errore; lo
 *      storico scrive gli stati in italiano.
 * 235 (parte promozioni): le percentuali dicono quale è scelta e stanno sotto «Sconto».
 */
const src = readFileSync('app/seller/promotions/page.tsx', 'utf8');

describe('356 — cancellare una promo', () => {
  it('stati in italiano', () => {
    const adesso = new Date('2026-11-05T10:00:00Z');
    expect(statoDellaPromo({ status: 'cancelled', ends_at: '2026-11-10T00:00:00Z' }, adesso)).toBe('Annullata');
    expect(statoDellaPromo({ status: 'active', ends_at: '2026-11-01T00:00:00Z' }, adesso)).toBe('Scaduta');
    expect(statoDellaPromo({ status: 'active', ends_at: '2026-11-10T00:00:00Z' }, adesso)).toBe('Attiva');
  });
  it('conferma, attesa ed errore', () => {
    expect(src).not.toContain('onClick={() => cancel.mutate(p.id)}');
    expect(src).toMatch(/confirmDialog\(\{\s*title: 'Cancellare la promozione\?'/);
    expect(src).toContain('disabled={cancel.isPending}');
    const blocco = src.slice(src.indexOf('const cancel = useMutation'), src.indexOf('const chiediCancellazione'));
    expect(blocco).toContain('onError');
    expect(src).toContain('{statoDellaPromo(p)}');
  });
});

describe('235 — le percentuali dello sconto', () => {
  it('fieldset con legend e aria-pressed', () => {
    expect(src).toMatch(/<fieldset>\s*<legend[^>]*>Sconto<\/legend>/);
    expect(src).toContain('aria-pressed={percent === p}');
  });
});
