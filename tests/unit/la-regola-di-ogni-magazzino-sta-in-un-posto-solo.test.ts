import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { caricaImmagine } from '@/lib/storage/carica-immagine';
import {
  attributoAccept,
  regolaDelSecchio,
  secchiConRegola,
  secchioConosciuto,
  tettoInMB,
} from '@/lib/storage/regole-secchi';

/**
 * 8/9/2026 — QUATTRO MAGAZZINI, LA STESSA REGOLA RICOPIATA A MANO, E NESSUNO CHE LA POSSIEDE.
 *
 * ── La malattia ──────────────────────────────────────────────────────────────────────────────
 * `products`, `reviews`, `stories` e `cod-proof` hanno tutti la stessa forma di regola scritta in
 * SQL: la prima cartella del percorso dev'essere chi carica. Ma le tre cose che contano davvero —
 * quali file passano, quanto pesano, se esiste l'eccezione dello staff — NON sono uguali fra i
 * quattro, e nel codice non stavano da nessuna parte: erano ricopiate a mano in ogni schermata.
 *
 * Il conto misurato prima della riparazione:
 *   · PhotoReviewUpload diceva 5 MB e tre tipi; il deposito ne accetta 10 MiB e sette.
 *   · La pagina delle storie non guardava il peso e prendeva l'estensione dal nome del file.
 *   · Il dialogo del fattorino non guardava ne' tipo ne' peso — e `cod-proof` e' l'unico che nel
 *     deposito non ha nessun limite: fra il telefono e il nostro archivio non c'era niente.
 *   · La porta concedeva la cartella `home` dello staff su TUTTI i magazzini, mentre in SQL la
 *     concede solo `products`.
 *
 * ── Che prova e' questa ──────────────────────────────────────────────────────────────────────
 * I primi blocchi ESEGUONO la porta con un deposito finto, un magazzino alla volta, e guardano
 * cosa consegna: e' comportamento, non una parola cercata in un file. Poi c'e' il confronto con
 * l'SQL vero — non posso eseguire una policy da qui, ma posso rileggerla e accorgermi il giorno in
 * cui il codice diventa una bugia. Alla fine l'invariante di struttura, che e' un controllo su del
 * testo e va detto: non puo' fallire come fallisce la realta', ma la proprieta' che misura e'
 * esattamente strutturale — «nessuno carica su questi magazzini fuori dalla porta».
 */

const UID = '11111111-2222-3333-4444-555555555555';
const CARTELLA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function depositoFinto() {
  const chiamate: Array<{ secchio: string; percorso: string; opzioni?: Record<string, unknown> }> = [];
  const client = {
    storage: {
      from: (secchio: string) => ({
        upload: async (percorso: string, _file: unknown, opzioni?: Record<string, unknown>) => {
          chiamate.push({ secchio, percorso, opzioni });
          return { error: null };
        },
        getPublicUrl: (percorso: string) => ({
          data: { publicUrl: `https://esempio.test/${secchio}/${percorso}` },
        }),
      }),
    },
  };
  return { client: client as unknown as Parameters<typeof caricaImmagine>[0], chiamate };
}

/** Un File vero col peso che decido io: `size` su Blob e' in sola lettura. */
function fileDa(nome: string, tipo: string, byte?: number) {
  const f = new File(['x'], nome, { type: tipo });
  if (byte !== undefined) Object.defineProperty(f, 'size', { value: byte });
  return f as never;
}

const QUATTRO = ['products', 'reviews', 'stories', 'cod-proof'];

describe('la regola di ogni magazzino ha una casa sola, e la porta la legge da li', () => {
  it('i quattro magazzini che il sito usa hanno tutti la loro regola dichiarata', () => {
    for (const nome of QUATTRO) {
      expect(secchioConosciuto(nome), `«${nome}» non ha una regola dichiarata`).toBe(true);
    }
    expect(secchiConRegola().map((r) => r.nome).sort()).toEqual([...QUATTRO].sort());
  });

  it('un magazzino NON dichiarato non passa: la porta si rifiuta di indovinargli una regola', async () => {
    // E' il cuore della cura. Prima un magazzino nuovo ereditava per caso la regola di un altro —
    // ed e' cosi' che `cod-proof` e' nato senza controlli. Adesso o la sua regola e' scritta, o non
    // si carica: il prossimo punto di caricamento non e' piu' una moneta lanciata in aria.
    expect(() => regolaDelSecchio('magazzino-che-non-esiste')).toThrow(/senza regola dichiarata/);
    const d = depositoFinto();
    await expect(
      caricaImmagine(d.client, { file: fileDa('a.jpg', 'image/jpeg'), userId: UID, secchio: 'nuovo-secchio' }),
    ).rejects.toThrow(/senza regola dichiarata/);
    expect(d.chiamate, 'non deve nemmeno parlare col deposito').toHaveLength(0);
  });

  it.each(QUATTRO)('su «%s» il file troppo pesante non parte, e la frase dice il tetto vero', async (secchio) => {
    const regola = regolaDelSecchio(secchio);
    const d = depositoFinto();
    await expect(
      caricaImmagine(d.client, {
        file: fileDa('enorme.jpg', 'image/jpeg', regola.maxByte + 1),
        userId: UID,
        cartella: CARTELLA,
        secchio,
      }),
    ).rejects.toThrow(new RegExp(`troppo pesante.*${tettoInMB(secchio)} MB`));
    expect(d.chiamate, `su «${secchio}» il file grosso e' comunque partito`).toHaveLength(0);
  });

  it.each(QUATTRO)('su «%s» un file fuori dalla lista dei tipi non parte', async (secchio) => {
    const d = depositoFinto();
    await expect(
      caricaImmagine(d.client, {
        file: fileDa('logo.svg', 'image/svg+xml'),
        userId: UID,
        cartella: CARTELLA,
        secchio,
      }),
    ).rejects.toThrow(/Formato non accettato/);
    expect(d.chiamate).toHaveLength(0);
  });

  it.each(QUATTRO)('su «%s» la foto di un iPhone (HEIC) passa: la lista non e piu una copia vecchia', async (secchio) => {
    const d = depositoFinto();
    await caricaImmagine(d.client, {
      file: fileDa('IMG_0042.HEIC', 'image/heic'),
      userId: UID,
      cartella: CARTELLA,
      secchio,
      quando: 1_755_000_000_000,
      caso: 'abc123',
    });
    expect(d.chiamate).toHaveLength(1);
    expect(d.chiamate[0].percorso.startsWith(`${UID}/`), 'la prima cartella dev essere chi carica').toBe(true);
  });

  it('la cartella dello staff la concede UN magazzino solo, e la porta lo sa', async () => {
    // In SQL l'eccezione `home` esiste in una policy sola, quella di `products` (114). Prima la
    // porta la concedeva ovunque: un caricamento dello staff su `reviews` partiva dal codice e
    // veniva respinto dal deposito, con l'utente davanti a un errore in inglese.
    const soloProducts = secchiConRegola().filter((r) => r.cartellaStaffAmmessa).map((r) => r.nome);
    expect(soloProducts).toEqual(['products']);

    const buono = depositoFinto();
    await caricaImmagine(buono.client, {
      file: fileDa('banner.png', 'image/png'),
      staff: true,
      secchio: 'products',
      quando: 1,
      caso: 'a',
    });
    expect(buono.chiamate[0].percorso.startsWith('home/')).toBe(true);

    for (const secchio of ['reviews', 'stories', 'cod-proof']) {
      const d = depositoFinto();
      await expect(
        caricaImmagine(d.client, { file: fileDa('x.png', 'image/png'), staff: true, secchio }),
        `su «${secchio}» la cartella dello staff non esiste: il database rifiuterebbe`,
      ).rejects.toThrow(/cartella dello staff/);
      expect(d.chiamate).toHaveLength(0);
    }
  });

  it('da un magazzino privato non esce un indirizzo pubblico', async () => {
    // `cod-proof` e' chiuso: la foto dei contanti e quella della porta di casa del cliente si
    // leggono con un link a scadenza. `getPublicUrl` costruirebbe comunque una stringa — ed e' cosi'
    // che quelle foto sono finite per mesi su un indirizzo indovinabile, prima della 114.
    const d = depositoFinto();
    const esito = await caricaImmagine(d.client, {
      file: fileDa('contanti.jpg', 'image/jpeg'),
      userId: UID,
      cartella: CARTELLA,
      secchio: 'cod-proof',
    });
    expect(esito.percorso, 'senza il percorso la prova d incasso non si ritrova piu').toContain(`${UID}/`);
    expect(esito.publicUrl, 'un indirizzo pubblico su un magazzino chiuso invita a salvarlo').toBe('');

    const pubblico = depositoFinto();
    const suReviews = await caricaImmagine(pubblico.client, {
      file: fileDa('pane.jpg', 'image/jpeg'),
      userId: UID,
      cartella: CARTELLA,
      secchio: 'reviews',
    });
    expect(suReviews.publicUrl, 'sui magazzini pubblici l indirizzo serve e deve restare').toContain('/reviews/');
  });

  it('quello che il campo «scegli un file» lascia scegliere e quello che la porta accetta', () => {
    // La divergenza vera trovata l'8/9: il campo delle recensioni diceva tre tipi, la porta ne
    // accetta sette. Chi scattava con un iPhone non riusciva nemmeno a selezionare la foto.
    for (const secchio of QUATTRO) {
      expect(attributoAccept(secchio).split(',')).toEqual([...regolaDelSecchio(secchio).tipiAmmessi]);
    }
  });
});

/**
 * IL CONFRONTO CON L'SQL. Non posso eseguire una policy da qui: vive in Postgres. Posso pero'
 * rileggerla e accorgermi il giorno in cui cambia — che e' il momento in cui questo modulo diventa
 * una bugia e i chiamanti continuano a fidarsene.
 */
describe('la regola nel codice dice la stessa cosa di quella nel database', () => {
  const RADICE = process.cwd();
  const sql = (f: string) => readFileSync(join(RADICE, 'migrations', f), 'utf8');

  it('i tipi e il tetto sono quelli della 070, parola per parola', () => {
    const t = sql('070_storage_and_rls_hardening.sql');
    const blocco = t.slice(t.indexOf('UPDATE storage.buckets'), t.indexOf("WHERE id IN ('products','reviews','stories')"));
    expect(blocco).toContain('file_size_limit = 10485760');
    for (const nome of ['products', 'reviews', 'stories']) {
      const r = regolaDelSecchio(nome);
      expect(r.maxByte, `${nome}: il tetto nel codice non e quello del deposito`).toBe(10485760);
      for (const tipo of r.tipiAmmessi) {
        expect(blocco, `${nome}: «${tipo}» non e nella lista del deposito`).toContain(`'${tipo}'`);
      }
      // E il contrario: se il deposito ne accettasse uno in piu', il codice lo starebbe nascondendo.
      const nelDeposito = [...blocco.matchAll(/'(image\/[a-z]+)'/g)].map((m) => m[1]);
      expect([...new Set(nelDeposito)].sort()).toEqual([...r.tipiAmmessi].sort());
    }
  });

  it('la prima cartella e chi carica, su tutti e quattro i magazzini', () => {
    // Ci si aggancia al NOME della policy di scrittura, non al nome del magazzino: ogni magazzino
    // compare in tre policy (lettura, scrittura, cancellazione) e la prima che si incontra e'
    // quella di lettura, che la cartella non la guarda.
    const dove: Array<[string, string, string]> = [
      ['products', '114_hardening_radiografia.sql', 'Authenticated users can upload product images'],
      ['reviews', '039_reviews_bucket.sql', 'reviews insert authenticated'],
      ['stories', '119_radiografia_18_agosto.sql', 'stories insert owner folder'],
      ['cod-proof', '114_hardening_radiografia.sql', 'cod-proof insert owner'],
    ];
    for (const [secchio, file, policy] of dove) {
      const t = sql(file);
      const i = t.indexOf(`CREATE POLICY "${policy}"`);
      expect(i, `la policy di scrittura di «${secchio}» («${policy}») non e piu in ${file}`).toBeGreaterThan(-1);
      const blocco = t.slice(i, t.indexOf(');', i) + 2);
      expect(blocco, `la policy «${policy}» non riguarda piu «${secchio}»`).toContain(`bucket_id = '${secchio}'`);
      // La forma della regola, comunque sia scritto `auth.uid()` (con o senza SELECT davanti).
      expect(blocco).toMatch(/foldername\(name\)\)\[1\] = (\(SELECT )?auth\.uid\(\)\)?::text/);
    }
  });

  it("l'eccezione della cartella «home» esiste in UNA policy sola", () => {
    // Se domani qualcuno la concedesse anche altrove senza dirlo al modulo, i chiamanti
    // continuerebbero a costruire percorsi legali — ma il modulo starebbe mentendo su cosa passa.
    const cartelle = readdirSync(join(RADICE, 'migrations'))
      .filter((f) => f.endsWith('.sql'))
      .flatMap((f) => [...sql(f).matchAll(/foldername\(name\)\)\[1\] = '([^']+)'/g)].map((m) => m[1]));
    expect([...new Set(cartelle)]).toEqual(['home']);
  });

  it('il magazzino che nel deposito NON ha il tetto e dichiarato tale, e la sua migrazione esiste', () => {
    // Questa e' la parte onesta della prova: `cod-proof` oggi e' difeso solo dal codice, e il
    // modulo lo dice invece di far finta di niente. Il giorno in cui Nicola applica la 157, questa
    // prova va riletta e il campo `tettoNelDeposito` va messo a true.
    const scoperti = secchiConRegola().filter((r) => !r.tettoNelDeposito);
    expect(scoperti.map((r) => r.nome)).toEqual(['cod-proof']);

    for (const r of scoperti) {
      expect(r.migrazioneCheLoDara, `${r.nome}: manca la migrazione che gli dara il tetto`).toBeTruthy();
      const t = sql(r.migrazioneCheLoDara!);
      expect(t, 'la migrazione non riguarda questo magazzino').toContain(`id = '${r.nome}'`);
      expect(t, 'la migrazione mette un tetto diverso da quello del codice').toContain(String(r.maxByte));
      for (const tipo of r.tipiAmmessi) expect(t).toContain(`'${tipo}'`);
    }

    // E la 114 lo crea davvero nudo: se un giorno non fosse piu' vero, il difetto sarebbe gia'
    // chiuso altrove e questa dichiarazione andrebbe tolta.
    const t = sql('114_hardening_radiografia.sql');
    const creazione = t.slice(t.indexOf("VALUES ('cod-proof'"), t.indexOf("DROP POLICY IF EXISTS \"cod-proof insert owner\""));
    expect(creazione).not.toContain('file_size_limit');
    expect(creazione).not.toContain('allowed_mime_types');
  });
});

/**
 * L'INVARIANTE DI STRUTTURA, esteso a tutti e quattro i magazzini — prima guardava solo `products`
 * e `reviews`, ed e' per questo che le due chiamate scritte a mano su `stories` e `cod-proof` sono
 * campate mesi senza che nessuna prova diventasse rossa.
 *
 * ⚠️ E' un controllo su del TESTO e non puo' fallire come fallisce la realta'. Serve lo stesso:
 * provato il 23/8, rimettendo a mano la stringa dentro un componente le prove della porta restavano
 * tutte verdi. Quelle provano che la regola sa giudicare; questa che chi carica ci passi.
 */
describe('nessuno carica su questi magazzini fuori dalla porta', () => {
  const RADICE = process.cwd();
  const CARTELLE = ['app', 'components', 'lib'];
  /** Chi puo' chiamare `.upload()`, e perche'. */
  const AMMESSI = new Map<string, string>([
    ['lib/storage/carica-immagine.ts', "e' la porta: e' il suo mestiere"],
  ]);

  /** Una CHIAMATA a `.upload()`, non una citazione: le parentesi devono avere dentro qualcosa. */
  const CHIAMATA_UPLOAD = /\.upload\(\s*[^)\s]/;

  /** Via i commenti, cosi' una spiegazione non viene scambiata per codice. */
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
      else if (/\.(ts|tsx)$/.test(voce)) out.push(pieno);
    }
    return out;
  }

  const file = CARTELLE.flatMap((c) => tuttiIFile(join(RADICE, c)))
    .map((f) => relative(RADICE, f))
    .filter((rel) => !AMMESSI.has(rel));

  it('trova davvero dei file da guardare (se no non sta misurando niente)', () => {
    expect(file.length).toBeGreaterThan(200);
  });

  it('il rilevatore non e cieco, nemmeno col nome del magazzino preso da una costante', () => {
    const conNome = `await supabase.storage.from('cod-proof').upload(path, file, { upsert: false });`;
    const conCostante = `await supabase.storage.from(SECCHIO_STORIE).upload(path, image, {});`;
    const soloCommento = `// per tornare a sbagliare bisogna riscrivere una chiamata a .upload()`;
    for (const t of [conNome, conCostante]) expect(CHIAMATA_UPLOAD.test(senzaCommenti(t)), t).toBe(true);
    expect(CHIAMATA_UPLOAD.test(senzaCommenti(soloCommento))).toBe(false);
  });

  it.each(QUATTRO)('nessun file che nomina «%s» si costruisce il percorso a mano', (secchio) => {
    const nomina = new RegExp(`['"\`]${secchio}['"\`]`);
    const colpevoli = file.filter((rel) => {
      const codice = senzaCommenti(readFileSync(join(RADICE, rel), 'utf8'));
      return nomina.test(codice) && CHIAMATA_UPLOAD.test(codice);
    });
    expect(
      colpevoli,
      `questi file caricano su «${secchio}» senza passare dalla porta: si scrivono il percorso a ` +
        `mano e non guardano ne' tipo ne' peso. Usa caricaImmagine() da ` +
        `@/lib/storage/carica-immagine.\n  ${colpevoli.join('\n  ')}`,
    ).toEqual([]);
  });

  /**
   * LA SECONDA META' DELLA MALATTIA: non basta passare dalla porta se poi la schermata si ricopia
   * accanto al campo QUALI file lasciar scegliere. E' cosi' che «5 MB e tre tipi» e' sopravvissuto
   * per mesi a un deposito che ne accettava 10 e sette, e che la foto scattata con un iPhone
   * spariva dalla finestra di scelta senza che nessuno dicesse niente.
   *
   * ⚠️ LA PRIMA VERSIONE DI QUESTA PROVA NON PROVAVA NIENTE, e va scritto perche' e' l'errore che
   * si rifara'. Cercavo `accept="image/…"` nel JSX. Rimettendo a mano la lista vecchia, ma dentro
   * una costante in cima al file (`const ACCEPT = 'image/jpeg,image/png,image/webp'`) e lasciando
   * nel JSX `accept={ACCEPT}`, la prova restava VERDE: misurava come si scrive l'attributo, non se
   * la schermata detta la sua lista. Se n'e' accorto l'esperimento del mutante, non la rilettura.
   * La regola vera e' quella qui sotto: in queste schermate non compare NESSUNA lista di tipi,
   * comunque la si scriva.
   *
   * ⚠️ IL PERIMETRO, dichiarato: le schermate che portano un file nei quattro magazzini. Restano
   * fuori, e non e' una svista:
   *   · `app/rider/onboarding/page.tsx` — manda i documenti a `/api/kyc/upload-document`, che li
   *     mette in `kyc-docs`: un quinto magazzino, con una regola sua (accetta anche i PDF) che
   *     questo modulo non dichiara ancora.
   *   · `components/seller/PhotoFillButton.tsx` — la foto non la salva: la manda a
   *     `/api/vision/extract-product` perche' l'AI ne legga i dati. Non c'e' nessun deposito.
   *   · le undici schermate che caricano su `products` passando dalla porta: la loro lista sta
   *     nelle caselle di trascinamento di `components/seller/site/`, ed e' un difetto suo.
   */
  const SCHERMATE_DEI_MAGAZZINI = new Map<string, string>([
    ['components/PhotoReviewUpload.tsx', 'reviews'],
    ['app/seller/stories/page.tsx', 'stories'],
    ['components/rider/CashConfirmDialog.tsx', 'cod-proof'],
    ['app/orders/[id]/return/page.tsx', 'products'],
  ]);

  /** Una lista di tipi scritta a mano, ovunque stia: nel JSX o in una costante in cima al file. */
  const LISTA_TIPI_A_MANO = /["'`][^"'`]*image\/[a-z]/;

  it.each([...SCHERMATE_DEI_MAGAZZINI])('«%s» non detta da sola quali file accettare', (rel, secchio) => {
    const grezzo = readFileSync(join(RADICE, rel), 'utf8');
    const codice = senzaCommenti(grezzo);
    expect(
      LISTA_TIPI_A_MANO.test(codice),
      `${rel} si riscrive la lista dei tipi invece di chiedere attributoAccept('${secchio}'): ` +
        `e' la copia che invecchia mentre il deposito cambia`,
    ).toBe(false);
    expect(codice, `${rel} non chiede piu la lista alla regola del magazzino`).toContain('attributoAccept');
  });

  it('e la lista qui sopra e completa: nessuna schermata di questi magazzini e rimasta fuori', () => {
    // Un elenco scritto a mano invecchia come tutto il resto. Questo lo ricalcola: ogni file che
    // nomina uno dei tre magazzini non-di-serie e ha un campo «scegli un file» dev'esserci dentro.
    const nominaUnMagazzino = /['"`](reviews|stories|cod-proof)['"`]/;
    const haUnCampoFile = /type="file"|useDropzone/;
    const trovate = file.filter((rel) => {
      if (!/^(app|components)\//.test(rel)) return false;
      const codice = senzaCommenti(readFileSync(join(RADICE, rel), 'utf8'));
      return nominaUnMagazzino.test(codice) && haUnCampoFile.test(codice);
    });
    const fuoriElenco = trovate.filter((rel) => !SCHERMATE_DEI_MAGAZZINI.has(rel));
    expect(
      fuoriElenco,
      `queste schermate caricano su reviews/stories/cod-proof e nessuno le sta guardando:\n  ` +
        fuoriElenco.join('\n  '),
    ).toEqual([]);
  });

  it('le esenzioni dichiarate esistono ancora (se no sono bugie che coprono un buco)', () => {
    for (const [rel, perche] of AMMESSI) {
      expect(() => statSync(join(RADICE, rel)), `${rel} e' esentato «${perche}» ma non esiste piu'`).not.toThrow();
    }
  });
});
