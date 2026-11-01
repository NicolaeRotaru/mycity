/**
 * Prova del collaudo (ondata 9). — la lettura dei riferimenti pagina con OFFSET su un insieme
 * filtrato (`or(col.not.is.null)`) che puo' cambiare mentre si legge. Se un
 * profilo con id piu' basso esce dall'insieme fra una pagina e l'altra
 * (cancellazione dell'account, potatura dei respinti o dell'iscrizione a meta'
 * che azzera le sei colonne), tutte le righe dopo scalano di uno e una riga
 * viene SALTATA: i suoi documenti vivi sembrano orfani e, se hanno piu' di 7
 * giorni, vengono tolti dal secchio (che non e' nel backup).
 */
import { describe, expect, it, vi } from 'vitest';
import { potaOrfaniKyc, COLONNE_DOCUMENTI_KYC, type ClienteOrfani, type VoceSecchio } from '@/lib/privacy/orfani-kyc';

type Lettura = ReturnType<ReturnType<ClienteOrfani['from']>['select']>;
type Risp = { data: Record<string, unknown>[] | null; error: { message: string } | null };

const ADESSO = Date.parse('2026-11-01T03:00:00Z');
const vecchio = new Date(ADESSO - 60 * 86_400_000).toISOString();

describe('QA: un documento vivo non sparisce se un altro profilo esce dalla lista durante la lettura', () => {
  it('il selfie di u2 (approvato, vivo) resta nel secchio', async () => {
    const secchio = new Map<string, string>([
      ['u0/selfie-0.jpg', vecchio],
      ['u1/selfie-1.jpg', vecchio],
      ['u2/selfie-2.jpg', vecchio],
      ['u3/selfie-3.jpg', vecchio],
    ]);
    const profili: Array<Record<string, unknown>> = [0, 1, 2, 3].map((i) => ({ id: `u${i}`, kyc_selfie_url: `u${i}/selfie-${i}.jpg` }));
    let pagineLette = 0;
    const admin: ClienteOrfani = {
      from: () => ({
        select: () => {
          // Un finto PostgREST: i filtri si applicano quando si aspetta la risposta.
          // Regge sia la paginazione a scostamento (`range`) sia quella a chiave (`gt` + `limit`).
          const filtri: Array<(p: Record<string, unknown>) => boolean> = [];
          let fetta: [number, number] = [0, Infinity];
          let rilettura = false;
          const esegui = () => {
            const filtrati = profili
              .filter((p) => COLONNE_DOCUMENTI_KYC.some((c) => p[c] != null) || rilettura)
              .filter((p) => filtri.every((f) => f(p)))
              .sort((x, y) => String(x.id).localeCompare(String(y.id)));
            const pagina = filtrati.slice(fetta[0], fetta[1]);
            if (!rilettura) {
              pagineLette += 1;
              // Fra la prima e la seconda pagina u0 chiude l'account: le sue colonne si azzerano.
              if (pagineLette === 1) profili[0].kyc_selfie_url = null;
            }
            return { data: pagina, error: null };
          };
          const q = {
            or: () => q,
            order: () => q,
            gt: (c: string, v: string) => { filtri.push((p) => String(p[c]) > v); return q; },
            eq: (c: string, v: string) => { rilettura = true; filtri.push((p) => p[c] === v); return q; },
            limit: (n: number) => { fetta = [0, n]; return q; },
            range: async (da: number, a: number) => { fetta = [da, a + 1]; return esegui(); },
            then: (ok?: ((v: Risp) => unknown) | null, ko?: ((e: unknown) => unknown) | null) => Promise.resolve(esegui()).then(ok, ko),
          };
          return q as unknown as Lettura;
        },
      }),
      storage: {
        from: () => ({
          list: async (prefisso: string, { limit, offset }: { limit: number; offset: number }) => {
            const voci = new Map<string, VoceSecchio>();
            for (const [p, d] of secchio) {
              const resto = prefisso === '' ? p : p.startsWith(`${prefisso}/`) ? p.slice(prefisso.length + 1) : null;
              if (resto === null) continue;
              const [testa, ...coda] = resto.split('/');
              voci.set(testa, coda.length ? { name: testa, id: null } : { name: testa, id: `id-${p}`, created_at: d, updated_at: d });
            }
            return { data: [...voci.values()].sort((x, y) => x.name.localeCompare(y.name)).slice(offset, offset + limit), error: null };
          },
          remove: async (percorsi: string[]) => { for (const p of percorsi) secchio.delete(p); return { error: null }; },
        }),
      },
    };
    await potaOrfaniKyc(admin, { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, ADESSO, { pagina: 2 });
    expect(secchio.has('u2/selfie-2.jpg'), 'il documento VIVO di u2 e stato cancellato').toBe(true);
  });
});
