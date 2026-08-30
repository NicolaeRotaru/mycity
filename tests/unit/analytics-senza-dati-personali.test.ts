import { describe, it, expect, vi } from 'vitest';
import { messaggioSenzaDatiPersonali } from '@/lib/analytics/events';
import { indirizzoSenzaDatiPersonali } from '@/lib/analytics/indirizzo-senza-dati-personali';
import { opzioniSentry } from '@/lib/analytics/sentry-config';

/**
 * `friendlyError()` mandava a PostHog il messaggio grezzo del database.
 *
 * Un errore di chiave duplicata di Postgres suona così: «duplicate key value
 * violates unique constraint "profiles_email_key" Key (email)=(mario@rossi.it)
 * already exists». Dentro c'è l'indirizzo di una persona, e finiva in un
 * sistema di analisi che di norma sta negli Stati Uniti e non è dichiarato per
 * contenere dati personali.
 *
 * Ogni prova qui sotto diventa rossa se si torna a passare il messaggio intero.
 */

describe('il messaggio che esce verso PostHog', () => {
  it("non porta l'email di nessuno", () => {
    const grezzo = 'duplicate key value violates unique constraint "profiles_email_key" Key (email)=(mario@rossi.it) already exists';
    const pulito = messaggioSenzaDatiPersonali(grezzo);
    expect(pulito).not.toContain('mario@rossi.it');
    expect(pulito).not.toContain('@');
  });

  it('non porta il contenuto della chiave in conflitto', () => {
    const pulito = messaggioSenzaDatiPersonali('Key (phone)=(+39 333 1234567) already exists');
    expect(pulito).not.toContain('333');
    expect(pulito).toContain('Key (…)=(…)');
  });

  it('non porta identificativi lunghi né numeri di telefono', () => {
    const pulito = messaggioSenzaDatiPersonali('order 8f14e45f-ceea-467a-9575-4a1b2c3d4e5f fallito per 3331234567');
    expect(pulito).toContain('<id>');
    expect(pulito).not.toContain('3331234567');
  });

  it('resta corto: è un raggruppamento, non un dump', () => {
    const lungo = 'errore '.repeat(50);
    expect(messaggioSenzaDatiPersonali(lungo).length).toBeLessThanOrEqual(40);
  });

  it('un messaggio senza dati personali passa leggibile', () => {
    expect(messaggioSenzaDatiPersonali('permission denied for table orders')).toBe('permission denied for table orders');
  });

  it('regge un messaggio vuoto', () => {
    expect(messaggioSenzaDatiPersonali('')).toBe('');
  });
});

/**
 * 22/8/2026 — QUELLO CHE LE PERSONE SCRIVONO NELLA RICERCA PARTIVA COSI'
 * COM'E'.
 *
 * Nella casella di ricerca la gente non scrive solo «pane». Scrive il proprio
 * indirizzo email, il numero d'ordine, il telefono. Quel testo andava dritto
 * nel sistema di analisi, che sta negli Stati Uniti e non è dichiarato per
 * contenere dati personali.
 *
 * La pulizia esisteva già in quel file, scritta per gli errori. Alla ricerca
 * non era mai stata applicata. Queste prove diventano rosse se ci si torna.
 */
describe('quello che si scrive nella ricerca', () => {
  it("non porta l'email di chi cerca", async () => {
    const inviati: Array<{ nome: string; props: Record<string, unknown> }> = [];
    vi.doMock('@/lib/analytics/posthog', () => ({
      track: (nome: string, props: Record<string, unknown>) => inviati.push({ nome, props }),
    }));
    vi.resetModules();
    const { trackSearchPerformed } = await import('@/lib/analytics/events');

    trackSearchPerformed('ordine di mario.rossi@gmail.com', 3);

    const evento = inviati.find((e) => e.nome === 'search_performed');
    expect(evento, "l'evento di ricerca non è partito").toBeTruthy();
    expect(String(evento?.props.query)).not.toContain('mario.rossi@gmail.com');
    expect(String(evento?.props.query)).not.toContain('@');
    // Il numero di risultati è la parte utile: quella deve arrivare intera.
    expect(evento?.props.result_count).toBe(3);
    vi.doUnmock('@/lib/analytics/posthog');
    vi.resetModules();
  });

  it('una ricerca normale arriva leggibile', async () => {
    const inviati: Array<{ nome: string; props: Record<string, unknown> }> = [];
    vi.doMock('@/lib/analytics/posthog', () => ({
      track: (nome: string, props: Record<string, unknown>) => inviati.push({ nome, props }),
    }));
    vi.resetModules();
    const { trackSearchPerformed } = await import('@/lib/analytics/events');

    trackSearchPerformed('pane di segale', 12);

    expect(inviati.find((e) => e.nome === 'search_performed')?.props.query).toBe('pane di segale');
    vi.doUnmock('@/lib/analytics/posthog');
    vi.resetModules();
  });
});

/**
 * 27/8/2026 (R161) — LA RICERCA VENIVA RIPULITA SU UNA PORTA SOLA, E USCIVA IN
 * CHIARO DALLE ALTRE TRE.
 *
 * `trackSearchPerformed` mascherava il testo cercato. Ma la ricerca finisce
 * anche nell'indirizzo della pagina — `/search?q=…` — e da lì usciva grezza da
 * ogni porta che manda in giro l'indirizzo: la pagina vista, il beacon delle
 * visite che la scrive nella nostra tabella, il registratore degli errori che
 * allega l'indirizzo della pagina dove è scoppiato il guasto.
 *
 * Nella casella di ricerca la gente scrive la propria email, il numero
 * d'ordine, il telefono. La riparazione del 22/8 copriva un quarto della
 * superficie, e la prova qui sotto faceva credere che le coprisse tutte.
 *
 * Regola nuova, una sola per tutti: del percorso si tiene la strada, dei
 * parametri si tiene il nome, e il valore si nasconde — tranne le etichette di
 * campagna, che dicono da dove arriva la gente e non da chi.
 */
describe("l'indirizzo prima di uscire di casa", () => {
  it("IL CASO CHE ROMPEVA — quello che una persona ha cercato non esce insieme al percorso", () => {
    const pulito = indirizzoSenzaDatiPersonali('/search?q=ordine%20di%20mario.rossi%40gmail.com');
    expect(pulito, "l'email scritta nella casella di ricerca esce con l'indirizzo della pagina").not.toContain('@');
    expect(pulito).not.toContain('mario.rossi');
    // La strada resta: serve per sapere quante volte si cerca, e non dice di chi.
    expect(pulito).toBe('/search?q=***');
  });

  it('il nome del parametro resta, così si sa ancora che è una ricerca', () => {
    expect(indirizzoSenzaDatiPersonali('/search?q=pane')).toBe('/search?q=***');
  });

  it("le etichette di campagna passano intere: dicono da dove arriva la gente, non chi è", () => {
    expect(indirizzoSenzaDatiPersonali('/?utm_source=facebook&utm_campaign=natale&q=segreto'))
      .toBe('/?utm_source=facebook&utm_campaign=natale&q=***');
  });

  it("il pezzo dopo il cancelletto sparisce: è dove Supabase mette i gettoni di accesso", () => {
    const pulito = indirizzoSenzaDatiPersonali('/auth/callback#access_token=eyJhbGciOi&type=recovery');
    expect(pulito, 'un gettone di accesso finisce nei sistemi di analisi').not.toContain('access_token');
    expect(pulito).toBe('/auth/callback');
  });

  it("di un indirizzo esterno resta il sito da cui si arriva, non quello che ci si era scritto", () => {
    const pulito = indirizzoSenzaDatiPersonali('https://www.google.com/search?q=mario+rossi+piacenza');
    expect(pulito).toBe('https://www.google.com/search?q=***');
  });

  it('un percorso senza domande passa uguale', () => {
    expect(indirizzoSenzaDatiPersonali('/store/12/panificio-garetti')).toBe('/store/12/panificio-garetti');
  });

  it('quello che non è un indirizzo non diventa una riga finta', () => {
    expect(indirizzoSenzaDatiPersonali(undefined)).toBeNull();
    expect(indirizzoSenzaDatiPersonali('')).toBeNull();
    expect(indirizzoSenzaDatiPersonali(42)).toBeNull();
    expect(indirizzoSenzaDatiPersonali('javascript:alert(1)')).toBeNull();
  });

  it('non cresce oltre il campo che lo deve contenere', () => {
    const lunghissimo = '/x'.repeat(1000);
    expect(indirizzoSenzaDatiPersonali(lunghissimo)!.length).toBeLessThanOrEqual(500);
  });
});

/**
 * 27/8/2026 (R161) — LA QUARTA PORTA: IL REGISTRATORE DEGLI ERRORI.
 *
 * Prima di uscire, ogni errore passava da una pulizia che cancellava cookie,
 * intestazioni e corpo della richiesta — ma non l'indirizzo della pagina. E
 * l'errore che si vuole di più è proprio quello che scoppia mentre qualcuno
 * cerca: l'indirizzo di quella pagina è `/search?q=…`, cioè quello che la
 * persona aveva appena scritto, allegato all'errore e mandato fuori.
 *
 * Le briciole di navigazione hanno lo stesso problema: raccontano da quale
 * pagina a quale pagina si è passati, e sono indirizzi anche loro.
 */
describe("l'errore che esce verso il registratore", () => {
  const errore = (dentro: Record<string, unknown>) =>
    (opzioniSentry().beforeSend as (e: unknown) => Record<string, unknown>)(dentro) ?? {};

  it("IL CASO CHE ROMPEVA — l'indirizzo della pagina non porta la ricerca di chi era lì", () => {
    const uscito = errore({
      request: { url: 'https://mycity.it/search?q=mario.rossi@gmail.com', query_string: 'q=mario.rossi@gmail.com' },
    });
    const richiesta = uscito.request as Record<string, unknown>;
    expect(String(richiesta.url), "l'email di chi cercava esce allegata all'errore").not.toContain('@');
    expect(richiesta.url).toBe('https://mycity.it/search?q=***');
    expect(richiesta.query_string, 'la ricerca esce lo stesso dal campo accanto').toBeUndefined();
  });

  it('le briciole di navigazione non portano indirizzi in chiaro', () => {
    const uscito = errore({
      breadcrumbs: [
        { category: 'navigation', data: { from: '/search?q=via+roma+12', to: '/product/7?token=abc123' } },
        { category: 'fetch', data: { url: 'https://mycity.it/api/search?q=telefono+333' } },
      ],
    });
    const briciole = uscito.breadcrumbs as Array<{ data: Record<string, unknown> }>;
    expect(briciole[0].data.from).toBe('/search?q=***');
    expect(briciole[0].data.to).toBe('/product/7?token=***');
    expect(String(briciole[1].data.url), 'quello che si cercava esce dalla briciola della chiamata').not.toContain('333');
  });

  it("quello che la pulizia già faceva continua a farlo", () => {
    const uscito = errore({
      request: { url: 'https://mycity.it/', cookies: { sb: 'x' }, headers: { authorization: 'Bearer x' }, data: { password: 'x' } },
      user: { id: 'u1', email: 'mario@rossi.it', ip_address: '1.2.3.4', username: 'mario' },
    });
    const richiesta = uscito.request as Record<string, unknown>;
    expect(richiesta.cookies).toBeUndefined();
    expect(richiesta.headers).toBeUndefined();
    expect(richiesta.data).toBeUndefined();
    const persona = uscito.user as Record<string, unknown>;
    expect(persona.email).toBeUndefined();
    expect(persona.ip_address).toBeUndefined();
    expect(persona.username).toBeUndefined();
    expect(persona.id, "l'id serve per correlare e resta").toBe('u1');
  });

  it('un errore senza richiesta non fa cadere la pulizia', () => {
    expect(() => errore({ message: 'boom' })).not.toThrow();
  });
});
