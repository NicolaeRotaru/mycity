import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * ONDATA 10 — IL NEGOZIO CHE NON HA MAI MANDATO LA RICHIESTA NON LEGGE «STIAMO VERIFICANDO».
 *
 * Il portiere ora lascia entrare il negozio non approvato sulla sola
 * /seller/dashboard, dove il layout mostra l'attesa. Ma ogni profilo nasce
 * con approval_status='pending': chi si è appena iscritto come negozio, e non
 * ha mandato niente, atterrava lì e leggeva «Stiamo verificando i dati della
 * tua attività, entro 48 ore». Una promessa su una richiesta che non esiste:
 * il negozio aspetta due giorni e nessuno lo chiama.
 *
 * La causa sotto: il layout decideva su approval_status e rejection_reason,
 * campi che useProfile NON legge (seleziona solo id, role, is_approved, …).
 * In produzione quei campi erano sempre vuoti: ogni negozio non approvato —
 * mai iscritto, in valutazione, rifiutato — vedeva la stessa schermata.
 * Qui la prova li dà nella forma vera: useProfile senza i campi della
 * richiesta, la lettura dedicata del layout con i campi.
 */

type Profilo = Record<string, unknown> | null;
type StatoRichiesta = {
  approval_status: string | null;
  approval_requested_at: string | null;
  rejection_reason?: string | null;
} | null;

let profilo: Profilo = null;
let lettura: { data: StatoRichiesta; isLoading: boolean; isError: boolean } = {
  data: null,
  isLoading: false,
  isError: false,
};

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/seller/SellerShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-prova="cruscotto">{children}</div>,
}));
vi.mock('@/components/seller/SubscriptionBanner', () => ({ SubscriptionBanner: () => null }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: profilo,
    isAuthenticated: true,
    isLoading: false,
    isSeller: profilo?.role === 'seller',
    isAdmin: profilo?.role === 'admin',
    isBuyer: profilo?.role === 'buyer',
    isRider: profilo?.role === 'rider',
  }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => lettura,
}));

const { default: SellerLayout } = await import('@/app/seller/layout');

const disegna = () => renderToStaticMarkup(<SellerLayout><p>contenuto</p></SellerLayout>);

beforeEach(() => {
  profilo = null;
  lettura = { data: null, isLoading: false, isError: false };
});

describe('la dashboard del negozio non approvato dice la verità sulla richiesta', () => {
  it('appena iscritto, richiesta mai mandata (forma del collaudo): niente «stiamo verificando», c è il modulo da mandare', () => {
    profilo = { id: 'u-1', role: 'seller', is_approved: false, approval_status: 'pending', approval_requested_at: null };
    lettura = { data: { approval_status: 'pending', approval_requested_at: null }, isLoading: false, isError: false };
    const html = disegna();
    expect(html, 'promettiamo una verifica su una richiesta che non esiste').not.toContain('Stiamo verificando i dati');
    expect(html).toContain('href="/sell"');
    expect(html).toContain('Invia la richiesta');
  });

  it('forma vera di produzione (useProfile senza i campi della richiesta), mai mandata: niente «stiamo verificando»', () => {
    profilo = { id: 'u-1', role: 'seller', is_approved: false };
    lettura = { data: { approval_status: 'pending', approval_requested_at: null }, isLoading: false, isError: false };
    expect(disegna()).not.toContain('Stiamo verificando i dati');
  });

  it('richiesta mandata davvero: vede l attesa', () => {
    profilo = { id: 'u-1', role: 'seller', is_approved: false };
    lettura = {
      data: { approval_status: 'pending', approval_requested_at: '2026-10-20T10:00:00Z' },
      isLoading: false,
      isError: false,
    };
    expect(disegna()).toContain('Stiamo verificando i dati');
  });

  it('richiesta rifiutata, useProfile senza approval_status: vede il rifiuto col motivo, non l attesa', () => {
    profilo = { id: 'u-1', role: 'seller', is_approved: false };
    lettura = {
      data: { approval_status: 'rejected', approval_requested_at: '2026-10-20T10:00:00Z', rejection_reason: 'Partita IVA non valida' },
      isLoading: false,
      isError: false,
    };
    const html = disegna();
    expect(html).toContain('Richiesta non approvata');
    expect(html).toContain('Partita IVA non valida');
    expect(html).not.toContain('Stiamo verificando i dati');
  });

  it('lettura dello stato fallita: non si promette la verifica (lato severo)', () => {
    profilo = { id: 'u-1', role: 'seller', is_approved: false };
    lettura = { data: null, isLoading: false, isError: true };
    const html = disegna();
    expect(html).not.toContain('Stiamo verificando i dati');
    expect(html).toContain('href="/sell"');
  });

  it('negozio approvato: entra nel cruscotto, la lettura dello stato non conta', () => {
    profilo = { id: 'u-1', role: 'seller', is_approved: true };
    lettura = { data: null, isLoading: true, isError: false };
    const html = disegna();
    expect(html).toContain('data-prova="cruscotto"');
    expect(html).toContain('contenuto');
  });
});
