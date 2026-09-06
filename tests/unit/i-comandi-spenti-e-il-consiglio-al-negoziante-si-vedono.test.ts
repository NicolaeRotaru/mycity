/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';
import { contrasto } from './aiuti/contrasto';
import { TAVOLOZZA } from './aiuti/tavolozza-del-sito';

/**
 * 6/9/2026 — TRE COSE CHE, SULLO SCHERMO DI CHI CI VEDE POCO, NON C'ERANO.
 *
 * ① L'interruttore delle impostazioni, da spento, era `cream-300` sulla pagina
 *    bianca: 1,32 di stacco, e la pallina bianca dentro la pista aveva lo
 *    stesso 1,32. Un comando deve staccare almeno 3 volte (WCAG 1.4.11, AA):
 *    chi ha la vista debole non vedeva ne' che li' c'era un interruttore, ne'
 *    da che parte stava la pallina — e li' si decide se MyCity puo' scrivere.
 * ② Nel pannello del negoziante il pulsante senape dei consigli era bianco su
 *    `accent-600`: 3,25, sotto il 4,5 del testo (WCAG 1.4.3, AA). Le altre due
 *    tonalita' della stessa mappa passavano: era stata composta a occhio.
 * ③ Nel profilo l'email usciva dal bordo bianco della scheda: `font-mono`,
 *    niente modo di spezzare la parola, e i browser non spezzano ne' sulla
 *    chiocciola ne' sul punto.
 *
 * Il colore non viene ricopiato qui: si legge da `tailwind.config.ts`, cosi' se
 * domani la tavolozza cambia la prova segue da sola.
 */

const BIANCO = '#FFFFFF';
const COMANDO = 3;   // parti grafiche di un comando — WCAG 1.4.11
const TESTO = 4.5;   // testo normale — WCAG 1.4.3

const globali = globalThis as Record<string, unknown>;
const leggi = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');

/** `bg-ink-400` → `#78716C`, leggendo la tavolozza vera. */
function sfondoDi(classi: string): string | null {
  for (const c of classi.split(/\s+/)) {
    const m = c.match(/^bg-([a-z]+)-(\d+)$/);
    if (m) return TAVOLOZZA.get(`${m[1]}-${m[2]}`) ?? null;
  }
  return null;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('l\'interruttore delle impostazioni si vede anche da spento', () => {
  it('la pista spenta stacca almeno 3 volte dalla pagina bianca, e dalla pallina', async () => {
    const mod = await monta('components/ui/Toggle.tsx');
    const s = accendi(mod.Toggle, {
      label: 'Aggiornamenti ordini', desc: 'Quando il tuo ordine cambia stato', value: false, onChange: () => {},
    });
    const interruttore = s.radice.querySelector<HTMLElement>('[role="switch"]');
    expect(interruttore, 'l\'interruttore non c\'e\' piu\': la prova non sta guardando niente').toBeTruthy();
    expect(interruttore!.getAttribute('aria-checked')).toBe('false');

    const pista = sfondoDi(interruttore!.className);
    expect(pista, `non riconosco il colore della pista: ${interruttore!.className}`).toBeTruthy();
    expect(
      contrasto(BIANCO, pista!),
      'la pista spenta non si stacca dalla pagina bianca: non si vede che li\' c\'e\' un interruttore',
    ).toBeGreaterThanOrEqual(COMANDO);

    // La pallina e' bianca: se la pista non stacca da lei, non si vede da che
    // parte sta, cioe' se e' acceso o spento.
    const pallina = interruttore!.querySelector<HTMLElement>('span');
    expect(pallina!.className, 'la pallina non e\' piu\' bianca: rifare il conto').toContain('bg-white');
    expect(
      contrasto(BIANCO, pista!),
      'la pallina bianca sparisce dentro la pista: non si vede se e\' acceso o spento',
    ).toBeGreaterThanOrEqual(COMANDO);
    s.smonta();
  }, 60000);

  it('e da acceso continua a staccare', async () => {
    const mod = await monta('components/ui/Toggle.tsx');
    const s = accendi(mod.Toggle, { label: 'Offerte', desc: 'Dai tuoi negozi', value: true, onChange: () => {} });
    const acceso = s.radice.querySelector<HTMLElement>('[role="switch"]')!;
    expect(contrasto(BIANCO, sfondoDi(acceso.className)!)).toBeGreaterThanOrEqual(COMANDO);
    s.smonta();
  }, 60000);
});

describe('i consigli dell\'analisi vendite si leggono tutti e tre', () => {
  it('ogni pulsante bianco della mappa stacca almeno 4,5 volte dal proprio fondo', () => {
    const src = leggi('app/seller/analytics/page.tsx');
    const mappa = src.slice(src.indexOf('const INSIGHT_TONE'), src.indexOf('function InsightCard'));
    const pulsanti = [...mappa.matchAll(/(\w+):\s*\{[^}]*btn:\s*'([^']+)'/g)];
    expect(pulsanti.length, 'la mappa dei consigli non si legge piu\': la prova non misura niente').toBe(3);

    for (const [, tono, classi] of pulsanti) {
      // Il testo del pulsante e' bianco: sta in `InsightCard`, non nella mappa.
      const fondo = sfondoDi(classi);
      expect(fondo, `il tono «${tono}» non ha un fondo che riconosco: ${classi}`).toBeTruthy();
      expect(
        contrasto(BIANCO, fondo!),
        `il pulsante del consiglio «${tono}» (${classi}) si legge a fatica: e\' quello che dovrebbe far agire il negozio`,
      ).toBeGreaterThanOrEqual(TESTO);
    }
  });

  it('e il testo dentro quei pulsanti e\' davvero bianco (se cambia, il conto sopra va rifatto)', () => {
    const src = leggi('app/seller/analytics/page.tsx');
    expect(src).toMatch(/rounded-full px-3\.5 py-2 text-\[13px\] font-bold text-white/);
  });
});

describe('nel profilo l\'email resta dentro la scheda', () => {
  beforeEach(() => {
    globali.__DATI_QUERY__ = {
      id: 'u1', full_name: 'Marta Rossi', phone: '', address: '', city: '', zip: '',
      email: 'marta.rossi.dellagiovanna@posta-elettronica-certificata.it',
    };
  });
  afterEach(() => { globali.__DATI_QUERY__ = undefined; });

  it('l\'indirizzo lungo puo\' andare a capo invece di uscire dal bordo', async () => {
    const mod = await monta('app/profile/page.tsx');
    const s = accendi(mod.default);
    await attendi();

    const email = Array.from(s.radice.querySelectorAll('span')).find(
      (e) => e.textContent === 'marta.rossi.dellagiovanna@posta-elettronica-certificata.it',
    );
    expect(email, 'l\'email non si vede piu\' nel profilo: la prova non sta guardando niente').toBeTruthy();
    expect(
      email!.className,
      'niente permette di spezzare l\'indirizzo: su un telefono da 375px esce dal bordo bianco della scheda',
    ).toMatch(/\bbreak-(words|all)\b/);
    s.smonta();
  }, 60000);
});
