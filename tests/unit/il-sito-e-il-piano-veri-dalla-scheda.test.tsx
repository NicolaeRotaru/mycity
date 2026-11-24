import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { bozzaSito, pianoEditoriale } from '@/lib/agenzia/contenuti-servizi';
import { SchedaInArrivo, soloConfermati, type SchedaCliente } from '@/lib/agenzia/scheda-cliente';
import AnteprimaServizio from '@/components/seller/AnteprimaServizio';

/**
 * 24/11/2026 — IL SITO E IL PIANO EDITORIALE VERI DENTRO I SERVIZI (Lavoro 3).
 *
 * Con la scheda di n8n la bozza del sito e il piano dei 12 post diventano quelli di quel locale:
 * indirizzo, orari, telefono, sito, prodotti tipici, idee per i post. Dove un dato manca resta il
 * testo generico di prima. Solo frasi vere: un dato non confermato è segnato «da confermare», e
 * gli orari entrano nei post (che sono pubblici) solo se confermati. Mai prezzi.
 */

const scheda = (campi: SchedaCliente['campi'], analisi?: SchedaCliente['analisi']): SchedaCliente =>
  SchedaInArrivo.parse({ tipo: 'scheda-cliente', id_attivita: '0de1905e-7000-4000-8000-000000000001', campi, analisi });

const PIENA = scheda(
  {
    indirizzo: { valore: 'Via Roma 10, Piacenza', stato: 'confermato', fonte: 'https://example.org' },
    orari: { valore: 'Lun–Sab 7:00–19:30', stato: 'da_confermare', fonte: 'https://example.org' },
    telefono: { valore: '0523 123456', stato: 'confermato', fonte: 'https://example.org' },
    sito_ufficiale: { valore: 'https://www.oradelgusto.example/', stato: 'confermato', fonte: 'https://example.org' },
    menu_testo: { valore: 'Brioche alla crema\nCappuccino 1,50 €\nTorta di mele\nCannoli siciliani', stato: 'confermato', fonte: null },
  },
  { punti_di_forza: ['le brioche fatte in casa', 'il dehors in piazza'], idee_contenuti: ['La brioche appena sfornata alle 7', 'Il dehors al tramonto'] },
);

describe('la bozza del sito', () => {
  it('senza scheda è uguale a prima', () => {
    expect(bozzaSito('Ora del Gusto', 'bar', null)).toEqual(bozzaSito('Ora del Gusto', 'bar'));
    const b = bozzaSito('Ora del Gusto', 'bar');
    expect(b.indirizzo).toBe('oradelgusto.it');
    expect(b.sezioni.every((s) => !s.dalLocale)).toBe(true);
  });

  it('con la scheda usa i dati veri del locale', () => {
    const b = bozzaSito('Ora del Gusto', 'bar', PIENA);
    expect(b.indirizzo).toBe('oradelgusto.example');
    expect(b.indirizzoEsistente).toBe(true);
    const testo = b.sezioni.map((s) => s.testo).join(' ');
    expect(testo).toContain('Via Roma 10, Piacenza');
    expect(testo).toContain('Lun–Sab 7:00–19:30');
    expect(testo).toContain('0523 123456');
    expect(testo).toContain('Brioche alla crema');
    expect(testo).toContain('le brioche fatte in casa');
    expect(testo).not.toMatch(/€|1,50/);
  });

  it('segna «da confermare» le sezioni con un dato non confermato, e non le altre', () => {
    const b = bozzaSito('Ora del Gusto', 'bar', PIENA);
    const sezione = (t: string) => b.sezioni.find((s) => s.titolo === t)!;
    expect(sezione('Dove siamo e orari').daConfermare).toBe(true);
    expect(sezione('Contatti').daConfermare).toBe(false);
    expect(sezione('Cosa offriamo').daConfermare).toBe(false);
    expect(sezione('Chi siamo').daConfermare).toBe(true);
  });

  it('un dato che manca lascia il testo generico di quella sezione', () => {
    const b = bozzaSito('Ora del Gusto', 'bar', scheda({ indirizzo: { valore: 'Via Roma 10', stato: 'confermato', fonte: null } }));
    expect(b.sezioni.find((s) => s.titolo === 'Contatti')?.dalLocale).toBeFalsy();
    expect(b.sezioni.find((s) => s.titolo === 'Cosa offriamo')?.dalLocale).toBeFalsy();
    expect(b.sezioni.find((s) => s.titolo === 'Dove siamo e orari')?.dalLocale).toBe(true);
  });
});

describe('il piano dei 12 post', () => {
  it('senza scheda è uguale a prima', () => {
    expect(pianoEditoriale('Ora del Gusto', 'bar', '2026-12-01', null)).toEqual(pianoEditoriale('Ora del Gusto', 'bar', '2026-12-01'));
  });

  it('con la scheda parla dei suoi prodotti e delle idee trovate, sempre 12 post tutti diversi', () => {
    const piano = pianoEditoriale('Ora del Gusto', 'bar', '2026-12-01', PIENA);
    expect(piano.post).toHaveLength(12);
    expect(new Set(piano.post.map((p) => p.esempio)).size).toBe(12);
    const tutto = piano.post.map((p) => `${p.tema} ${p.esempio}`).join(' ');
    expect(tutto).toContain('Brioche alla crema');
    expect(tutto).toContain('La brioche appena sfornata alle 7');
    expect(tutto).not.toMatch(/€|1,50/);
    expect(piano.post.filter((p) => p.dalLocale).length).toBeGreaterThanOrEqual(4);
  });

  it('gli orari da confermare non finiscono in un post; quelli confermati sì', () => {
    const daConfermare = pianoEditoriale('Ora del Gusto', 'bar', '2026-12-01', PIENA);
    expect(daConfermare.post.map((p) => p.esempio).join(' ')).not.toContain('7:00–19:30');
    const confermati = scheda({ orari: { valore: 'Lun–Sab 7:00–19:30', stato: 'confermato', fonte: null } });
    expect(pianoEditoriale('Ora del Gusto', 'bar', '2026-12-01', confermati).post.map((p) => p.esempio).join(' ')).toContain('7:00–19:30');
  });
});

describe('mai prezzi, mai frasi non vere (collaudo del 24/11)', () => {
  const SPORCA = scheda(
    {
      menu_testo: { valore: 'Cornetto 1,5\nBrioche 2\nCaffè 1.20\nTorta di mele', stato: 'da_confermare', fonte: null },
      sito_ufficiale: { valore: 'https://oradelgusto-falso.example', stato: 'proposta', fonte: null },
    },
    { idee_contenuti: ['Colazione completa a soli 3,50€', 'Aperitivo 8 euro', 'Il dehors al tramonto'], punti_di_forza: ['Cornetti a 1 euro', 'il dehors in piazza'] },
  );

  it('nessun prezzo nel sito o nei post, in nessuna forma', () => {
    const b = bozzaSito('Ora del Gusto', 'bar', SPORCA);
    const piano = pianoEditoriale('Ora del Gusto', 'bar', '2026-12-01', SPORCA);
    const tutto = [...b.sezioni.map((x) => x.testo), ...piano.post.map((p) => `${p.tema} ${p.esempio}`)].join(' | ');
    expect(tutto).not.toMatch(/3,50|8 euro|1 euro|Cornetto 1,5|Brioche 2|1\.20|€/);
    expect(tutto).toContain('Torta di mele');
    expect(tutto).toContain('Il dehors al tramonto');
    expect(tutto).toContain('il dehors in piazza');
  });

  it('gli orari con un prezzo dentro non entrano né nel sito né nei post', () => {
    const s = scheda({ orari: { valore: 'Lun-Ven 7-20, aperitivo 5€', stato: 'confermato', fonte: null } });
    const tutto = [...bozzaSito('Bar X', 'bar', s).sezioni.map((x) => x.testo), ...pianoEditoriale('Bar X', 'bar', '2026-12-01', s).post.map((p) => p.esempio)].join(' ');
    expect(tutto).not.toContain('5€');
  });

  it('un menu non confermato non entra nei post (che sono pubblici)', () => {
    const piano = pianoEditoriale('Ora del Gusto', 'bar', '2026-12-01', SPORCA);
    expect(piano.post.map((p) => p.esempio).join(' ')).not.toContain('Torta di mele');
  });

  it('un sito solo proposto non diventa «il sito che hai già»', () => {
    const b = bozzaSito('Ora del Gusto', 'bar', SPORCA);
    expect(b.indirizzoEsistente).toBe(false);
    expect(b.indirizzo).toBe('oradelgusto.it');
  });

  it('per il link col codice restano solo i campi confermati, senza l analisi', () => {
    const s = soloConfermati(PIENA)!;
    expect(Object.keys(s.campi).sort()).toEqual(['indirizzo', 'menu_testo', 'sito_ufficiale', 'telefono']);
    expect(s.analisi).toBeUndefined();
    const b = bozzaSito('Ora del Gusto', 'bar', s);
    expect(b.sezioni.map((x) => x.testo).join(' ')).not.toContain('7:00–19:30');
    expect(b.sezioni.some((x) => x.daConfermare)).toBe(false);
  });
});

describe('l anteprima nella pagina', () => {
  it('mostra la bozza col dato vero e il segno «da confermare»', () => {
    const html = renderToStaticMarkup(<AnteprimaServizio id="sito_web" nome="Ora del Gusto" tipo="bar" giorno="2026-12-01" scheda={PIENA} />);
    expect(html).toContain('Via Roma 10, Piacenza');
    expect(html).toContain('da confermare');
    expect(html).toContain('è l’indirizzo del sito che hai già');
  });
});
