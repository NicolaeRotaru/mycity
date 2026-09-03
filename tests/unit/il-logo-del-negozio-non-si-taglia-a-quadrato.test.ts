/**
 * 3/9/2026 — I MARCHI CON LA SCRITTA DIVENTAVANO ILLEGGIBILI.
 *
 * Il taglio non lo faceva il cerchio del CSS: lo faceva il server. Per le misure `thumb` e `card`
 * l'indirizzo dell'immagine veniva riscritto con l'altezza uguale alla larghezza e `resize=cover`,
 * cioè il CDN teneva solo il quadrato centrale. Su un marchio da 1000×300 — la forma normale di un
 * logo con scritto sopra il nome del negozio — restavano i trecento pixel centrali: si leggeva un
 * pezzo di parola. E il negoziante non poteva farci niente: al caricamento non gli viene chiesto
 * nessun ritaglio.
 *
 * Due prove, una per pezzo di malattia:
 * ① l'indirizzo che si chiede al server non deve MAI ritagliare (si esegue la funzione vera);
 * ② nessun punto del sito deve tornare a chiedere il logo con la strada che ritaglia, e il cerchio
 *    deve contenere il marchio invece di riempirlo (si legge il sorgente).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sizedImage, logoNegozio } from '@/lib/image-url';

const LOGO_SUPABASE = 'https://abcdefgh.supabase.co/storage/v1/object/public/store-logos/panificio.png';
const LOGO_PEXELS = 'https://images.pexels.com/photos/123/insegna.jpg';

describe('l\'indirizzo con cui si chiede un logo al server', () => {
  it('non chiede nessuna altezza: senza altezza il server non può ritagliare', () => {
    const url = new URL(logoNegozio(LOGO_SUPABASE, 40));
    expect(url.searchParams.get('height'), 'con height=width il CDN tiene solo il quadrato centrale').toBeNull();
    expect(url.searchParams.get('width')).toBeTruthy();
  });

  it('vale anche per le foto ospitate altrove: niente ritaglio, comunque', () => {
    const url = new URL(logoNegozio(LOGO_PEXELS, 40));
    expect(url.searchParams.get('h')).toBeNull();
    expect(url.searchParams.get('fit')).not.toBe('crop');
  });

  it('la vecchia strada ritagliava davvero: è la differenza che stiamo curando', () => {
    const vecchio = new URL(sizedImage(LOGO_SUPABASE, 'thumb'));
    expect(vecchio.searchParams.get('height'), 'se anche questo fosse nullo la prova non misurerebbe niente').toBe(
      vecchio.searchParams.get('width'),
    );
  });

  it('chiede il doppio dei pixel del cerchio: sui telefoni un pixel sono due', () => {
    expect(new URL(logoNegozio(LOGO_SUPABASE, 40)).searchParams.get('width')).toBe('80');
    expect(new URL(logoNegozio(LOGO_SUPABASE, 56)).searchParams.get('width')).toBe('112');
  });

  it('senza logo non inventa un indirizzo', () => {
    expect(logoNegozio(null, 40)).toBe('');
    expect(logoNegozio(undefined, 40)).toBe('');
  });
});

/**
 * I punti del sito che disegnano il marchio di un negozio.
 *
 * ⚠️ UNA SOLA ECCEZIONE, DICHIARATA: `components/home/ShopOfMonthHero.tsx` sta in mano a un'altra
 * squadra in questo stesso lotto e non si può toccare da qui. Lì il logo è ancora ritagliato: è
 * scritto nella consegna come lavoro che resta aperto. L'elenco è chiuso apposta — se qualcuno ne
 * aggiunge un secondo, questa prova diventa rossa invece di lasciar passare la cosa in silenzio.
 */
const FUORI_PORTATA = ['components/home/ShopOfMonthHero.tsx'];

function file(dir: string, dentro: string[] = []): string[] {
  for (const voce of readdirSync(dir)) {
    const p = join(dir, voce);
    if (statSync(p).isDirectory()) file(p, dentro);
    else if (p.endsWith('.tsx')) dentro.push(p);
  }
  return dentro;
}

describe('ovunque si disegni il marchio di un negozio', () => {
  const tutti = [...file('app'), ...file('components')];
  // Le righe che passano un logo a `sizedImage`: è la strada che ritaglia.
  const conRitaglio = tutti.filter((f) => /sizedImage\([^)]*store_logo/.test(readFileSync(f, 'utf8')));

  it('nessuno chiede più il logo con la strada che ritaglia', () => {
    expect(tutti.length, 'non ho letto nessun file: la prova non misura niente').toBeGreaterThan(100);
    expect(conRitaglio).toEqual(FUORI_PORTATA);
  });

  it('il cerchio contiene il marchio, non lo riempie', () => {
    const usano = tutti.filter((f) => /\blogoNegozio\(/.test(readFileSync(f, 'utf8')));
    expect(usano.length, 'nessuno usa il logo: la prova non misura niente').toBeGreaterThan(0);

    for (const f of usano) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\blogoNegozio\(/g)) {
        // Dentro lo stesso tag <Image …> ci sono sia l'indirizzo sia le classi.
        const tag = src.slice(m.index, src.indexOf('/>', m.index) + 2);
        expect(tag, `${f}: il logo è dentro un riquadro che lo taglia (object-cover)`).not.toContain('object-cover');
        expect(tag, `${f}: al logo manca object-contain`).toContain('object-contain');
      }
    }
  });
});
