import { describe, it, expect } from 'vitest';
import { veloceNonConfermataTemplate } from '@/lib/email/templates';
import { fraseDelFreno } from '@/lib/ordini/veloce-non-confermata';

const frase = (nonSpostati?: string[]) =>
  fraseDelFreno({ fascia: '15:00-17:00', euro: 'tolto-contanti', totaleCents: 1000, nonSpostati });

describe('R21-013: titolo e oggetto dell’email della veloce dicono l’eccezione della campanella', () => {
  it('tutta la spesa spostata: come prima', () => {
    const t = veloceNonConfermataTemplate({ orderId: 'o1', frase: frase() });
    expect(t.subject).toBe('La consegna veloce non è partita: la tua spesa arriva in una fascia oraria');
    expect(t.html).toContain('>La tua spesa arriva in una fascia oraria</h1>');
  });
  it('un ordine non spostato: oggetto e titolo dicono «tranne un ordine»', () => {
    const t = veloceNonConfermataTemplate({ orderId: 'o1', frase: frase(['A12']) });
    expect(t.subject).toContain('tranne un ordine');
    expect(t.html).toContain('>La tua spesa arriva in una fascia oraria, tranne un ordine</h1>');
  });
  it('più ordini non spostati: «tranne alcuni ordini»', () => {
    const t = veloceNonConfermataTemplate({ orderId: 'o1', frase: frase(['A12', 'B34']) });
    expect(t.subject).toContain('tranne alcuni ordini');
    expect(t.html).toContain('tranne alcuni ordini</h1>');
  });
});
