import { describe, it, expect } from 'vitest';
import { firmaDisiscrizione, verificaDisiscrizione, linkDisiscrizione } from '@/lib/email/unsubscribe';

/**
 * Le email di marketing devono portare un modo per smettere, con un clic e
 * senza accedere.
 *
 * Prima il footer diceva soltanto «Gestisci preferenze» e puntava a una pagina
 * che chiede il login: chi riceve una email e vuole smettere non ha un account
 * a portata di mano, e comunque non è tenuto ad accedere per esercitare
 * un'opposizione. Il commento in cima ai template dichiarava «Tutti i template
 * includono il link di unsubscribe»: non era vero.
 */

describe('il link per smettere di ricevere email', () => {
  it('riconosce il proprio token', () => {
    const t = firmaDisiscrizione('maria@example.it', 'marketing');
    expect(verificaDisiscrizione(t)).toEqual({ email: 'maria@example.it', ambito: 'marketing' });
  });

  it('normalizza maiuscole e spazi', () => {
    const t = firmaDisiscrizione('  Maria@Example.IT ', 'newsletter');
    expect(verificaDisiscrizione(t)?.email).toBe('maria@example.it');
  });

  it('rifiuta un token con la firma manomessa', () => {
    const t = firmaDisiscrizione('maria@example.it', 'marketing');
    const manomesso = `${t.slice(0, -3)}xyz`;
    expect(verificaDisiscrizione(manomesso)).toBeNull();
  });

  it('non si può cambiare indirizzo tenendo la firma di un altro', () => {
    // Chi ha il proprio link non deve poter disiscrivere l'indirizzo di un altro.
    const mio = firmaDisiscrizione('maria@example.it', 'marketing');
    const firma = mio.slice(mio.lastIndexOf('.') + 1);
    const altroCorpo = Buffer.from('vittima@example.it:marketing').toString('base64url');
    expect(verificaDisiscrizione(`${altroCorpo}.${firma}`)).toBeNull();
  });

  it('rifiuta un ambito inventato', () => {
    const corpo = Buffer.from('maria@example.it:tutto').toString('base64url');
    expect(verificaDisiscrizione(`${corpo}.qualcosa`)).toBeNull();
  });

  it('rifiuta spazzatura', () => {
    expect(verificaDisiscrizione('')).toBeNull();
    expect(verificaDisiscrizione('senzapunto')).toBeNull();
    expect(verificaDisiscrizione('.soloPunto')).toBeNull();
  });

  it('il link è chiamabile senza login e porta il token', () => {
    const link = linkDisiscrizione('maria@example.it', 'newsletter');
    expect(link).toContain('/api/unsubscribe?token=');
    const token = decodeURIComponent(link.split('token=')[1]);
    expect(verificaDisiscrizione(token)?.ambito).toBe('newsletter');
  });
});
