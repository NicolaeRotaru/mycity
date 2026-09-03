import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sizedImage } from '@/lib/image-url';
import caricatoreFotoRemote from '@/lib/image-loader';

/**
 * 3/9/2026 — DELLA LOCANDINA DI UN EVENTO, IN HOME, RESTAVA LA FASCIA CENTRALE.
 *
 * ── Il difetto, in parole semplici ───────────────────────────────────────────────────────────
 * L'admin carica la locandina di un evento: 16:9, col titolo a sinistra, la data in basso e il
 * logo del negozio in un angolo. Nella pagina Eventi si vedeva intera. Nella striscia in home
 * arrivava tagliata, e ne restava circa la meta' centrale: via il titolo, via la data, via il
 * logo. La STESSA immagine, due pagine, due risultati diversi.
 *
 * ── Perche' succedeva, e perche' non si vedeva ───────────────────────────────────────────────
 * Il taglio non lo faceva il riquadro: lo faceva il server delle immagini. La misura `card`
 * scrive nell'indirizzo un'altezza uguale alla larghezza con `resize=cover` — cioe' «ritaglia un
 * quadrato» — e va bene per una scheda prodotto, che e' quadrata. Su una copertina 16:9 butta via
 * le due fasce laterali; poi il riquadro 16:9 della home, con `object-cover`, butta via sopra e
 * sotto quel che resta. Due tagli in fila.
 *
 * Il caricatore delle foto non salvava niente, e vale la pena dirlo perche' e' controintuitivo:
 * lui riallinea l'altezza alla larghezza che il browser chiede, ma solo SE nell'indirizzo
 * un'altezza c'e' gia'. Con `card` c'e'; con `detail` no, e allora il server rimpicciolisce e
 * basta.
 *
 * ── Che prova e' questa ──────────────────────────────────────────────────────────────────────
 * Il primo blocco ESEGUE il pezzo che decide il taglio — `sizedImage` e poi il caricatore, la
 * stessa catena che gira nel browser — e guarda l'indirizzo che ne esce: se dentro c'e'
 * un'altezza, l'immagine viene ritagliata. Il secondo blocco tiene insieme le due pagine: la
 * stessa copertina non puo' essere trattata in due modi, che e' il difetto vero. Le due pagine non
 * si possono montare qui (chiedono i dati a Supabase), quindi la seconda meta' legge il sorgente:
 * e' l'invariante, ed e' rossa il giorno che una delle due torna a chiedere un ritaglio.
 */

/** Una copertina come quella caricata dall'admin: sta nello Storage di casa nostra. */
const COPERTINA = 'https://esempio.supabase.co/storage/v1/object/public/products/home/locandina.jpg';

/** Se nell'indirizzo finale c'e' un'altezza, il server consegna un ritaglio, non la foto intera. */
function vieneRitagliata(misura: 'thumb' | 'card' | 'detail' | 'hero'): boolean {
  const conMisura = sizedImage(COPERTINA, misura);
  // La larghezza vera la chiede il browser: e' il caricatore a metterla nell'indirizzo.
  const finale = caricatoreFotoRemote({ src: conMisura, width: 640, quality: 75 });
  return new URL(finale).searchParams.has('height');
}

/**
 * La misura chiesta per la copertina di un evento dentro un file, letta dal sorgente.
 * Torna `null` se in quel file nessuno chiede la copertina di un evento.
 */
function misuraDellaCopertina(file: string): string | null {
  const sorgente = readFileSync(file, 'utf8');
  const m = sorgente.match(/sizedImage\(\s*[\w.]*cover_image_url\s*,\s*'([a-z]+)'/);
  return m ? m[1] : null;
}

const HOME = 'components/home/HomeEvents.tsx';
const PAGINA = 'app/events/page.tsx';

describe('il taglio della copertina lo decide la misura chiesta', () => {
  it('con «card» il server consegna un quadrato: e questo mangiava la locandina', () => {
    // Il difetto eseguito, non raccontato: e' questa riga che dice perche' la cura serve.
    expect(vieneRitagliata('card')).toBe(true);
  });

  it('con «detail» non c e nessuna altezza: la foto arriva intera, solo piu piccola', () => {
    expect(vieneRitagliata('detail')).toBe(false);
  });

  it('il caricatore da solo non basta a evitare il taglio', () => {
    // Controintuitivo, e per questo scritto: il caricatore riallinea l'altezza alla larghezza
    // chiesta, ma l'altezza nell'indirizzo ce l'ha messa `card` prima di lui.
    const finale = caricatoreFotoRemote({ src: sizedImage(COPERTINA, 'card'), width: 320, quality: 75 });
    expect(new URL(finale).searchParams.get('height')).toBe('320');
  });
});

describe('la stessa copertina, sulle due pagine che la mostrano', () => {
  it('in home la locandina non viene piu ritagliata', () => {
    const misura = misuraDellaCopertina(HOME);
    expect(misura, `${HOME} non chiede piu la copertina dell'evento: la prova non sta misurando niente`).toBeTruthy();
    expect(
      vieneRitagliata(misura as 'card' | 'detail'),
      `la striscia eventi in home chiede «${misura}»: di una locandina 16:9 resta la fascia centrale`,
    ).toBe(false);
  });

  it('nella pagina Eventi nemmeno, come e sempre stato', () => {
    const misura = misuraDellaCopertina(PAGINA);
    expect(misura, `${PAGINA} non chiede piu la copertina dell'evento`).toBeTruthy();
    expect(vieneRitagliata(misura as 'card' | 'detail')).toBe(false);
  });

  it('e le due pagine chiedono la STESSA cosa: era questa la differenza da spiegare', () => {
    // Non pretende una misura in particolare — pretende che non divergano di nuovo in silenzio.
    expect(misuraDellaCopertina(HOME)).toBe(misuraDellaCopertina(PAGINA));
  });
});

/**
 * 3/9/2026 — E la copertina non deve passare dall'ottimizzatore interno di Next.
 *
 * Il campo che l'admin compila accetta un indirizzo qualsiasi, ma l'ottimizzatore di Next accetta
 * solo i quattro domini scritti in `next.config.js`. Con un indirizzo fuori elenco, in sviluppo
 * Next SOLLEVA un errore mentre disegna — e la pagina Eventi non si vedeva piu' — mentre in
 * produzione risponde 400 e il riquadro resta vuoto. Col caricatore quel controllo non c'e': la
 * pagina regge, e la copertina che il browser blocca lascia solo un riquadro vuoto dentro una
 * scheda che si usa lo stesso.
 *
 * ⚠️ Quello che questa prova NON copre: l'avviso all'admin quando incolla un indirizzo non
 * ammesso. Vive nel campo (`components/ImageUrlField.tsx`) e resta da fare.
 */
describe('la copertina non passa dall ottimizzatore interno', () => {
  for (const file of [HOME, PAGINA]) {
    it(`${file} passa la copertina al caricatore del CDN`, () => {
      const sorgente = readFileSync(file, 'utf8');
      const blocco = sorgente.match(/<Image[\s\S]{0,700}?cover_image_url[\s\S]{0,700}?\/>/);
      expect(blocco, `in ${file} non trovo piu l'immagine della copertina`).toBeTruthy();
      expect(
        blocco?.[0],
        `senza «loader» la copertina passa da /_next/image: con un indirizzo fuori elenco la pagina cade in sviluppo e risponde 400 in produzione`,
      ).toContain('loader={caricatoreFotoRemote}');
    });
  }
});
