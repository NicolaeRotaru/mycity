import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// R09-016 — Fra 768 e 1023 px la testata del computer metteva in fila logo, «Consegna a Piacenza
// 29121», ricerca, carrello, «Accedi» e «Registrati»: al campo di ricerca restavano 152 px.
// Prova leggera sulle classi: sotto lg la pillola mostra solo il CAP, le voci diventano icone e il
// campo può allargarsi.
const navbar = readFileSync('components/Navbar.tsx', 'utf8');
const pillola = readFileSync('components/LocationPill.tsx', 'utf8');

describe('R09-016 · su tablet la ricerca della testata ha spazio', () => {
  it('la pillola dell’indirizzo mostra città e «Consegna a» solo da lg in su', () => {
    expect(pillola).toContain('<span className="hidden lg:inline">Consegna a</span>');
    expect(pillola).toContain('<span className="hidden lg:inline font-semibold">{loc.city}</span>');
  });

  it('«Registrati», «Ordini», «Consegne» e «Admin» sotto lg sono icone col nome per i lettori di schermo', () => {
    for (const parola of ['Registrati', 'Ordini', 'Consegne', 'Admin']) {
      expect(navbar).toContain(`<span className="sr-only lg:not-sr-only">${parola}</span>`);
    }
  });

  it('il campo di ricerca può allargarsi e stringersi (min-w-0 flex-1)', () => {
    expect(navbar).toMatch(/<div className="min-w-0 flex-1 max-w-2xl">\s*<SearchBar \/>/);
    expect(navbar).toContain('className="flex items-center gap-3 lg:gap-4"');
  });

  it('la pillola ha un nome completo anche quando mostra solo il CAP, e «Registrati» icona è alto 44', () => {
    expect(pillola).toContain('aria-label={`Consegna a ${loc.city} ${loc.zip}: cambia indirizzo`}');
    expect(navbar).toMatch(/<Link href="\/sign-up" title="Registrati" className="inline-flex min-h-11 min-w-11 /);
  });
});
