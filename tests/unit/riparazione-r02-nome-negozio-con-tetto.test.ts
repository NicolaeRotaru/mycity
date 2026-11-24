/**
 * @vitest-environment jsdom
 */
/**
 * R02-012 — Il nome del negozio ha un tetto di 80 caratteri: il modulo lo conta senza gli spazi in
 * testa e in coda, il database (migrazione 830) lo conta su quello che si salva. «Dettagli negozio»
 * deve quindi salvare il nome che il modulo ha contato: un nome di 80 caratteri con uno spazio in
 * coda passa il modulo, e salvato com'è (81) il database lo rifiuterebbe con un errore che non dice
 * niente al negoziante.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const scritto = vi.hoisted(() => ({ righe: [] as Array<Record<string, unknown>>, invia: null as null | ((d: unknown) => void) }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'negozio-1' } } }) },
    from: () => ({
      update: (riga: Record<string, unknown>) => {
        scritto.righe.push(riga);
        return { eq: async () => ({ error: null }) };
      },
    }),
  },
}));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined }),
}));
vi.mock('@/components/VendorForm', () => ({
  default: (props: { onSubmit: (d: unknown) => void }) => {
    scritto.invia = props.onSubmit;
    return null;
  },
}));

import StoreDetailsEditor from '@/components/seller/site/StoreDetailsEditor';

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  scritto.righe.length = 0;
  scritto.invia = null;
});

const profilo = {
  store_name: 'Forno', store_phone: null, store_address: null, store_lat: null, store_lng: null,
  store_logo: null, store_media: [], store_description: null, store_hours: {}, store_customization: null,
};

async function salva(storeName: string) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(StoreDetailsEditor, { profile: profilo, onBack: () => undefined })));
  });
  expect(scritto.invia).toBeTypeOf('function');
  await act(async () => {
    scritto.invia!({ storeName, storeLogo: null, storeMedia: [], storeDescription: '', storeCustomization: {} });
    await new Promise((r) => setTimeout(r, 30));
  });
  expect(scritto.righe).toHaveLength(1);
  return scritto.righe[0].store_name;
}

describe('R02-012 · «Dettagli negozio» salva il nome che il modulo ha contato', () => {
  it('80 caratteri con uno spazio in coda: si salvano 80 caratteri, dentro il tetto del database', async () => {
    const nome = await salva('a'.repeat(80) + ' ');
    expect(nome).toBe('a'.repeat(80));
    expect(String(nome).length).toBeLessThanOrEqual(80);
  });

  it('gli spazi in testa e in coda non finiscono nel nome salvato', async () => {
    expect(await salva('   Forno Rossi  ')).toBe('Forno Rossi');
  });

  it('un nome già pulito si salva com\'è', async () => {
    expect(await salva('Panificio Bianchi')).toBe('Panificio Bianchi');
  });
});
