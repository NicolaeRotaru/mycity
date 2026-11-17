/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * R01-003 — Il modulo prodotto passa alle regole comuni delle proposte dell'assistente
 * (`pianoPatchPerIlModulo`) i due campi aggiunti con R04-020: `haVarianti` e `attributiAttuali`.
 *
 * Senza, nel modulo le due regole non valevano: con le varianti la disponibilità proposta si
 * scriveva e la chat diceva «aggiornata» (al salvataggio la somma delle varianti la sostituiva),
 * e «togli un attributo» che nella scheda non c'è contava come campo aggiornato.
 * La porta usata qui è il pulsante della voce (finto): riceve `onApplyPatch` come tutte le altre.
 * Banco del montaggio preso da minori-s06-modulo-prodotto-ai.test.tsx.
 */
const porta = vi.hoisted(() => ({ applica: null as null | ((p: Record<string, unknown>) => { cambiati: string[] }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }), getUser: async () => ({ data: { user: { id: 's1' } } }) } },
}));
vi.mock('@/components/seller/VoiceProductButton', () => ({
  default: (p: { onApplyPatch: typeof porta.applica }) => { porta.applica = p.onApplyPatch; return null; },
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CATEGORIE = [{ id: 'c1', name: 'Casa', slug: 'casa', parent_id: null }];

async function monta(extra: Record<string, unknown>) {
  const { default: ProductForm } = await import('@/components/seller/ProductForm');
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  porta.applica = null;
  await act(async () => {
    root.render(createElement(ProductForm, {
      mode: 'edit', categories: CATEGORIE, aiAccesa: true, sellerOffersExpress: true, consegnaDelNegozioNonLetta: false,
      onSubmit: () => {},
      initialValues: { name: 'Maglietta', description: 'Maglietta in cotone biologico tinta unita', price: 20, unit: 'pezzo', stock: 5,
        category_id: 'c1', images: ['https://x/1.jpg'], attributes: {}, tags: [], status: 'available', variants: [], ...extra },
    }));
  });
  expect(porta.applica, 'controprova: la porta dell\'assistente deve ricevere onApplyPatch').toBeTruthy();
  return root;
}

describe('R01-003 — le regole comuni delle proposte ricevono varianti e attributi del modulo', () => {
  it('con le varianti la disponibilità proposta non si scrive e non si dice «aggiornata»', async () => {
    const root = await monta({ variants: [{ id: 'v1', label: 'M', options: { taglia: 'M' }, stock: 3 }] });
    let esito: { cambiati: string[] } = { cambiati: [] };
    await act(async () => { esito = porta.applica!({ stock: 40 }); });
    expect(esito.cambiati, 'la disponibilità di un prodotto con varianti è la somma delle varianti').not.toContain('disponibilità');
    root.unmount();
  });

  it('senza varianti la disponibilità proposta si scrive ancora', async () => {
    const root = await monta({});
    let esito: { cambiati: string[] } = { cambiati: [] };
    await act(async () => { esito = porta.applica!({ stock: 40 }); });
    expect(esito.cambiati).toContain('disponibilità');
    root.unmount();
  });

  it('«togli» un attributo che la scheda non ha non conta come campo aggiornato; uno che c\'è sì', async () => {
    const root = await monta({ attributes: { colore: 'Rosso' } });
    let esito: { cambiati: string[] } = { cambiati: [] };
    await act(async () => { esito = porta.applica!({ attributes_remove: ['materiale'] }); });
    expect(esito.cambiati, 'togliere «materiale», che non c\'è, non cambia niente').toEqual([]);
    await act(async () => { esito = porta.applica!({ attributes_remove: ['colore'] }); });
    expect(esito.cambiati).toEqual(['rimosso colore']);
    root.unmount();
  });
});
