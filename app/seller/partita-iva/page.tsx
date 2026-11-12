'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

/**
 * 12/11/2026 (R08-002) — Dove un negozio già approvato inserisce la partita IVA.
 *
 * I negozi approvati prima del 1/11 potevano non averla, e non c'era nessuna
 * pagina per metterla: /sell risponde «sei già approvato». Il cliente la legge
 * nel riquadro «Venduto da» del prodotto. Si inserisce una volta; per cambiarla
 * si scrive all'assistenza (lo dice la rotta, app/api/seller/partita-iva).
 */
export default function PartitaIvaPage() {
  const [valore, setValore] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [salvata, setSalvata] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);

  async function invia(e: FormEvent) {
    e.preventDefault();
    setErrore(null);
    setInvio(true);
    try {
      const res = await fetch('/api/seller/partita-iva', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ partitaIva: valore }),
      });
      const j = (await res.json().catch(() => ({}))) as { partitaIva?: string; error?: { message?: string } | string; message?: string };
      if (res.ok) {
        setSalvata(j.partitaIva ?? valore);
        return;
      }
      const msg = typeof j.error === 'string' ? j.error : j.error?.message ?? j.message;
      setErrore(msg ?? 'Non è stato possibile salvare la partita IVA. Riprova.');
    } catch {
      setErrore('Sembra un problema di collegamento. Riprova.');
    } finally {
      setInvio(false);
    }
  }

  return (
    <div className="container mx-auto max-w-xl px-4 py-10">
      <h1 className="font-serif text-2xl font-bold text-ink-900">Partita IVA del negozio</h1>
      <p className="mt-2 text-sm text-ink-600">
        I clienti la leggono nel riquadro «Venduto da» di ogni prodotto, insieme al nome e alla sede del negozio.
        Si inserisce una volta: per cambiarla dopo, scrivi all&apos;assistenza.
      </p>

      {salvata ? (
        <div role="status" className="mt-6 flex items-start gap-3 rounded-xl border border-olive-200 bg-olive-50 px-4 py-3 text-sm text-olive-900">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden />
          <p>
            Partita IVA salvata: <strong>{salvata}</strong>.{' '}
            <Link href="/seller/dashboard" className="underline">Torna al pannello</Link>
          </p>
        </div>
      ) : (
        <form onSubmit={invia} className="mt-6 space-y-4" noValidate>
          <Input
            label="Partita IVA"
            name="partitaIva"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            required
            maxLength={16}
            value={valore}
            onChange={(e) => setValore(e.target.value)}
            hint="11 cifre, con o senza «IT» davanti."
            error={errore ?? undefined}
          />
          <Button type="submit" loading={invio} disabled={invio || valore.trim() === ''}>
            Salva la partita IVA
          </Button>
        </form>
      )}
    </div>
  );
}
