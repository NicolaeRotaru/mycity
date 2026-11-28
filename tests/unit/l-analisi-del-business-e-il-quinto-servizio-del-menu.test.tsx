/**
 * @vitest-environment jsdom
 */
/**
 * 24/11/2026 — L'ANALISI DEL BUSINESS DENTRO I SERVIZI.
 *
 * Nicola: «manca un'ultima cosa dentro i servizi, l'analisi del business, la fa n8n e deve esserci
 * dentro una voce dei servizi e ci deve essere il preventivo di questo… un'anteprima/demo già creata».
 * Sue scelte: ritmo «Avvio, mese, settimana»; fonti solo gratuite; la bozza del sito la scrive l'AD.
 *
 *  · la voce «Analisi del business» sta nel menu Servizi, l'ultima (dalla sera del 24/11
 *    «Abbonamento» sta sotto il nome del negozio, come su Claude);
 *  · Base: un'analisi all'avvio; Business: ogni mese; Premium: ogni settimana più un incontro al mese;
 *  · la pagina mostra l'analisi già pronta; dove non c'è ancora lo dice, e non inventa numeri;
 *  · «I tuoi canali» sta nella pagina dell'analisi e nel Profilo;
 *  · la pagina «Sito web» mostra la bozza dell'AD quando c'è, ogni testo «da confermare dal titolare».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FASCE, LISTINO, SERVIZI_AGENZIA, costruisciPreventivo, leggiImpostazioniAgenzia, type Preventivo } from '@/lib/agenzia/preventivo';
import { riassumiPageSpeed, sitoDaRifare, sitoInParole } from '@/lib/agenzia/analisi';
import { aspettaLaBozza } from '@/lib/agenzia/bozza-sito-ad';
import { indirizzoWebPubblico, linkGoogleMaps } from '@/lib/indirizzi-pubblici';
import { normalizeCustomization } from '@/lib/store-customization';
import { SchedaInArrivo } from '@/lib/agenzia/scheda-cliente';

const stato = vi.hoisted(() => ({
  pathname: '/seller/servizi/analisi',
  slug: 'analisi',
  dati: {} as Record<string, unknown>,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => stato.pathname,
  useParams: () => ({ servizio: stato.slug }),
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryKey: readonly unknown[]; enabled?: boolean }) => ({
    data: o.enabled === false ? undefined : stato.dati[String(o.queryKey[1])],
    isLoading: false,
    isError: false,
    refetch: () => undefined,
  }),
  useMutation: () => ({ mutate: () => undefined, isPending: false }),
  useQueryClient: () => ({ setQueryData: () => undefined, invalidateQueries: () => undefined }),
}));
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { signOut: async () => ({}) }, from: () => ({}) } }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 's-1', role: 'seller', store_name: 'Ora del Gusto' }, userEmail: 'o@o.it', isAuthenticated: true, isSeller: true }),
}));
vi.mock('@/components/hooks/useBottomSheetA11y', () => ({ useBottomSheetA11y: () => undefined }));

import SellerShell from '@/components/seller/SellerShell';
import PaginaDelServizio from '@/app/seller/servizi/[servizio]/page';

const RADICE = path.resolve(__dirname, '../..');
const accesi: Root[] = [];
async function monta(componente: unknown, figli?: unknown) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(createElement(componente as never, null, figli as never)); });
  return radice;
}

const preventivo = (): Preventivo =>
  costruisciPreventivo({
    idAttivita: '0de1905e-7000', nomeAttivita: 'Ora del Gusto', tipoAttivita: 'bar',
    dati: { storeLogo: null, storeMedia: [], prodotti: [], socials: null },
    impostazioni: leggiImpostazioniAgenzia({}), adesso: new Date('2026-11-24T10:00:00Z'),
  });

beforeEach(() => {
  stato.pathname = '/seller/servizi/analisi';
  stato.slug = 'analisi';
  stato.dati = { 'preventivo-agenzia': preventivo(), 'scheda-cliente': null, 'scheda-e-abbonamento': { scheda: null, aperta: false }, 'analisi-del-negozio': { sito: null, canali: null, canaliRichiestiIl: null }, canali: {} };
});
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

describe('il quarto servizio, nel listino e nel menu', () => {
  it('è in fondo ai servizi, si chiama «Analisi del business» e ha la sua pagina', () => {
    expect(SERVIZI_AGENZIA[SERVIZI_AGENZIA.length - 1]).toBe('analisi');
    expect(LISTINO.analisi.titolo).toBe('Analisi del business');
  });

  it('il ritmo è quello scelto da Nicola: avvio, ogni mese, ogni settimana con un incontro al mese', () => {
    expect(FASCE.base.servizi.analisi).toMatch(/all’avvio/);
    expect(FASCE.business.servizi.analisi).toMatch(/ogni mese/);
    expect(FASCE.premium.servizi.analisi).toMatch(/ogni settimana/);
    expect(FASCE.premium.servizi.analisi).toMatch(/incontro al mese/);
  });

  it('nel menu la voce sta dopo «Gestione social», l ultima dei servizi', async () => {
    stato.pathname = '/seller/dashboard';
    const r = await monta(SellerShell, createElement('p', null, 'x'));
    const voci = Array.from(r.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    const social = voci.indexOf('/seller/servizi/social');
    const analisi = voci.indexOf('/seller/servizi/analisi');
    expect(analisi).toBeGreaterThan(social);
    expect(voci).not.toContain('/seller/abbonamento'); // sta sotto il nome del negozio, nel menu dell account
    // 28/11/2026 — La voce del menu si chiama come l'ha scritta Nicola; il titolo del listino resta.
    expect(r.querySelector('a[href="/seller/servizi/analisi"]')?.textContent).toContain('Analisi di mercato');
  });
});

describe('la pagina dell analisi è un anteprima già pronta', () => {
  it('senza analisi lo dice, non inventa numeri, e chiede i canali', async () => {
    const r = await monta(PaginaDelServizio);
    const t = r.textContent ?? '';
    expect(t).toContain('Analisi del business');
    expect(t).toContain('La prepariamo appena colleghi i tuoi canali');
    expect(t).toContain('L’analisi della tua attività la prepariamo appena abbiamo letto le fonti pubbliche');
    expect(t).not.toMatch(/su 100|persone ti seguono|stelle su 5/);
    for (const id of ['canale-instagram', 'canale-facebook', 'canale-tiktok', 'canale-google_maps', 'canale-website']) {
      expect(r.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect(t).toContain('È compreso in tutti e tre gli abbonamenti');
    expect(t).toContain(FASCE.premium.servizi.analisi);
    expect(r.querySelector('a[href="/seller/abbonamento"]')?.textContent).toMatch(/Scegli l.abbonamento/);
  });

  it('con la scheda di n8n, l analisi dei canali e quella del sito mostra tutto, con fonte e data, senza prezzi', async () => {
    // 26/11/2026 — La pagina legge la scheda e «ha pagato?» dalla stessa risposta (rapporto dell'imprenditore).
    const scheda = SchedaInArrivo.parse({
      tipo: 'scheda-cliente', id_attivita: '0de1905e-7000-4000-8000-000000000001', campi: {},
      analisi: {
        tipo_di_locale: 'Bar e pasticceria di quartiere',
        pubblico: 'Chi lavora in centro e fa colazione di corsa',
        punti_di_forza: ['Brioche fatte in casa', 'Colazione a 2,50 €'],
        idee_contenuti: ['Il laboratorio alle 6 del mattino'],
      },
    });
    stato.dati['scheda-e-abbonamento'] = { scheda, aperta: false };
    stato.dati.canali = { instagram: 'oradelgusto', website: 'https://www.oradelgusto.it' };
    stato.dati['analisi-del-negozio'] = {
      canaliRichiestiIl: null,
      canali: {
        tipo: 'analisi-canali', id_attivita: '0de1905e-7000-4000-8000-000000000001', fatta_il: '2026-11-25T09:00:00Z',
        canali: {
          instagram: { stato: 'fatta', fonte: 'https://www.instagram.com/oradelgusto/', letto_il: '2026-11-25T08:58:00Z', numeri: { follower: 812 }, osservazioni: ['Pubblica una volta a settimana'], consigli: ['Tre post a settimana'] },
          google: { stato: 'non_trovato' },
        },
      },
      sito: riassumiPageSpeed(
        { lighthouseResult: { categories: { performance: { score: 0.42 }, seo: { score: 0.95 }, accessibility: { score: 0.7 } }, audits: { 'meta-description': { score: 0 } } } },
        'https://www.oradelgusto.it/',
        new Date('2026-11-24T09:00:00Z'),
      ),
    };
    const r = await monta(PaginaDelServizio);
    const t = r.textContent ?? '';
    expect(t).toContain('Chi lavora in centro e fa colazione di corsa');
    expect(t).toContain('Brioche fatte in casa');
    expect(t).not.toContain('2,50');
    expect(t).toContain('812 persone ti seguono');
    expect(t).toContain('Tre post a settimana');
    expect(t).toContain('Non l’abbiamo trovato');
    expect(t).toContain('Letto il 25 novembre 2026');
    expect(t).toContain('Velocità dal telefono');
    expect(t).toMatch(/42\s*su 100/);
    expect(t).toContain('Manca la descrizione che Google mostra');
    expect(t).toContain('Google PageSpeed Insights');
  });

  it('la pagella del flusso 18 sta in cima: i conti, gli avvisi, e «non misurato» dove manca il dato', async () => {
    const { pagella } = await import('@/lib/agenzia/pagella');
    stato.dati.pagella = pagella({
      profilo: { role: 'seller', approval_status: 'pending', approval_requested_at: '2026-11-21T12:00:00Z' },
      prodotti: { righe: [{ status: 'available', images: [], price: 3 }] },
      ordini: null,
      recensioni: { righe: [] },
      confronto: null,
      adesso: new Date('2026-11-24T12:00:00Z'),
    });
    const r = await monta(PaginaDelServizio);
    const box = r.querySelector('[data-testid="pagella"]')!;
    expect(box.textContent).toContain('Il tuo negozio: in verifica');
    expect(box.textContent).toContain('Ordini negli ultimi 30 giorni');
    expect(box.textContent).toContain('non misurato');
    expect(box.querySelector('[data-avviso="in-verifica"]')!.textContent).toContain('da 3 giorni');
    expect(box.querySelector('[data-avviso="senza-foto"]')).not.toBeNull();
    expect(box.textContent).toContain('Non misurato: i tuoi ordini: non letti');
  });

  it('quando i canali sono appena salvati dice che l analisi è in corso', async () => {
    stato.dati.canali = { instagram: 'oradelgusto' };
    stato.dati['analisi-del-negozio'] = { sito: null, canali: null, canaliRichiestiIl: '2026-11-24T10:00:00Z' };
    const r = await monta(PaginaDelServizio);
    expect(r.textContent).toContain('Stiamo analizzando i canali che hai salvato');
  });
});

describe('la pagina «Sito web» con la bozza dell AD', () => {
  const bozza = {
    tipo: 'bozza-sito' as const, id_attivita: '0de1905e-7000-4000-8000-000000000001', scritta_il: '2026-11-25T07:30:00Z',
    sottotitolo: 'Bar e pasticceria nel cuore di Piacenza.',
    sezioni: {
      chi_siamo: { testo: 'Ora del Gusto è il bar di via Roma, con le brioche fatte in casa.', stato: 'da_confermare' as const },
      cosa_offriamo: { testo: 'Colazioni, caffetteria e pasticceria su ordinazione.', stato: 'da_confermare' as const },
      dove_siamo: { testo: 'Ci trovi in via Roma 10, a Piacenza: gli orari li conferma il titolare.', stato: 'da_confermare' as const },
      contatti: { testo: 'WhatsApp e telefono a un tocco: i contatti li conferma il titolare.', stato: 'da_confermare' as const },
    },
  };

  it('se c è, mostra i testi dell AD, ognuno «da confermare dal titolare»', async () => {
    stato.slug = 'sito-web';
    stato.dati['bozza-sito-ad'] = bozza;
    const r = await monta(PaginaDelServizio);
    expect(r.textContent).toContain('Ora del Gusto è il bar di via Roma');
    expect(r.textContent).toContain('Bar e pasticceria nel cuore di Piacenza.');
    expect(r.textContent?.match(/da confermare dal titolare/g)).toHaveLength(4);
  });

  it('se non c è, resta la bozza di oggi fatta coi dati', async () => {
    stato.slug = 'sito-web';
    stato.dati['bozza-sito-ad'] = null;
    const r = await monta(PaginaDelServizio);
    expect(r.textContent).toContain('Una prima bozza fatta con i tuoi dati');
    expect(r.textContent).not.toContain('da confermare dal titolare');
  });
});

describe('le regole senza rete', () => {
  it('PageSpeed in parole: le soglie di Google, solo quello che Google ha misurato', () => {
    const r = riassumiPageSpeed({ lighthouseResult: { categories: { performance: { score: 0.95 }, seo: { score: null } } } }, 'https://a.it/', new Date())!;
    expect(sitoInParole(r).map((v) => [v.titolo, v.voto])).toEqual([['Velocità dal telefono', 'bene']]);
    expect(riassumiPageSpeed({ errore: 'x' }, 'https://a.it/', new Date())).toBeNull();
  });

  it('il sito si rifà solo in un altro giorno di Piacenza', () => {
    expect(sitoDaRifare(null, new Date())).toBe(true);
    expect(sitoDaRifare('2026-11-24T08:00:00Z', new Date('2026-11-24T20:00:00Z'))).toBe(false);
    // 23:30 di Piacenza del 24 e 00:30 del 25 sono due giorni diversi.
    expect(sitoDaRifare('2026-11-24T22:30:00Z', new Date('2026-11-24T23:30:00Z'))).toBe(true);
  });

  it('indirizzi: solo https pubblici; Google Maps solo coi link di Google', () => {
    expect(indirizzoWebPubblico('www.oradelgusto.it')).toBe('https://www.oradelgusto.it/');
    for (const no of ['localhost', 'https://127.0.0.1', 'https://[::1]/', 'https://casa.lan', 'https://a.it:8080', 'ftp://a.it', 'https://2130706433']) {
      expect(indirizzoWebPubblico(no), no).toBeNull();
    }
    expect(linkGoogleMaps('https://maps.app.goo.gl/AbC123')).not.toBeNull();
    expect(linkGoogleMaps('https://www.google.it/maps/place/Ora+del+Gusto')).not.toBeNull();
    expect(linkGoogleMaps('https://www.google.it/search?q=bar')).toBeNull();
    expect(linkGoogleMaps('https://maps.app.goo.gl.example.com/x')).toBeNull();
  });

  it('il link di Google Maps resta nei social della vetrina (il sito builder non lo cancella)', () => {
    const c = normalizeCustomization({ socials: { instagram: 'oradelgusto', google_maps: 'https://maps.app.goo.gl/AbC123' } });
    expect(c.socials?.google_maps).toBe('https://maps.app.goo.gl/AbC123');
    expect(normalizeCustomization({ socials: { google_maps: 'https://example.com' } }).socials?.google_maps).toBeUndefined();
  });

  it('aspetta la bozza chi è un negozio vero senza sito, senza bozza o con una scheda più nuova', () => {
    const base = { id: '0de1905e-7000-4000-8000-000000000001', ruolo: 'seller', sito: null, bozzaIl: null, schedaIl: null };
    expect(aspettaLaBozza(base)).toEqual({ aspetta: true, perche: 'nessuna_bozza' });
    expect(aspettaLaBozza({ ...base, sito: 'https://a.it' })).toEqual({ aspetta: false });
    expect(aspettaLaBozza({ ...base, id: '11111111-1111-1111-1111-5d9000000001' })).toEqual({ aspetta: false });
    expect(aspettaLaBozza({ ...base, ruolo: 'buyer' })).toEqual({ aspetta: false });
    expect(aspettaLaBozza({ ...base, bozzaIl: '2026-11-24T10:00:00Z', schedaIl: '2026-11-23T10:00:00Z' })).toEqual({ aspetta: false });
    expect(aspettaLaBozza({ ...base, bozzaIl: '2026-11-24T10:00:00Z', schedaIl: '2026-11-25T10:00:00Z' })).toEqual({ aspetta: true, perche: 'scheda_nuova' });
  });
});

describe('dove stanno le cose', () => {
  it('«I tuoi canali» è anche nel Profilo, la pagina admin delle bozze è nel menu admin', () => {
    expect(readFileSync(path.join(RADICE, 'app/seller/profile/page.tsx'), 'utf8')).toContain('<CanaliDelNegozio');
    expect(readFileSync(path.join(RADICE, 'components/admin/AdminSidebar.tsx'), 'utf8')).toContain("href: '/admin/bozze-sito'");
  });

  it('l analisi e la bozza entrano in «scarica i miei dati»', () => {
    const esporta = readFileSync(path.join(RADICE, 'app/api/account/export/route.ts'), 'utf8');
    expect(esporta).toContain("from('analisi_negozi')");
    expect(esporta).toContain("from('bozze_sito')");
  });

  it('nessuna IA e nessuna API a pagamento nelle porte nuove', () => {
    for (const f of ['app/api/seller/analisi-sito/route.ts', 'app/api/agenzia/analisi-canali/route.ts', 'app/api/agenzia/bozza-sito/route.ts', 'lib/agenzia/analisi.ts']) {
      const s = readFileSync(path.join(RADICE, f), 'utf8');
      expect(s, f).not.toMatch(/anthropic|openai|gemini|claude-|@ai-sdk/i);
    }
  });
});
