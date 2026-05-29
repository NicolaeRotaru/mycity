import type { Metadata } from 'next';
import Link from 'next/link';

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

const LAST_UPDATED = '2026-05-26';

export default function AccessibilityStatementPage() {
  return (
    <article className="container mx-auto px-4 py-10 max-w-3xl prose prose-sm sm:prose-base">
      <h1 className="font-serif text-3xl font-bold text-ink-900">Dichiarazione di accessibilità</h1>
      <p className="text-ink-500 text-sm">
        Ultimo aggiornamento: {LAST_UPDATED}
      </p>

      <h2 className="font-serif text-xl font-bold mt-8 mb-2">Impegno per l'accessibilità</h2>
      <p>
        MyCity Piacenza è impegnata a rendere il proprio sito web accessibile, in
        conformità con il <strong>European Accessibility Act (Direttiva UE 2019/882)</strong>,
        recepito dall'Italia con il D.Lgs. 82/2022, e con le <strong>Linee Guida WCAG 2.1
        livello AA</strong>.
      </p>

      <h2 className="font-serif text-xl font-bold mt-8 mb-2">Stato di conformità</h2>
      <p>
        Il sito <strong>mycity-marketplace.com</strong> è{' '}
        <strong>parzialmente conforme</strong> alle WCAG 2.1 livello AA per le
        non conformità elencate nella sezione "Contenuti non accessibili".
      </p>

      <h2 className="font-serif text-xl font-bold mt-8 mb-2">Funzionalità accessibili</h2>
      <ul>
        <li>Navigazione completa da tastiera su tutte le pagine principali</li>
        <li>Compatibilità con screen reader (NVDA, JAWS, VoiceOver) sui flussi critici</li>
        <li>Contrasto colore conforme WCAG AA sui testi principali</li>
        <li>Etichette ARIA su pulsanti, icone e immagini significative</li>
        <li>Skip-link per saltare la navigazione</li>
        <li>Form con etichette esplicite e messaggi di errore associati</li>
        <li>Ridimensionamento testo fino al 200% senza perdita di funzionalità</li>
        <li>Indicatori di focus visibili su tutti gli elementi interattivi</li>
      </ul>

      <h2 className="font-serif text-xl font-bold mt-8 mb-2">Contenuti non accessibili</h2>
      <p>I seguenti contenuti non sono al momento pienamente accessibili:</p>
      <ul>
        <li><strong>Mappe interattive</strong> (consegna in tempo reale): non
        accessibili da tastiera/screen reader. Forniamo alternative testuali
        per indirizzo e tempo di consegna stimato.</li>
        <li><strong>Carosello "Storie negozi"</strong>: auto-advance può essere
        difficile da gestire per utenti con disabilità motorie. È possibile
        chiuderlo con il tasto Esc.</li>
        <li><strong>Alcuni contenuti generati da utenti</strong> (recensioni
        con foto): le foto caricate dagli utenti potrebbero non avere
        descrizione alternativa.</li>
      </ul>
      <p className="text-sm text-ink-500">
        Stiamo lavorando per risolvere queste limitazioni entro <strong>dicembre 2026</strong>.
      </p>

      <h2 className="font-serif text-xl font-bold mt-8 mb-2">Metodologia di valutazione</h2>
      <p>La valutazione di conformità è stata effettuata tramite:</p>
      <ul>
        <li>Audit automatico con <code>axe-core</code> e <code>pa11y</code></li>
        <li>Test manuale con screen reader (VoiceOver su macOS, NVDA su Windows)</li>
        <li>Test di navigazione esclusivamente da tastiera sui flussi principali</li>
        <li>Verifica contrasto con strumenti WebAIM Contrast Checker</li>
      </ul>

      <h2 className="font-serif text-xl font-bold mt-8 mb-2">Meccanismo di feedback</h2>
      <p>
        Se incontri ostacoli di accessibilità su questo sito, contattaci:
      </p>
      <ul>
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

      <h2 className="font-serif text-xl font-bold mt-8 mb-2">Procedura di attuazione</h2>
      <p>
        In caso di risposta insoddisfacente, è possibile presentare reclamo all'<strong>AgID
        (Agenzia per l'Italia Digitale)</strong> attraverso il modulo presente sul sito
        ufficiale <a href="https://www.agid.gov.it" target="_blank" rel="noopener noreferrer" className="text-primary-700 hover:underline">agid.gov.it</a>.
      </p>

      <h2 className="font-serif text-xl font-bold mt-8 mb-2">Informazioni tecniche sul sito</h2>
      <ul>
        <li><strong>Conformità a standard:</strong> WCAG 2.1 livello AA (in corso di completamento)</li>
        <li><strong>Tecnologie utilizzate:</strong> HTML5, CSS3, JavaScript (React/Next.js 14), ARIA 1.2</li>
        <li><strong>Compatibilità browser:</strong> Chrome 100+, Firefox 100+, Safari 15+, Edge 100+</li>
        <li><strong>Compatibilità assistive technology:</strong> NVDA, JAWS, VoiceOver, TalkBack</li>
      </ul>

      <hr className="my-8" />
      <p className="text-sm text-ink-500">
        Questa dichiarazione è stata redatta il {LAST_UPDATED} e verrà aggiornata
        almeno una volta l'anno o quando vengono apportate modifiche significative
        al sito.
      </p>
    </article>
  );
}
