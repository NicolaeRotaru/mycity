/**
 * @vitest-environment jsdom
 */
/**
 * R21-016 / R21-012 — Un sito GIÀ salvato con le regole di prima («https://negozio.it/a b», «ftp://sito.it»)
 * non deve sparire dal database al primo salvataggio dei dettagli né al primo cambio di colore: la lettura
 * (normalizeCustomization) lo tiene, si rifiuta solo un valore nuovo. Uno schema che esegue codice
 * («javascript:») invece si scarta e non diventa mai un link.
 * La prova passa dal percorso vero: StoreDetailsEditor → VendorForm → update di profiles, e ThemePicker.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent } from '@testing-library/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const db = vi.hoisted(() => ({
  salvata: {} as unknown,
  scritture: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'negoziante-1' } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { store_customization: db.salvata }, error: null }) }) }),
      update: (riga: Record<string, unknown>) => {
        db.scritture.push(riga);
        return { eq: async () => ({ error: null }) };
      },
    }),
  },
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@/components/StoreAvatar', () => ({ default: () => null }));
vi.mock('@/components/StoreMediaManager', () => ({ default: () => null }));
vi.mock('@/components/StoreLocationPickerLazy', () => ({ default: () => null }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }),
}));
vi.mock('react-dropzone', () => ({
  useDropzone: () => ({ getRootProps: () => ({}), getInputProps: () => ({}), isDragActive: false, open: () => undefined }),
}));
vi.mock('@/lib/storage/carica-immagine', () => ({ ANNO_IN_SECONDI: 31536000, caricaImmagine: async () => '' }));
vi.mock('@/components/seller/AccentPicker', () => ({ default: () => null }));
vi.mock('@/components/seller/CoverPicker', () => ({ default: () => null }));
vi.mock('@/components/seller/AnnouncementEditor', () => ({ default: () => null }));
vi.mock('@/components/seller/BadgePicker', () => ({ default: () => null }));
vi.mock('@/components/seller/StoreHoursEditor', () => ({ default: () => null }));
vi.mock('@/components/seller/FeaturedProductsPicker', () => ({ default: () => null }));

import StoreDetailsEditor from '@/components/seller/site/StoreDetailsEditor';
import ThemePicker from '@/components/seller/site/ThemePicker';
import VendorForm from '@/components/VendorForm';
import { ACCENT_PRESETS, normalizeCustomization, socialLinks } from '@/lib/store-customization';

const accesi: Root[] = [];
beforeEach(() => {
  db.scritture.length = 0;
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});
const aspetta = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

function radice() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  accesi.push(root);
  return { el, root };
}

async function salvaDettagli(salvata: unknown, nuovoNome: string) {
  db.salvata = salvata;
  const { el, root } = radice();
  const profilo = { store_name: 'Pane Quotidiano', store_phone: null, store_address: null, store_lat: null, store_lng: null,
    store_logo: null, store_media: [], store_description: 'Forno', store_hours: {}, store_customization: salvata };
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: new QueryClient() },
      createElement(StoreDetailsEditor, { profile: profilo, onBack: () => undefined })));
  });
  await aspetta();
  const nome = el.querySelector<HTMLInputElement>('input[name="storeName"]')!;
  await act(async () => { fireEvent.change(nome, { target: { value: nuovoNome } }); });
  await act(async () => { fireEvent.submit(el.querySelector('form')!); });
  await aspetta();
  return db.scritture;
}

async function cambiaColore(salvata: unknown) {
  db.salvata = salvata;
  const { el, root } = radice();
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: new QueryClient() },
      createElement(ThemePicker, { value: 'classico' as never, onChange: () => undefined, accent: ACCENT_PRESETS[0].hex })));
  });
  await aspetta();
  const altro = el.querySelector<HTMLButtonElement>(`button[aria-label="Accent ${ACCENT_PRESETS[1].label}"]`)!;
  await act(async () => { altro.click(); });
  await aspetta();
  return db.scritture;
}

const sitoScritto = (righe: Array<Record<string, unknown>>) =>
  (righe[0]?.store_customization as { socials?: { website?: string } } | undefined)?.socials?.website;

describe('R21-016 / R21-012 · un sito già salvato resta al salvataggio dei dettagli', () => {
  it('sito con uno spazio nel percorso, cambio solo il nome: il sito si riscrive uguale', async () => {
    const righe = await salvaDettagli({ socials: { website: 'https://negozio.it/a b', instagram: 'pane' } }, 'Pane Quotidiano Piacenza');
    expect(righe).toHaveLength(1);
    expect(righe[0].store_name).toBe('Pane Quotidiano Piacenza');
    expect(sitoScritto(righe)).toBe('https://negozio.it/a b');
  });

  it('sito salvato con ftp://, cambio solo il nome: il sito si riscrive uguale', async () => {
    const righe = await salvaDettagli({ socials: { website: 'ftp://sito.it', instagram: 'pane' } }, 'Pane Quotidiano Piacenza');
    expect(righe).toHaveLength(1);
    expect(sitoScritto(righe)).toBe('ftp://sito.it');
  });

  it('un sito javascript: salvato non torna nel database', async () => {
    const righe = await salvaDettagli({ socials: { website: 'javascript:alert(1)', instagram: 'pane' } }, 'Pane Quotidiano Piacenza');
    expect(righe).toHaveLength(1);
    expect(sitoScritto(righe) ?? '').toBe('');
  });
});

describe('R21-016 / R21-012 · un sito già salvato resta al cambio di colore', () => {
  it('ThemePicker rilegge e riscrive: il sito con lo spazio resta', async () => {
    const righe = await cambiaColore({ socials: { website: 'https://negozio.it/a b' } });
    expect(righe).toHaveLength(1);
    expect(sitoScritto(righe)).toBe('https://negozio.it/a b');
  });

  it('ThemePicker: il sito ftp:// resta', async () => {
    const righe = await cambiaColore({ socials: { website: 'ftp://sito.it' }, tagline: 'Forno' });
    expect(sitoScritto(righe)).toBe('ftp://sito.it');
  });

  it('ThemePicker: uno schema che esegue codice si scarta, anche storpiato con un tab', async () => {
    const righe = await cambiaColore({ socials: { website: 'java\tscript:alert(1)' } });
    expect(sitoScritto(righe)).toBeUndefined();
  });
});

describe('R21-016 · un valore NUOVO resta rifiutato', () => {
  it('scrivere un sito nuovo con lo spazio ferma il salvataggio', async () => {
    const onSubmit = vi.fn();
    const { el, root } = radice();
    await act(async () => {
      root.render(createElement(VendorForm, {
        onSubmit, mode: 'branding', salvataggioRiuscito: 0,
        defaultValues: { storeName: 'Pane Quotidiano', storeDescription: 'Forno', storeCustomization: normalizeCustomization({}) },
      } as never));
    });
    await aspetta();
    const campi = Array.from(el.querySelectorAll<HTMLInputElement>('input'));
    const sito = campi.find((c) => /sito|website/i.test(`${c.name} ${c.id} ${c.placeholder} ${c.getAttribute('aria-label') ?? ''}`));
    expect(sito).toBeTruthy();
    await act(async () => { fireEvent.change(sito!, { target: { value: 'https://negozio.it/a b' } }); });
    await act(async () => { fireEvent.submit(el.querySelector('form')!); });
    await aspetta();
    const salvato = onSubmit.mock.calls[0]?.[0]?.storeCustomization?.socials?.website ?? '';
    expect(salvato).not.toBe('https://negozio.it/a b');
  });

  it('in vetrina un sito tenuto ma non http/https non diventa un link', () => {
    const c = normalizeCustomization({ socials: { website: 'ftp://sito.it' } });
    expect(c.socials?.website).toBe('ftp://sito.it');
    expect(socialLinks(c).find((l) => l.key === 'website')).toBeUndefined();
    expect(normalizeCustomization({ socials: { website: 'data:text/html,x' } }).socials?.website).toBeUndefined();
  });
});
