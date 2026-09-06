/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca, premi } from './aiuti/schermo';

/**
 * 6/9/2026 — IL PANNELLO SI APRIVA, MA NON CI SI ENTRAVA E NON CI STAVA.
 *
 * Sotto l'header c'è il pulsante «Tutte le categorie»: è la porta principale al
 * catalogo. Due cose non tornavano.
 *
 * ① DA TASTIERA NON CI SI ENTRAVA. Il pannello, nell'ordine della pagina, viene
 * DOPO le sette destinazioni della barra. Chi apriva il pannello e premeva Tab
 * non finiva dentro al pannello appena aperto, ma sulla voce «Tutti i negozi»
 * della barra: il pannello restava lì aperto, scavalcato. Con Esc invece il
 * fuoco tornava già sul pulsante (corretto il 27/8), e quello resta.
 *
 * ② NON CI STAVA NELLO SCHERMO. Il pannello elenca tutte le categorie
 * principali con fino a sei sottocategorie ciascuna, su telefono in due
 * colonne: molto più alto di uno schermo, e sopra al resto della pagina. Ora si
 * ferma e scorre dentro di sé.
 *
 * Sul secondo punto, avviso onesto: qui non c'è un motore che impagina, quindi
 * la prova guarda che il pannello nasca con un tetto d'altezza e con lo
 * scorrimento suo. Quanto è alto per davvero su un telefono si vede solo
 * aprendolo su un telefono.
 */

const CATEGORIE_FINTE = [
  { id: 'a', slug: 'gastronomia', name: 'Gastronomia', parent_id: null, icon: null },
  { id: 'b', slug: 'pane', name: 'Pane', parent_id: 'a', icon: null },
];

/**
 * Lo schermo acceso dalla prova in corso. Si smonta da solo alla fine, anche
 * quando la prova fallisce: se un componente resta appeso al documento, la
 * prova dopo non riesce nemmeno ad aprire il pannello e diventa rossa per il
 * motivo sbagliato — un rosso che non indica più niente.
 */
let schermo: { smonta: () => void } | null = null;

async function barraAperta() {
  const mod = await monta('components/CategoryBar.tsx');
  const s = accendi(mod.default, {});
  schermo = s;
  const apri = s.radice.querySelector('button') as HTMLButtonElement;
  s.agisci(() => {
    apri.focus();
    clicca(apri);
  });
  const pannello = s.radice.querySelector('#mega-menu-categorie') as HTMLElement;
  expect(pannello, 'Il pannello delle categorie non si è aperto: la prova non guarda niente').toBeTruthy();
  return { s, apri, pannello };
}

describe('il pannello «Tutte le categorie»', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = CATEGORIE_FINTE;
  });

  afterEach(() => {
    schermo?.smonta();
    schermo = null;
  });

  it('all\'apertura porta il fuoco dentro, non sulla barra dietro', async () => {
    const { s, pannello } = await barraAperta();

    const primoLink = pannello.querySelector('a[href]');
    expect(primoLink, 'Il pannello si apre vuoto').toBeTruthy();
    expect(
      pannello.contains(document.activeElement),
      'Aperto il pannello, chi naviga da tastiera premeva Tab e finiva sulle voci della barra dietro: il pannello restava aperto e scavalcato',
    ).toBe(true);
    expect(document.activeElement, 'Il fuoco deve entrare sul primo link del pannello').toBe(primoLink);
  }, 60000);

  it('con Esc si chiude e restituisce il fuoco al pulsante', async () => {
    const { s, apri } = await barraAperta();

    s.agisci(() => premi('Escape'));
    expect(s.radice.querySelector('#mega-menu-categorie'), 'Esc doveva chiudere il pannello').toBeFalsy();
    expect(
      document.activeElement,
      'Chiuso il pannello il fuoco deve tornare sul pulsante che l\'aveva aperto',
    ).toBe(apri);
  }, 60000);

  it('non si dichiara un menu: dentro ha solo link normali', async () => {
    const { s, apri, pannello } = await barraAperta();

    expect(
      apri.getAttribute('aria-haspopup'),
      'Il pulsante prometteva un menu con le frecce, che non è mai esistito',
    ).not.toBe('menu');
    expect(
      pannello.getAttribute('role'),
      'Dentro un role="menu" senza voci di menu, alcuni lettori di schermo nascondono tutto il contenuto',
    ).not.toBe('menu');
  }, 60000);

  it('si ferma prima di superare lo schermo e scorre dentro di sé', async () => {
    const { s, pannello } = await barraAperta();
    const classi = pannello.className;

    expect(
      /max-h-\[[^\]]+\]|max-h-screen/.test(classi),
      'Il pannello elenca tutte le categorie senza un tetto d\'altezza: su un telefono diventa più alto dello schermo e copre la pagina sotto',
    ).toBe(true);
    expect(
      /overflow-y-(auto|scroll)/.test(classi),
      'Un tetto d\'altezza senza scorrimento proprio taglierebbe via le categorie in fondo',
    ).toBe(true);
  }, 60000);
});
