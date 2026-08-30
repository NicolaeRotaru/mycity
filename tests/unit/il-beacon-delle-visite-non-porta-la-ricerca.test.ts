/**
 * 27/8/2026 (R161 · R169) — LA RIGA SALVATA NEL NOSTRO DATABASE RICOPIAVA
 * PAROLA PER PAROLA QUELLO CHE LA PERSONA AVEVA CERCATO.
 *
 * Il beacon delle visite manda al server il percorso intero della pagina. Sulla
 * pagina dei risultati quel percorso è `/search?q=…`, cioè il testo scritto
 * nella casella di ricerca: l'email di chi cerca il proprio ordine, il numero
 * di telefono, il nome di un'altra persona. Il server lo scriveva in
 * `activity_events.path` tagliato solo a 500 caratteri, e in più lo ricopiava
 * dentro `summary` — «Pagina vista: /search?q=…».
 *
 * Il `summary` è la parte che pesa di più, perché la pulizia periodica dei dati
 * vecchi lo lasciava indietro (R169): quella frase, con dentro la ricerca,
 * restava per sempre.
 *
 * Queste prove chiamano la rotta vera e guardano la riga che sarebbe finita nel
 * database. Diventano rosse se la ricerca torna a passare.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const scritte: Record<string, unknown>[] = [];

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({ getCurrentUser: async () => null }));
vi.mock('@/lib/activity', () => ({
  recordActivity: async (riga: Record<string, unknown>) => { scritte.push(riga); },
}));

import { POST } from '@/app/api/track/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { CONSENT_COOKIE, CONSENT_VERSION } from '@/lib/consent';

/** Il cookie di chi ha accettato tutto: senza, la pagina vista non passa. */
const HO_ACCETTATO = `${CONSENT_COOKIE}=${CONSENT_VERSION}%3A111`;

let contatore = 0;
function visita(corpo: Record<string, unknown>) {
  contatore++;
  return POST(new Request('https://mycity.test/api/track', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: HO_ACCETTATO,
      'x-forwarded-for': `93.40.20.${contatore % 250}`,
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    },
    body: JSON.stringify(corpo),
  }));
}

const ultima = () => scritte[scritte.length - 1];

beforeEach(() => {
  scritte.length = 0;
  __resetRateLimitBuckets();
});

describe('la pagina vista che arriva dal browser', () => {
  it("IL CASO CHE ROMPEVA — nella riga salvata non c'è quello che la persona ha cercato", async () => {
    const res = await visita({ event_type: 'page_view', path: '/search?q=ordine di mario.rossi@gmail.com' });

    expect(res.status).toBe(204);
    expect(ultima(), 'la visita non è stata registrata affatto').toBeTruthy();
    expect(String(ultima().path), "l'email scritta nella ricerca finisce nel nostro database").not.toContain('@');
    expect(ultima().path).toBe('/search?q=***');
  });

  it("IL CASO CHE ROMPEVA — nemmeno il riassunto la ricopia, ed è quello che resta per sempre", async () => {
    await visita({ event_type: 'page_view', path: '/search?q=telefono 3331234567' });

    expect(String(ultima().summary), 'la ricerca resta nel riassunto, che la pulizia dei dati vecchi non tocca')
      .not.toContain('3331234567');
    expect(ultima().summary).toBe('Pagina vista: /search?q=***');
  });

  it("il sito da cui si arriva resta, quello che ci si era cercato dentro no", async () => {
    await visita({
      event_type: 'page_view',
      path: '/product/7',
      referrer: 'https://www.google.com/search?q=mario+rossi+piacenza',
    });

    expect(String(ultima().referrer)).toContain('www.google.com');
    expect(String(ultima().referrer), 'la ricerca fatta su Google entra nel nostro database').not.toContain('mario');
  });

  it('la strada resta intera: senza, non si sa più quali pagine si visitano', async () => {
    await visita({ event_type: 'page_view', path: '/store/12/panificio-garetti' });
    expect(ultima().path).toBe('/store/12/panificio-garetti');
    expect(ultima().summary).toBe('Pagina vista: /store/12/panificio-garetti');
  });

  it("le etichette di campagna passano: dicono da dove arriva la gente, non chi è", async () => {
    await visita({ event_type: 'page_view', path: '/?utm_source=facebook&utm_campaign=natale' });
    expect(ultima().path).toBe('/?utm_source=facebook&utm_campaign=natale');
  });

  it('un percorso che non è un percorso non diventa una riga finta', async () => {
    await visita({ event_type: 'page_view', path: 'javascript:alert(1)' });
    expect(ultima().path).toBeNull();
    expect(ultima().summary).toBe('Pagina vista: /');
  });
});
