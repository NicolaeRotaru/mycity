/**
 * 3/9/2026 — QUELLO CHE LA GENTE SCRIVE NELLA CASELLA DI RICERCA USCIVA IN
 * CHIARO DA DUE PORTE SU QUATTRO.
 *
 * Nella casella di ricerca la gente non scrive «pane». Scrive la propria email
 * per ritrovare un ordine, il numero di telefono, l'indirizzo di casa, il nome
 * di un'altra persona. Quel testo finisce nell'indirizzo della pagina —
 * `/search?q=…` — e l'indirizzo della pagina lo spediscono in giro TUTTE le
 * porte di misura del sito, non solo quella che era stata ripulita.
 *
 * A fine agosto ne erano state chiuse due: il beacon delle visite, che scrive
 * nella nostra tabella, e il registratore degli errori. Restavano aperte le due
 * che portano il dato FUORI dall'Europa: Google Analytics, che riceveva
 * `page_path` e `page_location` con dentro la ricerca, e PostHog, che si
 * compilava `$current_url` da solo leggendo l'indirizzo del browser.
 *
 * Una pulizia che copre metà della superficie non è una pulizia: è una cosa in
 * cui si crede. Questa prova non guarda una porta per volta — le mette in fila
 * e le prova TUTTE con gli stessi dati sporchi. Una porta nuova che dimentica la
 * regola si vede subito: o è nell'elenco e fallisce, o non è nell'elenco e la
 * fallisce l'ultima prova, che va a cercare nel codice chi spedisce indirizzi
 * senza passare dalla regola.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const scritte: Record<string, unknown>[] = [];

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({ getCurrentUser: async () => null }));
vi.mock('@/lib/activity', () => ({
  recordActivity: async (riga: Record<string, unknown>) => { scritte.push(riga); },
  accessoGiaRegistrato: async () => false,
}));

import { POST } from '@/app/api/track/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { CONSENT_COOKIE, CONSENT_VERSION } from '@/lib/consent';
import { chiaveDellaPaginaVista } from '@/lib/analytics/tracciamento';
import { eventoSenzaDatiPersonali } from '@/lib/analytics/posthog';
import { opzioniSentry } from '@/lib/analytics/sentry-config';

/** Il cookie di chi ha accettato tutto: senza, la pagina vista non passa nemmeno. */
const HO_ACCETTATO = `${CONSENT_COOKIE}=${CONSENT_VERSION}%3A111`;

/**
 * Le cose vere che la gente scrive nella casella di ricerca, e che nessuna porta
 * deve poter ripetere fuori.
 */
const SCRITTO_DA_UNA_PERSONA = [
  'ordine di mario.rossi@gmail.com',
  'consegna al 3331234567',
  'via Roma 14 Piacenza',
  'giulia bianchi',
];

/** I pezzi che non devono comparire in nessuna uscita, per nessuna porta. */
const PEZZI_DA_NON_TROVARE = [
  'mario.rossi@gmail.com',
  'mario.rossi',
  '3331234567',
  'via Roma 14',
  'giulia bianchi',
  'bianchi',
];

/** L'uscita come si legge davvero: `%40` torna chiocciola, `+` torna spazio. */
function leggibile(uscita: string): string {
  try {
    return decodeURIComponent(uscita.replace(/\+/g, ' '));
  } catch {
    return uscita;
  }
}

let contatore = 0;
async function laRigaScrittaDallaRotta(indirizzo: string): Promise<string> {
  contatore++;
  scritte.length = 0;
  await POST(new Request('https://mycity.test/api/track', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: HO_ACCETTATO,
      'x-forwarded-for': `93.40.20.${contatore % 250}`,
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    },
    body: JSON.stringify({ event_type: 'page_view', path: indirizzo, referrer: `https://mycity.test${indirizzo}` }),
  }));
  const riga = scritte[scritte.length - 1] ?? {};
  return JSON.stringify(riga);
}

/**
 * LE PORTE. Ognuna prende l'indirizzo della pagina dei risultati e torna tutto
 * quello che spedirebbe davvero. Aggiungerne una qui significa provarla su tutti
 * i casi sporchi, senza scrivere una riga di prova in più.
 */
const PORTE: Array<{ nome: string; dove: string; cosaEsce: (indirizzo: string) => Promise<string> | string }> = [
  {
    nome: 'il beacon delle visite (la nostra tabella)',
    dove: 'app/api/track/route.ts',
    cosaEsce: (indirizzo) => laRigaScrittaDallaRotta(indirizzo),
  },
  {
    nome: 'Google Analytics (page_path e page_location)',
    dove: 'components/GoogleAnalytics.tsx → lib/analytics/tracciamento.ts',
    cosaEsce: (indirizzo) => {
      const [percorso, coda] = indirizzo.split('?');
      // È esattamente quello che il componente passa a gtag.
      const paginaVista = chiaveDellaPaginaVista(percorso, new URLSearchParams(coda ?? ''));
      return JSON.stringify({
        page_path: paginaVista,
        page_location: `https://mycity.test${paginaVista}`,
      });
    },
  },
  {
    nome: 'PostHog ($current_url, $referrer, $pathname)',
    dove: 'lib/analytics/posthog.tsx (before_send)',
    cosaEsce: (indirizzo) =>
      // È l'evento intero, come PostHog lo consegna a `before_send` un attimo
      // prima di spedirlo: la libreria si compila `$current_url` da sola.
      JSON.stringify(
        eventoSenzaDatiPersonali({
          uuid: 'un-evento',
          event: '$pageview',
          properties: {
            $current_url: `https://mycity.test${indirizzo}`,
            $referrer: `https://www.google.com${indirizzo}`,
            $pathname: indirizzo,
          },
          $set_once: { $initial_current_url: `https://mycity.test${indirizzo}` },
        } as unknown as Parameters<typeof eventoSenzaDatiPersonali>[0]),
      ),
  },
  {
    nome: 'Sentry (indirizzo della pagina e briciole)',
    dove: 'lib/analytics/sentry-config.ts (beforeSend)',
    cosaEsce: (indirizzo) => {
      const beforeSend = (opzioniSentry() as { beforeSend: (e: unknown) => unknown }).beforeSend;
      return JSON.stringify(
        beforeSend({
          request: { url: `https://mycity.test${indirizzo}`, query_string: indirizzo.split('?')[1] ?? '' },
          breadcrumbs: [{ data: { from: '/', to: indirizzo } }],
        }),
      );
    },
  },
];

beforeEach(() => {
  scritte.length = 0;
  __resetRateLimitBuckets();
});

describe('la ricerca di una persona, su ogni porta di misura', () => {
  for (const porta of PORTE) {
    for (const cercato of SCRITTO_DA_UNA_PERSONA) {
      it(`${porta.nome}: «${cercato}» non esce`, async () => {
        const indirizzo = `/search?q=${encodeURIComponent(cercato)}`;
        const uscita = await porta.cosaEsce(indirizzo);
        // Un dato personale travestito è ancora un dato personale: `%40` è una
        // chiocciola e `+` è uno spazio. Si guarda anche l'uscita in chiaro.
        const inChiaro = leggibile(uscita);

        for (const pezzo of PEZZI_DA_NON_TROVARE) {
          if (!cercato.toLowerCase().includes(pezzo.toLowerCase())) continue;
          for (const forma of [uscita, inChiaro]) {
            expect(
              forma.toLowerCase(),
              `${porta.dove} spedisce fuori quello che la persona ha scritto nella ricerca`,
            ).not.toContain(pezzo.toLowerCase());
          }
        }
        expect(uscita).not.toContain(encodeURIComponent(cercato));
      });
    }
  }

  it('la strada resta, su tutte le porte: senza, non si sa più quali pagine si visitano', async () => {
    for (const porta of PORTE) {
      const uscita = await porta.cosaEsce('/store/12/panificio-garetti');
      expect(uscita, `${porta.dove} ha perso anche il percorso, non solo la ricerca`)
        .toContain('/store/12/panificio-garetti');
    }
  });

  it('due ricerche diverse restano due pagine diverse, senza dire cosa contengono', () => {
    const pane = chiaveDellaPaginaVista('/search', new URLSearchParams('q=pane'));
    const vino = chiaveDellaPaginaVista('/search', new URLSearchParams('q=vino'));
    expect(pane).not.toBe(vino);
    expect(pane).not.toContain('pane');
    expect(vino).not.toContain('vino');
  });
});

/**
 * LA PORTA NUMERO CINQUE, QUELLA CHE NESSUNO HA ANCORA SCRITTO.
 *
 * ⚠️ Controllo di struttura, dichiarato: i componenti React di questa repo non
 * si montano dentro una prova. Qui si guarda chi COSTRUISCE un indirizzo da
 * spedire — `window.location.href`, `location.search`, i parametri della pagina
 * messi in fila — e si pretende che quel file passi dalla regola comune. Chi
 * domani aggiunge una quinta porta di misura e si scrive l'indirizzo da solo
 * trova questa prova rossa.
 */
const REGOLA_COMUNE = /indirizzoSenzaDatiPersonali|chiaveDellaPaginaVista|proprietaSenzaDatiPersonali/;
const COSTRUISCE_UN_INDIRIZZO = [
  /window\.location\.href/,
  /location\.search/,
  /\$\{searchParams\}/,
  /searchParams(\?)?\.toString\(\)/,
];

function fileDaGuardare(): string[] {
  const elenco: string[] = ['components/ActivityTracker.tsx', 'components/GoogleAnalytics.tsx'];
  for (const nome of readdirSync('lib/analytics')) {
    if (nome.endsWith('.ts') || nome.endsWith('.tsx')) elenco.push(path.join('lib/analytics', nome));
  }
  return elenco;
}

describe('chi spedisce indirizzi passa dalla regola comune', () => {
  for (const file of fileDaGuardare()) {
    it(`${file} non si costruisce un indirizzo per conto suo`, () => {
      const sorgente = readFileSync(file, 'utf8');
      const seLoCostruisce = COSTRUISCE_UN_INDIRIZZO.some((r) => r.test(sorgente));
      if (!seLoCostruisce) return; // non spedisce indirizzi: niente da chiedergli
      expect(
        REGOLA_COMUNE.test(sorgente),
        `${file} costruisce un indirizzo da spedire senza passare dalla pulizia comune: ` +
          'la ricerca della persona esce da questa porta',
      ).toBe(true);
    });
  }
});
