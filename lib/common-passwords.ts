// Blockliste häufig verwendeter Passwörter.
//
// Ehrlich dokumentiert, was das hier ist: KEINE verifizierte, kanonische
// "Top-1000"-Liste (die üblichen Quellen dafür — z.B. die SecLists
// 10k-most-common-Liste oder der Have-I-Been-Pwned-Pwned-Passwords-Datensatz —
// sind aus dieser Umgebung heraus nicht abrufbar). Stattdessen: eine kuratierte
// Basisliste bekannter, häufig in Leak-Auswertungen (RockYou, SplashData/
// NordPass "Worst Passwords") auftauchender Wörter/Muster, kombiniert mit den
// gängigsten numerischen Suffix-Mustern — dieselbe Technik, die reale
// Passwort-Blocklisten verwenden, um eine Basisliste auf mehrere tausend
// Einträge zu erweitern, ohne jedes Muster einzeln aufzuzählen.
//
// Weil die App eine Mindestlänge von 10 Zeichen erzwingt, sind die meisten
// trivialen Kurz-Passwörter ("123456", "qwerty", "admin") ohnehin schon durch
// die Längenprüfung ausgeschlossen. Diese Liste zielt gezielt auf die Fälle,
// die die Längenprüfung übersteht: bekannte Basiswörter plus Zahlen-Suffix
// ("password123", "iloveyou1234"), Tastatur-Läufe ("qwertyuiop"), reine
// Ziffernfolgen ≥10 Stellen ("1234567890"), und gängige deutsche/Schweizer
// Muster.
//
// Für den Produktivbetrieb (Punkt 12, Verkaufsfähigkeit) sollte das gegen
// einen echten Pwned-Passwords-Abgleich (k-Anonymity-API, kein Klartext-
// Versand) ersetzt oder ergänzt werden — das ist der einzige Ansatz, der
// wirklich alle bekannten Leaks abdeckt statt einer statischen Liste.

const BASE_WORDS = [
  "password", "passwort", "letmein", "welcome", "monkey", "dragon", "master",
  "sunshine", "princess", "football", "baseball", "basketball", "soccer",
  "iloveyou", "trustno1", "superman", "batman", "starwars", "pokemon",
  "shadow", "michael", "jennifer", "jordan", "hunter", "ranger", "buster",
  "thomas", "george", "charlie", "andrew", "daniel", "matthew", "joshua",
  "nicholas", "hallo", "willkommen", "schalke", "bayern", "borussia",
  "zuerich", "zurich", "schweiz", "switzerland", "chocolate", "computer",
  "internet", "freedom", "liverpool", "chelsea", "arsenal", "manchester",
  "whatever", "abcdefg", "abcdefgh", "qazwsx", "qwertyui", "qwertyuiop",
  "asdfghjkl", "zxcvbnm", "1qaz2wsx", "qwerty123", "letmein123",
  "changeme", "changeme1", "temppass", "temppassword", "newpassword",
  "mypassword", "iloveyou", "loveyou", "forever", "always", "family",
  "friends", "summer", "winter", "autumn", "spring", "flower", "sunflower",
  "butterfly", "rainbow", "diamond", "silver", "golden", "phoenix",
  "dragonfly", "elephant", "tigers", "lions", "eagles", "falcon", "wolves",
  "cowboys", "yankees", "startrek", "starwars", "harrypotter", "lordoftherings",
];

const NUMERIC_SUFFIXES = [
  "1", "12", "123", "1234", "12345", "123456", "0", "00", "01", "07", "08",
  "09", "10", "11", "13", "21", "22", "23", "24", "25", "26", "69", "77",
  "88", "99", "100", "111", "222", "333", "1990", "1991", "1992", "1993",
  "1994", "1995", "1996", "1997", "1998", "1999", "2000", "2001", "2010",
  "2020", "2021", "2022", "2023", "2024", "2025", "2026",
];

const KEYBOARD_WALKS = [
  "qwertyuiop", "asdfghjkl;", "1qaz2wsx3edc", "qazwsxedc", "zaq12wsx",
  "1q2w3e4r5t", "1q2w3e4r5t6y", "poiuytrewq", "mnbvcxz", "9876543210",
  "0123456789", "1234567890",
];

const PURE_NUMERIC_RUNS = [
  "0000000000", "1111111111", "2222222222", "1234567890", "0123456789",
  "9876543210", "1122334455", "1231231231", "1212121212",
];

function buildBlocklist(): Set<string> {
  const set = new Set<string>();
  for (const w of BASE_WORDS) {
    set.add(w);
    for (const suf of NUMERIC_SUFFIXES) {
      set.add(w + suf);
    }
  }
  for (const w of KEYBOARD_WALKS) set.add(w);
  for (const w of PURE_NUMERIC_RUNS) set.add(w);
  return set;
}

export const COMMON_PASSWORDS: ReadonlySet<string> = buildBlocklist();

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}
