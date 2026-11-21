/**
 * @vitest-environment jsdom
 *
 * R01-001 — Fra 768 e 1023 px i tasti Ordini, Consegne e Admin della testata erano solo
 * un'icona: il nome stava nel title, che col dito e da tastiera non si vede. Scelta del 19/11: sotto
 * lg i tre tasti stanno nel menu dell'account, col loro nome; una scritta sotto l'icona
 * toglierebbe spazio alla ricerca. Qui si monta la testata vera di chi è negozio, fattorino e
 * amministratore: sotto lg i tre tasti non si mostrano nella barra (le classi), e il menu
 * dell'account li ha tutti e tre, con il nome scritto.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

type Globale = Record<string, unknown>;

beforeEach(() => {
  (globalThis as Globale).__ASCOLTI_AUTH__ = [];
  (globalThis as Globale).__RISPOSTA_SUPABASE__ = { data: [], error: null };
});
afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__PROFILO__', '__ASCOLTI_AUTH__', '__RISPOSTA_SUPABASE__']) delete (globalThis as Globale)[k];
});

async function testata(profilo: Record<string, unknown>) {
  (globalThis as Globale).__PROFILO__ = { isAuthenticated: true, profile: { full_name: 'Mario Rossi' }, ...profilo };
  const mod = await monta('components/Navbar.tsx');
  const s = accendi(mod.default, {});
  for (let i = 0; i < 6; i++) await attendi();
  return s;
}

const menuAperto = async (s: { radice: HTMLElement }) => {
  const bottone = s.radice.querySelector('button[aria-label="Menu account"]');
  expect(bottone, 'controprova: il menu dell\'account c\'è').toBeTruthy();
  clicca(bottone!);
  for (let i = 0; i < 4; i++) await attendi();
  const voci = [...s.radice.querySelectorAll('ul a')] as HTMLAnchorElement[];
  return voci.map((a) => ({ href: a.getAttribute('href'), nome: (a.textContent ?? '').trim() }));
};

describe('sui tablet i tasti di mestiere stanno nel menu dell\'account, col nome', () => {
  it('negozio, fattorino e amministratore: sotto lg i tre tasti non sono icone mute nella barra', async () => {
    const s = await testata({ isSeller: true, isRider: true, isAdmin: true });
    for (const href of ['/seller/orders', '/rider', '/admin']) {
      const tasto = [...s.radice.querySelectorAll(`a[href="${href}"]`)].find((a) => a.closest('ul') === null) as HTMLElement | undefined;
      expect(tasto, `controprova: il tasto ${href} della barra c'è da lg in su`).toBeTruthy();
      const classi = (tasto!.getAttribute('class') ?? '').split(/\s+/);
      expect(classi, `sotto lg il tasto ${href} resta un'icona senza nome nella barra`).toContain('hidden');
      expect(classi).toContain('lg:inline-flex');
    }
    s.smonta();
  });

  it('il menu dell\'account ha Ordini, Consegne e Admin, con il nome scritto, anche per chi li ha tutti e tre', async () => {
    const s = await testata({ isSeller: true, isRider: true, isAdmin: true });
    const voci = await menuAperto(s);
    for (const href of ['/seller/orders', '/rider', '/admin']) {
      const voce = voci.find((v) => v.href === href);
      expect(voce, `nel menu dell'account manca ${href}: sotto lg non ci si arriva più`).toBeTruthy();
      expect(voce!.nome.length, `la voce ${href} del menu non ha un nome scritto`).toBeGreaterThan(2);
    }
    s.smonta();
  });

  it('negozio e fattorino: il menu ha gli ordini del negozio e le consegne', async () => {
    const s = await testata({ isSeller: true, isRider: true });
    const hrefs = (await menuAperto(s)).map((v) => v.href);
    expect(hrefs).toContain('/seller/orders');
    expect(hrefs).toContain('/rider');
    s.smonta();
  });
});
