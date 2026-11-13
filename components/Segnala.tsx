'use client';

import { useRef, useState } from 'react';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import Turnstile, { type ManopolaAntiBot } from '@/components/Turnstile';

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

/** 12/11/2026 (R02-005) — Una recensione non è un prodotto: «contraffatto» non vuol dire niente. */
const MOTIVI_RECENSIONE: Array<{ valore: string; etichetta: string }> = [
  { valore: 'ingannevole', etichetta: 'Recensione non genuina o ingannevole' },
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
  const motivi = tipo === 'recensione' ? MOTIVI_RECENSIONE : MOTIVI;
  const [motivo, setMotivo] = useState(motivi[0].valore);
  const [dettaglio, setDettaglio] = useState('');
  const [email, setEmail] = useState('');
  // 13/11/2026 (R21-014) — Nome e dichiarazione di buona fede (regolamento sui servizi digitali,
  // art. 16.2 lettere c e d): si possono dare, non si pretendono.
  const [nome, setNome] = useState('');
  const [buonaFede, setBuonaFede] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const [erroreEmail, setErroreEmail] = useState<string | null>(null);
  // 13/11/2026 (R21-008, correzione) — La conferma per email parte solo con il controllo anti-robot
  // superato, come nei contatti e nella newsletter: il riquadro compare quando c'è un'email.
  const chiaveAntiRobot = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
  const [gettone, setGettone] = useState('');
  const [antiRobotNonDisponibile, setAntiRobotNonDisponibile] = useState<string | null>(null);
  const antiRobot = useRef<ManopolaAntiBot>(null);
  // Se la conferma per email non parte, il numero della segnalazione resta scritto nel modulo
  // finché chi ha segnalato non lo chiude: un avviso che sparisce da solo non basta.
  const [numeroSenzaConferma, setNumeroSenzaConferma] = useState<string | null>(null);

  const chiudi = () => {
    if (inCorso) return;
    setAperto(false);
    setNumeroSenzaConferma(null);
  };

  const invia = async () => {
    // 5/11/2026 (S05) — L'email scritta male si dice sotto il campo, prima di
    // mandare: prima il server rispondeva 400 e a video usciva solo «riprova».
    const mail = email.trim();
    if (mail && !FORMA_EMAIL.test(mail)) {
      setErroreEmail('Questa email non sembra completa: controllala, oppure lascia il campo vuoto.');
      return;
    }
    setErroreEmail(null);
    if (mail && chiaveAntiRobot && !gettone && !antiRobotNonDisponibile) {
      toast.error('Completa il controllo anti-robot: serve per mandarti la conferma per email.');
      return;
    }
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
          nomeSegnalante: nome.trim() || undefined,
          buonaFede: buonaFede || undefined,
          captchaToken: (mail && gettone) || undefined,
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
      // 13/11/2026 (R21-008) — Chi ha lasciato l'email sa se la conferma è partita; se non è
      // partita, il numero della segnalazione glielo diamo qui.
      const ricevuta = (await res.json().catch(() => null)) as { id?: string; conferma?: string } | null;
      const senzaConferma = ricevuta?.conferma === 'fallita' || ricevuta?.conferma === 'non_inviata';
      const conferma =
        ricevuta?.conferma === 'inviata'
          ? ' Ti abbiamo mandato una conferma per email.'
          : senzaConferma
            ? ` La conferma per email non è partita: il numero della segnalazione è ${ricevuta?.id ?? ''}.`
            : '';
      toast.success(`Segnalazione ricevuta: la esaminiamo.${conferma}`);
      setDettaglio('');
      setBuonaFede(false);
      if (senzaConferma && ricevuta?.id) setNumeroSenzaConferma(ricevuta.id);
      else setAperto(false);
    } catch {
      toast.error('Non è stato possibile inviare la segnalazione. Riprova.');
    } finally {
      setInCorso(false);
      // Il gettone vale una volta sola: per un altro invio ne serve uno nuovo.
      setGettone('');
      antiRobot.current?.reset();
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
        onClose={chiudi}
        title="Segnala un contenuto"
        description="Dicci che cosa non va. Guardiamo ogni segnalazione e la chiudiamo con una decisione motivata."
        footer={
          numeroSenzaConferma ? (
            <Button fullWidth onClick={chiudi}>Chiudi</Button>
          ) : (
            <div className="flex w-full gap-2.5">
              <Button variant="secondary" fullWidth onClick={chiudi} disabled={inCorso}>
                Annulla
              </Button>
              <Button fullWidth onClick={invia} disabled={inCorso}>
                {inCorso ? 'Invio…' : 'Invia segnalazione'}
              </Button>
            </div>
          )
        }
      >
        {numeroSenzaConferma ? (
          <div role="status" className="rounded-lg border border-cream-300 bg-cream-50 p-4 text-sm text-ink-700">
            <p className="font-semibold text-ink-900">Segnalazione ricevuta: la esaminiamo.</p>
            <p className="mt-2">La conferma per email non è partita. Il numero della segnalazione è:</p>
            <p className="mt-1 select-all break-all font-mono text-ink-900">{numeroSenzaConferma}</p>
            <p className="mt-2">Annotalo: ti serve se ci scrivi per questa segnalazione.</p>
          </div>
        ) : (
          <>
            <label htmlFor="segnala-motivo" className="block text-sm font-medium text-ink-700">Motivo</label>
            <select
              id="segnala-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-cream-300 px-3 py-2 text-sm"
            >
              {motivi.map((m) => (
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

            <label htmlFor="segnala-nome" className="mt-3 block text-sm font-medium text-ink-700">
              Il tuo nome, o quello dell&apos;organizzazione per cui segnali (facoltativo)
            </label>
            <input
              id="segnala-nome"
              type="text"
              autoComplete="name"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={120}
              className="mt-1 w-full rounded-lg border border-cream-300 px-3 py-2 text-sm"
            />

            <label htmlFor="segnala-buona-fede" className="mt-3 flex items-start gap-2 text-sm text-ink-700">
              <input
                id="segnala-buona-fede"
                type="checkbox"
                checked={buonaFede}
                onChange={(e) => setBuonaFede(e.target.checked)}
                className="mt-0.5"
              />
              <span>Dichiaro in buona fede che le informazioni e le accuse di questa segnalazione sono esatte e complete (facoltativo).</span>
            </label>

            {chiaveAntiRobot && email.trim().length > 0 && (
              <div className="mt-3">
                <Turnstile
                  ref={antiRobot}
                  siteKey={chiaveAntiRobot}
                  onVerify={(t) => { setGettone(t); setAntiRobotNonDisponibile(null); }}
                  onExpire={() => setGettone('')}
                  onError={(motivo) => setAntiRobotNonDisponibile(motivo)}
                />
                {antiRobotNonDisponibile && (
                  <p className="mt-1 text-xs text-ink-500">
                    {antiRobotNonDisponibile} Puoi inviare lo stesso: la segnalazione arriva, ma senza la conferma per email.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
