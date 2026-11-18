/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R03-006 — «Genera con AI» riscriveva la descrizione e la METTEVA AL POSTO di quella del
 * negoziante: tre frasi al posto di 700 caratteri con lievitazione e conservazione, e i dettagli
 * veri sparivano. Adesso, sopra un testo già scritto, il risultato è una proposta con «Usa questa»
 * e «Tieni la mia». Il prompt (già corretto prima) vieta di inventare e riceve la descrizione
 * attuale intera: qui lo si guarda anche dalla rotta.
 */

const toast = vi.hoisted(() => Object.assign(vi.fn(), {
  success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn(() => 't1'), dismiss: vi.fn(),
}));
vi.mock('sonner', () => ({ toast }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }), getUser: async () => ({ data: { user: { id: 's1' } } }) } },
}));

// La rotta, per la parte sul prompt.
const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) => h({ user: FAKE_USER, req }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { store_name: 'Forno Rossi' }, error: null }) }) }) }),
  }),
}));
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, assertSafeText: async () => undefined };
});
const createMock = vi.fn();
vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return { ...actual, getAnthropic: () => ({ messages: { create: createMock } }) };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { default: ProductForm } = await import('@/components/seller/ProductForm');
const { POST } = await import('@/app/api/ai/description/route');
const { __resetRateLimitBuckets } = await import('@/lib/rate-limit');

const CATEGORIE = [{ id: 'c1', name: 'Panetteria', slug: 'panetteria', parent_id: null }];
const DEL_NEGOZIANTE =
  'Pane di Altamura a lievitazione naturale di 24 ore, cotto ogni mattina nel forno a legna. '.repeat(7) +
  'Si conserva tre giorni avvolto in un panno di cotone. FINE-DEL-TESTO';
const DELL_AI = 'Un pane rustico dalla crosta croccante. Ottimo con i salumi.';

let div: HTMLDivElement;
let root: Root;

async function monta(descrizione: string) {
  div = document.createElement('div');
  document.body.appendChild(div);
  root = createRoot(div);
  await act(async () => {
    root.render(createElement(ProductForm, {
      mode: 'edit', categories: CATEGORIE, aiAccesa: true, sellerOffersExpress: true, consegnaDelNegozioNonLetta: false,
      onSubmit: () => {},
      initialValues: { name: 'Pane di Altamura', description: descrizione, price: 4, unit: 'pezzo', stock: 1,
        category_id: 'c1', images: [], attributes: {}, tags: [], status: 'available', variants: [] },
    }));
  });
}

const bottone = (testo: RegExp) => [...div.querySelectorAll('button')].find((b) => testo.test(b.textContent ?? ''));
const campo = () => div.querySelector('textarea[name="description"]') as HTMLTextAreaElement;

async function clic(b: HTMLButtonElement | undefined) {
  expect(b, 'il pulsante non è a video').toBeTruthy();
  await act(async () => { b!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('R03-006 · «Genera con AI» non sostituisce in silenzio il testo del negoziante', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ description: DELL_AI }), { status: 200 }));
  });
  afterEach(() => {
    root.unmount();
    div.remove();
    vi.unstubAllGlobals();
  });

  it('sopra una descrizione già scritta il testo dell\'AI è una proposta: il campo resta del negoziante', async () => {
    await monta(DEL_NEGOZIANTE);
    await clic(bottone(/Genera con AI/));
    expect(campo().value).toBe(DEL_NEGOZIANTE);
    expect(div.textContent).toContain(DELL_AI);
    expect(bottone(/Usa questa/)).toBeTruthy();
    expect(bottone(/Tieni la mia/)).toBeTruthy();
  });

  it('«Usa questa» mette la proposta nel campo', async () => {
    await monta(DEL_NEGOZIANTE);
    await clic(bottone(/Genera con AI/));
    await clic(bottone(/Usa questa/));
    expect(campo().value).toBe(DELL_AI);
    expect(bottone(/Usa questa/)).toBeFalsy();
  });

  it('«Tieni la mia» chiude la proposta e lascia il testo com\'era', async () => {
    await monta(DEL_NEGOZIANTE);
    await clic(bottone(/Genera con AI/));
    await clic(bottone(/Tieni la mia/));
    expect(campo().value).toBe(DEL_NEGOZIANTE);
    expect(div.textContent).not.toContain(DELL_AI);
  });

  it('su un campo vuoto non c\'è niente da perdere: il testo entra subito', async () => {
    await monta('');
    await clic(bottone(/Genera con AI/));
    expect(campo().value).toBe(DELL_AI);
    expect(bottone(/Usa questa/)).toBeFalsy();
  });
});

describe('R03-006 · al modello arrivano la regola «non inventare» e la descrizione attuale intera', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: DELL_AI }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    });
  });

  it('il prompt vieta di inventare e il testo del negoziante oltre i 500 caratteri arriva tutto', async () => {
    const res = await POST(new Request('http://localhost/api/ai/description', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Pane di Altamura', current: DEL_NEGOZIANTE, category: 'Panetteria' }),
    }) as never);
    expect(res.status).toBe(200);
    const corpo = createMock.mock.calls[0][0] as { system: { text: string }[]; messages: { content: string }[] };
    const system = corpo.system.map((b) => b.text).join('\n');
    expect(system).toMatch(/Non inventare/);
    expect(system).not.toMatch(/provenienza locale/);
    expect(DEL_NEGOZIANTE.length).toBeGreaterThan(500);
    expect(corpo.messages[0].content).toContain('FINE-DEL-TESTO');
  });
});
