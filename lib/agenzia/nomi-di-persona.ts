/**
 * I NOMI DI PERSONA, RICONOSCIUTI SENZA SCARTARE LE FRASI BUONE — 26/11/2026 (ricontrollo di mycity#336).
 *
 * Prima bastavano due parole maiuscole di fila per scartare una frase, e si perdevano «Aggiorna la scheda su Google
 * Maps», «Per Natale prepara una vetrina», «Partecipa al mercato di Piazza Cavalli». Ora un nome di persona è un nome
 * proprio italiano di questo elenco (i più comuni) seguito da una parola maiuscola: «Mario Rossi», «Giulia Bianchi».
 * Se prima del nome c'è Via, Piazza, Corso, Viale, Largo, San, Santa o Sant' è il nome di una strada o di un santo,
 * e la frase resta. Un nome da solo («la cameriera Giulia») qui non si riconosce: nei temi delle recensioni lo ferma
 * la regola del minuscolo (rapporto.ts, `temaMostrabile`).
 */
const NOMI = `
Alessandro Alessandra Alberto Alberta Aldo Alda Alessio Alfredo Alice Alma Amedeo Andrea Angela Angelo Anna Annalisa
Antonella Antonio Antonia Arianna Armando Arturo Aurora Barbara Beatrice Benedetta Bianca Bruno Carla Carlo Carlotta
Carmela Carmen Carolina Caterina Cecilia Cesare Chiara Christian Claudia Claudio Concetta Cristian Cristina Cristiano
Dalila Damiano Daniela Daniele Dario Davide Debora Denis Diego Domenico Donatella Edoardo Elena Eleonora Elia Elisa
Elisabetta Emanuela Emanuele Emma Enrico Enrica Enzo Erica Ernesto Ettore Eugenio Fabio Fabiola Fabrizio Fausto
Federica Federico Fernando Filippo Fiorella Flavia Flavio Francesca Francesco Franco Gabriele Gabriella Gaetano Gianluca
Gianni Giacomo Gino Giorgia Giorgio Giovanna Giovanni Giulia Giuliana Giuliano Giulio Giuseppe Giuseppina Grazia
Graziella Guido Ilaria Irene Isabella Ivan Ivana Jacopo Laura Lauro Lea Leonardo Letizia Lia Lidia Liliana Linda Lisa
Livia Lorena Lorenzo Loredana Luana Luca Lucia Luciana Luciano Ludovica Luigi Luisa Manuela Marcello Marco Margherita
Maria Marianna Marina Mario Marisa Marta Martina Massimo Matilde Matteo Mattia Maurizio Mauro Michela Michele Mirco
Mirko Monica Nadia Natalia Nicola Nicoletta Nicolò Noemi Ornella Orlando Paola Paolo Pasquale Patrizia Pietro Piero
Raffaele Raffaella Renato Renata Riccardo Rita Roberta Roberto Rocco Rosa Rosalba Rosanna Rosaria Rossella Ruggero
Sabrina Salvatore Samuele Sandra Sandro Sara Serena Sergio Silvia Silvio Simona Simone Sofia Stefania Stefano Susanna
Teresa Tiziana Tiziano Tommaso Umberto Valentina Valentino Valeria Valerio Vanessa Vincenzo Viola Virginia Vittoria
Vittorio Walter Ylenia Yuri Zeno
`.trim().split(/\s+/);

const PRIMA_DI_UNA_STRADA = /(?:^|\s)(via|viale|piazza|piazzale|corso|largo|vicolo|san|santa|santo|sant')\s*$/i;
const NOME_E_COGNOME = new RegExp(`(^|[^\\p{L}])(${NOMI.join('|')})\\s+[A-ZÀ-Ý][\\p{L}']+`, 'gu');

/** Vero se il testo contiene un nome e cognome di persona (non il nome di una strada o di un santo). */
export function haUnNomeDiPersona(testo: string): boolean {
  for (const m of testo.matchAll(NOME_E_COGNOME)) {
    const prima = testo.slice(0, (m.index ?? 0) + m[1].length);
    if (!PRIMA_DI_UNA_STRADA.test(prima)) return true;
  }
  return false;
}
