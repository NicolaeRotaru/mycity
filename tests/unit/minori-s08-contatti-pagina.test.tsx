/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { accendi, clicca } from './aiuti/schermo';
import { testoVisibile } from './aiuti/monta-componente';

/** S08 (5/11/2026) — La pagina Contattaci (schede 2015, 2159, 2620). */

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: function Collegamento({ href, children, ...resto }: { href: unknown; children?: unknown } & Record<string, unknown>) {
      return createElement('a', { ...resto, href: String(href) }, children as never);
    },
  };
});
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock('@/components/Turnstile', () => ({ default: function T() { return null; } }));
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: () => {} }));

import ContactPage from '@/app/contact/page';

async function aspetta() {
  for (let i = 0; i < 6; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

function scriviNel(s: ReturnType<typeof accendi>, etichetta: string, valore: string) {
  const label = Array.from(s.radice.querySelectorAll('label')).find((l) => testoVisibile(l).includes(etichetta))!;
  const campo = (label.htmlFor ? s.radice.ownerDocument.getElementById(label.htmlFor) : label.querySelector('input,textarea')) as HTMLInputElement;
  const proto = campo.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  s.agisci(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(campo, valore);
    campo.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  delete process.env.NEXT_PUBLIC_SUPPORT_PHONE;
  delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
});

describe('la pagina Contattaci', () => {
  it('scheda 2159 — con la sola email non dice «scegli il canale» e non mostra gli orari di un canale che non c è', async () => {
    const s = accendi(ContactPage);
    await aspetta();
    const testo = testoVisibile(s.radice);
    expect(testo).not.toContain('Scegli il canale più comodo');
    expect(testo).not.toContain('Orari assistenza');
    s.smonta();
  });

  it('scheda 2015 — quando il modulo non arriva, il recapito resta scritto sotto il modulo', async () => {
    (globalThis as Record<string, unknown>).fetch = async () =>
      new Response(JSON.stringify({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Il modulo dei contatti non funziona in questo momento e il tuo messaggio non è arrivato. Scrivici a privacy@mycity-marketplace.com.',
          details: { recapito: { href: 'mailto:privacy@mycity-marketplace.com', testo: 'privacy@mycity-marketplace.com' } },
        },
      }), { status: 503, headers: { 'content-type': 'application/json' } });
    const realeOra = Date.now;
    const s = accendi(ContactPage);
    await aspetta();
    scriviNel(s, 'Nome', 'Maria Rossi');
    scriviNel(s, 'Email', 'maria@example.com');
    scriviNel(s, 'Messaggio', 'Vorrei cancellare il mio account.');
    // Il modulo rifiuta gli invii fatti in meno di 2 secondi (guardia anti-bot).
    Date.now = () => realeOra() + 5_000;
    const form = s.radice.querySelector('form')!;
    s.agisci(() => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    await aspetta();
    Date.now = realeOra;
    const avviso = s.radice.querySelector('[role="alert"]');
    expect(avviso, 'il recapito stava solo in un messaggio a comparsa che sparisce').not.toBeNull();
    expect(avviso!.querySelector('a')?.getAttribute('href')).toBe('mailto:privacy@mycity-marketplace.com');
    void clicca;
    s.smonta();
  });
});
