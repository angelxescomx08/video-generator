/**
 * El TTS interpreta `Juan 3:16` como una hora. Aunque el prompt pide la forma hablada, esta red
 * de seguridad deja el texto que llega al narrador inequívoco si el modelo ignora esa instrucción.
 */
const BIBLICAL_BOOK =
  "(?:(?:[1-3]\\s*)?(?:Samuel|Reyes|Cr[oó]nicas|Corintios|Tesalonicenses|Timoteo|Pedro|Juan)|G[eé]nesis|[EÉ]xodo|Lev[ií]tico|N[uú]meros|Deuteronomio|Josu[eé]|Jueces|Rut|Esdras|Nehem[ií]as|Ester|Job|Salmos?|Proverbios|Eclesiast[eé]s|Cantar(?: de los Cantares)?|Isa[ií]as|Jerem[ií]as|Lamentaciones|Ezequiel|Daniel|Oseas|Joel|Am[oó]s|Abd[ií]as|Jon[aá]s|Miqueas|Nah[uú]m|Habacuc|Sofon[ií]as|Hageo|Zacar[ií]as|Malaqu[ií]as|Mateo|Marcos|Lucas|Hechos|Romanos|G[aá]latas|Efesios|Filipenses|Colosenses|Tito|Filem[oó]n|Hebreos|Santiago|Judas|Apocalipsis)";

const COMPACT_BIBLICAL_REFERENCE = new RegExp(
  `\\b(${BIBLICAL_BOOK})\\s+(\\d{1,3})\\s*:\\s*(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?`,
  "gi",
);

export function normalizeBiblicalReferencesForSpeech(text: string): string {
  return text.replace(
    COMPACT_BIBLICAL_REFERENCE,
    (_match, book: string, chapter: string, firstVerse: string, lastVerse?: string) =>
      lastVerse
        ? `${book}, capitulo ${chapter}, versiculos ${firstVerse} al ${lastVerse}`
        : `${book}, capitulo ${chapter}, versiculo ${firstVerse}`,
  );
}
