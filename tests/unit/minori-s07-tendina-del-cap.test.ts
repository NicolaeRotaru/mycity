/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

function apri(s: ReturnType<typeof accendi>) {
  const pillola = [...s.radice.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Cambia indirizzo di consegna')!;
  s.agisci(() => clicca(pillola));
  return s.radice.querySelector<HTMLElement>('[role="dialog"]')!;
}
function scrivi(campo: HTMLInputElement, valore: string) {
  const imposta = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  imposta?.call(campo, valore);
  campo.dispatchEvent(new window.Event('input', { bubbles: true }));
}

describe('S07 · la tendina del CAP', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

  it('con un CAP di tre cifre il pulsante si può premere e dice perché non va', async () => {
    const mod = await monta('components/LocationPill.tsx');
    const s = accendi(mod.default, { compact: true });
    const tendina = apri(s);
    const campo = tendina.querySelector('input') as HTMLInputElement;
    s.agisci(() => scrivi(campo, '291'));
    const bottone = [...tendina.querySelectorAll('button')].find((b) => /Aggiorna posizione/.test(b.textContent ?? ''))!;
    expect(bottone.disabled).toBe(false);
    s.agisci(() => clicca(bottone));
    expect(s.radice.querySelector('[role="alert"]')?.textContent).toContain('Il CAP ha cinque cifre');
    s.smonta();
  }, 60000);

  it('Invio nel campo prova a salvare', async () => {
    const mod = await monta('components/LocationPill.tsx');
    const s = accendi(mod.default, { compact: true });
    const tendina = apri(s);
    const campo = tendina.querySelector('input') as HTMLInputElement;
    s.agisci(() => scrivi(campo, '29'));
    s.agisci(() => { campo.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(s.radice.querySelector('[role="alert"]')?.textContent).toContain('Il CAP ha cinque cifre');
    s.smonta();
  }, 60000);

  it('non promette di mostrare «i negozi che consegnano al tuo CAP»', async () => {
    const mod = await monta('components/LocationPill.tsx');
    const s = accendi(mod.default, { compact: true });
    const tendina = apri(s);
    expect(tendina.textContent).not.toMatch(/consegnano al tuo CAP/);
    expect(tendina.textContent).toMatch(/te lo dice la cassa/);
    s.smonta();
  }, 60000);

  it('il fumetto «Dove ti consegniamo?» non si apre sopra i titoli da tablet in su', async () => {
    vi.useFakeTimers();
    const mod = await monta('components/LocationPill.tsx');
    const s = accendi(mod.default, {});
    s.agisci(() => vi.advanceTimersByTime(2000));
    const fumetto = [...s.radice.querySelectorAll('div')].find((d) => d.textContent?.startsWith('Dove ti consegniamo?'))
      ?? [...s.radice.querySelectorAll('div')].find((d) => /Dove ti consegniamo\?/.test(d.textContent ?? '') && d.className.includes('fixed'));
    expect(fumetto, 'il fumetto non c’è più sul telefono').toBeTruthy();
    expect(fumetto!.className.split(/\s+/)).toContain('md:hidden');
    s.smonta();
  }, 60000);
});
