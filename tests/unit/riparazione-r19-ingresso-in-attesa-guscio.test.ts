/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R19-001 — Il fattorino in attesa ora arriva al modulo dei documenti e al
 * profilo, dentro il guscio dell'area rider. Lì vede il modulo, ma non il
 * pulsante SOS: non consegna ancora, e un SOS suonerebbe a tutti gli admin.
 * Il fattorino approvato il suo SOS lo vede come prima; l'admin no (P0-7).
 */

const profilo = vi.hoisted(() => ({
  attuale: {
    profile: { id: 'u-1', role: 'rider', is_approved: false } as { id: string; role: string; is_approved: boolean },
    isAuthenticated: true,
    isLoading: false,
    isRider: true,
    isAdmin: false,
  },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/components/hooks/useProfile', () => ({ useProfile: () => profilo.attuale }));
vi.mock('@/components/ui/LoadingState', () => ({ LoadingState: () => createElement('p', null, 'CARICAMENTO') }));
vi.mock('@/components/rider/RiderShell', () => ({
  default: ({ children, showSOS = true }: { children: unknown; showSOS?: boolean }) =>
    createElement('div', null, showSOS ? createElement('button', null, 'SOS') : null, children as never),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let radice: Root | null = null;

async function disegna(): Promise<HTMLDivElement> {
  const { default: RiderLayout } = await import('@/app/rider/layout');
  const div = document.createElement('div');
  radice = createRoot(div);
  await act(async () => {
    radice!.render(createElement(RiderLayout, null, createElement('p', null, 'MODULO DOCUMENTI')));
  });
  return div;
}

function come(ruolo: 'rider' | 'admin', approvato: boolean) {
  profilo.attuale = {
    profile: { id: 'u-1', role: ruolo, is_approved: approvato },
    isAuthenticated: true,
    isLoading: false,
    isRider: ruolo === 'rider',
    isAdmin: ruolo === 'admin',
  };
}

afterEach(() => {
  act(() => radice?.unmount());
  radice = null;
});

describe('il guscio del fattorino in attesa', () => {
  it('mostra il modulo dei documenti, senza il pulsante SOS', async () => {
    come('rider', false);
    const div = await disegna();
    expect(div.textContent).toContain('MODULO DOCUMENTI');
    expect(div.textContent, 'il fattorino non approvato vede il pulsante SOS').not.toContain('SOS');
  });

  it('il fattorino approvato vede il suo SOS, come prima', async () => {
    come('rider', true);
    const div = await disegna();
    expect(div.textContent).toContain('MODULO DOCUMENTI');
    expect(div.textContent).toContain('SOS');
  });

  it('l admin che guarda l area rider non vede l SOS, come prima', async () => {
    come('admin', true);
    const div = await disegna();
    expect(div.textContent).toContain('MODULO DOCUMENTI');
    expect(div.textContent).not.toContain('SOS');
  });
});
