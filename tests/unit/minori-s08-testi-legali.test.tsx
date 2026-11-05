/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * S08 (5/11/2026) — Termini, Privacy, Cookie e domande frequenti: le pagine
 * vere si montano e si confrontano con quello che il codice fa.
 */

const RADICE = path.resolve(__dirname, '../..');
const leggi = (f: string) => readFileSync(path.join(RADICE, f), 'utf8');

async function pagina(file: string) {
  const mod = await monta(file);
  const s = accendi(mod.default, {});
  return { s, testo: testoVisibile(s.radice), html: s.radice.innerHTML };
}

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY;
  delete process.env.NEXT_PUBLIC_TITOLARE_EMAIL_SEGNALAZIONI;
  delete process.env.NEXT_PUBLIC_TITOLARE_REFERENTE_PRIVACY;
});

describe('cookie policy', () => {
  it('scheda 2060 — ogni fornitore che la tabella mette negli Stati Uniti sta anche nel §4', async () => {
    const { s, testo } = await pagina('app/cookies/page.tsx');
    const fornitori = Array.from(s.radice.querySelectorAll('td'))
      .map((td) => testoVisibile(td))
      .filter((t) => /\(Stati Uniti\)/.test(t))
      .map((t) => t.replace(/\s*\(Stati Uniti\)/, '').trim());
    expect(fornitori.length).toBeGreaterThan(0);
    const extraUe = testo.slice(testo.indexOf('4. Trasferimenti extra-UE'));
    for (const f of fornitori) expect(extraUe, `${f} manca dal §4`).toContain(f);
    s.smonta();
  }, 60000);

  it('schede 2018 e 2019 — senza casella: nessun mailto finto, nessuna doppia parentesi', async () => {
    const { s, testo, html } = await pagina('app/cookies/page.tsx');
    expect(html).not.toMatch(/href="mailto:/);
    expect(testo).not.toMatch(/\)\s*\(/);
    expect(testo).not.toContain('non è ancora attiva');
    s.smonta();
  }, 60000);

  it('scheda 99 — modalità negozio, ruolo e sessione dicono il vero', async () => {
    const { SHOPPING_MODE_MAX_AGE } = await import('@/lib/shopping-access');
    const { s } = await pagina('app/cookies/page.tsx');
    const riga = (nome: string) =>
      Array.from(s.radice.querySelectorAll('tr')).find((tr) => testoVisibile(tr.querySelector('td') ?? tr).trim() === nome);
    const modalita = riga('mycity_shopping_mode')!;
    expect(testoVisibile(modalita)).toContain(`${SHOPPING_MODE_MAX_AGE / 3600} ore`);
    expect(testoVisibile(riga('mc_ruolo')!)).not.toContain('non contiene dati personali');
    expect(testoVisibile(riga('mc_ruolo')!)).toContain('identificativo interno');
    // mc_sid nasce anche senza consenso: sta fra i tecnici (prima tabella), non fra le analisi.
    const tabelle = Array.from(s.radice.querySelectorAll('table'));
    expect(testoVisibile(tabelle[0])).toContain('mc_sid');
    expect(testoVisibile(tabelle[1])).not.toContain('mc_sid');
    s.smonta();
  }, 60000);

  it('scheda 2062 — il §2.2 non descrive cookie funzionali che dice di non installare', async () => {
    const { s, testo } = await pagina('app/cookies/page.tsx');
    expect(testo).not.toMatch(/ultima ricerca|mappa salvata/);
    s.smonta();
    expect(leggi('components/CookieBanner.tsx')).not.toMatch(/ultima ricerca|mappa salvata/);
  }, 60000);

  it('scheda 2061 — la durata di _ga è quella che il sito fissa davvero', async () => {
    const avvio = leggi('lib/analytics/gtag-avvio.ts');
    const fissata = /cookie_expires\s*:\s*(\d+)/.exec(avvio)?.[1];
    const { s } = await pagina('app/cookies/page.tsx');
    const ga = Array.from(s.radice.querySelectorAll('tr')).find((tr) => testoVisibile(tr).includes('_ga'))!;
    const durata = testoVisibile(ga);
    if (!fissata) {
      expect(durata, 'senza cookie_expires vale il predefinito di GA4, 2 anni').toContain('2 anni');
      expect(durata).not.toContain('14 mesi');
    } else {
      const mesi = Math.round(Number(fissata) / (30.4 * 86_400));
      expect(durata).toContain(`${mesi} mesi`);
    }
    s.smonta();
  }, 60000);

  it('scheda 85 — il banner non chiama «anonime» le statistiche con identificativo e indirizzo di rete', () => {
    const banner = leggi('components/CookieBanner.tsx');
    expect(banner).not.toMatch(/desc="[^"]*anonime/);
    expect(banner).toMatch(/mc_vid/);
  });
});

describe('le tabelle si scorrono da tastiera (scheda 664)', () => {
  for (const file of ['app/cookies/page.tsx', 'app/privacy/page.tsx']) {
    it(file, async () => {
      const { s } = await pagina(file);
      const contenitori = Array.from(s.radice.querySelectorAll('table')).map((t) => t.parentElement!);
      expect(contenitori.length).toBeGreaterThan(0);
      for (const c of contenitori) {
        expect(c.getAttribute('tabindex')).toBe('0');
        expect(c.getAttribute('aria-label')).toBeTruthy();
      }
      s.smonta();
    }, 60000);
  }
});

describe('informativa privacy', () => {
  it('scheda 2020 — senza casella non dice «scrivendo a il modulo dei contatti»', async () => {
    const { s, testo } = await pagina('app/privacy/page.tsx');
    expect(testo).not.toMatch(/scrivendo a il modulo/);
    s.smonta();
  }, 60000);

  it('scheda 506 — negozio e rider fra i destinatari, e il database non negli Stati Uniti', async () => {
    const { s, testo } = await pagina('app/privacy/page.tsx');
    const destinatari = testo.slice(testo.indexOf('4. Destinatari'), testo.indexOf('5. Diritti'));
    expect(destinatari).toMatch(/negozio da cui compri/i);
    expect(destinatari).toMatch(/Rider che consegna/);
    expect(destinatari).not.toMatch(/Supabase Inc\.\s*\(Stati Uniti/);
    expect(testo).not.toContain('Li condividiamo solo con il negozio e il rider');
    s.smonta();
  }, 60000);

  it('scheda 1811 — fra i dati della verifica d identità c è il selfie', async () => {
    const { s, testo } = await pagina('app/privacy/page.tsx');
    expect(testo).toMatch(/selfie/i);
    s.smonta();
  }, 60000);

  it('scheda 105 — i documenti d identità non «10 anni»: i tempi della potatura', async () => {
    const { GIORNI_DOCUMENTI_ISCRIZIONE_A_META } = await import('@/lib/privacy/potature-ritenzione');
    const { s } = await pagina('app/privacy/page.tsx');
    const riga = Array.from(s.radice.querySelectorAll('tr')).find((tr) => testoVisibile(tr).includes('KYC'))!;
    const t = testoVisibile(riga);
    expect(t).not.toContain('10 anni');
    expect(t).toContain('90 giorni');
    expect(t).toContain(`${GIORNI_DOCUMENTI_ISCRIZIONE_A_META} giorni`);
    s.smonta();
  }, 60000);

  it('scheda 109 — Upstash: email e account, fino a 24 ore', async () => {
    const { s, testo } = await pagina('app/privacy/page.tsx');
    const riga = testo.slice(testo.indexOf('Upstash'), testo.indexOf('Upstash') + 400);
    expect(riga).not.toContain('per pochi minuti un contatore per indirizzo IP');
    expect(riga).toContain('24 ore');
    expect(riga).toMatch(/email/);
    s.smonta();
  }, 60000);

  it('scheda 121 — i messaggi del modulo Contatti hanno la loro riga di conservazione', async () => {
    const { MESI_DEI_MESSAGGI_DEI_CONTATTI } = await import('@/lib/privacy/potature-ritenzione');
    const { s } = await pagina('app/privacy/page.tsx');
    const riga = Array.from(s.radice.querySelectorAll('tr')).find((tr) => testoVisibile(tr).includes('modulo Contatti'));
    expect(riga, 'manca la riga dei Contatti').toBeTruthy();
    expect(testoVisibile(riga!)).toContain(`${MESI_DEI_MESSAGGI_DEI_CONTATTI} mesi`);
    s.smonta();
  }, 60000);
});

describe('niente note interne sulle pagine pubbliche (scheda 523)', () => {
  for (const file of ['app/terms/page.tsx', 'app/privacy/page.tsx', 'app/cookies/page.tsx']) {
    it(file, async () => {
      const { s, testo } = await pagina(file);
      expect(testo).not.toMatch(/Avviso legale/);
      expect(testo).not.toMatch(/validato da un|iubenda|Cookie-Script/);
      s.smonta();
    }, 60000);
  }
});

describe('Termini di servizio', () => {
  it('scheda 127 — l ordine non è una «proposta irrevocabile»: si annulla finché il negozio non accetta', async () => {
    const { s, testo } = await pagina('app/terms/page.tsx');
    expect(testo).not.toMatch(/irrevocabile/);
    expect(testo).toMatch(/finché il Venditore non l.ha accettata puoi annullarla/);
    s.smonta();
  }, 60000);

  it('scheda 2293 — la consegna non si calcola «in base a peso, distanza»', async () => {
    const { s, testo } = await pagina('app/terms/page.tsx');
    expect(testo).not.toMatch(/in base a peso/);
    s.smonta();
  }, 60000);

  it('scheda 440 — il modulo di recesso non ha righe di puntini più lunghe di 30', async () => {
    const { s } = await pagina('app/terms/page.tsx');
    const pre = s.radice.querySelector('pre')!;
    const lunghe = (pre.textContent ?? '').split(/\s+/).filter((pezzo) => pezzo.length > 30);
    expect(lunghe).toEqual([]);
    expect(pre.getAttribute('class')).toContain('[overflow-wrap:anywhere]');
    s.smonta();
  }, 60000);

  it('scheda 520 — il punto di contatto c è anche senza la variabile, e «qui sopra» porta a qualcosa', async () => {
    const { s, testo } = await pagina('app/terms/page.tsx');
    const sezione = testo.slice(testo.indexOf('16-bis'));
    expect(sezione).toMatch(/Punto di contatto per utenti e autorità/);
    const link = Array.from(s.radice.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(link).toContain('/contact');
    s.smonta();
  }, 60000);

  it('scheda 514 — l ordine dei risultati è quello del codice', async () => {
    const { s, testo } = await pagina('app/terms/page.tsx');
    const natura = testo.slice(testo.indexOf('Ranking dei risultati'), testo.indexOf('3. Registrazione'));
    expect(natura).not.toMatch(/distanza geografica|rating medio del Venditore/);
    expect(natura).toMatch(/pubblicati più di recente/);
    const griglia = leggi('lib/queries/griglia-prodotti.ts');
    expect(griglia, 'l ordine predefinito della griglia è cambiato: riscrivere il §2').toMatch(/default:\s*q = q\.order\('created_at', \{ ascending: false \}\)/);
    s.smonta();
  }, 60000);
});

describe('domande frequenti', () => {
  async function faq() {
    const { s } = await pagina('app/faq/page.tsx');
    // Le risposte sono chiuse: si aprono tutte.
    for (const b of Array.from(s.radice.querySelectorAll('button'))) {
      s.agisci(() => { b.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    }
    return { s, testo: testoVisibile(s.radice) };
  }

  it('scheda 2327 — il compenso del rider è quello firmato, non «in base alla distanza»', async () => {
    const { COMPENSO_RIDER_CENTS, COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS } = await import('@/lib/constants');
    const { s, testo } = await faq();
    expect(testo).not.toMatch(/in base alla distanza/);
    expect(testo).toContain(`${COMPENSO_RIDER_CENTS / 100} € per ogni giro`);
    expect(testo).toContain(`${COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS / 100} € per ogni negozio in più`);
    s.smonta();
  }, 60000);

  it('scheda 2326 — più negozi: niente «ognuno con la propria spedizione»', async () => {
    const { s, testo } = await faq();
    expect(testo).not.toMatch(/propria spedizione/);
    s.smonta();
  }, 60000);

  it('scheda 288 — coi codici sconto spenti non manda a un campo che non c è', async () => {
    const { CODICI_SCONTO_IN_CASSA } = await import('@/lib/funzioni-al-lancio');
    const { s, testo } = await faq();
    if (!CODICI_SCONTO_IN_CASSA) expect(testo).not.toMatch(/sezione "Coupon"/);
    s.smonta();
  }, 60000);

  it('scheda 2460 — i 14 giorni del recesso dicono che i freschi sono esclusi', async () => {
    const { s, testo } = await faq();
    const risposta = testo.slice(testo.indexOf('Hai 14 giorni dalla consegna'), testo.indexOf('Hai 14 giorni dalla consegna') + 200);
    expect(risposta).toMatch(/esclusi i prodotti freschi/);
    s.smonta();
  }, 60000);
});
