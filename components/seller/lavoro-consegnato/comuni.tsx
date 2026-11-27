import type { ReactNode } from 'react';

export const SCHEDA = 'rounded-2xl border border-cream-300 bg-white p-5 sm:p-6 shadow-warm';

/** «27 novembre 2026» da «2026-11-27T16:00:00+01:00» (si legge il giorno scritto, senza fuso del browser). */
export function aggiornatoIl(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** «lun 1 dic» da «2026-12-01». */
export function giornoCorto(giorno: string): string {
  const [a, m, g] = giorno.split('-').map(Number);
  if (!a || !m || !g) return giorno;
  return new Date(Date.UTC(a, m - 1, g, 12)).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(/\./g, '');
}

export function IntestazioneConsegnato({ aggiornato }: { aggiornato: string }) {
  return (
    <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="rounded-full bg-olive-700 px-2.5 py-0.5 text-[11px] font-bold text-white">Premium · lavoro consegnato</span>
      <span className="text-ink-600">aggiornato il {aggiornatoIl(aggiornato)}</span>
    </p>
  );
}

export function Sezione({ id, titolo, children }: { id: string; titolo: string; children: ReactNode }) {
  return (
    <section className={`mb-4 ${SCHEDA}`} aria-labelledby={id}>
      <h2 id={id} className="text-xl font-bold text-ink-900">{titolo}</h2>
      <div className="mt-2 text-sm text-ink-700">{children}</div>
    </section>
  );
}

export function Elenco({ voci }: { voci: string[] }) {
  if (voci.length === 0) return <p className="text-ink-500">Niente da segnalare.</p>;
  return <ul className="list-disc space-y-1 pl-5">{voci.map((v, i) => <li key={`${i}-${v}`}>{v}</li>)}</ul>;
}

export function LinkEsterno({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="break-words font-semibold text-primary-700 underline underline-offset-2">{children}</a>;
}
