import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/**
 * 6/9/2026 — TRE COSE CHE IL SERVICE WORKER SBAGLIAVA.
 *
 * Il service worker è il pezzo di MyCity che gira dentro il telefono, anche
 * quando il sito non è aperto: decide cosa mostrare quando la rete manca e
 * disegna le notifiche. Sbagliava in tre punti.
 *
 * ① Senza rete, se il sistema aveva svuotato la memoria del sito, il ripiego
 *    `caches.match('/offline.html')` restituiva `undefined`. Passare `undefined`
 *    a `respondWith` solleva un errore, e il browser mostrava la sua schermata
 *    bianca: sembrava che il sito fosse morto, non che mancasse la linea. iOS
 *    cancella da solo le cache dei siti dopo 7 giorni senza aperture.
 * ② Ogni foto già vista veniva riscaricata a ogni apertura di pagina, e la
 *    cache teneva 60 immagini mentre una pagina di ricerca ne mostra 96: si
 *    riempiva e si svuotava dentro la stessa schermata.
 * ③ Le notifiche chiedevano un'icona SVG, che Chrome su Android non disegna:
 *    al posto del marchio compariva l'icona generica del browser.
 *
 * ── Cosa prova, davvero ────────────────────────────────────────────────────
 * Non cerca parole nel file. Carica il vero `public/sw.js` in un contesto
 * isolato, gli dà una rete finta e una cache finta, e poi ESEGUE i suoi
 * gestori: chiede una pagina con la linea staccata, chiede due volte la stessa
 * foto, fa arrivare una notifica. Guarda cosa esce.
 *
 * ⚪ Quello che da qui NON ho potuto verificare: come Chrome su Android disegna
 * davvero l'icona della notifica, e se iOS svuota la cache come descritto.
 * Servono un telefono vero e sette giorni.
 */

const SORGENTE = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

type Opzioni = {
  /** La copia di /offline.html è ancora nella memoria del telefono? */
  offlineInCache?: boolean;
  /** La rete risponde, o siamo in ascensore? */
  reteViva?: boolean;
};

function avviaServiceWorker({ offlineInCache = true, reteViva = true }: Opzioni = {}) {
  const ascoltatori: Record<string, (e: unknown) => void> = {};
  const magazzino = new Map<string, Map<string, Response>>();
  const chiamateDiRete: string[] = [];
  let notifica: { titolo: string; opzioni: Record<string, unknown> } | null = null;

  const chiave = (req: { url?: string } | string) => (typeof req === 'string' ? req : String(req.url));

  const apri = async (nome: string) => {
    if (!magazzino.has(nome)) magazzino.set(nome, new Map());
    const m = magazzino.get(nome)!;
    return {
      match: async (req: never) => m.get(chiave(req)),
      put: async (req: never, res: Response) => void m.set(chiave(req), res),
      keys: async () => [...m.keys()],
      delete: async (req: never) => m.delete(chiave(req)),
    };
  };

  const caches = {
    open: apri,
    keys: async () => [...magazzino.keys()],
    delete: async (nome: string) => magazzino.delete(nome),
    // Come nel browser: cerca in tutte le cache del sito.
    match: async (req: never) => {
      for (const m of magazzino.values()) {
        const trovata = m.get(chiave(req));
        if (trovata) return trovata;
      }
      return undefined;
    },
  };

  if (offlineInCache) {
    magazzino.set('mycity-static-v2', new Map([
      ['/offline.html', new Response('<h1>Sei offline</h1><p>copia salvata sul telefono</p>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })],
    ]));
  }

  const contesto: Record<string, unknown> = {
    caches,
    Response,
    Headers,
    URL,
    console,
    fetch: async (req: { url: string }) => {
      chiamateDiRete.push(chiave(req));
      if (!reteViva) throw new TypeError('Failed to fetch');
      // Nessuna intestazione `date`: su una foto che arriva da un altro dominio
      // il browser non la lascia leggere comunque. Se il service worker si
      // appoggiasse a quella, la freschezza non funzionerebbe mai davvero.
      return new Response('roba dalla rete', { status: 200 });
    },
    self: {
      location: { origin: 'https://mycity.it' },
      addEventListener: (tipo: string, fn: (e: unknown) => void) => void (ascoltatori[tipo] = fn),
      skipWaiting: () => {},
      clients: { claim: () => {}, matchAll: async () => [], openWindow: async () => {} },
      registration: {
        showNotification: (titolo: string, opzioni: Record<string, unknown>) => {
          notifica = { titolo, opzioni };
          return Promise.resolve();
        },
      },
    },
  };
  vm.createContext(contesto);
  vm.runInContext(SORGENTE, contesto);

  const rispostaA = async (request: Record<string, unknown>) => {
    let promessa: unknown;
    ascoltatori.fetch?.({ request, respondWith: (p: unknown) => void (promessa = p) });
    return (await promessa) as Response | undefined;
  };

  return {
    /** Chiede una pagina, come quando si apre MyCity dalla schermata Home. */
    apriPagina: (url: string) => rispostaA({ method: 'GET', mode: 'navigate', url }),
    /** Chiede una foto di prodotto dallo storage. */
    chiediFoto: (url: string) => rispostaA({ method: 'GET', mode: 'no-cors', url }),
    /** Fa arrivare una notifica push. */
    arrivaNotifica: (payload: Record<string, unknown>) => {
      ascoltatori.push?.({
        data: { json: () => payload, text: () => '' },
        waitUntil: () => {},
      });
      return notifica;
    },
    chiamateDiRete,
    magazzino,
    contesto,
  };
}

const FOTO = (n: number) =>
  `https://abcdefgh.supabase.co/storage/v1/object/public/prodotti/foto-${n}.jpg?v=1`;

describe('① senza rete, la pagina «Sei offline» arriva sempre', () => {
  it('anche se il telefono ha svuotato la memoria del sito', async () => {
    const sw = avviaServiceWorker({ reteViva: false, offlineInCache: false });
    const res = await sw.apriPagina('https://mycity.it/negozi');

    // Se qui esce `undefined`, nel browser vero `respondWith` solleva un
    // TypeError e al posto del sito compare la schermata d'errore.
    expect(res, 'il service worker non ha risposto niente: respondWith(undefined) lancia').toBeInstanceOf(Response);
    const testo = await res!.text();
    expect(testo, 'la risposta di scorta non dice all\'utente che manca la linea').toContain('Sei offline');
    expect(testo.toLowerCase()).toContain('riprova');
  });

  it('e se la copia c\'è ancora, è quella che si vede (il banco di prova è sano)', async () => {
    const sw = avviaServiceWorker({ reteViva: false, offlineInCache: true });
    const res = await sw.apriPagina('https://mycity.it/negozi');
    expect(await res!.text()).toContain('copia salvata sul telefono');
  });

  it('con la rete viva la pagina arriva dalla rete, non dal ripiego', async () => {
    const sw = avviaServiceWorker({ reteViva: true });
    const res = await sw.apriPagina('https://mycity.it/negozi');
    expect(await res!.text()).toBe('roba dalla rete');
  });
});

describe('② le foto già viste non si riscaricano a ogni apertura', () => {
  it('la seconda volta la foto recente arriva dalla cache, senza toccare la rete', async () => {
    const sw = avviaServiceWorker();
    await sw.chiediFoto(FOTO(1));
    await new Promise((r) => setTimeout(r, 10)); // la cache si scrive in sottofondo
    expect(sw.chiamateDiRete.length, 'la prima volta la foto si scarica').toBe(1);

    await sw.chiediFoto(FOTO(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(
      sw.chiamateDiRete.length,
      'la foto è già sul telefono e recente: non c\'era niente da riscaricare',
    ).toBe(1);
  });

  it('una copia senza marca temporale (salvata dalla versione vecchia) si ricontrolla', async () => {
    const sw = avviaServiceWorker();
    sw.magazzino.set('mycity-images-v2', new Map([[FOTO(3), new Response('copia anonima')]]));
    await sw.chiediFoto(FOTO(3));
    await new Promise((r) => setTimeout(r, 10));
    expect(sw.chiamateDiRete, 'senza sapere quanto e\' vecchia, va ricontrollata').toContain(FOTO(3));
  });

  it('una foto vecchia si ricontrolla comunque', async () => {
    const sw = avviaServiceWorker();
    const treGiorniFa = String(Date.now() - 3 * 24 * 60 * 60 * 1000);
    sw.magazzino.set('mycity-images-v2', new Map([
      [FOTO(2), new Response('foto vecchia', { headers: { 'x-mycity-salvata': treGiorniFa } })],
    ]));

    await sw.chiediFoto(FOTO(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(sw.chiamateDiRete, 'una copia di tre giorni fa va ricontrollata').toContain(FOTO(2));
  });

  it('la cache tiene una pagina di ricerca intera (96 prodotti), non 60', async () => {
    const sw = avviaServiceWorker();
    for (let i = 0; i < 96; i++) await sw.chiediFoto(FOTO(i));
    await new Promise((r) => setTimeout(r, 50));

    const quante = sw.magazzino.get('mycity-images-v2')?.size ?? 0;
    expect(
      quante,
      `dopo una pagina di ricerca da 96 foto ne restano ${quante}: la cache si svuota da sola`,
    ).toBeGreaterThanOrEqual(96);
  });
});

describe('③ la notifica mostra il marchio, non l\'icona del browser', () => {
  it('chiede un PNG: Chrome su Android non disegna gli SVG nelle notifiche', () => {
    const sw = avviaServiceWorker();
    const n = sw.arrivaNotifica({ title: 'Il tuo ordine è pronto', body: 'Passa a ritirarlo' });

    expect(n, 'la notifica non è stata mostrata').not.toBeNull();
    expect(String(n!.opzioni.icon), 'icona della notifica').toMatch(/\.png$/);
    expect(String(n!.opzioni.badge), 'sagoma nella barra di stato').toMatch(/\.png$/);
  });

  it('il file dell\'icona esiste davvero e il service worker lo tiene già pronto', () => {
    const sw = avviaServiceWorker();
    const n = sw.arrivaNotifica({ title: 'MyCity' })!;
    const percorso = String(n.opzioni.icon);

    expect(
      existsSync(join(process.cwd(), 'public', percorso)),
      `la notifica punta a ${percorso}, che in public/ non c'è`,
    ).toBe(true);
    expect(
      SORGENTE.includes(`'${percorso}',`),
      `${percorso} non è fra i file precaricati: con la rete ballerina la notifica resta senza marchio`,
    ).toBe(true);
  });
});
