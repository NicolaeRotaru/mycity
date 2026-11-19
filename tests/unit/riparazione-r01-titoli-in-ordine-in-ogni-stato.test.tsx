/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * R01-001 — SU NOTIFICHE E MESSAGGI I TITOLI SALTAVANO DAL TITOLO PRINCIPALE AL TERZO LIVELLO.
 *
 * Si montano le due pagine vere, vuote, con la lettura caduta e piene, e si leggono i titoli
 * nell'ordine in cui li incontra un lettore di schermo, con in fondo l'h3 «MyCity» del piede
 * (components/Footer.tsx, che sulla pagina vera viene dopo). In ogni stato: prima l'h1, poi
 * nessun titolo più di un livello sotto il precedente.
 *
 * Seconda passata (collaudo): i due h2 nuovi degli stati vuoti («Nessuna conversazione»,
 * «Nessuna notifica») prendevano le regole di elemento di h2 in app/globals.css (serif, 20px,
 * spaziatura stretta): un paragrafo Inter da 16px diventava un titolo Fraunces da 20px. Qui si
 * guarda che portino le classi che rimettono l'aspetto di prima.
 */

const globali = globalThis as Record<string, unknown>;
const H3_DEL_PIEDE = 3;

type Opzioni = { queryKey: unknown[] };
type Stato = 'vuota' | 'errore' | 'piena';

const ora = Date.parse('2026-11-19T10:00:00Z');
const NOTIFICHE = Array.from({ length: 3 }, (_, i) => ({
  id: `n${i}`,
  user_id: 'u1',
  title: `Aggiornamento ${i}`,
  body: null,
  link: null,
  is_read: i > 0,
  created_at: new Date(ora - i * 3_600_000).toISOString(),
}));
const CONVERSAZIONE = {
  id: 'c1',
  buyer_id: 'u1',
  seller_id: 'pane',
  last_message_at: new Date(ora).toISOString(),
  last_message_preview: 'A che ora aprite?',
  buyer_unread_count: 0,
  seller_unread_count: 0,
  buyer: { id: 'u1', full_name: 'Marta', store_name: null },
  seller: null,
  insegna: 'Pane Quotidiano',
  insegnaNonLetta: false,
  cliente: null,
};
const CONVERSAZIONI = [CONVERSAZIONE, { ...CONVERSAZIONE, id: 'c2', seller_id: 'orto', insegna: 'Orto di Lia' }];

const PAGINE: Array<{ file: string; h1: string; vuoto: string; eLista: (o: Opzioni) => boolean; righe: unknown[] }> = [
  {
    file: 'app/messages/page.tsx',
    h1: 'Messaggi',
    vuoto: 'Nessuna conversazione',
    eLista: (o) => o.queryKey[0] === 'conversations' && o.queryKey[1] === 'u1',
    righe: CONVERSAZIONI,
  },
  {
    file: 'app/notifications/page.tsx',
    h1: 'Notifiche',
    vuoto: 'Nessuna notifica',
    eLista: (o) => o.queryKey[0] === 'notifications' && o.queryKey[1] === 'list',
    righe: NOTIFICHE,
  },
];

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__UTENTE__', '__DATI_QUERY__', '__ESITO_QUERY__']) globali[k] = undefined;
});

async function apri(pagina: (typeof PAGINE)[number], stato: Stato) {
  globali.__UTENTE__ = { id: 'u1' };
  globali.__DATI_QUERY__ = (o: Opzioni) => {
    if (o.queryKey[0] === 'auth') return { id: 'u1' };
    if (o.queryKey[0] === 'notifications' && o.queryKey[1] === 'count') return 0;
    if (pagina.eLista(o)) return stato === 'piena' ? pagina.righe : stato === 'vuota' ? [] : undefined;
    return undefined;
  };
  globali.__ESITO_QUERY__ = (o: Opzioni) =>
    stato === 'errore' && pagina.eLista(o)
      ? { data: undefined, isError: true, isSuccess: false, error: new Error('rete caduta') }
      : undefined;
  const mod = await monta(pagina.file);
  const s = accendi(mod.default);
  for (let i = 0; i < 4; i++) await attendi();
  return s;
}

const titoli = (radice: HTMLElement) => Array.from(radice.querySelectorAll('h1, h2, h3, h4, h5, h6'));

describe('R01-001 · su notifiche e messaggi i titoli non saltano un livello, in ogni stato', () => {
  for (const pagina of PAGINE) {
    for (const stato of ['vuota', 'errore', 'piena'] as Stato[]) {
      it(`${pagina.file} ${stato}: prima l'h1 «${pagina.h1}», poi nessun salto (piede compreso)`, async () => {
        const s = await apri(pagina, stato);
        const testo = s.radice.textContent ?? '';
        // Controprove: lo stato montato è quello che si dice.
        if (stato === 'vuota') expect(testo, 'controprova: la pagina doveva essere vuota').toContain(pagina.vuoto);
        if (stato === 'errore') expect(testo, 'controprova: la lettura doveva essere caduta').toMatch(/Non riusciamo a caricare/);
        if (stato === 'piena') expect(testo, 'controprova: la pagina doveva avere le sue righe').toMatch(/Pane Quotidiano|Aggiornamento 2/);

        const h = titoli(s.radice);
        const livelli = [...h.map((x) => Number(x.tagName[1])), H3_DEL_PIEDE];
        const elenco = h.map((x) => `${x.tagName.toLowerCase()} «${(x.textContent ?? '').trim()}»`).concat('h3 «MyCity» (piede)').join(' → ');
        expect(livelli[0], `${stato}: il primo titolo non è l'h1 — ${elenco}`).toBe(1);
        expect(h[0]?.textContent?.trim()).toBe(pagina.h1);
        const salti = livelli.filter((l, i) => i > 0 && l > livelli[i - 1] + 1);
        expect(salti, `${stato}: i titoli saltano un livello — ${elenco}`).toEqual([]);
        s.smonta();
      }, 60000);
    }

    it(`${pagina.file} vuota: «${pagina.vuoto}» è un h2 con l'aspetto del paragrafo di prima (Inter, 16px, spaziatura normale)`, async () => {
      const s = await apri(pagina, 'vuota');
      const h2 = titoli(s.radice).find((x) => (x.textContent ?? '').trim() === pagina.vuoto);
      expect(h2?.tagName, `«${pagina.vuoto}» non è un titolo di secondo livello`).toBe('H2');
      const classi = Array.from(h2!.classList);
      for (const c of ['font-sans', 'text-base', 'tracking-normal', 'font-semibold', 'text-ink-600']) {
        expect(classi, `a «${pagina.vuoto}» manca ${c}: prende la regola di h2 di app/globals.css`).toContain(c);
      }
      expect(classi.filter((c) => /^(font-serif|text-(xs|sm|lg|xl|[2-9]xl)|tracking-(tight|tighter|display|editorial))$/.test(c))).toEqual([]);
      s.smonta();
    }, 60000);
  }
});
