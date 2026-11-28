/**
 * @vitest-environment jsdom
 */
// La pagina di un servizio con react-query VERO e rete finta: rotta lenta, in errore o con dati rotti → torna il preventivo (collaudo del 27/11/2026, portato nel repo).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { costruisciPreventivo, leggiImpostazioniAgenzia } from '@/lib/agenzia/preventivo';

const stato = vi.hoisted(() => ({ slug: 'social' }));
vi.mock('next/navigation', () => ({ useParams: () => ({ servizio: stato.slug }), notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@/components/ui/LoadingState', async () => {
  const { createElement: ce } = await import('react');
  return { LoadingState: () => ce('p', { 'data-caricamento': '1' }, 'CARICAMENTO') };
});
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: null } }), signOut: async () => ({}) }, from: () => ({}) } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import PaginaDelServizio from '@/app/seller/servizi/[servizio]/page';
import { lavoroConsegnatoDi } from '@/lib/agenzia/lavoro-consegnato/registro';
import { SDG_SELLER_ID } from '@/lib/products/sdgSeller';

type Risposta = (init?: RequestInit) => Promise<Response>;
const json = (status: number, corpo: unknown) => async () => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const preventivo = JSON.parse(JSON.stringify(costruisciPreventivo({
  idAttivita: '0de1905e-7000', nomeAttivita: 'Ora del Gusto', tipoAttivita: 'bar',
  dati: { storeLogo: null, storeMedia: [], prodotti: [], socials: null },
  impostazioni: leggiImpostazioniAgenzia({}), adesso: new Date('2026-11-24T10:00:00Z'),
})));
let lavoro: Risposta = json(200, { ok: true, data: { lavoro: null } });
function rete() {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const u = String(input);
    if (u.startsWith('/api/seller/preventivo')) return json(200, { ok: true, data: preventivo })();
    if (u.startsWith('/api/seller/scheda-cliente')) return json(200, { ok: true, data: { scheda: null, aperta: false } })();
    if (u.startsWith('/api/seller/lavoro-consegnato')) return lavoro(init);
    throw new Error('rete inattesa ' + u);
  }) as typeof fetch;
}

const accesi: Root[] = [];
async function monta() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const d = document.createElement('div'); document.body.appendChild(d);
  const root = createRoot(d); accesi.push(root);
  // stesse opzioni del QueryProvider vero (retry 1 di default, la query nuova lo spegne)
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, gcTime: 300_000, refetchOnWindowFocus: false, retry: 1, retryDelay: 10 } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(PaginaDelServizio))); });
  return d;
}
const vediPreventivo = (d: HTMLElement) => d.querySelector('a[href="/seller/abbonamento"]') !== null && (d.textContent ?? '').includes('È compreso in tutti e tre gli abbonamenti');

beforeEach(() => { rete(); stato.slug = 'social'; });
afterEach(() => { for (const r of accesi.splice(0)) act(() => r.unmount()); document.body.innerHTML = ''; });

describe('venditore NON SDG', () => {
  it('lavoro null -> preventivo come prima', async () => {
    lavoro = json(200, { ok: true, data: { lavoro: null } });
    const d = await monta();
    await vi.waitFor(() => expect(vediPreventivo(d)).toBe(true), { timeout: 3000 });
  });
  it('rotta 500 -> preventivo', async () => {
    lavoro = json(500, { ok: false, error: { message: 'boom' } });
    const d = await monta();
    await vi.waitFor(() => expect(vediPreventivo(d)).toBe(true), { timeout: 3000 });
    expect(d.textContent).not.toContain('CARICAMENTO');
  });
  it('rotta 429 -> preventivo', async () => {
    lavoro = json(429, { ok: false });
    const d = await monta();
    await vi.waitFor(() => expect(vediPreventivo(d)).toBe(true), { timeout: 3000 });
  });
  it('rotta 403 (venditore non ammesso) -> preventivo', async () => {
    lavoro = json(403, { ok: false });
    const d = await monta();
    await vi.waitFor(() => expect(vediPreventivo(d)).toBe(true), { timeout: 3000 });
  });
  it('200 ma HTML (redirect al login) -> preventivo', async () => {
    lavoro = async () => new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    const d = await monta();
    await vi.waitFor(() => expect(vediPreventivo(d)).toBe(true), { timeout: 3000 });
  });
  it('rete caduta (fetch lancia) -> preventivo', async () => {
    lavoro = async () => { throw new TypeError('Failed to fetch'); };
    const d = await monta();
    await vi.waitFor(() => expect(vediPreventivo(d)).toBe(true), { timeout: 3000 });
  });
  it('200 con data.lavoro = oggetto senza parti -> preventivo', async () => {
    lavoro = json(200, { ok: true, data: { lavoro: { negozioId: 'x', fascia: 'premium' } } });
    const d = await monta();
    await vi.waitFor(() => expect(vediPreventivo(d)).toBe(true), { timeout: 3000 });
  });
  // Il collaudo del 27/11 aveva trovato che una rotta che non risponde teneva la pagina sul caricamento per sempre.
  // Ora la lettura si ferma dopo 5 secondi (AbortSignal.timeout in leggiLavoroConsegnato) e torna il preventivo.
  // La rete finta qui rispetta il segnale, come fa il fetch vero: senza il tempo massimo la prova resta rossa.
  it('rotta che NON risponde mai -> dopo il tempo massimo torna il preventivo', async () => {
    lavoro = (init) => new Promise<Response>((_, rifiuta) => {
      init?.signal?.addEventListener('abort', () => rifiuta(new DOMException('tempo scaduto', 'TimeoutError')));
    });
    const d = await monta();
    await new Promise((r) => setTimeout(r, 1000));
    expect(vediPreventivo(d)).toBe(false);
    await vi.waitFor(() => expect(vediPreventivo(d)).toBe(true), { timeout: 7000, interval: 100 });
  }, 12_000);
});

describe('SDG', () => {
  it('parte social non valida (assente) -> la pagina social torna al preventivo, sito mostra il lavoro', async () => {
    const l = lavoroConsegnatoDi(SDG_SELLER_ID)!;
    const senzaSocial = JSON.parse(JSON.stringify({ ...l, social: undefined }));
    lavoro = json(200, { ok: true, data: { lavoro: senzaSocial } });
    const d = await monta();
    await vi.waitFor(() => expect(vediPreventivo(d)).toBe(true), { timeout: 3000 });
    stato.slug = 'sito-web';
    const d2 = await monta();
    await vi.waitFor(() => expect(d2.querySelector('#sito-stato')).not.toBeNull(), { timeout: 3000 });
    expect(vediPreventivo(d2)).toBe(false);
  });
  it('lavoro vero di SDG: la pagina analisi si disegna senza errori', async () => {
    const errori: unknown[] = []; const orig = console.error; console.error = (...a: unknown[]) => { errori.push(a); };
    try {
      lavoro = json(200, { ok: true, data: { lavoro: JSON.parse(JSON.stringify(lavoroConsegnatoDi(SDG_SELLER_ID))) } });
      for (const slug of ['analisi', 'social', 'sito-web']) {
        stato.slug = slug;
        const d = await monta();
        await vi.waitFor(() => expect(d.textContent).toContain('Premium · lavoro consegnato'), { timeout: 3000 });
      }
    } finally { console.error = orig; }
    const chiavi = errori.filter((e) => String((e as unknown[])[0]).includes('key'));
    console.log('[COLLAUDO SDG] console.error totali=', errori.length, 'di cui chiavi duplicate=', chiavi.length, chiavi.slice(0, 3).map((c) => String((c as unknown[]).slice(0, 3).join(' | ')).slice(0, 300)));
  });
});

// 28/11/2026 — Il titolare che ha accettato il preventivo vede nella zona «Servizi» il lavoro nato col suo ordine:
// la bozza del sito, il piano, l'analisi. Sempre come bozza, e quello che non c'è ancora dice «in preparazione».
describe('titolare con l ordine di SDG (28/11)', () => {
  const ordine = {
    fascia: 'business',
    nomeAttivita: 'Ora del Gusto',
    piano: { stato: 'in_preparazione', piano: { origine: 'sito', periodo: { dal: '2026-12-01', al: '2026-12-31', titolo: 'dicembre 2026' }, intestazione: { cliente: 'Ora del Gusto', abbonamento: 'Business', canaliETono: 'Instagram, tono caldo', hashtag: '#Piacenza', primaDiPubblicare: 'gli orari' }, contenuti: [{ data: '2026-12-05', ora: '09:00', tipo: 'Post', tema: 'La colazione del sabato', stato: 'Idea', didascalia: 'Il sabato comincia qui.', cosaRiprendere: 'Il bancone', inCitta: null, fonteEvento: null }], note: [] } },
    sito: { stato: 'pronto', bozza: { origine: 'ad', fascia: 'business', sottotitolo: 'Bar in centro', pagine: [{ titolo: 'Home', percorso: '/', sezioni: [{ titolo: 'Chi siamo', testo: 'TESTO DELLA BOZZA DEL SITO', stato: 'da_confermare' }] }], daConfermare: [{ voce: 'Orari', perche: 'li scrive il titolare' }], fonti: [], note: [], pubblicata: false } },
    analisi: { stato: 'in_preparazione', analisi: null },
  };
  it('28/11: un servizio non scelto dall agente (qui il social) mostra la pagina di sempre, non il lavoro', async () => {
    lavoro = json(200, { ok: true, data: { lavoro: null, ordine: { ...ordine, servizi: ['sito_web'] } } });
    stato.slug = 'social';
    const d = await monta();
    await vi.waitFor(() => expect(vediPreventivo(d)).toBe(true), { timeout: 3000 });
    expect(d.textContent).not.toContain('La colazione del sabato');
    stato.slug = 'sito-web';
    const d2 = await monta();
    await vi.waitFor(() => expect(d2.textContent).toContain('TESTO DELLA BOZZA DEL SITO'), { timeout: 3000 });
  });
  it('Analisi andata storta: «lo stiamo preparando», mai un errore tecnico né il preventivo', async () => {
    lavoro = json(200, { ok: true, data: { lavoro: null, ordine: { ...ordine, analisi: { stato: 'lo_stiamo_preparando', analisi: null } } } });
    stato.slug = 'analisi';
    const d = await monta();
    await vi.waitFor(() => expect(d.textContent).toContain('Lo stiamo preparando'), { timeout: 3000 });
    expect(d.textContent).not.toMatch(/errore|n8n|AD non/i);
    expect(vediPreventivo(d)).toBe(false);
  });
  it('Sito web: la bozza, con la scritta «Bozza, la confermiamo insieme alla visita» e «Non è online»', async () => {
    lavoro = json(200, { ok: true, data: { lavoro: null, ordine } });
    stato.slug = 'sito-web';
    const d = await monta();
    await vi.waitFor(() => expect(d.textContent).toContain('TESTO DELLA BOZZA DEL SITO'), { timeout: 3000 });
    expect(d.textContent).toContain('Bozza, la confermiamo insieme alla visita');
    expect(d.textContent).toContain('Non è online');
    expect(vediPreventivo(d)).toBe(false);
  });
  it('Gestione social: il piano; Analisi: «in preparazione», mai una pagina vuota', async () => {
    lavoro = json(200, { ok: true, data: { lavoro: null, ordine } });
    stato.slug = 'social';
    const d = await monta();
    await vi.waitFor(() => expect(d.textContent).toContain('La colazione del sabato'), { timeout: 3000 });
    expect(d.textContent).toContain('Bozza, la confermiamo insieme alla visita');
    stato.slug = 'analisi';
    const d2 = await monta();
    await vi.waitFor(() => expect(d2.textContent).toContain('In preparazione, pronto entro poche ore.'), { timeout: 3000 });
    expect(vediPreventivo(d2)).toBe(false);
  });
});
