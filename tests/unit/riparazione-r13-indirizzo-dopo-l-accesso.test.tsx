/**
 * @vitest-environment jsdom
 */
/**
 * R13-025 — Tornando dall'accesso con un indirizzo già scritto da ospite, la cassa lo nascondeva
 * e non segnava nessun indirizzo come scelto: la bozza era nel modulo, il modulo era chiuso perché
 * esistono indirizzi salvati, e tutte le mattonelle erano spente. L'ordine partiva verso un
 * indirizzo che non compariva a schermo.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ShippingAddressForm } from '@/components/checkout/ShippingAddressForm';
import { accendi } from './aiuti/schermo';

const SALVATO = {
  id: 'casa', label: 'Casa', address: 'Via Roma 1', city: 'Piacenza', zip: '29121',
  full_name: 'Luca Bianchi', phone: '3331234567', is_default: true,
};

function modulo(form: Partial<Record<'fullName' | 'address' | 'city' | 'zip' | 'phone' | 'notes', string>>) {
  return {
    form: { fullName: '', address: '', city: 'Piacenza', zip: '29121', phone: '', notes: '', ...form },
    savedAddresses: [SALVATO],
    errors: {},
    onChange: () => {},
    onSubmit: () => {},
    onApplySavedAddress: () => {},
  };
}

const smonta: Array<() => void> = [];
afterEach(() => {
  while (smonta.length) smonta.pop()?.();
});

function apri(props: ReturnType<typeof modulo>) {
  const s = accendi(ShippingAddressForm, props);
  smonta.push(s.smonta);
  const form = s.radice.querySelector('#checkout-form') as HTMLFormElement;
  const mattonella = [...s.radice.querySelectorAll('button')].find((b) => b.textContent?.includes('Via Roma 1'))!;
  return { form, mattonella, via: (s.radice.querySelector('input[name="address"]') as HTMLInputElement).value };
}

describe('R13-025 · l\'indirizzo scritto da ospite si vede al ritorno dall\'accesso', () => {
  it('la bozza che non è nessuna mattonella si mostra nel modulo aperto, e nessuna mattonella finge di essere scelta', () => {
    const { form, mattonella, via } = apri(modulo({ fullName: 'Luca Bianchi', address: 'Via Calzolai 5', phone: '3331234567' }));
    expect(form.classList.contains('hidden'), 'l\'indirizzo dove partirà la spesa è nascosto').toBe(false);
    expect(via).toBe('Via Calzolai 5');
    expect(mattonella.getAttribute('aria-pressed')).toBe('false');
  });

  it('il modulo con un indirizzo salvato resta chiuso e la sua mattonella è accesa (come prima)', () => {
    const { form, mattonella } = apri(modulo({ fullName: 'Luca Bianchi', address: 'Via Roma 1', phone: '3331234567' }));
    expect(form.classList.contains('hidden')).toBe(true);
    expect(mattonella.getAttribute('aria-pressed')).toBe('true');
  });

  it('senza nessun indirizzo scritto si vedono le mattonelle, non il modulo (come prima)', () => {
    const { form } = apri(modulo({}));
    expect(form.classList.contains('hidden')).toBe(true);
  });
});
