// La scheda Google in diretta dentro la scheda del venditore (28/11/2026).
// Il riquadro ufficiale di Google si accende solo con la chiave del browser: senza chiave la scheda resta com'era.
// La domanda a Google nasce da nome e indirizzo letti dal link, e non si salva da nessuna parte.
import { describe, expect, it } from 'vitest';
import { domandaPerGoogle } from '@/components/agenti/GoogleInDiretta';
import { schedaGoogleCollegata } from '@/components/seller/SchedaGoogleUfficiale';

describe('la domanda per Google', () => {
  it('usa nome e indirizzo', () => {
    expect(domandaPerGoogle('Pane e Caffè', 'Via Calzolai 13, Piacenza', 'Piacenza')).toBe('Pane e Caffè, Via Calzolai 13, Piacenza');
  });
  it('senza indirizzo usa la città', () => {
    expect(domandaPerGoogle('Solo Cose Belle', null, 'Piacenza')).toBe('Solo Cose Belle, Piacenza');
  });
  it('senza nome non chiede niente', () => {
    expect(domandaPerGoogle('  ', 'Via Calzolai 54', 'Piacenza')).toBeNull();
  });
});

describe('senza la chiave del browser', () => {
  it('il riquadro di Google resta spento', () => {
    expect(process.env.NEXT_PUBLIC_GOOGLE_MAPS_CHIAVE ?? '').toBe('');
    expect(schedaGoogleCollegata()).toBe(false);
  });
});
