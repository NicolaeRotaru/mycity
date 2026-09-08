/**
 * 8/9/2026 — LA QUINTA PORTA: IL FILMATO DELLO SCHERMO PORTAVA FUORI LA RICERCA
 * IN CHIARO, E IL CANCELLO CI PASSAVA SOPRA A VUOTO.
 *
 * Le altre quattro porte erano state chiuse il 3/9
 * (`quello-che-si-cerca-non-esce-da-nessuna-porta.test.ts`). Il cancello di
 * PostHog — `before_send` — riscriveva pero' un elenco chiuso di nove nomi di
 * proprieta' (`$current_url`, `$referrer`, `$pathname`, `$initial_*`,
 * `$session_entry_*`). Sul filmato quei nove nomi non esistono:
 *
 * ① la libreria, in `calculateEventProperties`, esce SUBITO per l'evento
 *    `$snapshot` («"$snapshot"===e … return h»): a quell'evento le proprieta'
 *    d'indirizzo non gliele attacca nemmeno. Il sanificatore girava a vuoto.
 * ② l'indirizzo vero sta altrove, dentro `$snapshot_data`: il registratore
 *    dello schermo apre ogni filmato con la sua targa —
 *    `{type: 4, data:{href: window.location.href, width, height}}` — e quello e'
 *    l'indirizzo INTERO, letto dal browser, mai passato dalla regola comune.
 *
 * La pagina dei risultati si puo' filmare (non e' fra le pagine con dati di
 * terzi), ed e' giusto cosi': e' la pagina a piu' alta intenzione d'acquisto e
 * il filmato li' serve. Solo che nella casella la gente non scrive «pane»:
 * scrive la propria email per ritrovare un ordine, il telefono, l'indirizzo di
 * casa, il nome di un'altra persona. Il testo scritto nella casella e' gia'
 * mascherato nel DOM (`maskAllInputs`, `maskTextSelector:'*'`); nell'indirizzo
 * no. Quindi `https://.../search?q=mario.rossi@gmail.com` partiva leggibile
 * verso un servizio negli Stati Uniti — ed e' l'unico dei cinque canali dove il
 * dato esce in chiaro e non come impronta.
 *
 * QUESTA PROVA NON GUARDA UN NOME DI PROPRIETA'. Mette in fila i canali del
 * filmato che possono portare un indirizzo — la targa, la pagina dichiarata, le
 * chiamate di rete, la console — e li prova tutti con gli stessi dati sporchi.
 * L'ultima prova e' quella che difende la cura dalla ricaduta: un canale che
 * nessuno ha ancora scritto, con un nome di proprieta' mai visto, dev'essere
 * pulito lo stesso. Se domani qualcuno chiude «un nome in piu'» invece del
 * contenuto, quella prova diventa rossa.
 */
import { describe, it, expect } from 'vitest';
import { eventoSenzaDatiPersonali } from '@/lib/analytics/posthog';

/** Le cose vere che la gente scrive nella casella di ricerca. */
const SCRITTO_DA_UNA_PERSONA = [
  'ordine di mario.rossi@gmail.com',
  'consegna al 3331234567',
  'via Roma 14 Piacenza',
  'giulia bianchi',
];

/** I pezzi che non devono comparire in nessuna uscita, per nessun canale. */
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

/** L'evento del filmato come PostHog lo consegna a `before_send`. */
function cosaEsceDalFilmato(datiDelFilmato: unknown): string {
  const uscita = eventoSenzaDatiPersonali({
    uuid: 'un-pezzo-di-filmato',
    event: '$snapshot',
    properties: {
      $snapshot_bytes: 512,
      $snapshot_data: datiDelFilmato,
      $session_id: 'una-sessione',
      $window_id: 'una-finestra',
    },
  } as unknown as Parameters<typeof eventoSenzaDatiPersonali>[0]);
  return JSON.stringify(uscita);
}

/**
 * I CANALI DEL FILMATO. Ognuno costruisce il `$snapshot_data` come lo costruisce
 * davvero `posthog-js` (verificato in `node_modules/posthog-js/dist/`).
 */
const CANALI_DEL_FILMATO: Array<{ nome: string; dove: string; dati: (indirizzo: string) => unknown }> = [
  {
    nome: 'la targa del filmato (rrweb Meta, tipo 4)',
    dove: 'posthog-js/dist/recorder.js → {type:Meta, data:{href: window.location.href}}',
    dati: (indirizzo) => [{ type: 4, data: { href: `https://mycity.test${indirizzo}`, width: 390, height: 844 } }],
  },
  {
    nome: 'la pagina dichiarata dentro il filmato (rrweb Custom, tipo 5)',
    dove: 'posthog-js/dist/lazy-recorder.js → aggiunge $pageview al filmato',
    dati: (indirizzo) => [{ type: 5, data: { tag: '$pageview', payload: { href: `https://mycity.test${indirizzo}` } } }],
  },
  {
    nome: 'le chiamate di rete dentro il filmato (rrweb Plugin, tipo 6)',
    dove: 'plugin rrweb/network@1',
    dati: (indirizzo) => [
      {
        type: 6,
        data: {
          plugin: 'rrweb/network@1',
          payload: { requests: [{ name: `https://mycity.test/api${indirizzo}`, entryType: 'resource', method: 'GET' }] },
        },
      },
    ],
  },
  {
    nome: 'la console dentro il filmato (rrweb Plugin, tipo 6)',
    dove: 'plugin rrweb/console@1',
    dati: (indirizzo) => [
      {
        type: 6,
        data: {
          plugin: 'rrweb/console@1',
          payload: { level: 'log', payload: [`navigato su https://mycity.test${indirizzo}`], trace: [] },
        },
      },
    ],
  },
  {
    nome: 'un filmato spedito a pacchetti (piu\' pezzi in un colpo solo)',
    dove: 'il buffer del registratore accumula e spedisce in blocco',
    dati: (indirizzo) => [
      { type: 4, data: { href: `https://mycity.test${indirizzo}`, width: 390, height: 844 } },
      { type: 3, data: { source: 0, texts: [], attributes: [], removes: [], adds: [] } },
      { type: 5, data: { tag: '$pageview', payload: { href: `https://mycity.test${indirizzo}` } } },
    ],
  },
];

describe('la ricerca di una persona non esce dal filmato dello schermo', () => {
  for (const canale of CANALI_DEL_FILMATO) {
    for (const cercato of SCRITTO_DA_UNA_PERSONA) {
      it(`${canale.nome}: «${cercato}» non esce`, () => {
        const indirizzo = `/search?q=${encodeURIComponent(cercato)}`;
        const uscita = cosaEsceDalFilmato(canale.dati(indirizzo));
        const inChiaro = leggibile(uscita);

        for (const pezzo of PEZZI_DA_NON_TROVARE) {
          if (!cercato.toLowerCase().includes(pezzo.toLowerCase())) continue;
          for (const forma of [uscita, inChiaro]) {
            expect(
              forma.toLowerCase(),
              `${canale.dove} porta fuori nel filmato quello che la persona ha scritto nella ricerca`,
            ).not.toContain(pezzo.toLowerCase());
          }
        }
        expect(uscita).not.toContain(encodeURIComponent(cercato));
      });
    }
  }

  it('il gettone di accesso dopo il cancelletto sparisce dalla targa del filmato', () => {
    const uscita = cosaEsceDalFilmato([
      { type: 4, data: { href: 'https://mycity.test/auth/callback#access_token=eyJhbGciOi.SEGRETO.xyz&type=recovery', width: 390, height: 844 } },
    ]);
    expect(uscita).not.toContain('SEGRETO');
    expect(uscita).not.toContain('access_token');
  });
});

describe('il filmato resta un filmato: la cura non lo rompe', () => {
  it('la strada resta: senza, non si sa piu\' quale pagina e\' stata filmata', () => {
    const uscita = cosaEsceDalFilmato([
      { type: 4, data: { href: 'https://mycity.test/store/12/panificio-garetti', width: 390, height: 844 } },
    ]);
    expect(uscita, 'il filmato ha perso anche la pagina, non solo la ricerca').toContain('/store/12/panificio-garetti');
  });

  it('la misura dello schermo resta: senza, il filmato si riproduce della grandezza sbagliata', () => {
    const uscita = cosaEsceDalFilmato([
      { type: 4, data: { href: 'https://mycity.test/search?q=pane', width: 390, height: 844 } },
    ]);
    expect(uscita).toContain('390');
    expect(uscita).toContain('844');
  });

  it('il DOM del filmato non si tocca: e\' gia\' mascherato, e riscriverlo romperebbe la riproduzione', () => {
    // Il pezzo pesante del filmato (foto della pagina e sue modifiche). Qui dentro
    // ci sono gli indirizzi dei fogli di stile e delle immagini: se li si riscrive,
    // il filmato si riproduce senza grafica.
    const domDelFilmato = [
      {
        type: 2,
        data: {
          node: {
            type: 2,
            tagName: 'link',
            attributes: { rel: 'stylesheet', href: 'https://mycity.test/_next/static/css/app.css?v=8f3a1c' },
          },
        },
      },
      {
        type: 3,
        data: {
          source: 0,
          attributes: [{ id: 12, attributes: { src: 'https://mycity.test/_next/image?url=%2Ffoto.jpg&w=640' } }],
        },
      },
    ];
    const prima = JSON.stringify(domDelFilmato);
    const uscita = cosaEsceDalFilmato(domDelFilmato);
    expect(uscita, 'il DOM del filmato e\' stato riscritto: la riproduzione perde grafica e immagini').toContain(prima);
  });

  it('un filmato storto non fa cadere la pagina', () => {
    for (const storto of [null, undefined, 'non-un-elenco', 42, [{}], [{ type: 4 }], [{ type: 4, data: null }]]) {
      expect(() => cosaEsceDalFilmato(storto)).not.toThrow();
    }
  });
});

/**
 * LA RICADUTA: IL CANCELLO DEVE LAVORARE SUL CONTENUTO, NON SU UN ELENCO DI NOMI.
 *
 * Il difetto non era «manca `href` nell'elenco»: era che l'elenco esiste. Qui si
 * usa un tipo di evento che oggi non esiste e un nome di proprieta' che nessuno
 * ha mai scritto. Se il cancello continua a pulire per nome, questa prova e'
 * rossa — ed e' l'unica cosa che impedisce alla malattia di tornare.
 */
describe('un canale che nessuno ha ancora scritto e\' pulito lo stesso', () => {
  it('tipo rrweb sconosciuto, nome di proprieta\' mai visto: la ricerca non esce', () => {
    const uscita = cosaEsceDalFilmato([
      { type: 99, data: { qualcosaDiNuovo: { indirizzoDellaPagina: 'https://mycity.test/search?q=mario.rossi%40gmail.com' } } },
    ]);
    expect(leggibile(uscita).toLowerCase()).not.toContain('mario.rossi');
  });

  it('il salvacondotto del DOM vale solo dentro il filmato, non su una proprieta\' qualunque', () => {
    // Il DOM del filmato passa intero: e' l'unica eccezione, ed e' motivata.
    // Una proprieta' normale che per caso ha la stessa forma (`{type: 2, …}`)
    // non deve poter ereditare quel salvacondotto: la ricerca uscirebbe di li'.
    const uscita = JSON.stringify(
      eventoSenzaDatiPersonali({
        uuid: 'un-clic',
        event: 'home_cta_clicked',
        properties: {
          cta_id: 'cerca',
          // Preso al volo dai clic: PostHog ci mette l'indirizzo del link.
          $elements: [{ tag_name: 'a', attr__href: '/search?q=mario.rossi%40gmail.com' }],
          $elements_chain: 'a:attr__href="/search?q=mario.rossi%40gmail.com"nth-child="1"',
          // La forma di un fotogramma del filmato, ma non e' il filmato.
          travestito: { type: 2, data: { href: 'https://mycity.test/search?q=giulia+bianchi' } },
        },
      } as unknown as Parameters<typeof eventoSenzaDatiPersonali>[0]),
    );
    const inChiaro = leggibile(uscita).toLowerCase();
    expect(inChiaro).not.toContain('mario.rossi');
    expect(inChiaro).not.toContain('giulia bianchi');
    expect(uscita, 'il clic ha perso anche la pagina, non solo la ricerca').toContain('/search');
  });

  it('un indirizzo annidato in fondo a un canale nuovo non scappa', () => {
    const uscita = cosaEsceDalFilmato([
      { type: 5, data: { tag: 'qualcosa', payload: { dentro: { ancoraDentro: [{ dove: '/search?q=giulia+bianchi' }] } } } },
    ]);
    expect(leggibile(uscita).toLowerCase()).not.toContain('giulia bianchi');
  });
});
