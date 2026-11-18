/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

// R10-005 — Su notifiche e messaggi i titoli saltavano dal titolo principale (h1) al terzo livello (h3).
// Prova leggera sul sorgente: dopo un h1 non viene mai un titolo più di un livello sotto il precedente.
const pagine = ['app/notifications/page.tsx', 'app/messages/page.tsx'];

const livelliDi = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));

describe('R10-005 · i titoli di notifiche e messaggi non saltano un livello', () => {
  for (const file of pagine) {
    it(`${file}: c'è l'h1 e nessun salto (h1 → h3)`, () => {
      const livelli = livelliDi(file);
      expect(livelli[0]).toBe(1);
      const salti = livelli.filter((l, i) => i > 0 && l > livelli[i - 1] + 1);
      expect(salti, `livelli dei titoli: ${livelli.join(' → ')}`).toEqual([]);
    });
  }
});

/*
 * Seconda passata (revisore): nello STATO VUOTO, sia dei messaggi sia delle notifiche, dopo l'h1 non
 * c'era nessun h2, e il titolo seguente sulla pagina vera è l'h3 «MyCity» del piede
 * (components/Footer.tsx): il salto h1 → h3 restava. Qui le pagine si montano davvero, vuote, e si
 * leggono i titoli nell'ordine in cui li incontra un lettore di schermo, con in fondo l'h3 del piede.
 */
const globali = globalThis as Record<string, unknown>;
const H3_DEL_PIEDE = 3;

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__UTENTE__', '__DATI_QUERY__', '__ESITO_QUERY__']) globali[k] = undefined;
});

async function titoliDellaPaginaVuota(file: string): Promise<number[]> {
  globali.__UTENTE__ = { id: 'u1' };
  globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => {
    if (o.queryKey[0] === 'auth') return { id: 'u1' };
    if (o.queryKey[1] === 'count') return 0;
    return [];
  };
  const mod = await monta(file);
  const s = accendi(mod.default);
  await attendi();
  await attendi();
  const livelli = Array.from(s.radice.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((h) => Number(h.tagName[1]));
  s.smonta();
  return livelli;
}

describe('R10-005 · anche vuote, notifiche e messaggi hanno un h2 dopo l’h1', () => {
  const vuote: Array<[string, string]> = [
    ['app/messages/page.tsx', 'Messaggi'],
    ['app/notifications/page.tsx', 'Notifiche'],
  ];
  for (const [file, h1] of vuote) {
    it(`${file} vuota: dopo l'h1 «${h1}» viene un h2, non l'h3 del piede`, async () => {
      const livelli = await titoliDellaPaginaVuota(file);
      expect(livelli[0], `la pagina vuota non ha più l'h1 «${h1}»: la prova girerebbe a vuoto`).toBe(1);
      const conIlPiede = [...livelli, H3_DEL_PIEDE];
      const salti = conIlPiede.filter((l, i) => i > 0 && l > conIlPiede[i - 1] + 1);
      expect(salti, `titoli della pagina vuota, piede compreso: ${conIlPiede.join(' → ')}`).toEqual([]);
    }, 60000);
  }
});
