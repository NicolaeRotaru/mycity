/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ShippingPage from '@/app/shipping/page';
import { ShippingAddressForm } from '@/components/checkout/ShippingAddressForm';
import LocationPill from '@/components/LocationPill';
import { RAGGIO_CONSEGNA_KM, RITIRO_IN_NEGOZIO_ATTIVO } from '@/lib/constants';
import { motivoFuoriZona } from '@/lib/ordini/zona-di-consegna';
import { testoVisibile } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

/**
 * 28/10/2026 (sesto giro) — QUATTRO FRASI PROMETTEVANO POSTI CHE LA CASSA RIFIUTA.
 *
 * Col confine a 5 km (correzione di Nicola del 28/10) dentro ci sta Piacenza città; Podenzano,
 * Rottofreno, Gossolengo e la prima cintura restano fuori. Tre frasi dicevano ancora «Piacenza e
 * dintorni»: la riga sotto il CAP in cassa, la pagina Spedizioni e il messaggio con cui la cassa
 * rifiuta un indirizzo troppo lontano. La pillola dell'indirizzo, in cima a ogni pagina, diceva
 * «In MVP serviamo Piacenza e provincia»: scritta a mano, e falsa già col confine a 10 km. Chi
 * abita a Podenzano leggeva «dintorni», compilava tutto e si sentiva dire di no al clic finale.
 *
 * Qui il confine si finge a 3 km, e le quattro frasi si leggono come le legge la persona: montate
 * sullo schermo, o restituite dalla funzione con cui la cassa rifiuta. Ognuna deve dire «fino a
 * 3 km dal negozio» e nessun altro chilometro: un numero scritto a mano (il 5 di oggi, il 10 di
 * ieri) resterebbe lì il giorno in cui il confine cambia. E nessuna deve promettere i dintorni o la
 * provincia.
 *
 * Finti: il confine (3 km) e, per una prova sola, l'interruttore del ritiro in negozio. Le frasi,
 * i componenti e la funzione della cassa sono veri.
 */

/** L'interruttore del ritiro in negozio: `null` = il valore vero, come lo trova il sito. */
const finto = vi.hoisted(() => ({ ritiroAttivo: null as boolean | null }));

vi.mock('@/lib/constants', async (importOriginal) => {
  const veri = await importOriginal<typeof import('@/lib/constants')>();
  return {
    ...veri,
    RAGGIO_CONSEGNA_KM: 3,
    get RITIRO_IN_NEGOZIO_ATTIVO() {
      return finto.ritiroAttivo ?? veri.RITIRO_IN_NEGOZIO_ATTIVO;
    },
  };
});

/** Ogni distanza in chilometri scritta nel testo: «3 km», «4,5 km». */
function chilometriIn(testo: string): number[] {
  return [...testo.matchAll(/(\d+(?:[.,]\d+)?)\s*km\b/gi)].map((m) => Number(m[1].replace(',', '.')));
}

/** Quello che deve fare ogni frase sulla zona: dire il confine della cassa, solo quello, e niente oltre. */
function diceIlConfine(dove: string, testo: string) {
  expect(testo, `${dove} non dice fin dove consegniamo come lo dice il resto del sito: «${testo}»`).toContain(
    `fino a ${RAGGIO_CONSEGNA_KM} km dal negozio`,
  );
  const km = chilometriIn(testo);
  expect(km, `${dove} scrive un chilometro che non è il confine della cassa (${RAGGIO_CONSEGNA_KM} km): «${testo}»`).toEqual(
    km.map(() => RAGGIO_CONSEGNA_KM),
  );
  expect(testo, `${dove} promette posti oltre il confine: «${testo}»`).not.toMatch(/dintorni|provincia|cintura|limitrof/i);
}

const PROPS_DEL_MODULO = {
  form: { fullName: '', address: '', city: 'Piacenza', zip: '29121', phone: '', notes: '' },
  savedAddresses: [],
  errors: {},
  onChange: () => {},
  onSubmit: (e: { preventDefault?: () => void }) => e.preventDefault?.(),
  onApplySavedAddress: () => {},
};

const smontaDopo: Array<() => void> = [];
afterEach(() => {
  while (smontaDopo.length) smontaDopo.pop()?.();
  finto.ritiroAttivo = null;
  localStorage.clear();
});

describe('le frasi sulla zona dicono il confine della cassa, letto da dove è deciso', () => {
  it('la prova finge davvero un confine diverso da quello vero (se no non misura niente)', () => {
    expect(RAGGIO_CONSEGNA_KM).toBe(3);
  });

  it('in cassa, la riga sotto il CAP: quella che il lettore di schermo legge col campo', () => {
    const s = accendi(ShippingAddressForm, PROPS_DEL_MODULO);
    smontaDopo.push(s.smonta);
    const cap = s.radice.querySelector('input[name="zip"]');
    expect(cap, 'non trovo il campo del CAP nel modulo dell’indirizzo').toBeTruthy();
    const descrizione = (cap!.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => testoVisibile(s.doc.getElementById(id)))
      .join(' ');
    diceIlConfine('La riga sotto il CAP', descrizione);
  });

  it('la pagina Spedizioni, tutta', () => {
    const pagina = document.createElement('div');
    pagina.innerHTML = renderToStaticMarkup(<ShippingPage />);
    diceIlConfine('La pagina Spedizioni', testoVisibile(pagina));
  });

  it('il messaggio con cui la cassa rifiuta un indirizzo troppo lontano, col ritiro in negozio spento e acceso', () => {
    for (const acceso of [false, true]) {
      finto.ritiroAttivo = acceso;
      expect(RITIRO_IN_NEGOZIO_ATTIVO, 'la prova non riesce a girare l’interruttore del ritiro').toBe(acceso);
      const detto = motivoFuoriZona('Pane Quotidiano');
      diceIlConfine(`Il rifiuto della cassa (ritiro ${acceso ? 'acceso' : 'spento'})`, detto);
      expect(detto, 'il rifiuto non nomina il negozio').toContain('Pane Quotidiano');
      expect(detto.includes('Puoi ritirare in negozio'), 'il rifiuto offre il ritiro solo quando è acceso').toBe(acceso);
    }
  });

  it('la tendina della pillola dell’indirizzo, in cima a ogni pagina', () => {
    const s = accendi(LocationPill, { compact: true });
    smontaDopo.push(s.smonta);
    const pillola = [...s.radice.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Cambia indirizzo di consegna');
    expect(pillola, 'la pillola dell’indirizzo non c’è più: la prova non guarda niente').toBeTruthy();
    s.agisci(() => clicca(pillola!));
    const tendina = s.radice.querySelector('[role="dialog"]');
    expect(tendina, 'la pillola non apre più la tendina').toBeTruthy();
    diceIlConfine('La tendina della pillola', testoVisibile(tendina));
  });
});
