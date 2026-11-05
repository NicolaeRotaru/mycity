import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { notaDegliEsclusi } from '@/lib/ordini/recesso';

/**
 * S06 · 2577 — Nel reso misto la nota sui prodotti esclusi non si legge come
 * «Nota del cliente», e l'importo non parte col totale.
 */
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@tanstack/react-query', () => ({ useMutation: () => ({ mutate: vi.fn(), isPending: false }) }));
const { default: ReturnRequestCard, separaNotaDelReso } = await import('@/components/seller/ReturnRequestCard');

const notaRotta = notaDegliEsclusi('CHANGED_MIND', [
  { name: 'Torta', non_recedibile: true }, { name: 'Miele', non_recedibile: false },
] as never)!;
const reso = (notes: string | null) => ({
  id: 'r1', status: 'REQUESTED', reason: 'CHANGED_MIND', notes, photo_urls: [], refund_amount_cents: null,
  decision_notes: null, created_at: '2026-11-05T10:00:00Z', order_item_id: null, decided_at: null,
});

describe('2577 — reso misto', () => {
  it('la nota della rotta è riconosciuta', () => {
    expect(notaRotta).toBeTruthy();
    expect(separaNotaDelReso(`Non mi piace\n\n${notaRotta}`)).toEqual({ cliente: 'Non mi piace', esclusi: notaRotta });
  });
  it('la card non la mette sotto «Nota del cliente» e non propone il totale', () => {
    const html = renderToStaticMarkup(<ReturnRequestCard ret={reso(notaRotta) as never} orderTotal={41.4} onDecided={() => {}} />);
    expect(html).not.toContain('Nota del cliente');
    expect(html).toContain('Da sapere');
    expect(html).not.toContain('value="41.40"');
  });
  it('senza esclusi il totale resta proposto', () => {
    const html = renderToStaticMarkup(<ReturnRequestCard ret={reso('Rotto') as never} orderTotal={41.4} onDecided={() => {}} />);
    expect(html).toContain('value="41.40"');
    expect(html).toContain('Nota del cliente');
  });
});
