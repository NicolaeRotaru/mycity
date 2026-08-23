import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { caricaImmagine } from '@/lib/storage/carica-immagine';
import {
  CARTELLA_STAFF,
  casoNuovo,
  estensioneDi,
  percorsoAmmesso,
  percorsoStaff,
  percorsoUtente,
} from '@/lib/storage/percorso-caricamento';

/**
 * #167 — LA COPERTINA DEL NEGOZIO NON SI CARICAVA, PER NESSUN NEGOZIANTE, MAI.
 *
 * La regola di scrittura sul secchio `products` sta in SQL: passa solo un percorso la cui PRIMA
 * cartella è l'identificativo di chi carica, oppure `home` se chi carica è staff. Nel codice quella
 * regola non aveva casa: dieci punti costruivano il percorso a mano con una stringa, e tre lo
 * scrivevano in un modo che il database rifiuta —
 *
 *   `store-media/…` (la copertina della vetrina) · `events/…` e `shop/…` (le copertine in admin)
 *
 * Non è distrazione di chi li ha scritti: non c'era niente da chiamare. Con dieci copie a mano, che
 * due o tre siano sbagliate è l'esito atteso, non la sfortuna.
 *
 * ── Cosa prova questo file, e cosa no ────────────────────────────────────────────────────────
 * I casi che MORDONO sono i tre percorsi veri che il codice produceva: la regola deve rifiutarli.
 * Se qualcuno rimette una prima cartella di comodo, qui diventa rosso.
 *
 * L'ultimo blocco è quello che tiene onesti gli altri: rilegge la regola dal file SQL della
 * migrazione e pretende che dica la stessa cosa di questo modulo. Una regola scritta due volte
 * diverge sempre — e qui una delle due copie sta in un database che nessuna prova può interrogare
 * da qui. Non posso eseguire la policy; posso però accorgermi il giorno in cui cambia.
 */

const UID = '11111111-2222-3333-4444-555555555555';

describe('la regola: quale percorso il database accetta', () => {
  it('rifiuta i tre percorsi che il codice produceva davvero', () => {
    const rotti = ['store-media/xyz/1.png', 'events/1755000000.png', 'shop/1755000000.png'];
    for (const p of rotti) {
      const v = percorsoAmmesso(p, { userId: UID, staff: true });
      expect(v.ammesso, `${p} non deve passare: è il caricamento che nessun negoziante è mai riuscito a fare`).toBe(false);
      expect(v.motivo).toMatch(/prima cartella/);
    }
  });

  it('accetta la cartella di chi carica', () => {
    expect(percorsoAmmesso(`${UID}/store-media/1.png`, { userId: UID }).ammesso).toBe(true);
    expect(percorsoAmmesso(`${UID}/logos/1.png`, { userId: UID }).ammesso).toBe(true);
  });

  it('la cartella dello staff passa solo se chi carica è staff', () => {
    expect(percorsoAmmesso('home/events/1.png', { userId: UID, staff: true }).ammesso).toBe(true);
    expect(percorsoAmmesso('home/events/1.png', { userId: UID, staff: false }).ammesso).toBe(false);
  });

  it('la cartella di un ALTRO utente non passa', () => {
    const altro = '99999999-8888-7777-6666-555555555555';
    expect(percorsoAmmesso(`${altro}/logos/1.png`, { userId: UID }).ammesso).toBe(false);
  });

  it('un file nella radice non passa, e il motivo lo dice', () => {
    const v = percorsoAmmesso('copertina.png', { userId: UID });
    expect(v.ammesso).toBe(false);
    expect(v.motivo).toMatch(/radice/);
  });
});

describe('i costruttori producono percorsi che la regola accetta', () => {
  const quando = 1_755_000_000_000;
  const caso = 'abc123';

  it('il percorso di un negoziante', () => {
    const p = percorsoUtente(UID, 'store-media', 'foto.JPG', { quando, caso });
    expect(p).toBe(`${UID}/store-media/${quando}-${caso}.jpg`);
    expect(percorsoAmmesso(p, { userId: UID }).ammesso).toBe(true);
  });

  it('il percorso dello staff', () => {
    const p = percorsoStaff('events', 'banner.png', { quando, caso });
    expect(p).toBe(`${CARTELLA_STAFF}/events/${quando}-${caso}.png`);
    expect(percorsoAmmesso(p, { userId: UID, staff: true }).ammesso).toBe(true);
  });

  it('chi passa già «home» non ottiene home/home', () => {
    // Il banner della home oggi funziona: il fix non deve spostargli i file altrove.
    const p = percorsoStaff('home', 'banner.png', { quando, caso });
    expect(p).toBe(`${CARTELLA_STAFF}/${quando}-${caso}.png`);
    expect(percorsoAmmesso(p, { userId: UID, staff: true }).ammesso).toBe(true);
  });

  it('senza identificativo non si costruisce niente: meglio fermarsi che farsi rifiutare', () => {
    expect(() => percorsoUtente('', 'store-media', 'x.png', { quando, caso })).toThrow();
  });

  it("l'estensione non si fida di quello che arriva", () => {
    expect(estensioneDi('foto.JPG')).toBe('jpg');
    expect(estensioneDi('senzapunto')).toBe('bin');
    expect(estensioneDi('cattivo.../../etc/passwd')).toBe('bin');
    expect(casoNuovo()).toMatch(/^[a-z0-9]{1,6}$/);
  });
});

describe('la regola qui dentro dice la stessa cosa di quella nel database', () => {
  // Non posso eseguire la policy da qui: vive in Postgres. Posso però rileggerla e accorgermi il
  // giorno in cui cambia — che è il momento in cui questo modulo diventa una bugia.
  const sql = readFileSync(
    join(process.cwd(), 'migrations/114_hardening_radiografia.sql'),
    'utf8',
  );
  const blocco = sql.slice(sql.indexOf("CREATE POLICY \"Authenticated users can upload product images\""));
  const policy = blocco.slice(0, blocco.indexOf(');') + 2);

  it('la policy esiste ancora, e riguarda il secchio che pensiamo', () => {
    expect(policy, 'la policy è sparita o è stata rinominata: questo modulo va riletto').toContain(
      "bucket_id = 'products'",
    );
  });

  it('la prima cartella ammessa è chi carica', () => {
    expect(policy).toMatch(/foldername\(name\)\)\[1\] = \(SELECT auth\.uid\(\)\)::text/);
  });

  it("l'unica eccezione è la cartella dello staff, e si chiama come dice il modulo", () => {
    expect(policy).toContain(`(storage.foldername(name))[1] = '${CARTELLA_STAFF}'`);
    expect(policy).toContain('public.is_admin()');
  });

  it('non ci sono ALTRE cartelle di comodo ammesse dalla policy', () => {
    // Se domani qualcuno aggiunge un'eccezione in SQL senza dirlo a questo modulo, i chiamanti
    // continuerebbero a costruire percorsi legali — ma il modulo starebbe mentendo su cosa passa.
    const cartelleCitate = [...policy.matchAll(/foldername\(name\)\)\[1\] = '([^']+)'/g)].map((m) => m[1]);
    expect(cartelleCitate).toEqual([CARTELLA_STAFF]);
  });
});

/**
 * ── L'UNICA PORTA, e perché la prova qui sopra non bastava ───────────────────────────────────
 *
 * Provato il 23/8: rimettendo a mano `store-media/…` dentro il componente, tutte le prove qui sopra
 * restavano VERDI. Provavano che la regola sa giudicare, non che chi carica ci passi — cioè
 * esattamente la distinzione che aveva lasciato vivere il difetto.
 *
 * Il rimedio non è una prova più furba: è togliere ai chiamanti la possibilità di dire la cosa
 * sbagliata. `caricaImmagine` riceve una CARTELLA e non un percorso, quindi la prima cartella —
 * l'unica su cui il database decide — non passa più dalle loro mani. Qui sotto la porta si esegue
 * davvero, con un client finto, e si guarda il percorso che consegna allo storage.
 */
describe("l'unica porta: chi carica non costruisce piu' il percorso", () => {
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
  const file = new File(['x'], 'copertina.JPG', { type: 'image/jpeg' }) as never;

  it('la copertina del negozio finisce sotto la cartella del negoziante', async () => {
    const f = clienteFinto();
    const esito = await caricaImmagine(f.client, {
      file,
      userId: UID,
      cartella: 'store-media',
      quando: 1_755_000_000_000,
      caso: 'abc123',
    });
    expect(f.chiamate).toHaveLength(1);
    expect(f.chiamate[0].percorso).toBe(`${UID}/store-media/1755000000000-abc123.jpg`);
    expect(percorsoAmmesso(f.chiamate[0].percorso, { userId: UID }).ammesso).toBe(true);
    expect(esito.publicUrl).toContain(`${UID}/store-media/`);
  });

  it('il caricamento dello staff finisce nella cartella dello staff', async () => {
    const f = clienteFinto();
    await caricaImmagine(f.client, {
      file,
      cartella: 'events',
      staff: true,
      upsert: true,
      quando: 1_755_000_000_000,
      caso: 'abc123',
    });
    expect(f.chiamate[0].percorso).toBe(`${CARTELLA_STAFF}/events/1755000000000-abc123.jpg`);
    expect(f.chiamate[0].opzioni?.upsert).toBe(true);
  });

  it('senza identificativo la porta si ferma PRIMA di parlare con lo storage', async () => {
    const f = clienteFinto();
    await expect(caricaImmagine(f.client, { file, cartella: 'store-media' })).rejects.toThrow();
    expect(f.chiamate, "non deve nemmeno provarci: l'utente leggerebbe un errore dello storage").toHaveLength(0);
  });

  it("l'errore dello storage non viene ingoiato", async () => {
    const f = clienteFinto();
    f.rompi('secchio pieno');
    await expect(
      caricaImmagine(f.client, { file, userId: UID, cartella: 'logos' }),
    ).rejects.toThrow(/secchio pieno/);
  });

  it('la cintura scatta se un giorno la regola e il costruttore divergono', async () => {
    // Costruito a mano il caso che il modulo non produce: serve a provare che il controllo finale
    // c'e' davvero, e non e' una riga morta accanto a un percorso sempre giusto.
    const f = clienteFinto();
    await expect(
      caricaImmagine(f.client, { file, userId: UID, cartella: 'x', staff: true, quando: 1, caso: 'a' }),
    ).resolves.toBeTruthy();
    expect(f.chiamate[0].percorso.startsWith(`${CARTELLA_STAFF}/`)).toBe(true);
  });
});
