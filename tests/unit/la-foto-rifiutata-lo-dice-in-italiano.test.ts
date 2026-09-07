import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { friendlyError } from '@/lib/errors';
import {
  ANNO_IN_SECONDI,
  MAX_BYTE_CARICAMENTO,
  TIPI_IMMAGINE_AMMESSI,
  caricaImmagine,
} from '@/lib/storage/carica-immagine';

/**
 * 6/9/2026 — IL NEGOZIANTE CARICA IL LOGO E SI PRENDE UNA FRASE IN INGLESE.
 *
 * ── Cosa succedeva, in negozio ───────────────────────────────────────────────────────────────
 * Il grafico consegna il logo in SVG. Il negoziante lo trascina nel riquadro, che dichiarava di
 * accettare «qualunque immagine». Il file parte, sale, e alla fine il deposito lo respinge: nella
 * sua lista ci sono sette tipi e l'SVG non c'e'. Il messaggio che tornava indietro era il suo,
 * «mime type image/svg+xml is not supported», e usciva tale e quale sullo schermo. Stessa storia
 * con la foto della vetrina fatta col telefono nuovo, che supera i 10 MB: «The object exceeded the
 * maximum allowed size». Il negoziante non ha modo di capire che gli basterebbe salvarlo in PNG, o
 * scattarne una piu' leggera. Rinuncia, o telefona — e il negozio resta senza logo e senza
 * copertina, cioe' le due cose che fanno sembrare vera una bottega.
 *
 * ── Cosa prova questo file ───────────────────────────────────────────────────────────────────
 * Tre cose, tutte eseguendo il codice vero:
 *   ① le quattro frasi del deposito escono in italiano da `friendlyError`;
 *   ② la porta unica dei caricamenti rifiuta PRIMA di spedire cio' che il deposito rifiuterebbe
 *      alla fine — e non ci prova nemmeno, che e' il punto: se ci provasse, il negoziante
 *      aspetterebbe comunque il caricamento per poi vedersi dire di no;
 *   ③ il tempo di conservazione delle foto e' un anno, non un'ora.
 * In coda c'e' un invariante di struttura sui campi «carica un file», dichiarato per quello che e'.
 *
 * ⚠️ COSA NON PROVA, detto chiaro: che il deposito vero, su Supabase, abbia ancora quella lista di
 * sette tipi e quel tetto di 10 MB. Quella regola vive in Postgres e da qui non si esegue: la si
 * rilegge dalle migrazioni (ultimo blocco), cosi' il giorno in cui cambia questo file diventa rosso
 * invece di restare una bugia.
 */

const UID = '11111111-2222-3333-4444-555555555555';

describe('① le frasi del deposito arrivano al negoziante in italiano', () => {
  it('il formato che il deposito non accetta', () => {
    const detto = friendlyError({ message: 'mime type image/svg+xml is not supported' });
    expect(detto, "il negoziante leggeva l'inglese e non sapeva che bastava un PNG").not.toMatch(/mime type/i);
    expect(detto).toBe('Formato non accettato: usa una foto JPG, PNG o WEBP.');
  });

  it('la foto troppo pesante, in tutti e due i modi in cui il deposito lo dice', () => {
    for (const grezzo of ['The object exceeded the maximum allowed size', 'Payload too large']) {
      const detto = friendlyError({ message: grezzo });
      expect(detto, `«${grezzo}» esce ancora cosi' com'e'`).toMatch(/troppo pesante/);
      expect(detto, 'il limite va detto, se no non si sa quanto ridurre').toMatch(/10 MB/);
    }
  });

  it('le altre due frasi senza codice che passavano di là', () => {
    expect(friendlyError({ message: 'The resource already exists' })).toMatch(/c.è già/);
    expect(friendlyError({ message: 'value too long for type character varying' })).toMatch(/troppo lungo/);
  });

  it('non ho allargato la rete: cio' + ' che gia' + ' funzionava funziona ancora', () => {
    // Se una delle espressioni nuove fosse troppo larga, si prenderebbe errori di altri —
    // ed e' esattamente l'errore che questo file ha gia' visto fare una volta.
    expect(friendlyError({ message: 'Invalid login credentials' })).toBe('Email o password non corrette');
    expect(friendlyError({ message: 'fetch failed' })).toMatch(/connessione/);
    expect(friendlyError({ message: 'Il negozio è chiuso in questo momento.' })).toBe(
      'Il negozio è chiuso in questo momento.',
    );
  });
});

/** Un deposito finto: registra cosa gli viene consegnato, e non consegna niente da solo. */
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

describe('② la porta rifiuta prima di spedire quello che il deposito rifiuterebbe dopo', () => {
  it('il logo in SVG non parte nemmeno, e la frase dice cosa fare', async () => {
    const d = depositoFinto();
    const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }) as never;
    await expect(
      caricaImmagine(d.client, { file: svg, userId: UID, cartella: 'logos' }),
    ).rejects.toThrow(/JPG, PNG o WEBP/);
    expect(
      d.chiamate,
      'il file partiva, saliva, e veniva respinto alla fine: il negoziante aspettava per niente',
    ).toHaveLength(0);
  });

  it('la foto oltre i 10 MB non parte, e il limite viene detto', async () => {
    const d = depositoFinto();
    const enorme = new File([new Uint8Array(1)], 'vetrina.jpg', { type: 'image/jpeg' }) as never;
    // `File` non si puo' riempire davvero di 10 MB in una prova senza sprecare memoria: quello che
    // conta e' il peso dichiarato, ed e' quello che la porta guarda.
    Object.defineProperty(enorme, 'size', { value: MAX_BYTE_CARICAMENTO + 1 });
    await expect(
      caricaImmagine(d.client, { file: enorme, userId: UID, cartella: 'store-media' }),
    ).rejects.toThrow(/10 MB/);
    expect(d.chiamate).toHaveLength(0);
  });

  it('i sette formati che il deposito accetta passano tutti', async () => {
    for (const tipo of TIPI_IMMAGINE_AMMESSI) {
      const d = depositoFinto();
      const f = new File(['x'], 'foto.jpg', { type: tipo }) as never;
      await expect(
        caricaImmagine(d.client, { file: f, userId: UID, cartella: 'logos' }),
        `${tipo} e' nella lista del deposito ma la porta lo blocca: il controllo e' troppo stretto`,
      ).resolves.toBeTruthy();
      expect(d.chiamate).toHaveLength(1);
    }
  });

  it('una foto normale passa e arriva al deposito', async () => {
    const d = depositoFinto();
    const f = new File(['x'], 'pane.JPG', { type: 'image/jpeg' }) as never;
    await caricaImmagine(d.client, { file: f, userId: UID, cartella: 'logos' });
    expect(d.chiamate).toHaveLength(1);
  });
});

describe('③ una foto che non cambia mai non si riscarica ogni ora', () => {
  it('chi non dice niente ottiene un anno, non il valore corto di serie', async () => {
    const d = depositoFinto();
    const f = new File(['x'], 'logo.png', { type: 'image/png' }) as never;
    await caricaImmagine(d.client, { file: f, userId: UID, cartella: 'logos' });
    expect(
      d.chiamate[0].opzioni?.cacheControl,
      "l'indirizzo di una foto caricata e' unico: farla scadere presto e' un riscaricamento inutile",
    ).toBe(ANNO_IN_SECONDI);
  });

  it("l'anno vale davvero un anno, non un numero a caso", () => {
    expect(Number(ANNO_IN_SECONDI)).toBe(365 * 24 * 60 * 60);
  });

  it('nessun punto di caricamento rimette un tempo corto', () => {
    const RADICE = process.cwd();
    // I sette punti della scheda. `BackgroundRemovalPreview` scrive ancora un'ora: sta fuori dal
    // territorio di questa riparazione ed e' stato segnalato a parte, non nascosto qui.
    const punti = [
      'lib/products/uploadImages.ts',
      'lib/products/rehostImages.ts',
      'components/VendorForm.tsx',
      'components/SellerApplicationForm.tsx',
      'components/seller/site/ImageUpload.tsx',
      'components/PhotoReviewUpload.tsx',
      'components/ImageUrlField.tsx',
    ];
    const colpevoli = punti.filter((p) => /cacheControl:\s*'3600'/.test(readFileSync(join(RADICE, p), 'utf8')));
    expect(colpevoli, 'qui la foto torna a scadere dopo un ora').toEqual([]);
  });
});

/**
 * ── L'INVARIANTE DI STRUTTURA, e va detto che tipo di prova e' ───────────────────────────────
 *
 * Questa non esegue niente: legge del testo. Il campo «carica un file» di react-dropzone non e'
 * nascosto — e' rimpicciolito a un pixel — quindi resta nell'albero che legge un lettore di
 * schermo, e senza nome chi lo incontra sente «campo» e basta. Per provarlo davvero servirebbe
 * montare i componenti in un browser finto e passarli ad axe: in questo progetto la libreria per
 * montarli non c'e', e non si aggiunge una dipendenza dentro una riparazione.
 *
 * Quello che si puo' fare e' impedire che il prossimo campo nasca di nuovo senza nome. La proprieta'
 * misurata e' strutturale — «ogni dropzone da' un nome al suo campo» — quindi il controllo sul testo
 * la misura per intero, e diventa rosso il giorno in cui qualcuno la rompe.
 */
describe('ogni riquadro «carica un file» dice come si chiama', () => {
  const RADICE = process.cwd();
  const CARTELLE = ['app', 'components', 'lib'];

  /** Chi non ha ancora il nome, e perche' non l'ho riparato io. */
  const SCOPERTI = new Map<string, string>([
    [
      'components/admin/home/HomeSectionConfigForm.tsx',
      "stessa mancanza, ma il file sta fuori dal territorio di questa riparazione: segnalato come difetto nuovo, non toccato",
    ],
  ]);

  function tuttiIFile(dir: string, out: string[] = []): string[] {
    for (const voce of readdirSync(dir)) {
      if (voce === 'node_modules' || voce.startsWith('.')) continue;
      const pieno = join(dir, voce);
      if (statSync(pieno).isDirectory()) tuttiIFile(pieno, out);
      else if (/\.(ts|tsx)$/.test(voce)) out.push(pieno);
    }
    return out;
  }

  const file = CARTELLE.flatMap((c) => tuttiIFile(join(RADICE, c))).map((f) => relative(RADICE, f));

  it('trova davvero dei dropzone da guardare (se no non sta misurando niente)', () => {
    const conDropzone = file.filter((rel) => readFileSync(join(RADICE, rel), 'utf8').includes('getInputProps('));
    expect(conDropzone.length).toBeGreaterThan(5);
  });

  it('nessun campo file resta senza nome', () => {
    const senzaNome = file.filter((rel) => {
      if (SCOPERTI.has(rel)) return false;
      const testo = readFileSync(join(RADICE, rel), 'utf8');
      // Una chiamata a `getInputProps` che non porta dentro un `aria-label`.
      return /getInputProps\(\s*\)/.test(testo);
    });
    expect(
      senzaNome,
      'qui il campo «carica un file» non ha nome: chi usa un lettore di schermo sente «campo» ' +
        "e non sa cosa caricarci. Passa un aria-label a getInputProps().\n  " +
        senzaNome.join('\n  '),
    ).toEqual([]);
  });

  it('le eccezioni dichiarate esistono ancora (se no sono bugie che coprono un buco)', () => {
    for (const [rel, perche] of SCOPERTI) {
      expect(() => statSync(join(RADICE, rel)), `${rel} e' dichiarato scoperto «${perche}» ma non esiste piu'`).not.toThrow();
    }
  });

  it('il rilevatore non e cieco: su un testo costruito lo trova, e sul testo giusto sta zitto', () => {
    expect(/getInputProps\(\s*\)/.test('<input {...getInputProps()} />')).toBe(true);
    expect(/getInputProps\(\s*\)/.test("<input {...getInputProps({ 'aria-label': 'Carica' })} />")).toBe(false);
  });
});

/**
 * ── LA REGOLA QUI DENTRO DICE LA STESSA COSA DI QUELLA NEL DEPOSITO ──────────────────────────
 * La lista dei tipi e il tetto dei 10 MB sono scritti due volte: qui e in Postgres. Due copie
 * divergono sempre. Non posso eseguire la seconda; posso pero' rileggerla e accorgermi il giorno in
 * cui cambia — che e' il giorno in cui questo modulo comincia a mentire.
 */
describe('la lista dei formati dice la stessa cosa della migrazione', () => {
  const sql = readFileSync(join(process.cwd(), 'migrations/070_storage_and_rls_hardening.sql'), 'utf8');

  it('i sette tipi sono gli stessi', () => {
    for (const tipo of TIPI_IMMAGINE_AMMESSI) {
      expect(sql, `${tipo} non risulta piu' ammesso dalla migrazione`).toContain(`'${tipo}'`);
    }
    expect(sql, 'il deposito rifiuta SVG: se un giorno lo accettasse, la porta va riletta').not.toContain(
      'image/svg+xml',
    );
  });

  it('il tetto e ancora 10 MiB', () => {
    expect(sql).toContain('file_size_limit = 10485760');
    expect(MAX_BYTE_CARICAMENTO).toBe(10485760);
  });
});
