import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalLayout, LegalSection } from '@/components/ui/LegalLayout';

/**
 * Statement of Accessibility — obbligatorio EAA (European Accessibility Act,
 * in vigore dal 28 giugno 2025) per marketplace operanti in UE.
 *
 * Esperti consultati:
 * - Accessibility Specialist: "Senza statement pubblico sei fuori legge.
 *   Deve dichiarare livello conformità (full / partial / non-compliant),
 *   features accessibili, limitazioni note, canali di contatto."
 * - Legal: "Deve essere accessibile da homepage (link footer obbligatorio)."
 */

export const metadata: Metadata = {
  title: 'Dichiarazione di accessibilità — MyCity Piacenza',
  description: 'Dichiarazione di accessibilità ai sensi dell\'European Accessibility Act.',
  alternates: { canonical: '/accessibility' },
  openGraph: {
    title: 'Dichiarazione di accessibilità · MyCity',
    description: 'Dichiarazione di accessibilità ai sensi dell\'European Accessibility Act.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/accessibility',
  },
};

const LAST_UPDATED = '2026-08-20';

const TOC = [
  { id: 'impegno', label: 'Impegno per l’accessibilità' },
  { id: 'conformita', label: 'Stato di conformità' },
  { id: 'accessibili', label: 'Funzionalità accessibili' },
  { id: 'non-accessibili', label: 'Contenuti non accessibili' },
  { id: 'metodologia', label: 'Metodologia di valutazione' },
  { id: 'feedback', label: 'Meccanismo di feedback' },
  { id: 'attuazione', label: 'Procedura di attuazione' },
  { id: 'tecniche', label: 'Informazioni tecniche' },
];

export default function AccessibilityStatementPage() {
  return (
    <LegalLayout
      title="Dichiarazione di accessibilità"
      active="/accessibility"
      meta={<>Ultimo aggiornamento: {LAST_UPDATED}</>}
      summary="MyCity Piacenza è impegnata a rendere il sito accessibile in conformità all’European Accessibility Act e alle WCAG 2.1 livello AA. Il sito è attualmente parzialmente conforme; le limitazioni note sono elencate sotto."
      toc={TOC}
    >
      <LegalSection id="impegno" heading="Impegno per l'accessibilità">
        <p>
          MyCity Piacenza è impegnata a rendere il proprio sito web accessibile, in
          conformità con il <strong>European Accessibility Act (Direttiva UE 2019/882)</strong>,
          recepito dall&apos;Italia con il D.Lgs. 82/2022, e con le <strong>Linee Guida WCAG 2.1
          livello AA</strong>.
        </p>
      </LegalSection>

      <LegalSection id="conformita" heading="Stato di conformità">
        <p>
          Il sito <strong>mycity-marketplace.com</strong> è{' '}
          <strong>parzialmente conforme</strong> alle WCAG 2.1 livello AA per le
          non conformità elencate nella sezione &quot;Contenuti non accessibili&quot;.
        </p>
      </LegalSection>

      <LegalSection id="accessibili" heading="Funzionalità accessibili">
        <p className="text-sm text-ink-500">
          Elenchiamo solo ciò che è verificato da un controllo automatico che gira
          a ogni modifica del sito. Le voci che prima erano scritte qui senza una
          prova dietro — compatibilità con tre lettori di schermo, contrasto
          conforme ovunque, ridimensionamento al 200% — sono state tolte: una
          dichiarazione di accessibilità che promette più di quanto può provare
          non aiuta nessuno, e mette in difficoltà proprio chi si fida.
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li>Skip-link per saltare la navigazione</li>
          <li>
            Controllo automatico <code>axe-core</code> sulle pagine del percorso
            d&apos;acquisto (home, catalogo, scheda prodotto, carrello): nessuna
            violazione di livello A o AA. Gira nella suite di prova a ogni modifica.
          </li>
          <li>Indicatori di focus visibili sugli elementi interattivi</li>
          <li>Etichette esplicite sui campi dei moduli, con messaggi di errore associati</li>
          <li>
            Finestre di dialogo (filtri, foto a schermo intero, conferme) con uscita
            da tastiera, fuoco che resta dentro e torna al punto di partenza
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="non-accessibili" heading="Contenuti non accessibili">
        <p>I seguenti contenuti non sono al momento pienamente accessibili:</p>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Mappe interattive</strong> (consegna in tempo reale): non
          accessibili da tastiera e da lettore di schermo. Forniamo alternative
          testuali per indirizzo e tempo di consegna stimato.</li>
          <li><strong>Contenuti caricati dai clienti e dai negozi</strong> (foto
          delle recensioni, foto dei prodotti): possono non avere una descrizione
          alternativa scritta da chi li ha caricati.</li>
          <li><strong>Contrasto del testo secondario</strong>: alcune scritte di
          servizio in grigio chiaro su sfondo panna non raggiungono il rapporto
          richiesto dal livello AA.</li>
          <li><strong>Pagine fuori dal percorso d&apos;acquisto</strong>: il
          controllo automatico copre oggi quattro pagine su decine. Sulle altre
          non abbiamo ancora una verifica che possa fallire, quindi non
          dichiariamo niente.</li>
        </ul>
        <p className="text-sm text-ink-500">
          Ultima verifica: 20 agosto 2026. Le limitazioni qui sopra sono quelle
          che conosciamo; l&apos;elenco cambia insieme al sito e viene aggiornato
          a ogni controllo.
        </p>
      </LegalSection>

      <LegalSection id="metodologia" heading="Metodologia di valutazione">
        <p>Questa dichiarazione si basa su:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong>Autovalutazione</strong> (non una verifica di terzi).
          </li>
          <li>
            Controllo automatico con <code>axe-core</code> dentro la suite di
            prova del sito, sulle pagine del percorso d&apos;acquisto: se compare
            una violazione di livello A o AA, la modifica non passa.
          </li>
          <li>
            Lettura del codice e prove da tastiera sui percorsi principali fatte
            dal team durante lo sviluppo.
          </li>
        </ul>
        <p className="text-sm text-ink-500">
          Quello che <strong>non</strong> abbiamo ancora fatto, e che diremo qui
          quando sarà fatto: prove con lettori di schermo reali (VoiceOver, NVDA,
          JAWS), verifica del contrasto su tutta la tavolozza, e una valutazione
          da parte di un soggetto esterno.
        </p>
      </LegalSection>

      <LegalSection id="feedback" heading="Meccanismo di feedback">
        <p>
          Se incontri ostacoli di accessibilità su questo sito, contattaci:
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            Email: <a href="mailto:accessibilita@mycity-marketplace.com" className="text-primary-700 hover:underline">accessibilita@mycity-marketplace.com</a>
          </li>
          <li>
            Modulo di contatto: <Link href="/contact" className="text-primary-700 hover:underline">/contact</Link>
          </li>
        </ul>
        <p>
          Risponderemo entro <strong>30 giorni</strong> dalla ricezione della segnalazione.
        </p>
      </LegalSection>

      <LegalSection id="attuazione" heading="Procedura di attuazione">
        <p>
          In caso di risposta insoddisfacente, è possibile presentare reclamo all&apos;<strong>AgID
          (Agenzia per l&apos;Italia Digitale)</strong> attraverso il modulo presente sul sito
          ufficiale <a href="https://www.agid.gov.it" target="_blank" rel="noopener noreferrer" className="text-primary-700 hover:underline">agid.gov.it</a>.
        </p>
      </LegalSection>

      <LegalSection id="tecniche" heading="Informazioni tecniche sul sito">
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Conformità a standard:</strong> WCAG 2.1 livello AA (in corso di completamento)</li>
          <li><strong>Tecnologie utilizzate:</strong> HTML5, CSS3, JavaScript (React/Next.js 14), ARIA 1.2</li>
          <li><strong>Compatibilità browser:</strong> Chrome 100+, Firefox 100+, Safari 15+, Edge 100+</li>
          <li><strong>Compatibilità assistive technology:</strong> NVDA, JAWS, VoiceOver, TalkBack</li>
        </ul>
      </LegalSection>

      <hr className="my-8 border-cream-300" />
      <p className="text-sm text-ink-500">
        Questa dichiarazione è stata redatta il {LAST_UPDATED} e verrà aggiornata
        almeno una volta l&apos;anno o quando vengono apportate modifiche significative
        al sito.
      </p>
    </LegalLayout>
  );
}
