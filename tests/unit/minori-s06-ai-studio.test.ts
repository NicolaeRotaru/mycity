/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { campiDellaModifica, lavoroRicordato, ricordaLavoro } from '@/app/seller/products/ai-batch/anteprima';

/**
 * S06 — AI Studio («Migliora tutto il catalogo»), spento al lancio ma riparato.
 * 1668: l'anteprima elenca i campi che verranno scritti, non la frase del modello.
 * 615:  il lavoro avviato si ritrova dopo aver ricaricato la pagina.
 * 1830: «traduci» non è promesso quando Traduci è spento.
 */
const pagina = readFileSync('app/seller/products/ai-batch/page.tsx', 'utf8');

describe('1668 — anteprima vera', () => {
  it('una modifica ripulita vuota è «nessuna modifica», qualunque cosa dica il riassunto', () => {
    expect(campiDellaModifica({})).toEqual([]);
    expect(campiDellaModifica({ attributes: {} })).toEqual([]);
  });
  it('si elencano i campi con il valore nuovo', () => {
    expect(campiDellaModifica({ description: 'Focaccia alta', tags: ['pane', 'olio'] })).toEqual([
      { chiave: 'description', etichetta: 'Descrizione', valore: 'Focaccia alta' },
      { chiave: 'tags', etichetta: 'Tag', valore: 'pane, olio' },
    ]);
  });
  it('la pagina non mostra più r.summary al posto dei campi', () => {
    expect(pagina).not.toContain("r.summary ?? (r.patch");
    expect(pagina).toContain('<AnteprimaDellaModifica r={r} />');
  });
});

describe('615 — il lavoro si ritrova', () => {
  it('si ricorda e si dimentica', () => {
    ricordaLavoro('job-1');
    expect(lavoroRicordato()).toBe('job-1');
    ricordaLavoro(null);
    expect(lavoroRicordato()).toBeNull();
  });
  it('la pagina lo salva all\'avvio e riparte da lì all\'apertura', () => {
    expect(pagina).toContain('ricordaLavoro(String(data.jobId))');
    expect(pagina).toMatch(/const ricordato = lavoroRicordato\(\);\s+if \(ricordato\) void poll\(ricordato\);/);
  });
});

describe('1830 — traduci', () => {
  it('la nota sotto «Crea con AI» lo nomina solo con TRADUCI_ACCESO', () => {
    expect(pagina).not.toMatch(/ottimizza per la ricerca,\s+traduci,/);
    expect(pagina).toContain("{TRADUCI_ACCESO ? ' traduci,' : ''}");
  });
});
