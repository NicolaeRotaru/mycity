import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  controllaIndirizzoImmagine,
  immagineMostrabile,
  indirizzoTravestito,
  percorsoDelSito,
} from '@/lib/indirizzo-immagine-ammesso';
import { fotoDiCategoria, motivoDaSegnalare } from '@/lib/immagine-categoria';

/**
 * 8/9/2026 — UN INDIRIZZO CHE PORTA IL CLIENTE SU UN ALTRO SITO ENTRAVA VESTITO DA FOTO NOSTRA.
 *
 * Le due funzioni che decidono se una foto si può mettere in pagina — quella del campo immagine
 * dell'amministrazione e quella delle tessere di categoria in home — dicevano di sì a indirizzi
 * che il browser va a prendere su evil.com.
 *
 *   · `lib/indirizzo-immagine-ammesso.ts` diceva «ammesso» a `//evil.com/x.jpg`. Due barre in
 *     testa non sono un percorso del sito: sono «lo schema lo prendo dalla pagina, il dominio è
 *     quest'altro». Il file credeva di aver visto una foto di casa nostra.
 *   · `lib/immagine-categoria.ts` chiudeva le due barre nude, ma lasciava passare quattro
 *     travestimenti: una tabulazione, un a capo, un ritorno carrello e una barra rovescia dentro
 *     l'indirizzo. Il browser toglie i primi tre prima di leggere, e legge la barra rovescia come
 *     una barra: `/<TAB>//evil.com/x.jpg` diventa `//evil.com/x.jpg`.
 *
 * Queste prove non si fidano della lettura. Per ogni travestimento chiedono PRIMA al lettore di
 * indirizzi vero (`new URL`, lo stesso che usa il browser) dove finisce davvero quell'indirizzo,
 * e solo dopo pretendono che le nostre funzioni lo rifiutino. Se un giorno qualcuno allarga la
 * regola, la prova diventa rossa dicendo il dominio a cui stava per mandare un cliente.
 */

const RADICE = path.resolve(__dirname, '../..');

/** La pagina da cui il browser risolverebbe l'indirizzo. Serve solo a leggere dove si finisce. */
const PAGINA_DEL_SITO = 'https://mycity.example/negozi/pane-quotidiano';

/**
 * I travestimenti: sembrano un percorso di casa nostra (cominciano per una barra, o quasi) e il
 * browser li manda su `evil.com`.
 */
const TRAVESTIMENTI: ReadonlyArray<{ nome: string; indirizzo: string }> = [
  { nome: 'due barre nude', indirizzo: '//evil.com/x.jpg' },
  { nome: 'una tabulazione fra le barre', indirizzo: '/\t//evil.com/x.jpg' },
  { nome: 'un a capo fra le barre', indirizzo: '/\n//evil.com/x.jpg' },
  { nome: 'un ritorno carrello fra le barre', indirizzo: '/\r//evil.com/x.jpg' },
  { nome: 'una barra rovescia al posto della seconda barra', indirizzo: '/\\evil.com/x.jpg' },
  { nome: 'una tabulazione e una barra sola', indirizzo: '/\t/evil.com/x.jpg' },
  { nome: 'due barre rovesce', indirizzo: '\\\\evil.com/x.jpg' },
  {
    nome: 'un a capo dentro un https di un dominio ammesso',
    indirizzo: 'https://images.pexels.com\n@evil.com/x.jpg',
  },
];

/** Gli indirizzi veri, che devono continuare a funzionare: un fix che rompe questi è un danno. */
const INDIRIZZI_BUONI: ReadonlyArray<string> = [
  '/placeholder.svg',
  '/immagini/categorie/libri.jpg',
  'https://images.pexels.com/photos/1435904/pexels-photo.jpeg',
  'https://placehold.co/600x400.png',
];

describe('dove finisce davvero un indirizzo travestito da percorso del sito', () => {
  it.each(TRAVESTIMENTI)(
    'con $nome il browser va su evil.com, quindi non è un percorso di casa nostra',
    ({ indirizzo }) => {
      // Questo non è il nostro giudizio: è il lettore di indirizzi vero, quello del browser.
      const letto = new URL(indirizzo, PAGINA_DEL_SITO);

      expect(
        letto.host,
        `Se questo non fosse evil.com la prova non proverebbe niente: vorrebbe dire che l'indirizzo non è un travestimento e che la stiamo scrivendo sul caso sbagliato. Letto: ${letto.href}`,
      ).toBe('evil.com');
    },
  );

  it.each(TRAVESTIMENTI)(
    "con $nome il campo immagine dell'amministrazione dice di no, e lo dice",
    ({ indirizzo }) => {
      const esito = controllaIndirizzoImmagine(indirizzo);

      expect(
        esito.stato,
        `Il campo lo dichiarava «ammesso»: disegnava l'anteprima, non protestava, e l'indirizzo finiva salvato. Il browser lo andrebbe a prendere su ${new URL(indirizzo, PAGINA_DEL_SITO).host}`,
      ).toBe('non_ammesso');
      expect(
        esito.messaggio,
        "Un rifiuto muto è mezzo rifiuto: chi ha incollato l'indirizzo deve leggere perché",
      ).toBeTruthy();
      expect(
        immagineMostrabile(indirizzo),
        "immagineMostrabile decide se disegnare l'anteprima: qui deve dire di no",
      ).toBe(false);
    },
  );

  it.each(TRAVESTIMENTI)(
    'con $nome la tessera di categoria resta il gradiente, e il motivo finisce nei log',
    ({ indirizzo }) => {
      const esito = fotoDiCategoria({ slug: 'alimentari', image_url: indirizzo });

      expect(
        esito.src,
        `Questo valore finisce dentro il src di un'immagine su una pagina pubblica: se torna non-null, il browser va a prendere la foto su ${new URL(indirizzo, PAGINA_DEL_SITO).host}`,
      ).toBeNull();
      expect(esito.motivo).toBe('indirizzo-travestito');

      const daDire = motivoDaSegnalare(esito);
      expect(
        daDire,
        'Un guasto che nessuno vede è un guasto che resta: deve lasciare una riga nei log',
      ).toBeTruthy();
      expect(
        daDire,
        "Nei log ci deve essere l'indirizzo scartato, o non si sa quale correggere",
      ).toContain('evil.com');
    },
  );

  it('e nessuno di loro è un percorso di casa nostra, chiesto alla funzione di forma', () => {
    for (const { nome, indirizzo } of TRAVESTIMENTI) {
      expect(percorsoDelSito(indirizzo), `${nome}: non è un percorso di casa nostra`).toBe(false);
    }
  });
});

describe('quello che il database non può vedere lo deve vedere il sito', () => {
  /**
   * Il vincolo `categories_image_url_format` (migrazione 159) guarda la FORMA dell'indirizzo, non
   * il dominio: per lui `https://images.pexels.com@evil.com/x.jpg` è regolarissimo — nessuna
   * barra strana, nessun carattere di controllo. Ma tutto quello che sta prima della chiocciola è
   * un nome utente, non un dominio: il browser va su evil.com. Se il sito si fidasse del paletto
   * del database, quell'indirizzo entrerebbe in pagina.
   */
  const CON_LA_CHIOCCIOLA = 'https://images.pexels.com@evil.com/x.jpg';

  it('la chiocciola sposta il dominio: il database lo lascia passare, il sito no', () => {
    expect(
      new URL(CON_LA_CHIOCCIOLA).hostname,
      'Se il lettore vero non dicesse evil.com, questa prova starebbe difendendo un caso che non esiste',
    ).toBe('evil.com');

    // La forma è regolare: nessun carattere di controllo, nessuna barra rovescia. Cioè il vincolo
    // del database non ha niente da obiettare — ed è per questo che il controllo qui serve.
    expect(indirizzoTravestito(CON_LA_CHIOCCIOLA)).toBe(false);

    expect(controllaIndirizzoImmagine(CON_LA_CHIOCCIOLA).stato).toBe('non_ammesso');
    expect(fotoDiCategoria({ image_url: CON_LA_CHIOCCIOLA }).src).toBeNull();
  });

  it('e anche al contrario, col dominio vero ammesso ma un altro nome davanti', () => {
    // Qui il browser va DAVVERO su images.pexels.com, quindi l'elenco dei domini direbbe di sì.
    // A chi lo legge nel pannello però sembra un indirizzo di evil.com, e una foto non ha mai
    // bisogno di un nome utente: nel dubbio si rifiuta.
    const alContrario = 'https://evil.com@images.pexels.com/x.jpg';
    expect(new URL(alContrario).hostname).toBe('images.pexels.com');

    expect(controllaIndirizzoImmagine(alContrario).stato).toBe('non_ammesso');
    expect(fotoDiCategoria({ image_url: alContrario }).src).toBeNull();
  });
});

describe('il sito non è mai più permissivo del database', () => {
  /**
   * Non si confrontano due testi: si ESEGUE la regola del database su un elenco di indirizzi e si
   * pretende che tutto quello che il database rifiuta lo rifiuti anche il sito. Le regole vengono
   * lette dal file della migrazione, così il giorno che una delle due parti cambia da sola questa
   * prova diventa rossa invece di lasciare due paletti che non si parlano più.
   */
  function haCaratteriDiControllo(s: string): boolean {
    // La traduzione di `[[:cntrl:]]`, scritta senza scriverli: sono i caratteri sotto lo spazio
    // (tabulazione, a capo, ritorno carrello e compagnia) più il carattere di cancellazione.
    return [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
  }

  function regoleDiFormaDelDatabase(): RegExp[] {
    const sql = readFileSync(
      path.join(
        RADICE,
        'migrations/159_la_foto_della_categoria_si_cambia_senza_ripubblicare_il_sito.sql',
      ),
      'utf8',
    );
    const dentroIlVincolo = sql.slice(sql.indexOf('ADD CONSTRAINT categories_image_url_format'));
    const trovate = [...dentroIlVincolo.matchAll(/image_url\s+~\s+'([^']+)'/g)].map((m) => m[1]);
    expect(
      trovate.length,
      'Nella migrazione 159 non si trovano più le due regole di forma: o il vincolo è cambiato, o questa prova sta leggendo il file sbagliato',
    ).toBe(2);
    expect(
      dentroIlVincolo.includes("image_url !~ '[[:cntrl:]]'"),
      'Il database non rifiuta più i caratteri di controllo: allora il sito è rimasto solo a difendere, e va detto ad alta voce',
    ).toBe(true);
    // Le due regole sono già scritte in una sintassi che JavaScript legge allo stesso modo.
    return trovate.map((r) => new RegExp(r));
  }

  /** Vero se la riga entrerebbe in tabella. */
  function passaIlDatabase(indirizzo: string, forma: RegExp[]): boolean {
    if (haCaratteriDiControllo(indirizzo)) return false;
    return forma.some((r) => r.test(indirizzo));
  }

  /** Vero se il sito lo metterebbe in pagina: una sola delle due strade è già troppo. */
  function passaIlSito(indirizzo: string): boolean {
    return (
      controllaIndirizzoImmagine(indirizzo).stato === 'ammesso' ||
      fotoDiCategoria({ image_url: indirizzo }).src !== null
    );
  }

  it('tutto quello che il database rifiuta, il sito lo rifiuta', () => {
    const forma = regoleDiFormaDelDatabase();
    const scartatiDalDatabase = TRAVESTIMENTI.map((t) => t.indirizzo).filter(
      (i) => !passaIlDatabase(i, forma),
    );

    expect(
      scartatiDalDatabase.length,
      'Se il database ne accettasse qualcuno non ci sarebbe niente da confrontare su quello, e la prova girerebbe a vuoto',
    ).toBe(TRAVESTIMENTI.length);

    for (const indirizzo of scartatiDalDatabase) {
      expect(
        passaIlSito(indirizzo),
        `${JSON.stringify(indirizzo)} passa il sito ma non il database: vuol dire che il cancello più largo dei due è il sito`,
      ).toBe(false);
    }
  });

  it('e in più il sito ferma quello che il database non può vedere: il dominio', () => {
    const forma = regoleDiFormaDelDatabase();
    const conLaChiocciola = 'https://images.pexels.com@evil.com/x.jpg';

    expect(
      passaIlDatabase(conLaChiocciola, forma),
      'Il vincolo guarda la forma, e questo indirizzo la rispetta: è la ragione per cui il controllo sul dominio nel TypeScript non si può togliere',
    ).toBe(true);
    expect(passaIlSito(conLaChiocciola)).toBe(false);
  });

  it('gli indirizzi veri passano tutti e due i cancelli: severo non vuol dire rotto', () => {
    const forma = regoleDiFormaDelDatabase();
    for (const buono of INDIRIZZI_BUONI) {
      expect(passaIlDatabase(buono, forma), `${buono} non entrerebbe nemmeno in tabella`).toBe(true);
      expect(passaIlSito(buono), `${buono} è un indirizzo buono e il sito lo rifiuta`).toBe(true);
    }
  });
});

describe('la classe intera, non i casi che ci sono venuti in mente', () => {
  /**
   * Le prove qui sopra difendono gli otto travestimenti che conosciamo. Questa difende la REGOLA:
   * prende un pugno di scheletri di indirizzo, ci infila dentro a turno ogni carattere sospetto
   * (i caratteri di controllo, gli spazi strani, la barra rovescia, il punto, il niente) e per
   * OGNI combinazione che le nostre funzioni accettano chiede al lettore di indirizzi vero dove
   * si finirebbe. Se si finisce fuori da casa nostra e fuori dai domini ammessi, è una fuga.
   *
   * Serve perché un elenco di casi noti invecchia: il prossimo travestimento sarà un carattere a
   * cui non ha pensato nessuno. Il conto dell'8/9/2026, con questo stesso elenco: 51 fughe sul
   * codice di prima del fix, 0 su questo.
   */
  const CARATTERI_SOSPETTI: ReadonlyArray<string> = [
    // Scritti come numero e non come carattere apposta: sono invisibili, e un file di prove pieno
    // di caratteri invisibili è un file che nessuno può più rileggere.
    //   9 tabulazione · 10 a capo · 13 ritorno carrello · 0 nulla · 11 e 12 salti di riga vecchi
    //   127 cancellazione · 133 a capo della seconda famiglia · 160 spazio unificatore
    //   8203 spazio di larghezza zero · 65279 segno d'ordine dei byte · 8232 separatore di riga
    ...[9, 10, 13, 0, 11, 12, 127, 133, 160, 8203, 65279, 8232].map((c) => String.fromCharCode(c)),
    ' ',
    '\\',
    '%09',
    '%0a',
    '.',
    '',
  ];

  const SCHELETRI: ReadonlyArray<string> = [
    'X//evil.com/x.jpg',
    '/X/evil.com/x.jpg',
    '/X//evil.com/x.jpg',
    'X/evil.com/x.jpg',
    '//Xevil.com/x.jpg',
    '/\\X evil.com/x.jpg',
    'httpsX://evil.com/x.jpg',
    'https:X//evil.com/x.jpg',
    'https:/X/evil.com/x.jpg',
    'https://images.pexels.comX@evil.com/x.jpg',
    'https://images.pexels.com.evil.comX/x.jpg',
    'https://evil.comX/x.jpg',
    'https://images.pexels.comX.evil.com/x.jpg',
    '/immaginiX//evil.com/x.jpg',
  ];

  /**
   * I domini che possono ospitare una nostra foto. Sono scritti a mano qui, non importati: una
   * prova che chiede la risposta proprio alla cosa che sta provando non prova niente.
   */
  const DOMINI_CHE_POSSIAMO_MOSTRARE = ['images.pexels.com', 'placehold.co', 'api.iconify.design'];
  const dominioNostro = (host: string) =>
    DOMINI_CHE_POSSIAMO_MOSTRARE.includes(host) || /^[^.]+\.supabase\.co$/.test(host);

  it('qualunque indirizzo accettiamo, il browser lo va a prendere in casa nostra o su un dominio ammesso', () => {
    const casaNostra = new URL(PAGINA_DEL_SITO).origin;
    const fughe: string[] = [];
    let provati = 0;

    for (const scheletro of SCHELETRI) {
      for (const carattere of CARATTERI_SOSPETTI) {
        const indirizzo = scheletro.split('X').join(carattere);
        provati += 1;

        const loAccettiamo =
          controllaIndirizzoImmagine(indirizzo).stato === 'ammesso' ||
          fotoDiCategoria({ image_url: indirizzo }).src !== null;
        if (!loAccettiamo) continue;

        let dove: string;
        try {
          const letto = new URL(indirizzo, PAGINA_DEL_SITO);
          dove = letto.origin === casaNostra ? '' : letto.host;
        } catch {
          dove = 'non leggibile';
        }
        if (dove !== '' && !dominioNostro(dove)) {
          fughe.push(`${JSON.stringify(indirizzo)} porta su ${dove}`);
        }
      }
    }

    expect(provati, 'Se il giro non prova quasi niente, la prova è una decorazione').toBeGreaterThan(200);
    expect(
      fughe,
      `Questi indirizzi li accettiamo, e il browser li va a prendere su un sito che non è il nostro:\n${fughe.join('\n')}`,
    ).toEqual([]);
  });
});
