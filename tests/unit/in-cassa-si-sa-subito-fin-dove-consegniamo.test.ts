/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { RAGGIO_CONSEGNA_KM } from '@/lib/constants';

/**
 * 6/9/2026 — SI SCOPRIVA ALL'ULTIMO CLIC CHE NON CONSEGNIAMO LÌ.
 *
 * Il modulo dell'indirizzo non diceva da nessuna parte fin dove arriviamo. Chi
 * abita a Cremona o a Milano compilava nome, via, CAP, telefono, sceglieva come
 * pagare — e solo alla fine, adesso che le due rotte controllano la zona, si
 * sente dire di no. Il rifiuto giusto arrivato nel momento più caro.
 *
 * Qui la riga sotto il CAP lo dice prima, e prende il numero da dove è deciso
 * (`RAGGIO_CONSEGNA_KM`): se domani la zona cambia, la frase cambia da sé e non
 * può promettere una cosa mentre la cassa ne fa un'altra.
 *
 * ⚪ Questa è metà della cura. L'avviso VERO — «il tuo CAP è fuori zona»,
 * mentre lo scrivi — vuole le coordinate del negozio, che arrivano dalla pagina
 * del checkout: quel file non è di questa squadra.
 */

type Modulo = { ShippingAddressForm: (p: unknown) => unknown };

const props = {
  form: { fullName: '', address: '', city: 'Piacenza', zip: '29121', phone: '', notes: '' },
  savedAddresses: [],
  errors: {},
  onChange: () => {},
  onSubmit: (e: { preventDefault?: () => void }) => e.preventDefault?.(),
  onApplySavedAddress: () => {},
};

describe('il modulo dell indirizzo in cassa', () => {
  it('dice fin dove consegniamo mentre si scrive il CAP, non alla fine', async () => {
    const mod = (await monta('components/checkout/ShippingAddressForm.tsx')) as unknown as Modulo;
    const schermo = accendi(mod.ShippingAddressForm as never, props as never);

    const testo = testoVisibile(schermo.radice);
    expect(
      testo,
      'chi abita fuori zona non lo scopre dal modulo: lo scoprirà al clic finale, dopo aver compilato tutto',
    ).toContain('Piacenza e dintorni');
    expect(
      testo,
      `la distanza non viene dal posto dove è decisa (${RAGGIO_CONSEGNA_KM} km): due frasi che possono divergere`,
    ).toContain(`${RAGGIO_CONSEGNA_KM} km`);

    schermo.smonta();
  }, 60000);
});
