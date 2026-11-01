/**
 * Su Android Chrome non trovava il file che rende MyCity installabile.
 *
 * IL CASO. Il collegamento al manifest (il file che dice al telefono nome, icona,
 * colore e modalità app) stava nei `metadata` del layout. Il layout è
 * `force-dynamic`, e Next 15.5 i metadata delle pagine dinamiche li manda in
 * streaming: arrivano DOPO, dentro il <body>. Chrome il manifest lo cerca nel
 * <head>, quindi l'installazione come app non compariva.
 *
 * LA CURA. Il <link rel="manifest"> e l'icona per iPhone si scrivono a mano nel
 * <head> del layout, che esce subito, e spariscono dai metadata per non uscire
 * due volte. Restano dietro l'interruttore APP_INSTALLABILE_ACCESA: spenta
 * l'app installabile, niente manifest.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

const stato = vi.hoisted(() => ({ accesa: true }));

vi.mock('@/lib/funzioni-al-lancio', () => ({
  get APP_INSTALLABILE_ACCESA() {
    return stato.accesa;
  },
}));
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: 'f-inter' }),
  Fraunces: () => ({ variable: 'f-fraunces' }),
}));
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'it',
  getMessages: async () => ({}),
}));
vi.mock('next-intl', () => ({
  NextIntlClientProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/lib/env', () => ({
  indirizzoPubblico: () => ({ url: 'https://mycity.example', fonte: 'variabile' }),
}));
vi.mock('@/lib/site-branding', () => ({ DESCRIZIONE_DEL_SITO: 'desc' }));

vi.mock('@/components/Navbar', () => ({ default: () => null }));
vi.mock('@/components/SellerShoppingBanner', () => ({ default: () => null }));
vi.mock('@/components/Footer', () => ({ default: () => null }));
vi.mock('@/components/MobileTabBar', () => ({ default: () => null }));
vi.mock('@/components/SupportChatButton', () => ({ default: () => null }));
vi.mock('@/components/providers/QueryProvider', () => ({
  default: ({ children }: { children?: ReactNode }) => children ?? null,
}));
vi.mock('@/components/providers/ToastProvider', () => ({ default: () => null }));
vi.mock('@/components/ConfirmDialog', () => ({ ConfirmDialogHost: () => null }));
vi.mock('@/components/CookieBanner', () => ({ default: () => null }));
vi.mock('@/components/GoogleAnalytics', () => ({ default: () => null }));
vi.mock('@/components/ActivityTracker', () => ({ default: () => null }));
vi.mock('@/components/DailyCheckIn', () => ({ default: () => null }));
vi.mock('@/components/WelcomeCreditBanner', () => ({ default: () => null }));
vi.mock('@/components/CartCrossDeviceSync', () => ({ default: () => null }));
vi.mock('@/components/BuyerOnboardingTour', () => ({ default: () => null }));
vi.mock('@/components/PWAInstallBanner', () => ({ default: () => null }));
vi.mock('@/components/ServiceWorkerRegister', () => ({ default: () => null }));
vi.mock('@/lib/analytics/posthog', () => ({ default: () => null }));
vi.mock('@/components/analytics/EventiAccessoOAuth', () => ({ default: () => null }));
vi.mock('@/lib/analytics/sentry', () => ({ default: () => null }));

async function pagina(): Promise<{ head: string; html: string }> {
  vi.resetModules();
  const mod = await import('@/app/layout');
  const html = renderToStaticMarkup(await mod.default({ children: null }));
  const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';
  return { head, html };
}

describe('il manifest esce nella testa della pagina, non nello streaming', () => {
  beforeEach(() => {
    stato.accesa = true;
  });

  it("IL CASO: con l'app installabile accesa, il link al manifest sta nel <head>", async () => {
    const { head } = await pagina();
    expect(head).toContain('<link rel="manifest" href="/manifest.json"/>');
  });

  it("anche l'icona per la schermata Home di iPhone sta nel <head>", async () => {
    const { head } = await pagina();
    expect(head).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png"/>');
  });

  it('niente doppioni: i metadata non dichiarano più manifest né icona Apple', async () => {
    vi.resetModules();
    const { metadata } = await import('@/app/layout');
    expect(metadata.manifest).toBeUndefined();
    expect((metadata.icons as { apple?: unknown }).apple).toBeUndefined();
  });

  it("con l'app installabile spenta il manifest non esce da nessuna parte", async () => {
    stato.accesa = false;
    const { html } = await pagina();
    expect(html).not.toContain('rel="manifest"');
  });
});
