import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import configurazione from '../../playwright.config';

/**
 * R01 — LE PROVE NEL BROWSER GIRANO ANCHE SULLO SCHERMO DI UN TELEFONO.
 *
 * playwright.config.ts dichiara un progetto telefono («mobile-safari», un iPhone 14), ma tutti i
 * lanci della CI forzavano --project=chromium: nessuna prova nel browser girava mai su uno schermo
 * stretto, e una era già rossa sul telefono senza che nessuno lo vedesse.
 *
 * Qui si legge la CI com'è e si chiede che almeno un lancio di Playwright usi un progetto che
 * Playwright tratta da telefono (isMobile), con il browser di quel progetto installato, in un
 * lavoro che gira sempre (nessun `if:`, nessun segreto) e che il cancello «Main» aspetta.
 */

const richiedi = createRequire(import.meta.url);
const yaml = richiedi('js-yaml') as { load: (t: string) => unknown };

type Passo = { name?: string; run?: string; if?: unknown };
type Lavoro = { if?: unknown; needs?: string | string[]; steps?: Passo[] };

const ci = yaml.load(readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8')) as { jobs: Record<string, Lavoro> };

type Progetto = { name?: string; use?: { isMobile?: boolean; defaultBrowserType?: string } };
const progetti = (configurazione.projects ?? []) as Progetto[];
const tuttiINomi = progetti.map((p) => String(p.name));
const telefoni = progetti.filter((p) => p.use?.isMobile === true);

const LANCIA_PLAYWRIGHT = /npm run test:e2e|npx playwright test/;

/** I progetti che un lancio fa girare: quelli dopo --project, o tutti se non ne nomina nessuno. */
function progettiLanciati(run: string): string[] {
  const righe = run.split('\n').filter((r) => LANCIA_PLAYWRIGHT.test(r) || /--project/.test(r));
  const nominati = [...righe.join(' ').matchAll(/--project(?:=|\s+)["']?([\w-]+)/g)].map((m) => m[1]);
  return nominati.length > 0 ? nominati : tuttiINomi;
}

type Lancio = { lavoro: string; passo: Passo; progetti: string[] };

function lanciDellaCi(): Lancio[] {
  return Object.entries(ci.jobs).flatMap(([lavoro, l]) =>
    (l.steps ?? [])
      .filter((p) => LANCIA_PLAYWRIGHT.test(p.run ?? ''))
      .map((passo) => ({ lavoro, passo, progetti: progettiLanciati(passo.run ?? '') })),
  );
}

function lanciSulTelefono(): Lancio[] {
  const nomi = new Set(telefoni.map((p) => String(p.name)));
  return lanciDellaCi().filter((l) => l.progetti.some((n) => nomi.has(n)));
}

describe('le prove nel browser girano anche sullo schermo di un telefono', () => {
  it('playwright.config.ts ha un progetto telefono (la condizione di partenza)', () => {
    expect(telefoni.length, 'nessun progetto con isMobile in playwright.config.ts').toBeGreaterThan(0);
  });

  it('almeno un lancio della CI fa girare le prove col progetto del telefono', () => {
    const lanci = lanciDellaCi();
    expect(lanci.length, 'la CI non lancia più Playwright').toBeGreaterThan(0);
    expect(
      lanciSulTelefono().map((l) => l.lavoro),
      `tutti i lanci usano solo ${[...new Set(lanci.flatMap((l) => l.progetti))].join(', ')}: nessuno schermo da telefono`,
    ).not.toEqual([]);
  });

  it('il lancio sul telefono fa girare tutte le prove, senza filtri che ne escludano', () => {
    for (const l of lanciSulTelefono()) {
      expect(l.passo.run ?? '', `«${l.lavoro}» filtra le prove sul telefono`).not.toMatch(/--grep-invert|\s-gv?\s|--grep\b/);
    }
    expect(lanciSulTelefono().length).toBeGreaterThan(0);
  });

  it('il lavoro installa il browser del telefono, gira sempre e il cancello «Main» lo aspetta', () => {
    const lanci = lanciSulTelefono();
    expect(lanci.length, 'nessun lancio sul telefono da controllare').toBeGreaterThan(0);
    const main = Object.values(ci.jobs).find((l) => (l as { name?: string }).name === 'Main');
    const aspettati = new Set([main?.needs ?? []].flat());
    for (const { lavoro, passo, progetti: nomi } of lanci) {
      const l = ci.jobs[lavoro];
      const passi = l.steps ?? [];
      const browser = new Set(
        telefoni.filter((p) => nomi.includes(String(p.name))).map((p) => p.use?.defaultBrowserType ?? 'chromium'),
      );
      const installa = passi
        .slice(0, passi.indexOf(passo))
        .map((p) => p.run ?? '')
        .filter((r) => /playwright install/.test(r));
      for (const b of browser) {
        expect(
          installa.some((r) => new RegExp(`\\b${b}\\b`).test(r) || !/playwright install(?:[ \t]+--with-deps)?[ \t]+[a-z]/.test(r)),
          `«${lavoro}» non installa ${b}, il browser del telefono: il lancio cadrebbe prima di aprire una pagina`,
        ).toBe(true);
      }
      expect(l.if, `«${lavoro}» gira solo a una condizione`).toBeUndefined();
      for (const p of passi) expect(p.if, `in «${lavoro}» il passo «${p.name}» gira solo a una condizione`).toBeUndefined();
      expect(JSON.stringify(l), `«${lavoro}» legge un segreto: il giorno che manca, il telefono torna a non girare`).not.toMatch(/secrets\./);
      expect(aspettati.has(lavoro), `il cancello «Main» non aspetta «${lavoro}»`).toBe(true);
    }
  });
});
