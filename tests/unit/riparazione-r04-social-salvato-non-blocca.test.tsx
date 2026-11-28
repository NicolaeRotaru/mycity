/**
 * @vitest-environment jsdom
 */
/**
 * R04-010 — UN SOCIAL GIÀ SALVATO CHE LE REGOLE NUOVE RIFIUTANO NON BLOCCA IL NEGOZIO E NON SI CANCELLA.
 *
 * Un Instagram, Facebook o TikTok salvato quando le regole erano più larghe («Pane Quotidiano
 * Piacenza», con gli spazi) arrivava alla schermata «Dettagli negozio» già tolto: la lettura
 * (normalizeCustomization) lo scartava, il campo si apriva vuoto, e al primo «Salva» del nome la
 * personalizzazione riscritta intera lo cancellava dal database senza dire niente. Lo stesso al primo
 * cambio di colore (ThemePicker). Adesso chi modifica legge il valore com'era salvato: resta nel campo,
 * al «Salva» si riscrive uguale, sotto il campo e nel riepilogo si legge che non va più bene e va
 * corretto, e il resto si salva. Un valore NUOVO sbagliato resta rifiutato come prima.
 *
 * La prova passa dal percorso vero, come riparazione-r21-sito-gia-salvato-resta: la riga salvata in
 * `profiles` → StoreDetailsEditor → VendorForm → update di `profiles`; e ThemePicker.
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
import { ACCENT_PRESETS, normalizeCustomization, personalizzazioneDaModificare, socialLinks } from '@/lib/store-customization';

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

/** Apre «Dettagli negozio» con la personalizzazione salvata in `profiles`, così come la legge il sito. */
async function apriDettagli(salvata: unknown) {
  db.salvata = salvata;
  const { el, root } = radice();
  const profilo = { store_name: 'Pane Quotidiano', store_phone: null, store_address: null, store_lat: null, store_lng: null,
    store_logo: null, store_media: [], store_description: 'Forno', store_hours: {}, store_customization: salvata };
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: new QueryClient() },
      createElement(StoreDetailsEditor, { profile: profilo, onBack: () => undefined })));
  });
  await aspetta();
  return el;
}
async function scrivi(el: HTMLInputElement, v: string) {
  await act(async () => { fireEvent.change(el, { target: { value: v } }); });
}
async function salva(el: HTMLElement) {
  await act(async () => { fireEvent.submit(el.querySelector('form')!); });
  await aspetta();
}
const nome = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[name="storeName"]')!;
const campo = (el: HTMLElement, k: string) => el.querySelector<HTMLInputElement>(`#social-${k}`)!;
const errore = (el: HTMLElement, k: string) => el.querySelector(`#social-${k}-errore`)?.textContent ?? '';
const socialScritti = (riga: Record<string, unknown> | undefined) =>
  ((riga?.store_customization as { socials?: Record<string, string> } | undefined)?.socials ?? {});

describe('R04-010 · un social già salvato e rifiutato dalle regole nuove resta, e il resto si salva', () => {
  it.each([
    ['facebook', 'Pane Quotidiano Piacenza'],
    ['instagram', 'pane quotidiano'],
    ['tiktok', 'pane quotidiano'],
    ['whatsapp', 'solo sms'],
    ['google_maps', 'https://www.example.com/pane-quotidiano'],
  ])('%s salvato come «%s»: il campo lo mostra, cambio solo il nome, si salva e il social si riscrive uguale', async (k, salvato) => {
    const el = await apriDettagli({ socials: { [k]: salvato, website: 'https://www.panequotidiano.it' }, tagline: 'Pane fresco' });
    expect(campo(el, k).value, `il ${k} salvato spariva dal modulo prima del «Salva»`).toBe(salvato);
    await scrivi(nome(el), 'Pane Quotidiano di Piacenza');
    await salva(el);
    expect(db.scritture, `un ${k} già salvato bloccava tutto il negozio`).toHaveLength(1);
    expect(db.scritture[0].store_name).toBe('Pane Quotidiano di Piacenza');
    expect(socialScritti(db.scritture[0])[k], `il ${k} già salvato si cancellava dal database`).toBe(salvato);
    expect(socialScritti(db.scritture[0]).website).toBe('https://www.panequotidiano.it');
    expect(errore(el, k), 'l avviso resta sotto il suo campo').not.toBe('');
  });

  it('a salvataggio riuscito il messaggio dice che il resto è salvato e che quel social va corretto', async () => {
    const el = await apriDettagli({ socials: { facebook: 'Pane Quotidiano Piacenza' } });
    await scrivi(nome(el), 'Pane Quotidiano di Piacenza');
    await salva(el);
    expect(db.scritture).toHaveLength(1);
    expect(el.textContent).toContain('Facebook: Scrivi solo il nome del profilo');
    expect(el.textContent).toContain("Il resto è salvato; Facebook è rimasto com'era ma va corretto.");
  });

  it('anche il secondo salvataggio parte e lo riscrive uguale', async () => {
    const el = await apriDettagli({ socials: { facebook: 'Pane Quotidiano Piacenza', website: 'https://www.panequotidiano.it' } });
    await salva(el);
    await scrivi(nome(el), 'Pane Quotidiano di Piacenza');
    await salva(el);
    expect(db.scritture).toHaveLength(2);
    expect(socialScritti(db.scritture[1])).toMatchObject({
      facebook: 'Pane Quotidiano Piacenza',
      website: 'https://www.panequotidiano.it',
    });
  });

  it('un Facebook NUOVO sbagliato scritto sopra quello già salvato e sbagliato si ferma ancora', async () => {
    const el = await apriDettagli({ socials: { facebook: 'Pane Quotidiano' } });
    await scrivi(campo(el, 'facebook'), 'Pane Quotidiano Piacenza');
    await salva(el);
    expect(db.scritture, 'un valore nuovo sbagliato non passa').toHaveLength(0);
    expect(errore(el, 'facebook')).not.toBe('');
  });

  it('un Facebook NUOVO sbagliato in un campo vuoto non si salva; il resto sì', async () => {
    const el = await apriDettagli({ socials: { instagram: 'panequotidiano' } });
    await scrivi(campo(el, 'facebook'), 'Pane Quotidiano Piacenza');
    await salva(el);
    expect(db.scritture).toHaveLength(1);
    expect(socialScritti(db.scritture[0]).facebook ?? '').toBe('');
    expect(socialScritti(db.scritture[0]).instagram).toBe('panequotidiano');
    expect(errore(el, 'facebook')).not.toBe('');
  });

  it('svuotare il campo cancella il social: è una scelta del negoziante', async () => {
    const el = await apriDettagli({ socials: { facebook: 'Pane Quotidiano Piacenza' } });
    await scrivi(campo(el, 'facebook'), '');
    await salva(el);
    expect(db.scritture).toHaveLength(1);
    expect(socialScritti(db.scritture[0]).facebook ?? '').toBe('');
  });
});

describe('R04-010 · un social già salvato resta al cambio di colore', () => {
  it('ThemePicker rilegge e riscrive: il Facebook con gli spazi resta', async () => {
    db.salvata = { socials: { facebook: 'Pane Quotidiano Piacenza', instagram: 'pane quotidiano' }, tagline: 'Forno' };
    const { el, root } = radice();
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: new QueryClient() },
        createElement(ThemePicker, { value: 'classico' as never, onChange: () => undefined, accent: ACCENT_PRESETS[0].hex })));
    });
    await aspetta();
    await act(async () => { el.querySelector<HTMLButtonElement>(`button[aria-label="Accent ${ACCENT_PRESETS[1].label}"]`)!.click(); });
    await aspetta();
    expect(db.scritture).toHaveLength(1);
    expect(socialScritti(db.scritture[0])).toMatchObject({ facebook: 'Pane Quotidiano Piacenza', instagram: 'pane quotidiano' });
  });
});

describe('R04-010 · la vetrina non cambia', () => {
  it('la vetrina continua a non leggere il social sbagliato, e non ne fa un link', () => {
    const salvata = { socials: { facebook: 'Pane Quotidiano Piacenza', instagram: 'panequotidiano' } };
    expect(normalizeCustomization(salvata).socials?.facebook).toBeUndefined();
    expect(personalizzazioneDaModificare(salvata).socials?.facebook).toBe('Pane Quotidiano Piacenza');
    expect(socialLinks(personalizzazioneDaModificare(salvata)).map((l) => l.key)).toEqual(['instagram']);
  });

  it('uno schema che esegue codice non torna nemmeno a chi modifica', () => {
    expect(personalizzazioneDaModificare({ socials: { instagram: 'javascript:alert(1)' } }).socials?.instagram).toBeUndefined();
    expect(personalizzazioneDaModificare({ socials: { facebook: 'java\tscript:alert(1)' } }).socials?.facebook).toBeUndefined();
  });
});
