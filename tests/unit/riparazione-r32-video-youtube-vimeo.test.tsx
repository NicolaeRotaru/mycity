/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import VideoSection from '@/components/store-sections/VideoSection';

/**
 * R32-024 — I VIDEO DI YOUTUBE E VIMEO SI CARICAVANO SENZA CHIEDERE IL CONSENSO, E LA COOKIE POLICY
 * NON LI NOMINAVA.
 *
 * Il caricamento al tocco c'è dal 5/11 (VideoAlClic): la prova lo tiene fermo col clic vero, e
 * controlla che quello che le pagine legali dicono (dominio senza cookie, «do not track», al
 * fornitore arriva il sito e non la pagina) sia quello che l'iframe fa davvero.
 * Il pezzo che mancava: la cookie policy e l'informativa non nominavano né YouTube né Vimeo.
 */

const ctx = { storeId: 's1', accent: '#C0492C', store: { store_name: 'Pane Quotidiano' } } as never;

let Cookies: ComponentType<Record<string, unknown>>;
let Privacy: ComponentType<Record<string, unknown>>;

beforeAll(async () => {
  Cookies = (await import('@/app/cookies/page')).default as ComponentType<Record<string, unknown>>;
  Privacy = (await monta('app/privacy/page.tsx')).default as ComponentType<Record<string, unknown>>;
}, 60000);

afterEach(() => {
  document.body.innerHTML = '';
});

function leggi<T>(Pagina: ComponentType<Record<string, unknown>>, fai: (radice: HTMLElement) => T): T {
  const s = accendi(Pagina);
  try {
    return fai(s.radice);
  } finally {
    s.smonta();
  }
}

describe('R32-024 · i video esterni: al tocco, e dichiarati', () => {
  it('il video della vetrina nasce solo al clic, senza cookie di YouTube, col «do not track» di Vimeo, e manda solo il sito', () => {
    for (const [provider, id, dominio] of [
      ['youtube', 'abc123', 'https://www.youtube-nocookie.com/embed/abc123'],
      ['vimeo', '987', 'https://player.vimeo.com/video/987?dnt=1'],
    ] as const) {
      const s = accendi(VideoSection, { ctx, config: { heading: 'Il forno', provider, videoId: id } });
      expect(s.radice.querySelectorAll('iframe'), `${provider}: il video parte senza che nessuno lo chieda`).toHaveLength(0);
      const bottone = s.radice.querySelector('button') as HTMLButtonElement;
      expect(bottone.textContent).toContain('Guarda il video');
      s.agisci(() => bottone.click());
      const iframe = s.radice.querySelector('iframe');
      expect(iframe, `${provider}: dopo il tocco il video non parte`).toBeTruthy();
      expect(iframe!.getAttribute('src')!.startsWith(dominio)).toBe(true);
      // Le pagine legali dicono «il sito da cui guardi»: è vero solo con questa regola sul referrer.
      expect(iframe!.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
      s.smonta();
    }
  });

  it('IL CASO CHE ROMPEVA — la cookie policy nomina YouTube e Vimeo fra le tipologie, e dice che si caricano solo al tocco', () => {
    const tipologie = leggi(Cookies, (r) => testoVisibile(r.querySelector('#tipologie')));
    expect(tipologie, 'la sezione delle tipologie non è comparsa').toMatch(/Cookie tecnici/);
    expect(tipologie, 'la cookie policy non nomina YouTube').toMatch(/YouTube/);
    expect(tipologie, 'la cookie policy non nomina Vimeo').toMatch(/Vimeo/);
    expect(tipologie).toMatch(/youtube-nocookie\.com/);
    expect(tipologie).toMatch(/do not track/);
    expect(tipologie).toMatch(/non si carica da solo/);
    expect(tipologie).toMatch(/Guarda il video/);
    expect(tipologie).not.toMatch(/la pagina da cui guardi/);
  });

  it('IL CASO CHE ROMPEVA — fra i trasferimenti extra-UE della cookie policy c\'è anche Vimeo, e Google anche per YouTube', () => {
    const extra = leggi(Cookies, (r) => testoVisibile(r.querySelector('#extra-ue')));
    expect(extra).toMatch(/Vimeo\.com, Inc\./);
    expect(extra).toMatch(/Google[^.]*YouTube/);
  });

  it('IL CASO CHE ROMPEVA — l\'informativa elenca YouTube e Vimeo fra chi riceve i dati, solo al tocco', () => {
    const voci = leggi(Privacy, (r) => Array.from(r.querySelectorAll('#destinatari li')).map((li) => testoVisibile(li)));
    const video = voci.find((t) => /YouTube/.test(t));
    expect(video, 'l\'informativa non nomina YouTube fra i destinatari').toBeTruthy();
    expect(video).toMatch(/Vimeo\.com, Inc\./);
    expect(video).toMatch(/solo quando tocchi «Guarda il video»/);
    expect(video).toMatch(/indirizzo IP/);
  }, 60000);
});
