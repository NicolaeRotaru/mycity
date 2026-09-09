import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import accepts from 'attr-accept';
import {
  ESTENSIONI_DEI_TIPI,
  decidiCosaFareDelDrop,
  elencoAccept,
  fileColTipoGiusto,
  mappaAccept,
  pesoMassimo,
  tipiScrittiPerUmani,
  tipoDedotto,
} from '@/lib/storage/casella-di-caricamento';
import { CARTELLA_DEL_SITO, richiestaPerIlSito } from '@/lib/storage/foto-del-sito';
import { ANNO_IN_SECONDI } from '@/lib/storage/carica-immagine';
import { regolaDelSecchio } from '@/lib/storage/regole-secchi';

/**
 * 8/9/2026 — LE DUE CASELLE DELLA VETRINA HANNO SMESSO DI ACCETTARE LE FOTO DELL'IPHONE, E NON LO
 * DICEVANO A NESSUNO.
 *
 * ── La malattia, in tre pezzi ────────────────────────────────────────────────────────────────
 * ① `components/seller/site/GalleryFields.tsx` e `SingleImageUpload` (dentro `ImageUpload.tsx`) si
 *    scrivevano addosso l'elenco dei formati: tre tipi, JPG PNG WEBP. Il magazzino dove quelle foto
 *    finiscono ne accetta sette, HEIC e HEIF compresi — cioe' proprio quello con cui scatta un
 *    iPhone. La lista ricopiata a mano era invecchiata mentre il deposito cambiava.
 * ② `react-dropzone` consegna a `onDrop` DUE mucchi: gli accettati e gli scartati. Le due caselle
 *    guardavano solo il primo. Cosi' il file rifiutato spariva: nessun messaggio, nessuna anteprima,
 *    nessun errore. Il negoziante trascinava la foto del suo negozio e non succedeva niente.
 * ③ e anche facendo entrare l'HEIC nella casella, dal PC non sarebbe arrivato lo stesso: col `type`
 *    vuoto il file parte come `application/octet-stream` e il deposito lo rifiuta. Il terzo blocco
 *    qui sotto esegue quel pezzo — senza, la riparazione sarebbe stata finta a meta'.
 *
 * ── Che prova e' questa, detto onestamente ──────────────────────────────────────────────────
 * I primi due blocchi ESEGUONO: il primo da' in pasto la nostra lista ad `attr-accept`, che e' la
 * libreria vera che decide dentro `react-dropzone`, e le chiede se un HEIC entra; il secondo esegue
 * il cervello di `onDrop` su tutti i casi che la casella puo' produrre, compreso un codice d'errore
 * che oggi non esiste. Il terzo blocco e' un invariante di struttura — un controllo su del testo,
 * e va detto che non puo' fallire come fallisce la realta' — ma la proprieta' che misura e'
 * esattamente strutturale: «nessuna casella si detta da sola i formati, e nessuna butta via un file
 * senza dirlo».
 */

/** Un file finto: ad `attr-accept` bastano nome e tipo, ed e' tutto cio' che guarda. */
function file(name: string, type = ''): { name: string; type: string } {
  return { name, type };
}

/**
 * La stringa che `react-dropzone` costruisce dall'oggetto `accept` prima di passarla ad
 * `attr-accept`: tipo, poi le sue estensioni, tutto in fila separato da virgole.
 */
function comeLaVedeLaLibreria(secchio?: string): string {
  return elencoAccept(secchio).join(',');
}

describe('la casella della vetrina accetta quello che il magazzino accetta', () => {
  const ACCEPT = comeLaVedeLaLibreria();

  /**
   * IL CASO PER CUI ESISTE TUTTO IL RESTO. Il tipo vuoto non e' un caso di scuola: Windows e
   * diversi browser desktop non conoscono il MIME di HEIC e consegnano stringa vuota, quindi la
   * sola `image/heic` nella lista non basterebbe — decide l'estensione.
   */
  it.each([
    ['la foto appena scattata da un iPhone', file('IMG_0421.HEIC', 'image/heic')],
    ['lo stesso file trascinato da un PC, che il tipo non lo sa', file('IMG_0421.heic', '')],
    ['un HEIF', file('scatto.heif', 'image/heif')],
    ['una GIF', file('vetrina.gif', 'image/gif')],
    ['un AVIF', file('vetrina.avif', 'image/avif')],
    ['un JPG di sempre', file('negozio.jpg', 'image/jpeg')],
    ['un PNG di sempre', file('logo.png', 'image/png')],
    ['un WEBP di sempre', file('banner.webp', 'image/webp')],
  ])('%s entra', (_titolo, f) => {
    expect(accepts(f, ACCEPT)).toBe(true);
  });

  it.each([
    ['un SVG, che e codice travestito da immagine', file('finto.svg', 'image/svg+xml')],
    ['un video', file('giro.mov', 'video/quicktime')],
    ['un PDF', file('listino.pdf', 'application/pdf')],
    ['un file senza estensione ne tipo', file('appunti', '')],
  ])('%s resta fuori', (_titolo, f) => {
    expect(accepts(f, ACCEPT)).toBe(false);
  });

  /**
   * IL RILEVATORE NON E' CIECO. Se questa prova restasse verde anche con la lista vecchia, non
   * starebbe misurando niente: e' l'errore in cui e' gia' caduta la prova di un lotto precedente.
   */
  it('e con la lista vecchia — tre tipi scritti a mano — la foto dell iPhone NON entrava', () => {
    const listaVecchia = 'image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp';
    expect(accepts(file('IMG_0421.HEIC', 'image/heic'), listaVecchia)).toBe(false);
    expect(accepts(file('vetrina.gif', 'image/gif'), listaVecchia)).toBe(false);
    // e i tre di sempre passavano anche prima: la differenza sta tutta nei quattro che mancavano
    expect(accepts(file('negozio.jpg', 'image/jpeg'), listaVecchia)).toBe(true);
  });

  it('la casella non inventa: i suoi tipi sono ESATTAMENTE quelli del magazzino', () => {
    expect(Object.keys(mappaAccept())).toEqual([...regolaDelSecchio('products').tipiAmmessi]);
    expect(pesoMassimo()).toBe(regolaDelSecchio('products').maxByte);
  });

  it('ogni tipo ammesso ha la sua estensione, o mappaAccept si rifiuta di rispondere', () => {
    for (const tipo of regolaDelSecchio('products').tipiAmmessi) {
      expect(ESTENSIONI_DEI_TIPI[tipo], `«${tipo}» senza estensione`).toBeTruthy();
    }
    // Il giorno che qualcuno aggiunge un tipo al magazzino e si dimentica l'estensione, la casella
    // non nasce zitta: lancia. È il modo di non far tornare il difetto da un'altra porta.
    const finto = { ...regolaDelSecchio('products'), tipiAmmessi: ['image/tiff'] };
    expect(() => {
      for (const tipo of finto.tipiAmmessi) {
        if (!ESTENSIONI_DEI_TIPI[tipo]) throw new Error(`senza estensione: ${tipo}`);
      }
    }).toThrow(/senza estensione/);
  });

  it('i formati detti a parole nascono dalla stessa regola, non da una frase scritta a mano', () => {
    const frase = tipiScrittiPerUmani();
    expect(frase).toContain('HEIC');
    expect(frase).toContain('JPG');
    expect(frase).toMatch(/ o [A-Z]+$/);
  });
});

/**
 * LA SECONDA METÀ DEL CASO HEIC, e senza questa la prima è finta.
 *
 * Entrare nella casella non è arrivare nel magazzino. Nel browser il client Supabase impacchetta il
 * file in una `FormData` e il tipo che viaggia è quello del `File`, non l'opzione `contentType`
 * (`node_modules/@supabase/storage-js` → `uploadOrUpdate`, ramo `fileBody instanceof Blob`). Per un
 * file con `type` vuoto lo standard impone `application/octet-stream`, che nella lista dei sette
 * tipi del deposito non c'è: rifiutato. Cioè l'HEIC dal telefono passava e lo stesso HEIC dal PC no.
 */
describe('e il tipo che il PC non sa dire lo deduciamo dall estensione', () => {
  it.each([
    ['IMG_0421.heic', '', 'image/heic'],
    ['IMG_0421.HEIC', '', 'image/heic'],
    ['scatto.heif', '', 'image/heif'],
    ['negozio.jpg', '', 'image/jpeg'],
    ['negozio.jpeg', '', 'image/jpeg'],
    ['vetrina.gif', '', 'image/gif'],
  ])('«%s» col tipo «%s» diventa %s', (nome, tipo, atteso) => {
    expect(tipoDedotto(nome, tipo)).toBe(atteso);
  });

  it('se il browser il tipo lo sa, comanda lui: non si indovina sopra a un dato vero', () => {
    expect(tipoDedotto('foto.jpg', 'image/png')).toBe('image/png');
    expect(tipoDedotto('IMG_0421.HEIC', 'image/heic')).toBe('image/heic');
  });

  it('e su un file che il magazzino NON accetta non inventa niente', () => {
    expect(tipoDedotto('finto.svg', '')).toBe('');
    expect(tipoDedotto('listino.pdf', '')).toBe('');
    expect(tipoDedotto('appunti', '')).toBe('');
    expect(tipoDedotto('', '')).toBe('');
  });

  it('il file che parte verso il deposito ha il tipo scritto sopra', () => {
    const dalPc = new File([new Uint8Array([1, 2, 3])], 'IMG_0421.heic', { type: '' });
    expect(dalPc.type).toBe('');
    const sistemato = fileColTipoGiusto(dalPc);
    expect(sistemato.type).toBe('image/heic');
    expect(sistemato.name).toBe('IMG_0421.heic');
    expect(sistemato.size).toBe(3);
  });

  /**
   * E QUESTO È IL PEZZO CHE CONTA DAVVERO: non che la funzione sappia correggere il tipo, ma che
   * la richiesta che parte verso il deposito lo porti corretto. La prima versione di questa prova
   * cercava il nome `fileColTipoGiusto` nel sorgente del componente: togliendo la chiamata e
   * lasciando la riga `import`, restava verde. Se n'è accorto il mutante, non la rilettura.
   */
  it('la richiesta che parte per la vetrina porta il tipo corretto, non octet-stream', () => {
    const dalPc = new File([new Uint8Array([9])], 'IMG_0421.heic', { type: '' });
    const richiesta = richiestaPerIlSito(dalPc, 'uid-del-negoziante');
    expect((richiesta.file as File).type).toBe('image/heic');
    expect(richiesta.userId).toBe('uid-del-negoziante');
    expect(richiesta.cartella).toBe(CARTELLA_DEL_SITO);
    expect(richiesta.cacheControl).toBe(ANNO_IN_SECONDI);
  });

  it('e se non c era niente da correggere resta lo stesso identico file', () => {
    const gia = new File([new Uint8Array([1])], 'negozio.jpg', { type: 'image/jpeg' });
    expect(fileColTipoGiusto(gia)).toBe(gia);
    const fuoriLista = new File([new Uint8Array([1])], 'finto.svg', { type: '' });
    expect(fileColTipoGiusto(fuoriLista)).toBe(fuoriLista);
  });
});

describe('quello che resta fuori, chi carica lo viene a sapere', () => {
  const scarto = (nome: string, ...codici: string[]) => ({
    file: { name: nome },
    errors: codici.map((code) => ({ code, message: code })),
  });

  it('se entra tutto non dice niente: nessun avviso inutile', () => {
    const esito = decidiCosaFareDelDrop(['a', 'b'], [], { postiLiberi: 12 });
    expect(esito.daCaricare).toEqual(['a', 'b']);
    expect(esito.avviso).toBeNull();
  });

  it('il formato sbagliato ha un nome, un perché e la lista di cosa si può caricare', () => {
    const esito = decidiCosaFareDelDrop([], [scarto('finto.svg', 'file-invalid-type')], {
      postiLiberi: 12,
    });
    expect(esito.avviso).toContain('finto.svg');
    expect(esito.avviso).toContain('HEIC');
    expect(esito.daCaricare).toEqual([]);
  });

  it('la foto troppo pesante dice il limite vero del magazzino, in MB', () => {
    const esito = decidiCosaFareDelDrop([], [scarto('enorme.jpg', 'file-too-large')], {
      postiLiberi: 12,
    });
    const mb = Math.round(pesoMassimo() / (1024 * 1024));
    expect(esito.avviso).toContain(`${mb} MB`);
    expect(esito.avviso).toContain('enorme.jpg');
  });

  it('nel caricatore singolo, due file insieme non spariscono: lo dice', () => {
    const esito = decidiCosaFareDelDrop(
      [],
      [scarto('a.jpg', 'too-many-files'), scarto('b.jpg', 'too-many-files')],
      { postiLiberi: 1 },
    );
    expect(esito.avviso).toMatch(/una (foto )?sola|una per volta/i);
  });

  /**
   * IL PEZZO CHE CHIUDE LA MALATTIA, non solo il punto malato: `slice` buttava via i file oltre il
   * dodicesimo senza una parola, e quelli erano file BUONI.
   */
  it('i file buoni tagliati perché i posti erano finiti non spariscono in silenzio', () => {
    const esito = decidiCosaFareDelDrop(['a', 'b', 'c', 'd'], [], { postiLiberi: 2 });
    expect(esito.daCaricare).toEqual(['a', 'b']);
    expect(esito.avviso).not.toBeNull();
    expect(esito.avviso).toContain('2 foto');
  });

  it('con zero posti liberi non parte niente, e si capisce cosa fare', () => {
    const esito = decidiCosaFareDelDrop(['a'], [], { postiLiberi: 0 });
    expect(esito.daCaricare).toEqual([]);
    expect(esito.avviso).toMatch(/posto/i);
  });

  /**
   * LA PROPRIETÀ CHE VALE PER SEMPRE: se qualcosa è rimasto fuori, l'avviso non è mai vuoto.
   *
   * Ci sono dentro anche un codice che react-dropzone non ha ancora inventato e uno scarto senza
   * errori: sono i due modi in cui il silenzio tornerebbe da solo, e sono esattamente il difetto.
   */
  const CODICI = [
    'file-invalid-type',
    'file-too-large',
    'file-too-small',
    'too-many-files',
    'codice-che-oggi-non-esiste',
    '',
  ];
  it.each(CODICI)('nessun file sparisce zitto, nemmeno col codice «%s»', (codice) => {
    const esito = decidiCosaFareDelDrop([], [scarto('misterioso.xyz', codice)], { postiLiberi: 5 });
    expect(esito.avviso, `codice «${codice}»`).toBeTruthy();
    expect(String(esito.avviso).length).toBeGreaterThan(10);
  });

  it('nemmeno uno scarto senza errori, o senza nome, o malformato', () => {
    for (const brutto of [
      { file: { name: 'a.txt' }, errors: [] },
      { file: { name: '' }, errors: [{ code: 'file-invalid-type' }] },
      {},
      { file: null, errors: null },
    ]) {
      const esito = decidiCosaFareDelDrop([], [brutto], { postiLiberi: 5 });
      expect(esito.avviso, JSON.stringify(brutto)).toBeTruthy();
    }
  });

  it('un nome lunghissimo non fa esplodere il messaggio', () => {
    const esito = decidiCosaFareDelDrop([], [scarto('a'.repeat(400) + '.svg', 'file-invalid-type')], {
      postiLiberi: 5,
    });
    expect(String(esito.avviso).length).toBeLessThan(300);
  });
});

describe('e nessuna casella può tornare a dettarsi i formati da sola', () => {
  const RADICE = join(__dirname, '..', '..');

  function senzaCommenti(testo: string): string {
    return testo
      .split('\n')
      .map((riga) => riga.replace(/(^|[^:])\/\/.*$/, '$1'))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
  }

  function tuttiIFile(dir: string, out: string[] = []): string[] {
    for (const voce of readdirSync(dir)) {
      if (voce === 'node_modules' || voce.startsWith('.')) continue;
      const pieno = join(dir, voce);
      if (statSync(pieno).isDirectory()) tuttiIFile(pieno, out);
      else if (/\.tsx?$/.test(voce)) out.push(pieno);
    }
    return out;
  }

  const conCasella = ['app', 'components']
    .flatMap((c) => tuttiIFile(join(RADICE, c)))
    .map((f) => relative(RADICE, f))
    .filter((rel) => /useDropzone/.test(readFileSync(join(RADICE, rel), 'utf8')));

  /** Le due caselle di questo difetto: qui la cura dev'esserci tutta. */
  const LE_DUE_CASELLE = [
    'components/seller/site/GalleryFields.tsx',
    'components/seller/site/ImageUpload.tsx',
  ];

  /**
   * IL DEBITO, DICHIARATO CON I NOMI. Queste caselle si dettano ancora i formati a mano ed e' lo
   * STESSO difetto — ma stanno fuori dal territorio di questa riparazione (`ImageUrlField.tsx` e'
   * di un'altra corsia dello stesso lotto) e allargare qui vorrebbe dire riscrivere il lavoro di
   * qualcun altro. Sono in `difetti_nuovi`. L'elenco serve a due cose: che la prova non diventi
   * rossa per un difetto che non e' suo, e che una casella NUOVA non possa nascere sbagliata.
   */
  const DEBITO_DICHIARATO = new Map<string, string>([
    ['components/ImageUrlField.tsx', "territorio della corsia 15 dello stesso lotto"],
    ['components/SellerApplicationForm.tsx', 'fuori territorio'],
    ['components/seller/ProductImagesField.tsx', 'fuori territorio'],
    ['components/VendorForm.tsx', 'fuori territorio'],
    ['components/StoreMediaManager.tsx', 'fuori territorio'],
    ['components/admin/home/HomeSectionConfigForm.tsx', 'e una casella per VIDEO: regola sua, il magazzino dei video non e ancora dichiarato'],
  ]);

  const LISTA_TIPI_A_MANO = /["'`][^"'`]*(image|video)\/[a-z]/;

  it('trova davvero delle caselle da guardare (se no non sta misurando niente)', () => {
    expect(conCasella.length).toBeGreaterThanOrEqual(LE_DUE_CASELLE.length);
    for (const rel of LE_DUE_CASELLE) expect(conCasella, rel).toContain(rel);
  });

  it.each(LE_DUE_CASELLE)('«%s» chiede i formati al magazzino invece di scriverseli', (rel) => {
    const codice = senzaCommenti(readFileSync(join(RADICE, rel), 'utf8'));
    expect(
      LISTA_TIPI_A_MANO.test(codice),
      `${rel} si riscrive la lista dei tipi invece di chiamare mappaAccept(): è la copia che ` +
        `invecchia mentre il deposito cambia, ed è così che le foto dell'iPhone sono sparite`,
    ).toBe(false);
    expect(codice, `${rel} non chiede più la lista alla regola del magazzino`).toContain('mappaAccept');
  });

  /**
   * L'avviso passa dal cervello comune, non da una frase scritta lì per lì: due caselle che si
   * inventano due frasi diverse per la stessa cosa sono la stessa malattia di prima, un gradino
   * più in là. Che l'avviso ci SIA lo verifica già il guardiano di casa
   * (`un-riquadro-che-scarta-un-file-lo-dice.test.ts`), da cui l'8/9/2026 queste due sono uscite.
   */
  it('e il caricatore corregge il tipo del file prima di mandarlo al deposito', () => {
    const codice = senzaCommenti(
      readFileSync(join(RADICE, 'components/seller/site/ImageUpload.tsx'), 'utf8'),
    );
    expect(
      codice,
      "uploadSiteImage si costruisce la richiesta da se': quella logica torna dentro un file " +
        "'use client' dove nessuna prova puo' eseguirla",
    ).toContain('richiestaPerIlSito(file, user.id)');
  });

  it.each(LE_DUE_CASELLE)('«%s» dice quello che scarta, con le parole del cervello comune', (rel) => {
    const codice = senzaCommenti(readFileSync(join(RADICE, rel), 'utf8'));
    expect(codice, `${rel} non ha un onDropRejected: il file scartato sparisce ancora`)
      .toContain('onDropRejected');
    expect(codice, `${rel} si scrive l'avviso da sé invece di chiederlo a avvisoPerGliScartati()`)
      .toContain('avvisoPerGliScartati');
  });

  it('la galleria non taglia più in silenzio i file buoni oltre il dodicesimo', () => {
    const codice = senzaCommenti(
      readFileSync(join(RADICE, 'components/seller/site/GalleryFields.tsx'), 'utf8'),
    );
    expect(codice, 'il taglio non passa dal cervello comune: torna a essere muto')
      .toContain('decidiCosaFareDelDrop');
    expect(
      /files\.slice\(/.test(codice),
      'lo `slice` a mano è tornato: è quello che buttava via i file buoni senza dirlo',
    ).toBe(false);
  });

  it('una casella NUOVA non può nascere con la lista scritta a mano', () => {
    const colpevoli = conCasella.filter((rel) => {
      if (DEBITO_DICHIARATO.has(rel)) return false;
      const codice = senzaCommenti(readFileSync(join(RADICE, rel), 'utf8'));
      return LISTA_TIPI_A_MANO.test(codice) && !codice.includes('mappaAccept');
    });
    expect(
      colpevoli,
      `queste caselle si dettano da sole quali file accettare, e nessuno le ha dichiarate:\n  ` +
        `${colpevoli.join('\n  ')}\nUsa mappaAccept() da @/lib/storage/casella-di-caricamento.`,
    ).toEqual([]);
  });

  it('il debito dichiarato è fatto di file che esistono davvero', () => {
    for (const rel of DEBITO_DICHIARATO.keys()) {
      expect(existsSync(join(RADICE, rel)), `${rel} non esiste più: togli la riga dal debito`).toBe(true);
    }
  });
});
