import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * DUE DIFETTI CHE FERMANO QUALCUNO, TROVATI DALLA RADIOGRAFIA DEL DESIGN (21/8/2026).
 *
 * ① IL PULSANTE SOS DEL FATTORINO ERA COPERTO IN PIENO DALL'ASSISTENZA.
 *    I due pulsanti flottanti avevano la scatola identica: stesso angolo,
 *    stessa misura, stesso piano (`bottom-24 right-4 z-40 w-14 h-14`). Quando
 *    due cose stanno sullo stesso piano vince quella disegnata dopo, e
 *    l'Assistenza è montata dopo nella pagina. Sotto i 768px il SOS non si
 *    poteva premere — e il fattorino lavora dal telefono.
 *
 * ② IL TOUR DI BENVENUTO SI APRIVA SOPRA IL PAGAMENTO.
 *    Parte un secondo e mezzo dopo l'apertura della pagina per chi si è appena
 *    registrato, e nessuna pagina era esclusa. Il sito chiede l'account proprio
 *    all'ultimo clic del checkout: quasi tutti si registrano mentre stanno
 *    comprando, e il tour gli compariva davanti mentre pagavano. L'ultimo suo
 *    pulsante manda alla ricerca, cioè via dall'ordine.
 *
 * Sono difetti di posizione e di condizione: si leggono nel codice, e per questo
 * si possono difendere da qui senza aprire un browser.
 */

const RADICE = resolve(__dirname, '..', '..');
const leggi = (f: string) => readFileSync(resolve(RADICE, f), 'utf8');

/**
 * La scatola di un pulsante flottante: angolo, distanza dal fondo, piano.
 *
 * 3/9/2026 — LA DISTANZA DAL FONDO PUÒ NON STARE PIÙ FRA LE CLASSI.
 *
 * Il pulsante dell'assistenza stava a un numero fisso (`bottom-24`) e finiva sopra il lato destro
 * di «Aggiungi al carrello»: il tocco apriva la chat invece di comprare. Adesso somma le corsie
 * occupate in fondo allo schermo (`lib/ui/barra-in-fondo.ts`) e scrive il risultato in `style`.
 * Se questa lettura restasse ferma alle sole classi, tornerebbe `null` e il controllo qui sotto
 * smetterebbe di guardare proprio il pulsante che deve guardare — passando per finta.
 */
function scatolaFlottante(sorgente: string): { bottom: string; right: string; z: string } | null {
  const m = sorgente.match(/className="fixed (?:(bottom-[\w[\]-]+)\s[^"]*?)?(right-[\w[\]-]+)\s(z-[\w[\]-]+)/);
  if (!m) return null;
  const dalloStile = sorgente.match(/style=\{\{\s*bottom:\s*([\s\S]+?)\s*\}\}/);
  const bottom = m[1] ?? dalloStile?.[1];
  return bottom ? { bottom, right: m[2], z: m[3] } : null;
}

describe('il pulsante di emergenza del fattorino', () => {
  it('non sta nello stesso punto del pulsante Assistenza', () => {
    const sos = scatolaFlottante(leggi('components/rider/SOSButton.tsx'));
    const assistenza = scatolaFlottante(leggi('components/SupportChatButton.tsx'));

    expect(sos, 'non ho trovato la scatola del SOS: il controllo non misura niente').not.toBeNull();
    expect(assistenza, 'non ho trovato la scatola dell Assistenza').not.toBeNull();

    const stessoPunto = sos!.bottom === assistenza!.bottom && sos!.right === assistenza!.right;
    expect(stessoPunto, 'SOS e Assistenza sono di nuovo nello stesso angolo: uno copre l altro').toBe(false);
  });

  it('sta su un piano più alto di ogni altro pulsante flottante', () => {
    const sos = scatolaFlottante(leggi('components/rider/SOSButton.tsx'));
    expect(sos!.z, 'il SOS è tornato sul piano comune: chi viene disegnato dopo lo copre').toBe('z-emergenza');

    // E quel piano deve esistere davvero ed essere sopra `overlay`, dove
    // stanno gli altri pulsanti flottanti.
    const tw = leggi('tailwind.config.ts');
    const emergenza = tw.match(/'emergenza':\s*'(\d+)'/);
    const overlay = tw.match(/'overlay':\s*'(\d+)'/);
    expect(emergenza, 'il piano «emergenza» non esiste nei token').not.toBeNull();
    expect(Number(emergenza![1])).toBeGreaterThan(Number(overlay![1]));
  });
});

describe('il tour di benvenuto', () => {
  it('non parte mentre qualcuno sta comprando', () => {
    const tour = leggi('components/BuyerOnboardingTour.tsx');
    expect(tour, 'il tour non guarda più su quale pagina si trova').toMatch(/usePathname/);
    for (const pagina of ['/checkout', '/cart', '/orders/']) {
      expect(tour, `il tour può ancora aprirsi su ${pagina}`).toContain(`startsWith('${pagina}')`);
    }
    expect(tour, 'la condizione di uscita non è agganciata all effetto che apre il tour')
      .toMatch(/if \(dentroUnAcquisto\) return;/);
  });
});
