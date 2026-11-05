import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** S03 — la pagina delle notifiche (schede 426, 430). Prova leggera: lettura del sorgente. */
const src = readFileSync('app/notifications/page.tsx', 'utf8');

describe('pagina notifiche', () => {
  it('426 — l errore di rete di getUser non manda all accesso, e «segna tutte» legge l esito', () => {
    expect(src).toMatch(/const \{ data: \{ user \}, error: errUtente \} = await supabase\.auth\.getUser\(\);/);
    expect(src).toMatch(/if \(!user && errUtente && !sessioneMancante\(errUtente\)\) throw errUtente;/);
    expect(src).toMatch(/const \{ error: errAggiorna \} = await supabase\s*\.from\('notifications'\)\s*\.update\(\{ is_read: true \}\)/);
    expect(src).toMatch(/if \(errAggiorna\) throw errAggiorna;/);
    expect(src).toMatch(/onError: \(e\) => toast\.error\(friendlyError\(e\)\)/);
  });

  it('430 — aprire una notifica non letta la segna letta', () => {
    expect(src).toMatch(/<Link href=\{n\.link\} className="block" onClick=\{\(\) => \{ if \(!n\.is_read\) segnaLetta\(n\.id\); \}\}>/);
    expect(src).toMatch(/\.update\(\{ is_read: true \}\)\s*\.eq\('id', id\)/);
  });
});
