'use client';

import { useState } from 'react';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/** Un controllo semplice, lo stesso che il server fa con zod: qualcosa@dominio.estensione. */
const FORMA_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * «Segnala»: il modo per dirci che un contenuto è illecito.
 *
 * 22/8/2026 — NON C'ERA. Sul sito non esisteva nessun canale per segnalare un
 * prodotto contraffatto, pericoloso o illecito. Il regolamento europeo sui
 * servizi digitali lo chiede a ogni piattaforma che ospita contenuti di terzi,
 * e per un marketplace è anche la difesa più economica che esista: chi vede una
 * cosa sbagliata ce la dice prima che la compri qualcun altro.
 *
 * Si può segnalare senza account. Chi lascia un recapito ha diritto a un esito
 * motivato: è l'altra metà dell'obbligo, e la parte che si dimentica sempre.
 *
 * 1/11/2026 — QUI SI PROMETTEVA UN ESITO CHE NON PARTIVA. Il modulo diceva «ti
 * diciamo com'è andata», ma nessun codice mandava l'esito. Il mittente adesso
 * esiste (PATCH /api/segnalazioni), però la pagina admin non lo chiama ancora:
 * finché non lo fa, qui non si promette niente che non succede.
 */
const MOTIVI: Array<{ valore: string; etichetta: string }> = [
  { valore: 'contraffatto', etichetta: 'Prodotto contraffatto' },
  { valore: 'pericoloso', etichetta: 'Prodotto pericoloso o non conforme' },
  { valore: 'ingannevole', etichetta: 'Descrizione o prezzo ingannevoli' },
  { valore: 'proprieta_intellettuale', etichetta: 'Uso non autorizzato di un marchio o di foto' },
  { valore: 'odio_o_molestie', etichetta: 'Contenuto offensivo o molesto' },
  { valore: 'illecito', etichetta: 'Altro contenuto illecito' },
  { valore: 'altro', etichetta: 'Altro' },
];

export function Segnala({
  tipo,
  oggettoId,
}: {
  tipo: 'prodotto' | 'negozio' | 'recensione' | 'messaggio';
  oggettoId: string;
}) {
  const [aperto, setAperto] = useState(false);
  const [motivo, setMotivo] = useState(MOTIVI[0].valore);
  const [dettaglio, setDettaglio] = useState('');
  const [email, setEmail] = useState('');
  const [inCorso, setInCorso] = useState(false);
  const [erroreEmail, setErroreEmail] = useState<string | null>(null);

  const invia = async () => {
    // 5/11/2026 (S05) — L'email scritta male si dice sotto il campo, prima di
    // mandare: prima il server rispondeva 400 e a video usciva solo «riprova».
    const mail = email.trim();
    if (mail && !FORMA_EMAIL.test(mail)) {
      setErroreEmail('Questa email non sembra completa: controllala, oppure lascia il campo vuoto.');
      return;
    }
    setErroreEmail(null);
    setInCorso(true);
    try {
      const res = await fetch('/api/segnalazioni', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo,
          oggettoId,
          motivo,
          dettaglio: dettaglio.trim() || undefined,
          emailContatto: email.trim() || undefined,
        }),
      });
      if (!res.ok) {
        // Il motivo del server, quando c'è: troppe segnalazioni, dati non validi,
        // contenuto che non esiste più. «Riprova» resta per il guasto vero.
        if (res.status === 429) {
          toast.error('Hai inviato molte segnalazioni in poco tempo: riprova fra un po’.');
          return;
        }
        const corpo = (await res.json().catch(() => null)) as { error?: { message?: string } | string } | null;
        const msg = typeof corpo?.error === 'object' ? corpo?.error?.message : corpo?.error;
        if (res.status === 400 || res.status === 404) {
          toast.error(msg || 'Controlla i dati della segnalazione.');
          return;
        }
        throw new Error('Segnalazione non inviata');
      }
      toast.success('Segnalazione ricevuta: la esaminiamo.');
      setAperto(false);
      setDettaglio('');
    } catch {
      toast.error('Non è stato possibile inviare la segnalazione. Riprova.');
    } finally {
      setInCorso(false);
    }
  };

  // 5/11/2026 (S05) — Il pulsante resta sempre montato (prima il dialogo lo
  // sostituiva e il fuoco cadeva sul corpo della pagina), e il modulo vive nel
  // Modal del sito: trappola del Tab, Esc per chiudere, fuoco che torna qui.
  return (
    <>
      <button
        type="button"
        onClick={() => setAperto(true)}
        aria-haspopup="dialog"
        aria-expanded={aperto}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
      >
        <Flag size={14} strokeWidth={2.2} aria-hidden /> Segnala questo contenuto
      </button>
      <Modal
        open={aperto}
        onClose={() => { if (!inCorso) setAperto(false); }}
        title="Segnala un contenuto"
        description="Dicci che cosa non va. Guardiamo ogni segnalazione e la chiudiamo con una decisione motivata."
        footer={
          <div className="flex w-full gap-2.5">
            <Button variant="secondary" fullWidth onClick={() => setAperto(false)} disabled={inCorso}>
              Annulla
            </Button>
            <Button fullWidth onClick={invia} disabled={inCorso}>
              {inCorso ? 'Invio…' : 'Invia segnalazione'}
            </Button>
          </div>
        }
      >
        <label htmlFor="segnala-motivo" className="block text-sm font-medium text-ink-700">Motivo</label>
        <select
          id="segnala-motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className="mt-1 w-full rounded-lg border border-cream-300 px-3 py-2 text-sm"
        >
          {MOTIVI.map((m) => (
            <option key={m.valore} value={m.valore}>{m.etichetta}</option>
          ))}
        </select>

        <label htmlFor="segnala-dettaglio" className="mt-3 block text-sm font-medium text-ink-700">
          Cosa hai visto (facoltativo)
        </label>
        <textarea
          id="segnala-dettaglio"
          value={dettaglio}
          onChange={(e) => setDettaglio(e.target.value)}
          rows={3}
          maxLength={2000}
          className="mt-1 w-full rounded-lg border border-cream-300 px-3 py-2 text-sm"
        />

        <label htmlFor="segnala-email" className="mt-3 block text-sm font-medium text-ink-700">
          La tua email, se vuoi essere ricontattato (facoltativa)
        </label>
        <input
          id="segnala-email"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setErroreEmail(null); }}
          aria-invalid={erroreEmail ? true : undefined}
          aria-describedby={erroreEmail ? 'segnala-email-errore' : undefined}
          className="mt-1 w-full rounded-lg border border-cream-300 px-3 py-2 text-sm"
        />
        {erroreEmail && (
          <p id="segnala-email-errore" role="alert" className="mt-1 text-xs font-semibold text-secondary-700">{erroreEmail}</p>
        )}
      </Modal>
    </>
  );
}
