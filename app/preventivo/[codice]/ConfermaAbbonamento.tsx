'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import type { Abbonamento } from '@/lib/agenzia/preventivo';
import { ETICHETTE_SERVIZI, SERVIZI_AGENZIA, SPIEGAZIONE_AL_TITOLARE, type ServizioAgenzia } from '@/lib/agenzia/servizi-scelti';
import { FRASE_CONTANTI, PAGAMENTO_ONLINE_SERVIZI } from '@/lib/agenzia/pagamento-servizi';
import { DURATA_VISITA, GIORNO_NON_PIU_VALIDO, ORA_GIA_PRESA, type GiornoVisita } from '@/lib/agenzia/visita-sdg';
import { PasswordInput } from '@/components/ui/Field';
import { byteDellaPassword, eFraseDellaPassword, PASSWORD_MASSIMA, PASSWORD_MINIMA, PASSWORD_TROPPO_LUNGA } from '@/lib/agenzia/password-dal-link';

/**
 * LE TRE FASCE, IL CODICE DELL'EMAIL E L'INGRESSO — 27/11/2026 (app/preventivo/[codice]/page.tsx).
 *
 * Nicola: il titolare vede i tre abbonamenti, trova segnato quello detto al venditore, può toccarne un
 * altro e confermare quello; dopo il clic entra nella sua pagina con l'abbonamento scelto. Sul rischio
 * trovato dal collaudo della sicurezza ha scelto «codice dall'email». Quindi due passi nella stessa pagina:
 *  1. fascia, email, condizioni → «Confermo il …»: parte il codice (app/api/preventivo/[codice]/codice);
 *  2. il titolare scrive il codice → «Entra nella mia pagina»: il server lo verifica, accetta e apre la
 *     sessione (…/accetta), e risponde con `entra`, la pagina dell'abbonamento del negozio. Fino a lì
 *     niente cambia sul negozio (secondo collaudo della sicurezza, 27/11).
 * Senza `entra` (un altro account già dentro in questo browser) entra dal link dell'email, come prima.
 *
 * 28/11/2026 verso le 13:30 — Nicola, iscrivendo un bar dal telefono: il pulsante dell'email vale una volta sola,
 * poi «Accedi» chiede email e password, e il titolare una password non l'aveva mai scelta. Ora la sceglie qui,
 * sotto l'email (almeno 8 caratteri, come la registrazione), e parte solo col codice giusto (passo 2).
 * Il testo delle fasce lo prepara il server (`fasce`).
 *
 * 27/11/2026 verso le 17:40 — Nicola: nello stesso passo il titolare sceglie giorno e ora in cui il team creativo
 * di SDG passa da lui (piano editoriale, foto e video), e la pagina gli dice cosa succede dopo la conferma, con
 * parole sue. I giorni li prepara il server (`giorni`, lib/agenzia/visita-sdg.ts) senza le ore già prese; la
 * scelta va al server con la conferma (`visita`). Se non c'è nessun giorno libero si conferma lo stesso e lo
 * chiamiamo noi. Se il server risponde che l'ora l'ha appena presa un altro, o che quel giorno non vale più (pagina
 * rimasta aperta oltre la mezzanotte), si torna alla scelta e quell'ora (o quel giorno) si barra (collaudo del 27/11).
 */

/** «Lunedì 30 novembre alle 10:00», dall'orario scelto. */
function scriviScelta(giorni: GiornoVisita[], id: string | null): string | null {
  for (const g of giorni) {
    const o = g.orari.find((x) => x.id === id);
    if (o) return `${g.lungo.charAt(0).toUpperCase()}${g.lungo.slice(1)} alle ${o.ora}`;
  }
  return null;
}

export type FasciaDaConfermare = {
  id: Abbonamento;
  nome: string;
  canone: string;
  primoMese: string | null;
  perChi: string;
  servizi: { titolo: string; testo: string }[];
};

type Risposta = {
  ok?: boolean;
  data?: { url?: string | null; entra?: string | null; accessoInviato?: boolean; gettone?: string };
  error?: { message?: string };
};

export default function ConfermaAbbonamento({
  codice,
  fasce,
  iniziale,
  segnata,
  dalVenditore,
  giorni,
  serviziDelVenditore = null,
}: {
  codice: string;
  fasce: FasciaDaConfermare[];
  /** La fascia detta al venditore; senza, la consigliata. */
  iniziale: Abbonamento;
  /** La fascia con l'etichetta: quella detta al venditore, o la consigliata. */
  segnata: Abbonamento;
  /** Vero se `segnata` l'ha scelta il titolare davanti al venditore: l'etichetta dice «La tua scelta». */
  dalVenditore: boolean;
  /** I giorni e le ore in cui SDG può passare, già senza quelli pieni. */
  giorni: GiornoVisita[];
  /**
   * 28/11/2026 — I servizi segnati dal venditore (Nicola: «lo deve poter fare in anticipo anche il venditore»): il
   * titolare li trova già segnati e li può cambiare. `null` = nessuno segnato: li sceglie da sé.
   */
  serviziDelVenditore?: ServizioAgenzia[] | null;
}) {
  const [fascia, setFascia] = useState<Abbonamento>(iniziale);
  const [servizi, setServizi] = useState<ServizioAgenzia[]>(serviziDelVenditore ?? []);
  const scegliServizio = (s: ServizioAgenzia) => setServizi((x) => (x.includes(s) ? x.filter((y) => y !== s) : SERVIZI_AGENZIA.filter((y) => y === s || x.includes(y))));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [condizioni, setCondizioni] = useState(false);
  const [invio, setInvio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [fatto, setFatto] = useState<null | { accessoInviato: boolean }>(null);
  /** Il secondo passo: il codice è partito, si aspetta che il titolare lo scriva. */
  const [fase, setFase] = useState<'scelta' | 'codice'>('scelta');
  const [codiceEmail, setCodiceEmail] = useState('');
  /** Il gettone firmato che accompagna il codice (lib/agenzia/codice-dal-link.ts): il codice in chiaro non c'è. */
  const [gettone, setGettone] = useState('');
  const [rimandato, setRimandato] = useState(false);
  /** Il giorno aperto (si vede subito il primo) e l'orario scelto per la visita di SDG: quello lo tocca il titolare. */
  const [giorno, setGiorno] = useState<string | null>(giorni[0]?.giorno ?? null);
  const [visita, setVisita] = useState<string | null>(null);
  /** Gli orari che il server ha rifiutato in questa pagina: si barrano come quelli già presi. */
  const [rifiutati, setRifiutati] = useState<ReadonlySet<string>>(new Set());
  const scelta = fasce.find((f) => f.id === fascia) ?? fasce[0];
  const aperto = giorni.find((g) => g.giorno === giorno) ?? null;
  /** C'è ancora un'ora da scegliere? Se il server ha appena rifiutato l'ultima, si conferma senza (lo chiamiamo noi). */
  const cePosto = giorni.some((g) => g.orari.some((o) => o.libero && !rifiutati.has(o.id)));
  const quando = scriviScelta(giorni, visita);

  async function chiedi(percorso: 'codice' | 'accetta', corpo: Record<string, unknown>): Promise<Risposta | null> {
    const r = await fetch(`/api/preventivo/${codice}/${percorso}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    const letto = (await r.json().catch(() => null)) as Risposta | null;
    if (!r.ok || !letto?.ok) {
      const messaggio = letto?.error?.message ?? 'Non ci sono riuscito. Riprova fra un momento.';
      setErrore(messaggio);
      if (visita && (messaggio === ORA_GIA_PRESA || messaggio === GIORNO_NON_PIU_VALIDO)) {
        // Quell'ora (o tutto quel giorno) non si può più scegliere: si barra e si torna alla scelta.
        const giornata = giorni.find((g) => g.orari.some((o) => o.id === visita));
        const via = messaggio === GIORNO_NON_PIU_VALIDO && giornata ? giornata.orari.map((o) => o.id) : [visita];
        setRifiutati((prima) => new Set([...prima, ...via]));
        setVisita(null);
        setFase('scelta');
      }
      if (eFraseDellaPassword(messaggio)) {
        // Il campo della password sta nel primo passo: si torna lì, vuoto, e si riconferma con un codice nuovo.
        setPassword('');
        setFase('scelta');
      }
      return null;
    }
    return letto;
  }

  /** Passo 1, e «Rimanda il codice»: parte il codice all'email. */
  async function mandaCodice(nuovo: boolean) {
    setErrore(null);
    setInvio(true);
    try {
      const r = await chiedi('codice', { email, abbonamento: fascia });
      if (r) {
        setGettone(r.data?.gettone ?? '');
        setFase('codice');
        setRimandato(nuovo);
        setCodiceEmail('');
      }
    } catch {
      setErrore('Non ci sono riuscito. Controlla la connessione e riprova.');
    }
    setInvio(false);
  }

  async function conferma(e: React.FormEvent) {
    e.preventDefault();
    setErrore(null);
    if (servizi.length === 0) {
      setErrore('Scegli almeno un servizio di cui hai bisogno.');
      return;
    }
    if (cePosto && !visita) {
      setErrore('Scegli il giorno e l’ora in cui passiamo da te.');
      return;
    }
    if (password.length < PASSWORD_MINIMA) {
      setErrore(`Scegli una password di almeno ${PASSWORD_MINIMA} caratteri: ti serve per rientrare nella tua pagina.`);
      return;
    }
    if (byteDellaPassword(password) > PASSWORD_MASSIMA) {
      setErrore(PASSWORD_TROPPO_LUNGA);
      return;
    }
    if (!condizioni) {
      setErrore('Per continuare accetta le condizioni e l’informativa privacy.');
      return;
    }
    await mandaCodice(false);
  }

  /** Passo 2: il codice giusto accetta e apre la sessione. */
  async function entra(e: React.FormEvent) {
    e.preventDefault();
    setErrore(null);
    setInvio(true);
    try {
      const r = await chiedi('accetta', { email, password, abbonamento: fascia, accettoCondizioni: true, codice: codiceEmail, gettone, servizi, ...(visita ? { visita } : {}) });
      if (r) {
        const dove = r.data?.url ?? r.data?.entra ?? null;
        if (dove) {
          // Il pulsante resta su «Un momento…» finché la pagina nuova non si apre.
          window.location.assign(dove);
          return;
        }
        setFatto({ accessoInviato: r.data?.accessoInviato === true });
      }
    } catch {
      setErrore('Non ci sono riuscito. Controlla la connessione e riprova.');
    }
    setInvio(false);
  }

  if (fatto) {
    return (
      <div role="status" className="mt-6 rounded-2xl border-2 border-olive-300 bg-olive-50 p-5">
        <p className="font-semibold text-ink-900">Fatto, il {scelta.nome} è confermato.{quando ? ` Ci vediamo ${quando.charAt(0).toLowerCase()}${quando.slice(1)}.` : ''}</p>
        <p className="mt-1 text-sm text-ink-700">
          {fatto.accessoInviato
            ? `Ti abbiamo scritto a ${email}: da lì entri nella tua pagina. Dopo, entri da «Accedi» con questa email e la password che hai scelto.`
            : 'L’email con il link per entrare non è partita: ti scriviamo noi a breve.'}
        </p>
      </div>
    );
  }

  if (fase === 'codice') {
    return (
      <form onSubmit={entra} className="mx-auto mt-6 max-w-xl rounded-2xl border-2 border-primary-200 bg-surface-0 p-5" aria-label="Scrivi il codice">
        <p className="text-sm text-ink-700">
          Hai scelto il <strong className="text-ink-900">{scelta.nome}</strong> · {scelta.canone}
          {quando && <> · visita <strong className="text-ink-900">{quando.charAt(0).toLowerCase()}{quando.slice(1)}</strong></>}{' '}
          <button type="button" onClick={() => { setFase('scelta'); setErrore(null); }} className="font-semibold text-primary-700 underline">Cambia</button>
        </p>
        <h2 className="mt-3 text-lg font-bold text-ink-900">{rimandato ? 'Ti abbiamo mandato un codice nuovo' : 'Ti abbiamo mandato un codice'}</h2>
        <p className="mt-1 text-sm text-ink-700">
          È arrivato a <strong className="text-ink-900">{email}</strong>. Scrivilo qui per entrare nella tua pagina.
        </p>
        <label className="mt-4 block text-sm font-medium text-ink-800" htmlFor="codice-email">Il codice dell’email</label>
        <input
          id="codice-email"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          value={codiceEmail}
          onChange={(e) => setCodiceEmail(e.target.value.replace(/\D/g, ''))}
          className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-center text-2xl font-bold tracking-[0.4em]"
        />
        {errore && <p role="alert" className="mt-3 text-sm text-secondary-700">{errore}</p>}
        <button
          type="submit"
          disabled={invio || codiceEmail.length < 6}
          className="mt-4 w-full rounded-lg bg-primary-700 py-3 text-lg font-bold text-white hover:bg-primary-800 disabled:opacity-60"
        >
          {invio ? 'Un momento…' : 'Entra nella mia pagina'}
        </button>
        <p className="mt-3 text-center text-sm text-ink-600">
          Non è arrivato? Guarda anche nello spam, oppure{' '}
          <button type="button" disabled={invio} onClick={() => mandaCodice(true)} className="font-semibold text-primary-700 underline disabled:opacity-60">rimanda il codice</button>
          {' · '}
          <button type="button" onClick={() => { setFase('scelta'); setErrore(null); }} className="font-semibold text-primary-700 underline">ho sbagliato email</button>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={conferma} className="mt-6" aria-label="Conferma l’abbonamento">
      <fieldset>
        <legend className="text-lg font-bold text-ink-900">I tre abbonamenti</legend>
        <p className="mt-1 text-sm text-ink-600">Ognuno comprende tutti i servizi: cambia quanto.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {fasce.map((f) => {
            const attiva = f.id === fascia;
            return (
              <label key={f.id} data-fascia={f.id} className="block cursor-pointer">
                <input
                  type="radio"
                  name="fascia"
                  value={f.id}
                  checked={attiva}
                  onChange={() => setFascia(f.id)}
                  className="peer sr-only"
                />
                <span
                  className={`flex h-full flex-col rounded-2xl border-2 p-4 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 peer-focus-visible:ring-offset-2 ${attiva ? 'border-primary-700 bg-primary-50' : 'border-cream-200 bg-surface-0 hover:border-primary-300'}`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-serif text-xl font-bold text-ink-900">{f.nome}</span>
                    {f.id === segnata && (
                      <span className="rounded-full bg-olive-700 px-2 py-0.5 text-[11px] font-bold text-white">{dalVenditore ? 'La tua scelta' : 'Consigliato'}</span>
                    )}
                    {attiva && <Check size={18} className="ml-auto text-primary-700" aria-hidden />}
                  </span>
                  <span className="mt-1 block text-lg font-extrabold text-ink-900">{f.canone}</span>
                  {f.primoMese && <span className="block text-xs font-semibold text-olive-800">Il primo mese {f.primoMese}</span>}
                  <span className="mt-2 block text-sm text-ink-700">{f.perChi}</span>
                  <span className="mt-3 block space-y-1 border-t border-cream-200 pt-3 text-sm text-ink-700">
                    {f.servizi.map((s) => (
                      <span key={s.titolo} className="block"><strong className="text-ink-900">{s.titolo}:</strong> {s.testo}</span>
                    ))}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mx-auto mt-6 max-w-xl rounded-2xl border-2 border-cream-300 bg-surface-0 p-5" aria-describedby="servizi-cosa">
        <legend className="px-1 text-lg font-bold text-ink-900">Di quali servizi hai bisogno?</legend>
        <p id="servizi-cosa" className="text-sm text-ink-700">
          {serviziDelVenditore?.length ? 'Li trovi segnati come li hai scelti col nostro venditore: puoi cambiarli. ' : 'Puoi sceglierne più di uno. '}
          Prepariamo subito quelli che scegli. Il prezzo dell’abbonamento non cambia.
        </p>
        <div className="mt-3 space-y-2">
          {SERVIZI_AGENZIA.map((s) => (
            <label key={s} data-servizio={s} className="flex cursor-pointer items-start gap-2 text-sm text-ink-800">
              <input type="checkbox" name="servizi" value={s} checked={servizi.includes(s)} onChange={() => scegliServizio(s)} className="mt-1" />
              <span><strong className="text-ink-900">{ETICHETTE_SERVIZI[s]}</strong> · {SPIEGAZIONE_AL_TITOLARE[s]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mx-auto mt-6 max-w-xl rounded-2xl border-2 border-cream-300 bg-surface-0 p-5" aria-describedby="visita-cosa">
        <legend className="px-1 text-lg font-bold text-ink-900">Quando passiamo da te?</legend>
        <p id="visita-cosa" className="text-sm text-ink-700">
          Il team creativo di SDG viene da te, nella tua attività. Con te scriviamo il piano dei contenuti del primo mese,
          poi il fotografo e il videomaker fanno subito le prime foto e i primi video. Ci vuole {DURATA_VISITA}.
        </p>
        {!cePosto ? (
          <p className="mt-3 text-sm font-semibold text-ink-900">In queste due settimane siamo al completo: conferma lo stesso, ti chiamiamo noi per fissare il giorno.</p>
        ) : (
          <>
            <p className="mt-4 text-sm font-medium text-ink-800" id="visita-giorno">Il giorno</p>
            <div role="radiogroup" aria-labelledby="visita-giorno" className="mt-1 flex flex-wrap gap-2">
              {giorni.map((g) => {
                const attivo = g.giorno === giorno;
                return (
                  <label key={g.giorno} data-giorno={g.giorno} className="cursor-pointer">
                    <input
                      type="radio"
                      name="giorno-visita"
                      value={g.giorno}
                      checked={attivo}
                      onChange={() => { setGiorno(g.giorno); setVisita(null); }}
                      className="peer sr-only"
                    />
                    {/* Il nome per chi usa un lettore o la voce contiene la scritta che si vede (WCAG 2.5.3). */}
                    <span className={`block rounded-lg border-2 px-3 py-2 text-sm font-semibold capitalize peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 ${attivo ? 'border-primary-700 bg-primary-50 text-ink-900' : 'border-cream-200 text-ink-700 hover:border-primary-300'}`}>
                      {g.breve}<span className="sr-only">, {g.lungo}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {aperto && (
              <>
                <p className="mt-4 text-sm font-medium text-ink-800" id="visita-ora">L’ora, {aperto.lungo}</p>
                <div role="radiogroup" aria-labelledby="visita-ora" className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {aperto.orari.map((o) => {
                    const attiva = o.id === visita;
                    const libero = o.libero && !rifiutati.has(o.id);
                    return (
                      <label key={o.id} data-ora={o.ora} className={libero ? 'cursor-pointer' : 'cursor-not-allowed'}>
                        <input
                          type="radio"
                          name="ora-visita"
                          value={o.id}
                          checked={attiva}
                          disabled={!libero}
                          onChange={() => setVisita(o.id)}
                          className="peer sr-only"
                          aria-label={libero ? `alle ${o.ora}` : `alle ${o.ora}, già presa`}
                        />
                        <span className={`block rounded-lg border-2 px-3 py-2 text-center text-base font-bold peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 ${!libero ? 'border-cream-200 text-ink-400 line-through' : attiva ? 'border-primary-700 bg-primary-50 text-ink-900' : 'border-cream-200 text-ink-800 hover:border-primary-300'}`}>
                          {o.ora}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
            <p className="mt-3 text-xs text-ink-500">Nessun giorno ti va bene? Scegli il più comodo: ti chiamiamo e lo spostiamo insieme.</p>
          </>
        )}
      </fieldset>

      <div className="mx-auto mt-6 max-w-xl rounded-2xl border-2 border-cream-300 bg-surface-0 p-5">
        <label className="block text-sm font-medium text-ink-800" htmlFor="email-titolare">La tua email</label>
        <input
          id="email-titolare"
          type="email"
          required
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2"
        />
        <p className="mt-1 text-xs text-ink-500">Ti mandiamo qui un codice per entrare nella tua pagina, e il link per rientrare quando vuoi.</p>
        <div className="mt-4">
          <PasswordInput
            id="password-titolare"
            label="Scegli una password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={`Almeno ${PASSWORD_MINIMA} caratteri. Con questa email e questa password rientri da «Accedi» quando vuoi.`}
            required
            minLength={PASSWORD_MINIMA}
            maxLength={PASSWORD_MASSIMA}
            autoComplete="new-password"
          />
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm text-ink-700">
          <input type="checkbox" checked={condizioni} onChange={(e) => setCondizioni(e.target.checked)} className="mt-1" />
          <span>
            Accetto le <Link href="/terms" className="underline" target="_blank">condizioni</Link> e ho letto l’<Link href="/privacy" className="underline" target="_blank">informativa privacy</Link>.
          </span>
        </label>
        <div className="mt-4 rounded-xl bg-cream-50 p-4">
          <p className="text-sm font-bold text-ink-900">Cosa succede dopo</p>
          <ol className="mt-2 space-y-2 text-sm text-ink-700">
            <li>
              <strong className="text-ink-900">Adesso.</strong> Ti mandiamo un codice per email: lo scrivi qui ed entri nella tua pagina
              {PAGAMENTO_ONLINE_SERVIZI ? '.' : `, con il ${scelta.nome} già attivo.`}
            </li>
            {cePosto ? (
              <li><strong className="text-ink-900">{quando ?? 'Il giorno che scegli'}.</strong> Il team di SDG passa da te: piano dei contenuti, foto e video.</li>
            ) : (
              <li><strong className="text-ink-900">Nei prossimi giorni.</strong> Ti chiamiamo per fissare quando il team di SDG passa da te: piano dei contenuti, foto e video.</li>
            )}
            <li><strong className="text-ink-900">Nei giorni dopo.</strong> Prepariamo i primi post e te li facciamo vedere prima di pubblicarli.</li>
          </ol>
        </div>
        {errore && <p role="alert" className="mt-3 text-sm text-secondary-700">{errore}</p>}
        <button
          type="submit"
          disabled={invio}
          className="mt-4 w-full rounded-lg bg-primary-700 py-3 text-lg font-bold text-white hover:bg-primary-800 disabled:opacity-60"
        >
          {invio ? 'Un momento…' : cePosto ? `Confermo il ${scelta.nome} e la visita` : `Confermo il ${scelta.nome}`}
        </button>
        {!PAGAMENTO_ONLINE_SERVIZI && <p className="mt-2 text-center text-xs text-ink-600">{FRASE_CONTANTI}</p>}
      </div>
    </form>
  );
}
