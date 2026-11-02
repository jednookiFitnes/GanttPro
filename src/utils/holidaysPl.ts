/**
 * Moduł polskich świąt kalendarzowych i formatowania dat dla Gantt Calendar Pro
 *
 * Obsługuje wszystkie polskie dni ustawowo wolne od pracy (stałe i ruchome)
 * zgodnie z ustawą o dniach wolnych od pracy z dnia 18 stycznia 1951 r.
 */

export interface PolishHoliday {
	dateStr: string; // YYYY-MM-DD
	name: string;
}

/**
 * Wyliczanie daty Niedzieli Wielkanocnej algorytmem Meeusa/Jonesa/Butchera
 */
export function getEasterSunday(year: number): Date {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = marzec, 4 = kwiecień
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return new Date(year, month - 1, day);
}

function formatDateKey(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

const holidaysCache = new Map<number, Map<string, string>>();

/**
 * Zwraca mapę wszystkich polskich świąt w danym roku (klucz: 'YYYY-MM-DD', wartość: nazwa święta)
 */
export function getPolishHolidaysForYear(year: number): Map<string, string> {
	const cached = holidaysCache.get(year);
	if (cached) return cached;

	const holidays = new Map<string, string>();

	// 1. Święta o stałej dacie
	holidays.set(`${year}-01-01`, 'Nowy Rok');
	holidays.set(`${year}-01-06`, 'Święto Trzech Króli');
	holidays.set(`${year}-05-01`, 'Święto Państwowe (Święto Pracy)');
	holidays.set(`${year}-05-03`, 'Święto Narodowe Trzeciego Maja');
	holidays.set(`${year}-08-15`, 'Wniebowzięcie NMP / Święto Wojska Polskiego');
	holidays.set(`${year}-11-01`, 'Wszystkich Świętych');
	holidays.set(`${year}-11-11`, 'Narodowe Święto Niepodległości');
	holidays.set(`${year}-12-25`, 'Boże Narodzenie (pierwszy dzień)');
	holidays.set(`${year}-12-26`, 'Boże Narodzenie (drugi dzień)');

	// 2. Święta ruchome (pochodne Wielkanocy)
	const easter = getEasterSunday(year);
	const addDays = (base: Date, days: number): Date => {
		const res = new Date(base);
		res.setDate(res.getDate() + days);
		return res;
	};

	holidays.set(formatDateKey(easter), 'Wielkanoc (Niedziela Wielkanocna)');
	holidays.set(formatDateKey(addDays(easter, 1)), 'Poniedziałek Wielkanocny');
	holidays.set(formatDateKey(addDays(easter, 49)), 'Zielone Świątki (Zesłanie Ducha Świętego)');
	holidays.set(formatDateKey(addDays(easter, 60)), 'Boże Ciało');

	holidaysCache.set(year, holidays);
	return holidays;
}

/**
 * Sprawdza czy dany dzień jest polskim świętem i zwraca jego nazwę lub null
 */
export function getPolishHoliday(date: Date): string | null {
	const year = date.getFullYear();
	const holidays = getPolishHolidaysForYear(year);
	const key = formatDateKey(date);
	return holidays.get(key) || null;
}

/**
 * Sprawdza czy dany dzień jest weekendem (sobota lub niedziela)
 */
export function isWeekend(date: Date): boolean {
	const day = date.getDay();
	return day === 0 || day === 6; // 0 = Niedziela, 6 = Sobota
}

/**
 * Skrócone polskie nazwy dni tygodnia (0=Nd, 1=Pn, ..., 6=So)
 */
export const POLISH_DAY_ABBR = ['Nd', 'Pn', 'Wt', 'Śr', 'Czw', 'Pt', 'So'];

/**
 * Pełne polskie nazwy miesięcy
 */
export const POLISH_MONTH_NAMES = [
	'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
	'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
];

/**
 * Wylicza numer tygodnia w roku wg standardu ISO 8601
 */
export function getIsoWeekNumber(date: Date): number {
	const target = new Date(date.valueOf());
	const dayNr = (date.getDay() + 6) % 7; // Poniedziałek = 0
	target.setDate(target.getDate() - dayNr + 3); // Najbliższy czwartek
	const firstThursday = target.valueOf();
	target.setMonth(0, 1);
	if (target.getDay() !== 4) {
		target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
	}
	return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}
