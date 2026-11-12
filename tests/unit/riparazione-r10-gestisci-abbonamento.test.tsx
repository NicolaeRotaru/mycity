import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R10-021 — Con l'abbonamento dei negozi spento, un negozio con l'abbonamento
 * disdetto vedeva «Gestisci abbonamento», e il tasto rispondeva che
 * l'abbonamento non è attivo. Il bottone segue la regola della rotta del portale.
 */

vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<typeof import('@/lib/funzioni-al-lancio')>()),
  ABBONAMENTO_NEGOZI_ACCESO: false,
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));

const { default: GestisciAbbonamento } = await import('@/components/seller/GestisciAbbonamento');
const disegna = (stato: string | null) => renderToStaticMarkup(createElement(GestisciAbbonamento, { stato }));

describe('R10-021 — il bottone non promette un portale che non si apre', () => {
  it('abbonamento disdetto, funzione spenta: niente bottone', () => {
    expect(disegna('canceled')).toBe('');
  });
  it('abbonamento in ritardo di pagamento: il bottone c’è, per aggiornare la carta o disdire', () => {
    expect(disegna('past_due')).toMatch(/abbonamento/i);
  });
  it('abbonamento attivo: il bottone c’è', () => {
    expect(disegna('active')).not.toBe('');
  });
  it('mai attivato: niente bottone, come prima', () => {
    expect(disegna(null)).toBe('');
    expect(disegna('none')).toBe('');
  });
});
