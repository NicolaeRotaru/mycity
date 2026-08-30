/**
 * Una foto chiesta più piccola del riquadro che la mostra.
 *
 * `sizedImage(foto, 'thumb')` chiedeva 100 pixel. Chi la scriveva intendeva «è una miniatura», e non
 * aveva modo di dire quanto è largo il riquadro: il nome non lo porta. Così una foto da 100 pixel
 * finiva dentro un riquadro da 160, stirata del 60% — sgranata, ma «ottimizzata».
 *
 * Misurato sul sito il 24/8: su **31** punti in cui il riquadro dichiara una larghezza fissa, **7**
 * chiedevano meno di quanto mostravano. Altri **5** dichiarano il riquadro solo in percentuale di
 * schermo, e quelli non si possono misurare senza scegliere uno schermo: restano dichiarati, non
 * indovinati.
 *
 * ⚠️ LA PRIMA MISURA ERA SBAGLIATA, e vale la pena scriverlo. Leggevo `sizes` prendendo il numero
 * più grande, e in `(min-width: 768px) 160px, 50vw` il numero più grande è la SOGLIA dello schermo,
 * non il riquadro. Con quella lettura il difetto sembrava sette volte peggiore, e la «cura» avrebbe
 * fatto scaricare foto quasi cinque volte più grandi del necessario. Per questo la lettura di
 * `sizes` ha una sua funzione in casa, e i suoi casi qui sotto sono i primi.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { LARGHEZZA_MASSIMA, pixelDellaTaglia, riquadroDichiarato, sizedImage } from '@/lib/image-url';

describe('leggere `sizes` come lo legge un browser', () => {
  it('una soglia di schermo non è un riquadro', () => {
    // È l'errore che ho fatto io. `(min-width: 768px) 160px` vuol dire: da 768 pixel di schermo in
    // su, il riquadro è largo 160. Il riquadro è 160.
    expect(riquadroDichiarato('(min-width: 768px) 160px, 50vw').px).toBe(160);
  });

  it('fra due larghezze fisse vince la più grande: è quella che va coperta', () => {
    expect(riquadroDichiarato('(min-width: 1024px) 220px, (min-width: 640px) 320px, 100px').px).toBe(320);
  });

  it('un riquadro largo un tot di schermo non ha UNA larghezza: è null, non zero', () => {
    // «Non lo so» non deve diventare un numero comodo: un riquadro in `vw` cresce con lo schermo.
    const r = riquadroDichiarato('(max-width: 640px) 50vw, 33vw');
    expect(r.px).toBeNull();
    expect(r.inVw).toBe(2);
  });

  it('una larghezza secca è la larghezza', () => {
    expect(riquadroDichiarato('144px').px).toBe(144);
  });
});

describe('chiedere la foto della misura del riquadro', () => {
  const SUPA = 'https://xyz.supabase.co/storage/v1/object/public/products/a.jpg';

  it('un numero è la larghezza del riquadro, e finisce nella richiesta', () => {
    expect(sizedImage(SUPA, 160)).toContain('width=160');
  });

  it('col numero il ritaglio quadrato è spento: la larghezza non dice niente sulla forma', () => {
    // È il difetto del logo: ritagliato a quadrato perché la chiamata si chiamava «thumb», e i
    // marchi con la scritta dentro diventavano illeggibili.
    expect(sizedImage(SUPA, 160)).not.toContain('height=');
    expect(sizedImage(SUPA, 160, { quadrato: true })).toContain('height=160');
  });

  it('coi nomi il ritaglio resta com era: questo lavoro non cambia cosa si vede', () => {
    expect(sizedImage(SUPA, 'thumb')).toContain('height=100');
    expect(sizedImage(SUPA, 'card')).toContain('height=400');
    expect(sizedImage(SUPA, 'detail')).not.toContain('height=');
    expect(sizedImage(SUPA, 'hero')).not.toContain('height=');
  });

  it('si può spegnere il quadrato anche su un nome che lo accendeva', () => {
    expect(sizedImage(SUPA, 'thumb', { quadrato: false })).not.toContain('height=');
  });

  it('una larghezza assurda viene riportata dentro i limiti, mai sotto il minimo', () => {
    expect(sizedImage(SUPA, 99_999)).toContain(`width=${LARGHEZZA_MASSIMA}`);
    expect(sizedImage(SUPA, 0)).toContain('width=1');
    expect(sizedImage(SUPA, 12.3)).toContain('width=13');
  });

  it('un indirizzo che non si sa riscrivere torna com era', () => {
    expect(sizedImage('https://altrosito.it/foto.jpg', 160)).toBe('https://altrosito.it/foto.jpg');
    expect(sizedImage('data:image/png;base64,AAA', 160)).toBe('data:image/png;base64,AAA');
    expect(sizedImage('', 160)).toBe('');
  });

  it('i quattro nomi valgono ancora i loro pixel: nessuno è cambiato di nascosto', () => {
    expect(pixelDellaTaglia('thumb')).toBe(100);
    expect(pixelDellaTaglia('card')).toBe(400);
    expect(pixelDellaTaglia('detail')).toBe(800);
    expect(pixelDellaTaglia('hero')).toBe(1200);
  });
});

describe("l'invariante di STRUTTURA sul sito vero", () => {
  // Legge il codice com'è adesso. Diventa rossa il giorno che qualcuno chiede di nuovo una foto più
  // piccola del riquadro in cui la mette — prima che la foto sgranata arrivi a schermo.
  const files = execSync(
    'grep -rl "sizedImage(" --include=*.tsx --include=*.ts . | grep -v node_modules | grep -v lib/image-url',
    { encoding: 'utf8' },
  ).trim().split('\n');

  const misure = (() => {
    const corti: string[] = [];
    const soloVw: string[] = [];
    let coppie = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const re = /<Image[\s\S]{0,700}?\/>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const blocco = m[0];
        const t = blocco.match(/sizedImage\(([^;]*?),\s*(?:['"](thumb|card|detail|hero)['"]|(\d+))\s*[,)]/);
        if (!t) continue;
        const s = blocco.match(/sizes=\{?["`]([^"`]+)["`]\}?/);
        if (!s) continue;
        const { px } = riquadroDichiarato(s[1]);
        const chiesti = t[2] ? pixelDellaTaglia(t[2] as 'thumb' | 'card' | 'detail' | 'hero') : Number(t[3]);
        const riga = src.slice(0, m.index).split('\n').length;
        const nome = t[2] ?? `${chiesti}px`;
        if (px === null) { soloVw.push(`${f}:${riga} (${nome})`); continue; }
        coppie += 1;
        if (chiesti < px) corti.push(`${f}:${riga} chiede ${nome} dentro un riquadro da ${px}px`);
      }
    }
    return { corti, soloVw, coppie };
  })();

  it('il conto degli accoppiamenti non è zero: senza, questo blocco non misura niente', () => {
    // Un elenco vuoto passerebbe qualunque regola. Questa riga muore il giorno in cui la mia
    // espressione smette di riconoscere le foto, invece di dire verde per sbaglio.
    expect(misure.coppie).toBeGreaterThan(20);
  });

  it('nessuna foto viene chiesta più piccola del riquadro che la mostra', () => {
    expect(misure.corti).toEqual([]);
  });

  it('i riquadri che non so misurare restano dichiarati, non contati come a posto', () => {
    // ⚪, mai un verde: questi sono espressi in percentuale di schermo e non hanno UNA larghezza.
    // Il numero sta qui perché scenda quando qualcuno li dichiara in pixel, e perché non cresca in
    // silenzio: oggi sono cinque.
    expect(misure.soloVw.length).toBeLessThanOrEqual(5);
  });
});

/**
 * 27/8/2026 (R093) — `unoptimized` SPEGNE IL `sizes` SCRITTO LÌ ACCANTO.
 *
 * Il difetto #99 era già scritto in `lib/image-loader.ts` e la cura c'era: un `loader` verso il CDN
 * di Supabase, che tiene il ridimensionamento dove stava e fa tornare `srcSet` e `sizes`. Solo che
 * era stata applicata a otto file su venticinque. Negli altri diciassette la foto restava della
 * misura scritta nell'indirizzo — cento pixel dentro un riquadro da novantasei, che su un telefono
 * a tre volte ne vorrebbe duecentottantotto. Sgranata nel carrello e nella pagina degli ordini,
 * cioè dove si decide se confermare. Invisibile da computer, che è a una volta sola.
 *
 * La prova qui sopra non poteva vederlo: confronta i pixel CSS e non conosce la densità dello
 * schermo. Questa qui sotto guarda la cosa giusta — quante foto sono rimaste senza caricatore — e
 * il numero deve solo scendere.
 */
describe('le foto che non passano dal caricatore', () => {
  const senzaCaricatore = execSync(
    'grep -rl "unoptimized" app/ components/ || true',
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean).sort();

  it('sono quattro, e sono queste: il numero scende e non risale', () => {
    // ⚪ Debito dichiarato, non un verde: questi quattro file appartengono a un altro lotto e
    // nessuno di questa squadra può toccarli oggi. Erano DICIASSETTE il 27/8 mattina.
    expect(senzaCaricatore).toEqual([
      'app/cart/page.tsx',
      'app/orders/[id]/page.tsx',
      'app/seller/products/page.tsx',
      'app/shared-cart/page.tsx',
    ]);
  });

  it('dove il caricatore c è, la foto la chiede il browser della misura che gli serve', () => {
    // Il comportamento vero (srcSet + sizes col caricatore) è provato in
    // `foto-che-si-adattano-allo-schermo.test.ts`: qui si tiene solo il conto di chi lo usa.
    const conCaricatore = execSync(
      'grep -rl "caricatoreFotoRemote" app/ components/ || true',
      { encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);
    expect(conCaricatore.length, 'il caricatore è sparito dai file dove era stato messo').toBeGreaterThanOrEqual(20);
  });
});
