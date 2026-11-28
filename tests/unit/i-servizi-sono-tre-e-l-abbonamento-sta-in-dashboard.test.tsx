/**
 * @vitest-environment jsdom
 */
/**
 * 24/11/2026 — Nicola, dal telefono, sulla pagina «Foto e video» di Pane Quotidiano:
 * «qua nel preventivo non posso selezionare l'abbonamento… togli la sezione preventivo, perché
 * ognuna di quelle sezioni è di per sé un preventivo… fai in modo che ci sia poi un bottone che
 * manda alla pagina dove si sceglie quell'abbonamento… foto e video, sito e social, gestione di
 * social. E gestione di social dentro è compreso anche Google Maps», e poi «la sezione abbonamento
 * deve essere nella home page, nel dashboard del venditore… e le voci dei servizi mettili in alto».
 *
 *  · il gruppo «Servizi» è il secondo del menu, con Foto e video, Sito web, Gestione social (dalla
 *    sera del 24/11 «Abbonamento» sta in fondo al menu, sotto il nome del negozio, come su Claude);
 *  · i servizi sono tre, e la gestione social comprende la scheda Google Maps;
 *  · i vecchi indirizzi /seller/preventivo… portano ai nuovi, anche dal portiere vero;
 *  · la dashboard ha il riquadro «Abbonamento» nei tre stati (da scegliere, attivo, pagamento non riuscito);
 *  · nelle pagine del negozio non resta la parola «preventivo».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const stato = vi.hoisted(() => ({
  pathname: '/seller/dashboard',
  slug: 'foto-video',
  preventivo: null as unknown,
  inVetrina: false as boolean | null,
  approvato: true,
  erroreLettura: false,
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
  useQuery: (o: { queryKey: readonly unknown[] }) => {
    if (o.queryKey[1] === 'preventivo-agenzia') {
      return stato.erroreLettura
        ? { data: undefined, isLoading: false, isError: true, error: new Error('guasto'), refetch: () => undefined }
        : { data: stato.preventivo, isLoading: false, isError: false, refetch: () => undefined };
    }
    if (o.queryKey[1] === 'in-vetrina') return { data: stato.inVetrina };
    return { data: 0 };
  },
  useMutation: () => ({ mutate: () => undefined, isPending: false }),
  useQueryClient: () => ({ setQueryData: () => undefined, invalidateQueries: () => undefined }),
}));
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { signOut: async () => ({}) }, from: () => ({}), rpc: async () => ({ data: null }) } }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: 's-1', role: 'seller', store_name: 'Pane Quotidiano', is_approved: stato.approvato },
    userEmail: 'p@p.it', isAuthenticated: true, isSeller: true,
  }),
}));
vi.mock('@/components/hooks/useBottomSheetA11y', () => ({ useBottomSheetA11y: () => undefined }));

import {
  FASCE, LISTINO, SERVIZI_AGENZIA, ABBONAMENTI, costruisciPreventivo, leggiImpostazioniAgenzia, servizioDaSlug, type Preventivo,
} from '@/lib/agenzia/preventivo';
import { indirizzoDopoIlPreventivo, PERCORSO_ABBONAMENTO } from '@/lib/agenzia/indirizzi-servizi';
import { pulsantiServizi, statoRiquadro } from '@/lib/agenzia/riquadro-abbonamento';
import SellerShell from '@/components/seller/SellerShell';
import RiquadroAbbonamento from '@/components/seller/RiquadroAbbonamento';
import PaginaDelServizio from '@/app/seller/servizi/[servizio]/page';
import PaginaAbbonamento from '@/app/seller/abbonamento/page';

const RADICE = path.resolve(__dirname, '../..');

const accesi: Root[] = [];
async function monta(componente: unknown, props?: Record<string, unknown> | null, figli?: unknown) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(createElement(componente as never, (props ?? null) as never, figli as never)); });
  return radice;
}

/** Una vetrina come quella di Pane Quotidiano: 1 foto del locale, nessun video, nessun sito. */
const vetrina = (attivo: Preventivo['attivo'] = null): Preventivo => costruisciPreventivo({
  idAttivita: 'a1b2c3', nomeAttivita: 'Pane Quotidiano', tipoAttivita: 'negozio',
  dati: { storeLogo: null, storeMedia: [{ type: 'image', url: 'https://x/1.jpg' }], prodotti: [{ images: ['a.jpg'] }], socials: { instagram: 'pane' } },
  impostazioni: leggiImpostazioniAgenzia({}), adesso: new Date('2026-11-24T10:00:00Z'), attivo,
});

beforeEach(() => {
  stato.pathname = '/seller/dashboard';
  stato.slug = 'foto-video';
  stato.preventivo = vetrina();
  stato.inVetrina = false;
  stato.approvato = true;
  stato.erroreLettura = false;
});
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

describe('il menu: «Servizi» è il secondo gruppo, coi servizi in alto', () => {
  it('dopo Dashboard, Ordini e Prodotti e prima di «Crescita», con le voci dei servizi in ordine', async () => {
    const r = await monta(SellerShell, null, createElement('p', null, 'x'));
    const testi = Array.from(r.querySelectorAll('nav *')).filter((n) => n.children.length === 0).map((n) => n.textContent?.trim() ?? '');
    const indice = (t: string) => testi.indexOf(t);
    expect(indice('Prodotti')).toBeGreaterThan(-1);
    expect(indice('Servizi')).toBeGreaterThan(indice('Prodotti'));
    expect(indice('Crescita')).toBeGreaterThan(indice('Servizi'));
    // 28/11/2026 — I nomi delle voci come li ha scritti Nicola.
    const voci = ['Foto e video', 'Gestione sito web', 'Gestione social e Google', 'Analisi di mercato'].map(indice);
    expect(voci.every((i) => i > indice('Servizi') && i < indice('Crescita')), `voci: ${voci}`).toBe(true);
    expect([...voci].sort((a, b) => a - b)).toEqual(voci);
    expect(testi).not.toContain('Il tuo preventivo');
    expect(testi).not.toContain('Scheda Google');
    expect(testi).not.toContain('Abbonamento'); // sta sotto il nome del negozio (MenuAccount)
  });

  it('le voci portano alle pagine nuove', async () => {
    const r = await monta(SellerShell, null, createElement('p', null, 'x'));
    for (const href of ['/seller/servizi/foto-video', '/seller/servizi/sito-web', '/seller/servizi/social', '/seller/servizi/analisi']) {
      expect(r.querySelector(`a[href="${href}"]`), href).not.toBeNull();
    }
    expect(r.querySelector('a[href^="/seller/preventivo"]')).toBeNull();
  });
});

describe('da quattro servizi a tre', () => {
  it('foto e video, sito web, gestione social (e dal 24/11 sera l analisi del business, in fondo)', () => {
    expect([...SERVIZI_AGENZIA]).toEqual(['foto_video', 'sito_web', 'social', 'analisi']);
    expect(servizioDaSlug('scheda-google')).toBeNull();
  });

  it('la gestione social comprende la scheda Google Maps, nel listino e in ogni fascia', () => {
    expect(LISTINO.social.titolo).toContain('Google Maps');
    expect(LISTINO.social.descrizione).toContain('Google Maps');
    for (const f of ABBONAMENTI) expect(FASCE[f].servizi.social, f).toContain('Google Maps');
  });

  it('il perché della gestione social dice anche della scheda Google', () => {
    const social = vetrina().righe.find((r) => r.id === 'social')!;
    expect(social.perche.some((f) => f.includes('Google'))).toBe(true);
  });
});

describe('i vecchi indirizzi del preventivo portano ai nuovi', () => {
  it('il preventivo va all abbonamento, ogni servizio alla sua pagina, la scheda Google alla gestione social', () => {
    expect(indirizzoDopoIlPreventivo('/seller/preventivo')).toBe('/seller/abbonamento');
    expect(indirizzoDopoIlPreventivo('/seller/preventivo/')).toBe('/seller/abbonamento');
    expect(indirizzoDopoIlPreventivo('/seller/preventivo/foto-video')).toBe('/seller/servizi/foto-video');
    expect(indirizzoDopoIlPreventivo('/seller/preventivo/sito-web')).toBe('/seller/servizi/sito-web');
    expect(indirizzoDopoIlPreventivo('/seller/preventivo/social')).toBe('/seller/servizi/social');
    expect(indirizzoDopoIlPreventivo('/seller/preventivo/scheda-google')).toBe('/seller/servizi/social');
    expect(indirizzoDopoIlPreventivo('/seller/preventivo/boh')).toBe('/seller/abbonamento');
  });

  it('gli altri indirizzi non si toccano, compresa la pagina pubblica col codice', () => {
    expect(indirizzoDopoIlPreventivo('/seller/preventivo-falso')).toBeNull();
    expect(indirizzoDopoIlPreventivo('/seller/abbonamento')).toBeNull();
    expect(indirizzoDopoIlPreventivo('/preventivo/ABC123')).toBeNull();
  });

  it('il portiere vero rimanda, e tiene ?pagato=1 del ritorno da Stripe', async () => {
    const { NextRequest } = await import('next/server');
    const { middleware } = await import('@/middleware');
    const r = await middleware(new NextRequest('https://www.mycity-marketplace.com/seller/preventivo?pagato=1'));
    expect(r.status).toBeGreaterThanOrEqual(300);
    expect(r.status).toBeLessThan(400);
    expect(r.headers.get('location')).toBe('https://www.mycity-marketplace.com/seller/abbonamento?pagato=1');
    const g = await middleware(new NextRequest('https://www.mycity-marketplace.com/seller/preventivo/scheda-google'));
    expect(g.headers.get('location')).toBe('https://www.mycity-marketplace.com/seller/servizi/social');
  });

  it('la cassa Stripe torna alla pagina Abbonamento', () => {
    const rotta = readFileSync(path.join(RADICE, 'app/api/seller/preventivo/paga/route.ts'), 'utf8');
    expect(rotta).toContain('${PERCORSO_ABBONAMENTO}?pagato=1');
    expect(rotta).not.toContain('/seller/preventivo?');
    expect(PERCORSO_ABBONAMENTO).toBe('/seller/abbonamento');
  });
});

describe('ogni pagina di servizio è il suo preventivo', () => {
  it('perché coi dati veri, cosa ricevi, le tre fasce da leggere e un solo pulsante verso l abbonamento', async () => {
    const r = await monta(PaginaDelServizio);
    expect(r.textContent).toContain('La copertina ha 1 foto del locale');
    expect(r.textContent).toContain('I formati che ricevi');
    expect(r.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    const pulsanti = [...r.querySelectorAll('a, button')].filter((n) => /Scegli l.abbonamento/.test(n.textContent ?? ''));
    expect(pulsanti).toHaveLength(1);
    expect(pulsanti[0].getAttribute('href')).toBe('/seller/abbonamento');
  });

  it('se la lettura non riesce, il pulsante verso l abbonamento resta (collaudo del 24/11)', async () => {
    stato.erroreLettura = true;
    const r = await monta(PaginaDelServizio);
    expect(r.textContent).toContain('Non sono riuscito a leggere la tua vetrina');
    expect(r.querySelector('a[href="/seller/abbonamento"]')?.textContent).toMatch(/Scegli l.abbonamento/);
  });

  it('la gestione social mostra il piano dei post e la scheda su Google Maps', async () => {
    stato.slug = 'social';
    const r = await monta(PaginaDelServizio);
    expect(r.querySelector('[aria-label^="Il piano editoriale di"]')).not.toBeNull();
    expect(r.querySelector('[aria-label="La tua scheda su Google Maps"]')).not.toBeNull();
  });
});

describe('la pagina Abbonamento serve solo a scegliere e pagare', () => {
  it('niente «Cosa manca» né anteprime dei servizi', async () => {
    const r = await monta(PaginaAbbonamento);
    // 27/11/2026 — Nicola: «togli questo pezzo "cosa ci guadagni"»: il riquadro non c’è più.
    expect(r.textContent).not.toContain('Cosa ci guadagni');
    expect(r.querySelector('#cosa-ci-guadagni')).toBeNull();
    expect(r.querySelectorAll('input[name="abbonamento"]')).toHaveLength(3);
    expect(r.textContent).not.toContain('Cosa manca alla tua vetrina');
    expect(r.textContent).not.toContain('I formati che ricevi');
    expect(r.textContent).not.toContain('La bozza del tuo sito');
    // 26/11/2026 — Per ora si paga in contanti (lib/agenzia/pagamento-servizi.ts): niente «Paga e attiva», resta «contattatemi».
    expect(r.textContent).toContain('contattatemi');
    expect(r.textContent).toContain('si paga in contanti');
    expect(r.textContent).not.toContain('Paga e attiva');
  });

  it('col pagamento online spento non dice «Pagamento ricevuto» né «riprovare», anche con ?pagato= (collaudo del 26/11)', async () => {
    for (const v of ['1', '0']) {
      window.history.replaceState({}, '', `/seller/abbonamento?pagato=${v}`);
      const r = await monta(PaginaAbbonamento);
      expect(r.textContent, v).not.toContain('Pagamento ricevuto');
      expect(r.textContent, v).not.toContain('Pagamento annullato');
    }
    window.history.replaceState({}, '', '/');
  });

  it('porta alle pagine dei tre servizi, per rileggere cosa si riceve (collaudo del 24/11)', async () => {
    const r = await monta(PaginaAbbonamento);
    for (const href of ['/seller/servizi/foto-video', '/seller/servizi/sito-web', '/seller/servizi/social', '/seller/servizi/analisi']) {
      expect(r.querySelector(`a[href="${href}"]`), href).not.toBeNull();
    }
  });
});

describe('il riquadro «Abbonamento» in dashboard', () => {
  it('in demo è il primo blocco: vetrina non visibile, le tre fasce corte, il pulsante e i tre servizi col perché vero', async () => {
    const r = await monta(RiquadroAbbonamento, { posizione: 'cima' });
    const q = r.querySelector('[data-testid="riquadro-abbonamento"]')!;
    expect(q).not.toBeNull();
    expect(q.textContent).toContain('La tua vetrina non è ancora visibile sul marketplace');
    for (const nome of ['Base', 'Business', 'Premium']) expect(q.textContent).toContain(nome);
    expect(q.textContent).toMatch(/300,00\s€ al mese/);
    expect(q.textContent).toMatch(/Il primo mese 300,00\s€/);
    expect(q.textContent).toContain('Consigliato');
    expect(q.querySelector('a[href="/seller/abbonamento"]')?.textContent).toMatch(/Scegli l.abbonamento/);
    expect(q.querySelector('a[href="/seller/servizi/foto-video"]')?.textContent).toContain('La copertina ha 1 foto del locale');
    expect(q.querySelector('a[href="/seller/servizi/sito-web"]')?.textContent).toContain('non ha ancora un sito');
    expect(q.querySelector('a[href="/seller/servizi/social"]')?.textContent).toContain('Instagram');
    // il posto «dopo i numeri» resta vuoto: il riquadro è uno solo
    const sotto = await monta(RiquadroAbbonamento, { posizione: 'dopo-numeri' });
    expect(sotto.textContent).toBe('');
  });

  it('un negozio già online senza abbonamento non legge che la vetrina non si vede', async () => {
    stato.inVetrina = true;
    const r = await monta(RiquadroAbbonamento, { posizione: 'cima' });
    expect(r.textContent).not.toContain('non è ancora visibile');
    expect(r.textContent).toContain('Scegli il tuo abbonamento ai servizi');
    expect(r.querySelector('a[href="/seller/abbonamento"]')).not.toBeNull();
  });

  it('con l abbonamento attivo è più piccolo, dopo i numeri, coi tre servizi', async () => {
    stato.preventivo = vetrina({ fascia: 'business', stato: 'active', rinnovoIl: null });
    stato.inVetrina = true;
    const cima = await monta(RiquadroAbbonamento, { posizione: 'cima' });
    expect(cima.textContent).toBe('');
    const r = await monta(RiquadroAbbonamento, { posizione: 'dopo-numeri' });
    expect(r.textContent).toContain('Il tuo abbonamento Business è attivo, lo realizza SDG Agenzia');
    expect(r.querySelectorAll('a[href^="/seller/servizi/"]')).toHaveLength(4);
    expect(r.textContent).not.toContain('Premium');
  });

  it('col pagamento non riuscito è il primo blocco, giallo, e manda all Aiuto', async () => {
    stato.preventivo = vetrina({ fascia: 'base', stato: 'past_due', rinnovoIl: null });
    stato.inVetrina = true;
    const r = await monta(RiquadroAbbonamento, { posizione: 'cima' });
    const q = r.querySelector('[data-testid="riquadro-abbonamento"]')!;
    expect(q.className).toContain('amber');
    expect(q.textContent).toContain('Il pagamento del tuo abbonamento Base non è riuscito');
    expect(q.textContent).toContain('scrivici dall’Aiuto');
    expect(q.querySelector('a[href="/seller/help"]')).not.toBeNull();
  });

  it('se i dati dei servizi non si leggono, in demo resta almeno l avviso', async () => {
    stato.preventivo = undefined;
    const r = await monta(RiquadroAbbonamento, { posizione: 'cima' });
    expect(r.textContent).toContain('La tua vetrina non è ancora visibile sul marketplace');
    stato.inVetrina = null;
    const nulla = await monta(RiquadroAbbonamento, { posizione: 'cima' });
    expect(nulla.textContent).toBe('');
  });

  it('lo stato si decide dall abbonamento e dalla vetrina', () => {
    expect(statoRiquadro(null, false)).toEqual({ tipo: 'scegli', vetrina: 'nascosta' });
    expect(statoRiquadro(null, true)).toEqual({ tipo: 'scegli', vetrina: 'visibile' });
    expect(statoRiquadro(null, null)).toEqual({ tipo: 'scegli', vetrina: 'sconosciuta' });
    expect(statoRiquadro({ fascia: 'premium', stato: 'active', rinnovoIl: null }, true)).toEqual({ tipo: 'attivo', fascia: 'premium' });
    expect(statoRiquadro({ fascia: 'base', stato: 'past_due', rinnovoIl: null }, true)).toEqual({ tipo: 'in_ritardo', fascia: 'base' });
    expect(pulsantiServizi(null).map((p) => p.href)).toEqual(['/seller/servizi/foto-video', '/seller/servizi/sito-web', '/seller/servizi/social', '/seller/servizi/analisi']);
  });

  it('la dashboard lo mette in cima e dopo i numeri, al posto del preventivo e dell avviso demo', () => {
    const pagina = readFileSync(path.join(RADICE, 'app/seller/dashboard/page.tsx'), 'utf8');
    const cima = pagina.indexOf('<RiquadroAbbonamento posizione="cima" />');
    const eroe = pagina.indexOf('{/* ===== HERO ===== */}');
    const numeri = pagina.indexOf('<HeroStat label="30 giorni"');
    const dopo = pagina.indexOf('<RiquadroAbbonamento posizione="dopo-numeri" />');
    expect(cima).toBeGreaterThan(-1);
    expect(cima).toBeLessThan(eroe);
    expect(dopo).toBeGreaterThan(numeri);
    expect(pagina).not.toContain('PreventivoAgenziaCard');
    expect(pagina).not.toContain('BannerModalitaDemo');
  });
});

// 25/11/2026 — Nicola: «il link all'abbonamento sia il preventivo personalizzato in base all'azienda e
// all'abbonamento». Da qui la pagina Abbonamento prima di abbonarsi, e le tre fasce del riquadro che
// la aprono, SONO il preventivo e lo dicono. Resta vero il resto: menu, pagine dei servizi e stati
// con l'abbonamento già fatto non parlano di preventivo.
describe('nell area del negozio la parola «preventivo» sta solo dove c è da scegliere', () => {
  it('menu, pagine dei servizi, pagina Abbonamento e riquadro ad abbonamento fatto: niente «preventivo»', async () => {
    const testi: string[] = [];
    testi.push((await monta(SellerShell, null, createElement('p', null, 'x'))).textContent ?? '');
    for (const id of SERVIZI_AGENZIA) {
      stato.slug = ({ foto_video: 'foto-video', sito_web: 'sito-web', social: 'social', analisi: 'analisi' } as const)[id];
      testi.push((await monta(PaginaDelServizio)).textContent ?? '');
    }
    stato.preventivo = vetrina({ fascia: 'business', stato: 'active', rinnovoIl: null });
    testi.push((await monta(PaginaAbbonamento)).textContent ?? '');
    testi.push((await monta(RiquadroAbbonamento, { posizione: 'dopo-numeri' })).textContent ?? '');
    stato.preventivo = vetrina({ fascia: 'base', stato: 'past_due', rinnovoIl: null });
    testi.push((await monta(RiquadroAbbonamento, { posizione: 'cima' })).textContent ?? '');
    for (const t of testi) expect(t.toLowerCase()).not.toContain('preventivo');
    expect(testi.every((t) => t.length > 0)).toBe(true);
  });

  it('le pagine del negozio non portano più al vecchio indirizzo', () => {
    const file = [
      'app/seller/dashboard/page.tsx', 'app/seller/layout.tsx', 'app/seller/abbonamento/page.tsx',
      'app/seller/servizi/[servizio]/page.tsx', 'components/seller/RiquadroAbbonamento.tsx',
      'components/seller/servizi-nel-menu.ts', 'components/seller/SellerShell.tsx',
      'lib/modalita-demo.ts', 'lib/products/sdgSeller.ts', 'lib/stripe/webhook/servizi.ts',
      'lib/stripe/webhook/abbonamenti.ts', 'lib/agenzia/preventivo-col-codice.ts',
    ];
    for (const f of file) expect(readFileSync(path.join(RADICE, f), 'utf8'), f).not.toMatch(/['"`]\/seller\/preventivo/);
  });
});
