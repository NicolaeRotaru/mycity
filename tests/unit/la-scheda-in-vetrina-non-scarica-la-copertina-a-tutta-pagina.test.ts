/**
 * LA VETRINA SCARICAVA SEI COPERTINE DA PAGINA INTERA, E LE MARCAVA URGENTI.
 *
 * `StoreMediaCarousel` serviva due posti con una misura sola: chiedeva la foto
 * da 1200 pixel e dichiarava al browser `sizes="…1024px"` anche dentro la
 * scheda della vetrina, che è alta 112 punti e larga circa 300. Con sei negozi
 * in vetrina erano sei foto grandi, e la prima di ognuna aveva `priority`: sei
 * precaricamenti urgenti nell'intestazione per roba che sta sotto la piega.
 *
 * Qui non si cerca una parola nel sorgente: si costruiscono gli attributi VERI
 * dell'immagine con la funzione di Next (`getImageProps`) e si sceglie la
 * variante come farebbe il browser, dato uno schermo e la sua densità.
 *
 * ⚠️ QUELLO CHE QUESTA PROVA NON VEDE: che il componente usi davvero
 * `fotoDelNegozio`. I componenti `.tsx` non si montano in questa suite
 * (`tsconfig` tiene `jsx: preserve`, e vitest non li sa trasformare —
 * verificato l'8/9). Qui si esegue tutta la logica che decide; l'unica riga
 * scoperta è lo `spread` dentro il JSX.
 */
import { describe, expect, it } from 'vitest';
import { getImageProps } from 'next/image';
import caricatoreFotoRemote from '@/lib/image-loader';
import { sizedImage } from '@/lib/image-url';
import {
  RIQUADRO_DELLA_FOTO,
  caricatoreDelRiquadroLargo,
  fotoDelNegozio,
  larghezzaChiesta,
  larghezzaDelRiquadro,
  riquadriIncoerenti,
  type FotoDaMostrare,
  type PostoDellaFoto,
} from '@/lib/media/foto-del-negozio';

const COPERTINA_SUPABASE =
  'https://xyz.supabase.co/storage/v1/object/public/store-media/copertina.jpg';
const COPERTINA_PEXELS = 'https://images.pexels.com/photos/1/negozio.jpeg';

/** Com'era scritto dentro il componente, uguale per la copertina e per la scheda. */
const RIQUADRO_DI_PRIMA = '(max-width: 768px) 100vw, 1024px';

/**
 * Gli attributi che finiscono davvero nell'`<img>`, costruiti come li costruisce
 * il componente: le tre proprietà decise da `fotoDelNegozio` più quelle fisse.
 */
function attributi(foto: FotoDaMostrare) {
  const { props } = getImageProps({
    ...foto,
    alt: '',
    fill: true,
    loader: caricatoreDelRiquadroLargo,
  });
  return props as { src: string; srcSet?: string; sizes?: string; loading?: string };
}

/** Le larghezze fra cui il browser può scegliere, in ordine. */
function variantiOfferte(srcSet: string | undefined): number[] {
  return [...String(srcSet).matchAll(/\s(\d+)w/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
}

/**
 * Quanto è largo il riquadro su UNO schermo, leggendo `sizes` come lo legge un
 * browser: la prima clausola la cui condizione è vera.
 */
function riquadroSuSchermo(sizes: string, schermoPunti: number): number {
  for (const clausola of sizes.split(',')) {
    const testo = clausola.trim();
    const condizione = testo.match(/^\((max|min)-width:\s*(\d+)px\)\s*(.+)$/);
    const valore = condizione ? condizione[3] : testo;
    if (condizione) {
      const soglia = Number(condizione[2]);
      const vale = condizione[1] === 'max' ? schermoPunti <= soglia : schermoPunti >= soglia;
      if (!vale) continue;
    }
    const inSchermo = valore.match(/^(\d+(?:\.\d+)?)vw$/);
    if (inSchermo) return (schermoPunti * Number(inSchermo[1])) / 100;
    const fisso = valore.match(/^(\d+(?:\.\d+)?)px$/);
    if (fisso) return Number(fisso[1]);
  }
  return schermoPunti;
}

/**
 * La variante che scaricherebbe un browser: la più piccola che copre i pixel
 * veri che servono (punti del riquadro × densità dello schermo).
 */
function fotoScaricata(foto: FotoDaMostrare, schermoPunti: number, densita: number): number {
  const p = attributi(foto);
  const varianti = variantiOfferte(p.srcSet);
  const servono = riquadroSuSchermo(p.sizes ?? '', schermoPunti) * densita;
  return varianti.find((w) => w >= servono) ?? varianti[varianti.length - 1];
}

/** La stessa scelta, ma con la misura che c'era prima dentro il componente. */
function fotoScaricataPrima(schermoPunti: number, densita: number): number {
  const p = attributi({ src: COPERTINA_SUPABASE, sizes: RIQUADRO_DI_PRIMA, priority: true });
  const varianti = variantiOfferte(p.srcSet);
  const servono = riquadroSuSchermo(RIQUADRO_DI_PRIMA, schermoPunti) * densita;
  return varianti.find((w) => w >= servono) ?? varianti[varianti.length - 1];
}

describe('la prova non è vuota: il browser ha davvero fra cosa scegliere', () => {
  it('ogni foto viene offerta in più larghezze', () => {
    const varianti = variantiOfferte(attributi(fotoDelNegozio(COPERTINA_SUPABASE, 'scheda-in-vetrina')).srcSet);
    expect(varianti.length).toBeGreaterThan(4);
    expect(Math.min(...varianti)).toBeLessThan(500);
    expect(Math.max(...varianti)).toBeGreaterThan(1500);
  });

  it('i posti dichiarati sono tre: uno solo non misurerebbe niente', () => {
    expect(Object.keys(RIQUADRO_DELLA_FOTO).length).toBeGreaterThanOrEqual(3);
  });
});

describe('la scheda della vetrina scarica una foto da scheda', () => {
  const scheda = fotoDelNegozio(COPERTINA_SUPABASE, 'scheda-in-vetrina');

  it('da telefono, schermo denso: prima 1200 pixel, adesso 640', () => {
    // Telefono da 390 punti a 3×: è il caso peggiore e il più comune.
    expect(fotoScaricataPrima(390, 3)).toBe(1200);
    expect(fotoScaricata(scheda, 390, 3)).toBe(640);
  });

  it('da computer: prima 1080 pixel per un riquadro da 300, adesso 384', () => {
    expect(fotoScaricataPrima(1280, 1)).toBe(1080);
    expect(fotoScaricata(scheda, 1280, 1)).toBe(384);
  });

  it('da computer con schermo denso: prima 2048 pixel, adesso 640', () => {
    expect(fotoScaricataPrima(1280, 2)).toBe(2048);
    expect(fotoScaricata(scheda, 1280, 2)).toBe(640);
  });

  it('su ogni schermo la scheda scarica meno di prima, mai di più', () => {
    for (const schermo of [360, 390, 414, 768, 1024, 1280, 1536]) {
      for (const densita of [1, 2, 3]) {
        const adesso = fotoScaricata(scheda, schermo, densita);
        const prima = fotoScaricataPrima(schermo, densita);
        expect(adesso, `schermo ${schermo} a ${densita}×`).toBeLessThanOrEqual(prima);
      }
    }
  });
});

describe('la cura non deve creare il difetto opposto: una foto più piccola del riquadro', () => {
  // Nell'elenco negozi (`/stores`) la griglia da telefono ha UNA colonna: la
  // stessa scheda è larga quanto lo schermo. Dichiararla 50vw come in vetrina
  // servirebbe metà dei pixel che occupa, cioè una foto sgranata sul telefono.
  const elenco = fotoDelNegozio(COPERTINA_SUPABASE, 'scheda-in-elenco');

  it("nell'elenco negozi la foto resta grande quanto lo schermo", () => {
    expect(fotoScaricata(elenco, 390, 2)).toBe(828);
    expect(fotoScaricata(elenco, 390, 3)).toBe(1200);
  });

  it('in vetrina il riquadro è più stretto che nell elenco: due colonne contro una', () => {
    expect(riquadroSuSchermo(RIQUADRO_DELLA_FOTO['scheda-in-vetrina'], 390)).toBeLessThan(
      riquadroSuSchermo(RIQUADRO_DELLA_FOTO['scheda-in-elenco'], 390),
    );
  });

  it('una scheda non può dichiarare il riquadro di una copertina', () => {
    const scheda = larghezzaDelRiquadro('scheda-in-vetrina');
    const copertina = larghezzaDelRiquadro('copertina');
    expect(scheda).not.toBeNull();
    expect(copertina).not.toBeNull();
    expect(scheda!).toBeLessThan(copertina! / 2);
  });

  it('ogni posto dichiarato chiede una foto che copre il suo riquadro senza sfondarlo', () => {
    // Gira su TUTTA la tabella: vale anche per il quarto posto di domani.
    expect(riquadriIncoerenti()).toEqual([]);
  });
});

describe('urgente lo decide chi conosce la pagina, non il componente', () => {
  it('le sei schede della vetrina non sono urgenti: nessuna finisce nei precaricamenti', () => {
    const negozi = ['a', 'b', 'c', 'd', 'e', 'f'];
    const urgenti = negozi
      .map((n) => fotoDelNegozio(`${COPERTINA_SUPABASE}?n=${n}`, 'scheda-in-vetrina', { indice: 0 }))
      .filter((foto) => foto.priority);
    expect(urgenti).toHaveLength(0);
  });

  it('e il browser le rimanda a quando servono: `loading="lazy"`', () => {
    const p = attributi(fotoDelNegozio(COPERTINA_SUPABASE, 'scheda-in-vetrina', { indice: 0 }));
    expect(p.loading).toBe('lazy');
  });

  it('la copertina del negozio invece è urgente: è la prima cosa che si vede', () => {
    const copertina = fotoDelNegozio(COPERTINA_SUPABASE, 'copertina', { priority: true });
    expect(copertina.priority).toBe(true);
    expect(attributi(copertina).loading).not.toBe('lazy');
  });

  it('la seconda foto di un carosello non è mai urgente: nessuno l ha ancora fatta scorrere', () => {
    expect(fotoDelNegozio(COPERTINA_SUPABASE, 'copertina', { indice: 1, priority: true }).priority).toBe(false);
  });
});

describe('il riquadro non è quadrato, e la foto non arriva tagliata ai lati', () => {
  // La copertina della scheda è alta 112 punti su ~300 di larghezza. Il
  // caricatore generale ritaglia quadrato sotto i 600 pixel (e sempre su
  // Pexels): senza toglierlo, chiedere 320 punti invece di 1024 farebbe vedere
  // MENO negozio di prima, ingrandito.
  for (const [nome, url] of [
    ['Supabase', COPERTINA_SUPABASE],
    ['Pexels', COPERTINA_PEXELS],
  ] as const) {
    it(`nessuna variante ${nome} chiede un ritaglio quadrato`, () => {
      const p = attributi(fotoDelNegozio(url, 'scheda-in-vetrina'));
      const pezzi = String(p.srcSet).split(', ').filter(Boolean);
      expect(pezzi.length).toBeGreaterThan(4);
      for (const pezzo of pezzi) {
        const indirizzo = pezzo.trim().split(' ')[0];
        expect(indirizzo, pezzo).not.toMatch(/[?&](height|h)=/);
        expect(indirizzo, pezzo).not.toContain('fit=crop');
      }
    });

    it(`ogni variante ${nome} chiede comunque la larghezza giusta`, () => {
      const p = attributi(fotoDelNegozio(url, 'scheda-in-vetrina'));
      for (const pezzo of String(p.srcSet).split(', ').filter(Boolean)) {
        const [indirizzo, etichetta] = pezzo.trim().split(' ');
        expect(larghezzaChiesta(indirizzo)).toBe(Number(etichetta.replace('w', '')));
      }
    });
  }

  it('un percorso locale non è un indirizzo: torna com era', () => {
    expect(caricatoreDelRiquadroLargo({ src: '/placeholder.svg', width: 384, quality: 75 })).toBe('/placeholder.svg');
  });
});

describe('la copertina del negozio non doveva cambiare, e non è cambiata', () => {
  /**
   * `/store/[id]` chiedeva la foto giusta già prima: lì il riquadro è davvero
   * la pagina intera. Spostare la misura nella tabella non deve spostare un
   * pixel — se questa prova diventa rossa, il lavoro sulla vetrina ha toccato
   * la pagina del negozio, che non c'entrava niente.
   */
  const stessaFoto = (indirizzo: string) => {
    const url = new URL(indirizzo);
    const parametri = [...url.searchParams.entries()].sort().map(([k, v]) => `${k}=${v}`);
    // L'ORDINE dei parametri può cambiare (`sizedImage` li scrive in ordine
    // diverso a seconda di come è stato chiamato): al CDN non importa, torna la
    // stessa identica foto. Quello che conta è che i parametri siano gli stessi.
    return `${url.origin}${url.pathname}?${parametri.join('&')}`;
  };

  for (const [nome, url] of [
    ['Supabase', COPERTINA_SUPABASE],
    ['Pexels', COPERTINA_PEXELS],
  ] as const) {
    it(`una copertina ${nome} arriva esattamente come prima`, () => {
      const prima = getImageProps({
        src: sizedImage(url, 'hero'), // com'era scritto in HeroSection
        alt: 'x',
        fill: true,
        sizes: RIQUADRO_DI_PRIMA,
        loader: caricatoreFotoRemote,
        priority: true,
      });
      const adesso = getImageProps({
        ...fotoDelNegozio(url, 'copertina', { priority: true }),
        alt: 'x',
        fill: true,
        loader: caricatoreFotoRemote,
      });
      const varianti = (p: { srcSet?: string }) =>
        String(p.srcSet).split(', ').filter(Boolean).map((pezzo) => {
          const [indirizzo, etichetta] = pezzo.trim().split(' ');
          return `${stessaFoto(indirizzo)} ${etichetta}`;
        });
      expect(varianti(adesso.props)).toEqual(varianti(prima.props));
      expect(adesso.props.sizes).toBe(prima.props.sizes);
      expect(adesso.props.loading).toBe(prima.props.loading);
    });
  }
});

describe('un posto sconosciuto non fa danni', () => {
  it('ricade sul riquadro più largo fra le schede: sgranata non si torna indietro', () => {
    const inventato = fotoDelNegozio(COPERTINA_SUPABASE, 'vetrina-di-natale' as PostoDellaFoto);
    expect(inventato.sizes).toBe(RIQUADRO_DELLA_FOTO['scheda-in-elenco']);
    expect(inventato.priority).toBe(false);
  });

  it('una foto che non c è non diventa un indirizzo rotto', () => {
    expect(fotoDelNegozio(null, 'scheda-in-vetrina').src).toBe('');
    expect(fotoDelNegozio(undefined, 'copertina').src).toBe('');
  });
});
