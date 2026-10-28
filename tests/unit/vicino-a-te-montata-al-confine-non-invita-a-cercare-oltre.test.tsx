/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import NearMePage from '@/app/near/page';
import { RAGGIO_CONSEGNA_KM } from '@/lib/constants';
import { avvisoNessunNegozioVicino } from '@/lib/promesse-pubbliche';
import { accendi, clicca } from './aiuti/schermo';

/**
 * 27/10/2026 (quinto giro) — «VICINO A TE», MONTATA, AL CONFINE NON INVITA A CERCARE OLTRE.
 *
 * La prova del quarto giro leggeva il sorgente della pagina e cercava le parole di un invito:
 * «aumenta», «allarga», «più lontano». Il collaudo ha attaccato all'avviso della lista vuota
 * «Sposta il cursore verso destra per cercare più in là.» e tutto è rimasto verde. Al confine
 * quella frase sta subito dopo «oltre non arriviamo»: promette una ricerca che la cassa poi
 * rifiuta. Era un'altra lista di parole proibite, e una lista così non finisce mai.
 *
 * Qui la pagina si monta davvero e si fa quello che fa una persona: tocca «Ordina per vicinanza»,
 * il telefono dà la posizione, l'unico negozio sta a 15 km. Si legge la pagina a 5 km, poi si porta
 * il cursore in fondo, fin dove arriva, e si rilegge. Ogni frase è tenuta ferma come è stata riletta
 * contro la cassa il 27/10: si consegna fino a 10 km dal negozio, oltre no.
 *
 * SE QUESTA PROVA DIVENTA ROSSA perché hai cambiato una frase: rileggi la frase nuova contro quello
 * che fa la cassa, e solo allora aggiorna il testo qui sotto.
 *
 * Finti: l'elenco dei negozi (arriva da useQuery), la mappa, la riga del negozio e la posizione del
 * telefono. La pagina, i suoi stati, il cursore e le frasi sono veri.
 */

const CASA = { lat: 45.0526, lng: 9.6929 };
const KM_PER_GRADO = 111.195;
/** L'unico negozio, 15 km a nord della casa: oltre il confine, quindi la lista resta vuota. */
const ELENCO = {
  stores: [{ id: 'negozio-lontano', store_name: 'Bottega lontana', store_lat: CASA.lat + 15 / KM_PER_GRADO, store_lng: CASA.lng }],
  productsByStore: {},
  reviewsByStore: {},
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: ELENCO, isLoading: false, isError: false, refetch: () => undefined }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/NearbyStoresMapLazy', () => ({ default: () => null }));
vi.mock('@/components/StoreListRow', () => ({ default: () => null }));

const KM = RAGGIO_CONSEGNA_KM;

/** Le frasi come le legge la persona: un blocco per paragrafo, voce d'elenco, titolo o riquadro. */
function frasiDi(radice: HTMLElement): string[] {
  const copia = radice.cloneNode(true) as HTMLElement;
  // I dati per i motori di ricerca non li legge la persona.
  copia.querySelectorAll('script, style').forEach((n) => n.remove());
  return copia.innerHTML
    .split(/<\/(?:p|li|div|h[1-6])>|<br\s*\/?>/i)
    .map((b) =>
      b
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/[ \t\r\n]+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}

/** Porta il cursore a un valore come lo trascina una persona: React se ne accorge solo così. */
function sposta(cursore: HTMLInputElement, valore: string) {
  const imposta = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  imposta?.call(cursore, valore);
  cursore.dispatchEvent(new window.Event('input', { bubbles: true }));
}

const smontaDopo: Array<() => void> = [];
afterEach(() => {
  while (smontaDopo.length) smontaDopo.pop()?.();
});

/** Monta la pagina e dà la posizione, come dopo il tocco su «Ordina per vicinanza». */
function paginaConLaPosizione() {
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) =>
        ok({ coords: { latitude: CASA.lat, longitude: CASA.lng } }),
    },
  });
  const s = accendi(NearMePage);
  smontaDopo.push(s.smonta);
  const bottone = [...s.radice.querySelectorAll('button')].find((b) => b.textContent?.includes('Ordina per vicinanza'));
  expect(bottone, 'la pagina non offre più di ordinare per vicinanza: la prova non arriva al cursore').toBeTruthy();
  s.agisci(() => clicca(bottone as HTMLButtonElement));
  const cursore = s.radice.querySelector('input[type="range"]') as HTMLInputElement | null;
  expect(cursore, 'con la posizione il cursore del raggio non compare').toBeTruthy();
  return { s, cursore: cursore as HTMLInputElement };
}

const TESTATA = ['Home', 'Vicino a te', 'Negozi vicini', 'Vicino a te', `I negozi della tua zona a Piacenza: consegniamo fino a ${KM} km dal negozio.`];

describe('«Vicino a te», montata, dice il confine com’è e non invita a cercare oltre', () => {
  /*
   * 28/10/2026 — Il confine è sceso a 5 km (correzione di Nicola) e la pagina si apre al confine, letto
   * da RAGGIO_CONSEGNA_KM: all'apertura il cursore è già in fondo, e l'invito ad aumentare il raggio non
   * c'è. Torna solo se si porta il cursore sotto il confine, perché solo allora il cursore può salire.
   */
  it('all’apertura, al confine e con la lista vuota: nessun invito ad aumentare il raggio; torna solo se il cursore può salire', () => {
    const { s, cursore } = paginaConLaPosizione();
    expect(cursore.max, 'il cursore va oltre il confine della cassa').toBe(String(KM));
    expect(cursore.value, 'la pagina non si apre al confine della cassa').toBe(String(KM));
    expect(frasiDi(s.radice), 'la pagina «Vicino a te» è cambiata: rileggi le frasi contro la cassa').toEqual([
      ...TESTATA,
      `0 negozi entro ${KM} km`,
      'Lista Mappa',
      `Raggio: ${KM} km`,
      `Nessun negozio entro ${KM} km. Per ora consegniamo fino a ${KM} km dal negozio, e oltre non arriviamo.`,
    ]);
    const sotto = Math.max(1, KM - 2);
    s.agisci(() => sposta(cursore, String(sotto)));
    expect(cursore.value).toBe(String(sotto));
    expect(frasiDi(s.radice), 'sotto il confine la pagina «Vicino a te» dice qualcosa che non è stato riletto').toEqual([
      ...TESTATA,
      `0 negozi entro ${sotto} km`,
      'Lista Mappa',
      `Raggio: ${sotto} km`,
      avvisoNessunNegozioVicino(sotto),
    ]);
    expect(avvisoNessunNegozioVicino(sotto)).toBe(`Nessun negozio entro ${sotto} km. Aumenta il raggio per vederne di più.`);
  });

  it('IL CASO DEL COLLAUDO — col cursore in fondo, al confine: «oltre non arriviamo», e nessuna frase dopo', () => {
    const { s, cursore } = paginaConLaPosizione();
    expect(cursore.max, 'il cursore va oltre il confine della cassa').toBe(String(KM));
    s.agisci(() => sposta(cursore, cursore.max));
    expect(cursore.value).toBe(String(KM));
    expect(frasiDi(s.radice), 'al confine la pagina «Vicino a te» dice qualcosa che non è stato riletto').toEqual([
      ...TESTATA,
      `0 negozi entro ${KM} km`,
      'Lista Mappa',
      `Raggio: ${KM} km`,
      `Nessun negozio entro ${KM} km. Per ora consegniamo fino a ${KM} km dal negozio, e oltre non arriviamo.`,
    ]);
  });

  it('anche sulla mappa, col cursore in fondo, nessuna frase in più', () => {
    const { s, cursore } = paginaConLaPosizione();
    s.agisci(() => sposta(cursore, cursore.max));
    const mappa = [...s.radice.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Mappa');
    expect(mappa, 'la pagina non offre più la mappa').toBeTruthy();
    s.agisci(() => clicca(mappa as HTMLButtonElement));
    expect(mappa?.getAttribute('aria-pressed')).toBe('true');
    expect(frasiDi(s.radice)).toEqual([...TESTATA, `0 negozi entro ${KM} km`, 'Lista Mappa', `Raggio: ${KM} km`]);
  });
});
