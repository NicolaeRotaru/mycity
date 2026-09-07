import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_BYTE_CARICAMENTO, caricaImmagine } from '@/lib/storage/carica-immagine';

/**
 * 6/9/2026 — CHI ALLEGA LA FOTO ALLA RECENSIONE SI PRENDEVA UN ERRORE DA PROGRAMMATORE.
 *
 * ── Cosa succedeva, a video ──────────────────────────────────────────────────────────────────
 * Il cliente ha comprato il pane, scrive la recensione, allega la foto. Se qualcosa andava
 * storto, `PhotoReviewUpload` mostrava il messaggio che gli arrivava, qualunque fosse:
 *   • «Bucket "reviews" non esiste. Chiedi all'admin di crearlo (public, max 5MB).»
 *   • «caricaImmagine senza file»
 *   • «percorso non ammesso (la prima cartella è «xyz»: il database accetta solo
 *      l'identificativo di chi carica o «home» per lo staff…)»
 *   • e il ripiego «Upload fallito», che non è nemmeno italiano.
 * Tre su quattro sono guasti NOSTRI: lui non può farci niente e non deve leggerne il motivo.
 *
 * ── Cosa prova questo file, e come ───────────────────────────────────────────────────────────
 * Le frasi grezze NON sono scritte a mano qui dentro: si fanno lanciare alla porta vera dei
 * caricamenti (`caricaImmagine`, eseguita davvero) e a un deposito finto che risponde come
 * risponde lo Storage. Poi si prendono le regole VERE spedite in produzione — i caratteri delle
 * espressioni dentro `FRASI_DI_CARICAMENTO`, lette dal sorgente e ricostruite come RegExp — e si
 * eseguono su quelle frasi. Se domani la porta cambia parole, o qualcuno allarga una regola, qui
 * diventa rosso.
 *
 * ⚠️ COSA NON PROVA, detto chiaro: che il pezzo di schermo si disegni. Un componente `.tsx` in
 * questo progetto non si può importare in una prova unitaria (`jsx: preserve` in tsconfig.json,
 * che è di tutti e non si tocca) e la libreria per montarlo non è installata. Quindi qui non si
 * monta niente: si esegue la porta vera, si eseguono le regole vere, e sul resto — che il testo
 * finisca proprio dentro `toast.error` — si legge il sorgente, che sui difetti minori il manuale
 * del lotto ammette.
 */

const RADICE = process.cwd();
const REL = 'components/PhotoReviewUpload.tsx';
const SORGENTE = readFileSync(join(RADICE, REL), 'utf8');
const UID = '11111111-2222-3333-4444-555555555555';

/** Un deposito finto che può anche rispondere di no, come fa lo Storage vero. */
function depositoFinto(errore?: { message: string }) {
  const chiamate: string[] = [];
  const client = {
    storage: {
      from: (secchio: string) => ({
        upload: async (percorso: string) => {
          chiamate.push(`${secchio}/${percorso}`);
          return { error: errore ?? null };
        },
        getPublicUrl: (percorso: string) => ({ data: { publicUrl: `https://esempio.test/${percorso}` } }),
      }),
    },
  };
  return { client: client as unknown as Parameters<typeof caricaImmagine>[0], chiamate };
}

/** Quello che c'è scritto dentro un errore, come lo legge il componente. */
function messaggioDi(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err ?? '');
}

/** Fa fallire davvero la porta e restituisce la frase grezza che ne esce. */
async function frazeGrezzaDa(richiesta: Parameters<typeof caricaImmagine>[1], errore?: { message: string }) {
  const d = depositoFinto(errore);
  const esito = await caricaImmagine(d.client, richiesta).then(() => null).catch((e) => e);
  expect(esito, 'doveva fallire e non è fallito: la prova non sta misurando niente').not.toBeNull();
  return messaggioDi(esito);
}

/**
 * LE REGOLE VERE, prese dai caratteri che partono in produzione — non una copia scritta qui.
 * Se qualcuno riscrive `FRASI_DI_CARICAMENTO`, questa prova legge la versione nuova.
 */
function regoleSpedite(): Array<{ re: RegExp; costante: string }> {
  const inizio = SORGENTE.indexOf('const FRASI_DI_CARICAMENTO');
  const fine = SORGENTE.indexOf('function frasePerChiCarica');
  expect(inizio, 'la lista chiusa delle frasi non esiste più in ' + REL).toBeGreaterThan(-1);
  expect(fine).toBeGreaterThan(inizio);
  return [...SORGENTE.slice(inizio, fine).matchAll(/\[\s*\/(.+?)\/([a-z]*)\s*,\s*([A-Z_]+)\s*\]/g)].map(
    ([, corpo, flag, costante]) => ({ re: new RegExp(corpo, flag), costante }),
  );
}

/** Il nome della frase che il cliente leggerebbe davanti a questo errore grezzo. */
function cosaLegge(grezzo: string): string {
  for (const r of regoleSpedite()) if (r.re.test(grezzo)) return r.costante;
  return 'NON_RIUSCIAMO_A_SALVARE';
}

/** Il testo vero di una delle frasi dichiarate. */
function testoDi(costante: string): string {
  const m = SORGENTE.match(new RegExp(`const ${costante}\\s*=\\s*([\\s\\S]*?);\\n`));
  expect(m, `la frase ${costante} non è dichiarata in ${REL}`).not.toBeNull();
  return String(m?.[1] ?? '');
}

describe('il lettore non è cieco (se no non sta misurando niente)', () => {
  it('trova la lista chiusa e almeno tre regole', () => {
    expect(regoleSpedite().length).toBeGreaterThanOrEqual(3);
  });

  it('una frase che nessuna regola conosce finisce nel ripiego', () => {
    expect(cosaLegge('qualcosa che non somiglia a niente di dichiarato')).toBe('NON_RIUSCIAMO_A_SALVARE');
  });
});

describe('① il gergo della porta dei caricamenti non arriva a chi sta scrivendo la recensione', () => {
  it('«caricaImmagine senza file» resta dentro casa', async () => {
    const grezzo = await frazeGrezzaDa({
      file: undefined as unknown as Parameters<typeof caricaImmagine>[1]['file'],
      userId: UID,
      cartella: 'prod-1',
      secchio: 'reviews',
    });
    expect(grezzo, 'la porta non lancia più questa frase: la prova va riletta').toContain('caricaImmagine');
    expect(cosaLegge(grezzo), `«${grezzo}» finirebbe a video`).toBe('NON_RIUSCIAMO_A_SALVARE');
  });

  it('«percorso non ammesso (…)» resta dentro casa', async () => {
    const grezzo = await frazeGrezzaDa({
      file: new File(['x'], 'pane.jpg', { type: 'image/jpeg' }) as never,
      userId: '',
      cartella: 'prod-1',
      secchio: 'reviews',
    });
    expect(grezzo, 'il controllo del percorso non scatta più: la prova va riletta').toMatch(/percorso/i);
    expect(cosaLegge(grezzo), `«${grezzo}» finirebbe a video`).toBe('NON_RIUSCIAMO_A_SALVARE');
  });

  it('il magazzino che non c’è non diventa un compito per il cliente', async () => {
    const grezzo = await frazeGrezzaDa(
      {
        file: new File(['x'], 'pane.jpg', { type: 'image/jpeg' }) as never,
        userId: UID,
        cartella: 'prod-1',
        secchio: 'reviews',
      },
      { message: 'Bucket not found' },
    );
    expect(grezzo).toContain('Bucket');
    expect(cosaLegge(grezzo)).toBe('NON_RIUSCIAMO_A_SALVARE');
  });

  it('il ripiego dice cosa può fare, e dice che la recensione si lascia lo stesso', () => {
    const testo = testoDi('NON_RIUSCIAMO_A_SALVARE');
    expect(testo).toMatch(/Riprova/i);
    expect(testo, 'senza questa riga il cliente pensa di dover ricominciare tutto').toMatch(/senza foto/i);
  });
});

describe('② quello su cui il cliente PUÒ agire continua ad arrivargli', () => {
  it('il formato che il deposito non accetta', async () => {
    const grezzo = await frazeGrezzaDa({
      file: new File(['<svg/>'], 'foto.svg', { type: 'image/svg+xml' }) as never,
      userId: UID,
      cartella: 'prod-1',
      secchio: 'reviews',
    });
    expect(cosaLegge(grezzo)).toBe('FORMATO_NON_ACCETTATO');
    expect(testoDi('FORMATO_NON_ACCETTATO')).toMatch(/JPG/);
  });

  it('la foto troppo pesante, anche quando è lo Storage a dirlo in inglese', async () => {
    const enorme = new File(['x'], 'vetrina.jpg', { type: 'image/jpeg' }) as never;
    Object.defineProperty(enorme, 'size', { value: MAX_BYTE_CARICAMENTO + 1 });
    const dallaPorta = await frazeGrezzaDa({ file: enorme, userId: UID, cartella: 'prod-1', secchio: 'reviews' });
    expect(cosaLegge(dallaPorta)).toBe('FOTO_TROPPO_PESANTE');
    for (const dalloStorage of ['The object exceeded the maximum allowed size', 'Payload too large']) {
      expect(cosaLegge(dalloStorage), `«${dalloStorage}» uscirebbe in inglese`).toBe('FOTO_TROPPO_PESANTE');
    }
  });

  it('la rete caduta si dice, perché lì riprovare serve davvero', () => {
    expect(cosaLegge('TypeError: fetch failed')).toBe('RETE_CADUTA');
  });
});

describe('③ nessuna frase tecnica può più uscire da questa schermata', () => {
  const PAROLE_DA_TERMINALE = /\bbucket\b|\badmin\b|\bupload\b|percorso|\bpublic\b|not found|fallito/i;

  it('le frasi dichiarate sono in italiano da negozio', () => {
    for (const costante of ['NON_RIUSCIAMO_A_SALVARE', 'FORMATO_NON_ACCETTATO', 'FOTO_TROPPO_PESANTE', 'RETE_CADUTA']) {
      expect(testoDi(costante), `«${costante}» parla ancora da terminale`).not.toMatch(PAROLE_DA_TERMINALE);
    }
  });

  it('nessun avviso mostra il messaggio grezzo dell’errore', () => {
    const avvisi = [...SORGENTE.matchAll(/toast\.error\(([\s\S]*?)\);/g)].map((m) => m[1].trim());
    expect(avvisi.length, 'nessun avviso trovato: la prova non sta misurando niente').toBeGreaterThan(0);
    const colpevoli = avvisi.filter((a) => !a.startsWith('frasePerChiCarica(') && /\berr\b|messaggioDi\(/.test(a));
    expect(
      colpevoli,
      'qui il messaggio grezzo finisce a video: passalo da frasePerChiCarica().\n  ' + colpevoli.join('\n  '),
    ).toEqual([]);
  });

  it('la lista resta chiusa: fuori dalle regole si cade sempre nel ripiego', () => {
    const corpo = SORGENTE.slice(SORGENTE.indexOf('function frasePerChiCarica'));
    expect(corpo.slice(0, corpo.indexOf('\n}')), 'il ripiego non è più la frase dichiarata').toContain(
      'return NON_RIUSCIAMO_A_SALVARE;',
    );
  });
});
