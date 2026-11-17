/**
 * @vitest-environment jsdom
 */
/**
 * R10-012 — NELLE NOTIFICHE IL TASTO «CARICA ALTRE» SPARIVA MENTRE CARICAVA, E UN ERRORE CANCELLAVA
 * DALLA PAGINA L'ELENCO GIÀ LETTO.
 *
 * Premuto «Carica altre», la domanda nuova (100 invece di 50) mostra l'elenco di prima come
 * segnaposto: 50 righe su 100 chieste, e il tasto si nascondeva («ne sono arrivate meno di quante ne
 * ho chieste»). Se poi la lettura cadeva, la pagina intera diventava l'errore e le 50 notifiche già a
 * video sparivano.
 *
 * Qui si monta la pagina vera; react-query è quello finto delle prove: la prova dice cosa risponde
 * la domanda da 50 (letta) e quella da 100 (in corso, oppure caduta), come fa react-query 5.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;

const ora = Date.parse('2026-11-13T10:00:00Z');
const cinquanta = Array.from({ length: 50 }, (_, i) => ({
  id: `n${i}`,
  user_id: 'u1',
  title: `Aggiornamento ${i}`,
  body: null,
  link: null,
  is_read: true,
  created_at: new Date(ora - i * 3_600_000).toISOString(),
}));

type Opzioni = { queryKey: unknown[] };
const eLista = (o: Opzioni, quante: number) =>
  o.queryKey[0] === 'notifications' && o.queryKey[1] === 'list' && o.queryKey[2] === quante;

const pulsante = (radice: HTMLElement, testo: RegExp) =>
  Array.from(radice.querySelectorAll('button')).find((b) => testo.test((b.textContent ?? '').trim())) ?? null;

/** Apre la pagina con le prime 50 lette e preme «Carica altre»: la domanda da 100 risponde `cento`. */
async function premiCaricaAltre(cento: Record<string, unknown>) {
  globali.__DATI_QUERY__ = (o: Opzioni) => {
    if (o.queryKey[0] === 'auth') return { id: 'u1' };
    if (o.queryKey[1] === 'count') return 0;
    if (eLista(o, 50)) return cinquanta;
    if (eLista(o, 100)) return cento.data;
    return undefined;
  };
  globali.__ESITO_QUERY__ = (o: Opzioni) => (eLista(o, 100) ? cento : undefined);
  const mod = await monta('app/notifications/page.tsx');
  const s = accendi(mod.default);
  await attendi();
  const altre = pulsante(s.radice, /^Carica altre$/);
  expect(altre, 'con 50 notifiche su 50 chieste il tasto «Carica altre» c’è').not.toBeNull();
  s.agisci(() => clicca(altre!));
  await attendi();
  return s;
}

beforeEach(() => {
  globali.__UTENTE__ = { id: 'u1' };
});

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__UTENTE__', '__DATI_QUERY__', '__ESITO_QUERY__']) globali[k] = undefined;
});

describe('R10-012 · «Carica altre» resta al suo posto e un errore non cancella l’elenco', () => {
  it('mentre carica, il tasto resta visibile, disattivato, e dice che sta caricando', async () => {
    // react-query 5 con keepPreviousData: i dati di prima come segnaposto, lettura in corso.
    const s = await premiCaricaAltre({ data: cinquanta, isPlaceholderData: true, isFetching: true });
    const tasto = pulsante(s.radice, /Caricamento|Carica altre/);
    expect(tasto, 'mentre carica le altre, il tasto è sparito').not.toBeNull();
    expect(tasto!.disabled, 'mentre carica, il tasto si può premere di nuovo').toBe(true);
    expect(tasto!.textContent).toMatch(/Caricamento/);
    expect(s.radice.textContent).toContain('Aggiornamento 49');
    s.smonta();
  }, 60000);

  it('se «Carica altre» cade, le 50 già lette restano e l’errore si dice accanto, con «Riprova»', async () => {
    // react-query 5: la domanda nuova non ha dati suoi, e il segnaposto finisce con l'errore.
    const s = await premiCaricaAltre({
      data: undefined, isPlaceholderData: false, isFetching: false,
      isError: true, isSuccess: false, error: new Error('rete caduta'),
    });
    const testo = s.radice.textContent ?? '';
    expect(testo, 'l’errore ha cancellato le notifiche già lette').toContain('Aggiornamento 0');
    expect(testo).toContain('Aggiornamento 49');
    expect(testo).toContain('Non riusciamo a caricare altre notifiche');
    expect(pulsante(s.radice, /^Riprova$/), 'accanto all’errore manca «Riprova»').not.toBeNull();
    s.smonta();
  }, 60000);
});
