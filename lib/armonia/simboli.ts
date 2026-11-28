/**
 * ARMONIA NASCOSTA — i simboli di tutte le culture, e quelli che non si usano mai (Nicola, 28/11/2026).
 *
 * Si prendono i PRINCIPI geometrici delle culture (proporzioni, reticoli, motivi decorativi),
 * mai i loro simboli di fede né i simboli che oggi hanno un significato d'odio.
 */
import type { Elemento } from './cielo';
import type { Motivo } from './forme';

export const MOTIVI: Readonly<Record<Motivo, { cultura: string; significato: string }>> = {
  'fiore-della-vita': { cultura: 'geometria sacra del Mediterraneo', significato: 'la creazione, tutto che nasce da un punto' },
  'seme-della-vita': { cultura: 'geometria sacra del Mediterraneo', significato: 'i sette giorni, l\'inizio' },
  'rosa-etrusca': { cultura: 'aruspici etruschi, Fegato di Piacenza', significato: 'i sedici settori del cielo che si leggevano per decidere' },
  cerchi: { cultura: 'elemento aria', significato: 'il respiro, lo spazio' },
  triangoli: { cultura: 'alchimia, elemento fuoco', significato: 'lo slancio, la trasformazione' },
  quadrati: { cultura: 'alchimia, elemento terra', significato: 'la stabilità, il mestiere' },
  onde: { cultura: 'elemento acqua', significato: 'il flusso, l\'accoglienza' },
  esagoni: { cultura: 'Giappone (kikkō, guscio di tartaruga)', significato: 'la lunga vita' },
  asanoha: { cultura: 'Giappone (foglia di canapa)', significato: 'crescere dritti e in fretta, la protezione; forma rosette a sei punte: solo su richiesta' },
  seigaiha: { cultura: 'Giappone (onde del mare blu)', significato: 'la calma e la fortuna che arrivano a ondate' },
  linee: { cultura: 'elemento aria', significato: 'il vento, il movimento leggero' },
  quincunx: { cultura: 'pavimenti cosmateschi, chiese romaniche italiane', significato: 'l\'ordine del mondo nei cinque cerchi, decorazione pura' },
};

/** Due motivi per elemento: il numero dell'attività sceglie fra i due. */
const PER_ELEMENTO: Readonly<Record<Elemento, readonly [Motivo, Motivo]>> = {
  fuoco: ['triangoli', 'quincunx'],
  terra: ['quadrati', 'esagoni'],
  aria: ['cerchi', 'linee'],
  acqua: ['onde', 'seigaiha'],
};

export const motivoPerFirma = (elemento: Elemento, numero: number): Motivo => PER_ELEMENTO[elemento][numero % 2];

/** Quello che non si usa mai, neanche nascosto. */
export const VIETATI: ReadonlyArray<{ nome: string; perche: string }> = [
  { nome: 'pentagramma', perche: 'la stella a cinque punte, dritta o rovesciata, la gente la legge come simbolo occulto' },
  { nome: 'stella a sei punte', perche: 'è la stella di David, un simbolo di fede' },
  { nome: 'stella a otto punte isolata', perche: 'due quadrati incrociati da soli sono il segno che divide il Corano (Rub el Hizb)' },
  { nome: 'sayagata', perche: 'il motivo giapponese è fatto di svastiche (manji)' },
  { nome: 'Sri Yantra, om, loto come emblema', perche: 'sono simboli sacri induisti e buddhisti' },
  { nome: 'trigrammi cinesi visibili', perche: 'sono segni del Libro dei Mutamenti: si usano solo come griglia invisibile' },
  { nome: 'simboli Adinkra', perche: 'appartengono agli Akan del Ghana e alcuni sono religiosi (Gye Nyame)' },
  { nome: 'svastica', perche: 'anche nella forma antica, oggi è un simbolo d\'odio' },
  { nome: 'sole nero', perche: 'simbolo neonazista' },
  { nome: 'rune', perche: 'Odal, Sig, Tyr, Wolfsangel e simili sono usate come simboli d\'odio' },
  { nome: 'croce celtica', perche: 'simbolo d\'odio; in Italia ricade anche nella legge Mancino' },
  { nome: 'triskele', perche: 'in alcune forme è un simbolo d\'odio' },
  { nome: 'occhio nella piramide', perche: 'lo riconoscono tutti' },
  { nome: 'croce rovesciata, 666', perche: 'la gente li legge come satanici' },
  { nome: 'croci, mezzelune, om, ruote del dharma e altri simboli di fede', perche: 'sono simboli religiosi: delle culture si usano i principi geometrici, mai i simboli di fede' },
  { nome: 'nomi divini, calligrafia sacra, testi sacri', perche: 'mai, neanche nascosti nel codice' },
  { nome: 'simboli dei popoli nativi', perche: 'appropriazione culturale' },
];

const PAROLE_VIETATE = [
  'pentagram', 'stella a cinque', 'stella a 5', 'stella a sei', 'stella a 6', 'esagramma', 'hexagram', 'david',
  'svastica', 'swastika', 'sole nero', 'sonnenrad', 'runa', 'rune', 'odal', 'wolfsangel', 'croce', 'cross',
  'triskel', 'piramide', '666', 'mezzaluna', 'crescent', 'baphomet', 'lucifer', 'allah', 'om ', 'dharma',
  'sayagata', 'manji', 'rub el hizb', 'stella a otto', 'stella a 8', 'sri yantra', 'adinkra', 'gye nyame', 'trigramm', ' tyr',
];

/** Vero se il nome di un motivo non richiama niente della lista dei vietati. */
export function motivoAmmesso(nome: string): boolean {
  const t = ` ${nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')} `;
  return !PAROLE_VIETATE.some((p) => t.includes(p));
}
