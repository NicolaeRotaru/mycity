import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { caricaImmagine } from '@/lib/storage/carica-immagine';
import { percorsoAmmesso } from '@/lib/storage/percorso-caricamento';

/**
 * 3/9/2026 — LA FOTO DI UNA RECENSIONE SI COSTRUIVA IL PERCORSO DA SOLA.
 *
 * ── La malattia, e perche' non e' morta col difetto #167 ─────────────────────────────────────
 * Sul magazzino `products` la regola di scrittura sta in SQL: passa solo un percorso la cui PRIMA
 * cartella e' l'identificativo di chi carica. Nel codice quella regola non aveva casa: dieci punti
 * costruivano il percorso a mano con una stringa, e TRE l'hanno scritto in un modo che il database
 * rifiuta. Conseguenza vera: nessun negoziante e' mai riuscito a mettere la copertina alla vetrina.
 * La cura e' stata togliere ai chiamanti la possibilita' di dire la cosa sbagliata — una porta
 * sola, che riceve una CARTELLA e non un percorso.
 *
 * Il magazzino delle foto delle recensioni ha la stessa identica regola (`039_reviews_bucket.sql`:
 * `(storage.foldername(name))[1] = auth.uid()::text`, ripetuta in lettura dalla `070`), ma era
 * rimasto fuori dalla porta: questa schermata si scriveva il percorso a mano, con la prima
 * cartella dentro la stringa. Oggi e' giusta — quindi il difetto non si vede — ma e' giusta per
 * caso, come lo era in sette punti su dieci sul secchio `products`. Il prossimo punto che nasce su
 * questo magazzino e' un'altra moneta lanciata in aria.
 *
 * ── Che prova e' questa ──────────────────────────────────────────────────────────────────────
 * Il primo blocco ESEGUE la porta con un client finto e guarda il percorso che consegna al
 * magazzino: e' il comportamento, non una parola cercata in un file. Il secondo e' l'invariante di
 * struttura — «nessuno carica sul magazzino delle recensioni fuori dalla porta» — ed e' un
 * controllo su del testo, va detto: non puo' fallire come fallisce la realta', ma la proprieta' che
 * misura e' esattamente strutturale e diventa rossa il giorno che qualcuno riapre la strada
 * alternativa. Da sole nessuna delle due basta: la prima prova che la regola sa giudicare, la
 * seconda che chi carica ci passi. Insieme chiudono la malattia su questo magazzino.
 */

const SECCHIO = 'reviews';
const UID = '11111111-2222-3333-4444-555555555555';
const PRODOTTO = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function clienteFinto() {
  const chiamate: Array<{ secchio: string; percorso: string; opzioni?: Record<string, unknown> }> = [];
  let errore: { message: string } | null = null;
  const client = {
    storage: {
      from: (secchio: string) => ({
        upload: async (percorso: string, _file: unknown, opzioni?: Record<string, unknown>) => {
          chiamate.push({ secchio, percorso, opzioni });
          return { error: errore };
        },
        getPublicUrl: (percorso: string) => ({
          data: { publicUrl: `https://esempio.test/${secchio}/${percorso}` },
        }),
      }),
    },
  };
  return {
    client: client as unknown as Parameters<typeof caricaImmagine>[0],
    chiamate,
    rompi: (m: string) => {
      errore = { message: m };
    },
  };
}

// Un File vero: Blob ha `type` in sola lettura, quindi non lo si puo' decorare.
const file = new File(['x'], 'la mia foto.JPEG', { type: 'image/jpeg' }) as never;

describe('la porta, sul magazzino delle recensioni', () => {
  it('mette la foto sotto la cartella di chi scrive la recensione', async () => {
    const f = clienteFinto();
    const esito = await caricaImmagine(f.client, {
      file,
      userId: UID,
      cartella: PRODOTTO,
      secchio: SECCHIO,
      cacheControl: '3600',
      quando: 1_755_000_000_000,
      caso: 'abc123',
    });

    expect(f.chiamate).toHaveLength(1);
    expect(f.chiamate[0].secchio, 'la foto e finita in un altro magazzino').toBe(SECCHIO);
    expect(f.chiamate[0].percorso).toBe(`${UID}/${PRODOTTO}/1755000000000-abc123.jpeg`);
    expect(
      percorsoAmmesso(f.chiamate[0].percorso, { userId: UID }).ammesso,
      'il database rifiuterebbe questo percorso: la foto della recensione non si caricherebbe mai',
    ).toBe(true);
    expect(esito.percorso, 'senza il percorso, il pulsante «togli la foto» non sa cosa cancellare').toBe(
      f.chiamate[0].percorso,
    );
    expect(esito.publicUrl).toContain(`/${SECCHIO}/${UID}/`);
  });

  it('il tempo di conservazione arriva al magazzino, e non si sovrascrive niente', async () => {
    const f = clienteFinto();
    await caricaImmagine(f.client, { file, userId: UID, cartella: PRODOTTO, secchio: SECCHIO, cacheControl: '3600' });
    expect(f.chiamate[0].opzioni?.cacheControl).toBe('3600');
    expect(f.chiamate[0].opzioni?.upsert).toBe(false);
    expect(f.chiamate[0].opzioni?.contentType).toBe('image/jpeg');
  });

  it('senza sapere CHI carica si ferma prima di parlare col magazzino', async () => {
    const f = clienteFinto();
    await expect(
      caricaImmagine(f.client, { file, cartella: PRODOTTO, secchio: SECCHIO }),
    ).rejects.toThrow();
    expect(f.chiamate, "non deve nemmeno provarci: chi scrive leggerebbe l'errore crudo del magazzino").toHaveLength(0);
  });

  it("l'errore del magazzino non viene ingoiato: e cosi che si riconosce «non esiste»", async () => {
    const f = clienteFinto();
    f.rompi('Bucket not found');
    await expect(
      caricaImmagine(f.client, { file, userId: UID, cartella: PRODOTTO, secchio: SECCHIO }),
    ).rejects.toThrow(/not found/);
  });

  it('i percorsi scritti a mano che il database rifiuta: eccoli', () => {
    // I due modi in cui una stringa scritta a mano sbaglia: il nome di comodo davanti, e le due
    // cartelle invertite. Nessuno dei due si puo' piu' dire passando dalla porta.
    for (const rotto of [`${SECCHIO}/${PRODOTTO}/1.jpg`, `${PRODOTTO}/${UID}/1.jpg`]) {
      expect(percorsoAmmesso(rotto, { userId: UID }).ammesso, `${rotto} non deve passare`).toBe(false);
    }
  });
});

/**
 * L'invariante di struttura, per QUESTO magazzino. Oggi il punto che ci carica e' uno solo —
 * la schermata delle foto nelle recensioni — quindi l'elenco degli ammessi e' completo e non
 * nasconde niente: e' il senso di tenerlo qui accanto.
 */
describe('nessuno carica sul magazzino delle recensioni fuori dalla porta', () => {
  const RADICE = process.cwd();
  const CARTELLE = ['app', 'components', 'lib'];
  /** Chi puo' chiamare `.upload()` su questo magazzino, e perche'. */
  const AMMESSI = new Map<string, string>([
    ['lib/storage/carica-immagine.ts', "e' la porta: e' il suo mestiere"],
  ]);
  const cerca = new RegExp(`from\\(\\s*['"\`]${SECCHIO}['"\`]\\s*\\)\\s*\\.upload\\(`);

  function tuttiIFile(dir: string, out: string[] = []): string[] {
    for (const voce of readdirSync(dir)) {
      if (voce === 'node_modules' || voce.startsWith('.')) continue;
      const pieno = join(dir, voce);
      if (statSync(pieno).isDirectory()) tuttiIFile(pieno, out);
      else if (/\.(ts|tsx)$/.test(voce)) out.push(pieno);
    }
    return out;
  }

  const file = CARTELLE.flatMap((c) => tuttiIFile(join(RADICE, c)));

  it('trova davvero dei file da guardare (se no non sta misurando niente)', () => {
    expect(file.length).toBeGreaterThan(200);
  });

  it('il rilevatore non e cieco: su un testo costruito lo trova', () => {
    expect(cerca.test(`await supabase.storage.from('${SECCHIO}').upload(path, file, {});`)).toBe(true);
  });

  it(`nessun file costruisce a mano il percorso su «${SECCHIO}»`, () => {
    const colpevoli = file
      .map((f) => relative(RADICE, f))
      .filter((rel) => !AMMESSI.has(rel) && cerca.test(readFileSync(join(RADICE, rel), 'utf8')));
    expect(
      colpevoli,
      `questi file caricano sul magazzino «${SECCHIO}» senza passare dalla porta: si costruiscono il ` +
        `percorso a mano, ed e' esattamente cosi' che tre schermate sono nate rifiutate dal database. ` +
        `Usa caricaImmagine() da @/lib/storage/carica-immagine.\n  ${colpevoli.join('\n  ')}`,
    ).toEqual([]);
  });

  it('le esenzioni dichiarate esistono ancora (se no sono bugie che coprono un buco)', () => {
    for (const [rel, perche] of AMMESSI) {
      expect(() => statSync(join(RADICE, rel)), `${rel} e' esentato «${perche}» ma non esiste piu'`).not.toThrow();
    }
  });
});
