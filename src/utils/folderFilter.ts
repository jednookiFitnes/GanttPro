/**
 * Narzędzia do filtrowania ścieżek plików zadań na podstawie wybranych folderów
 */

/**
 * Normalizuje ścieżkę folderu lub pliku:
 * - zamienia ukośniki odwrotne na ukośniki zwykłe
 * - usuwa początkowe i końcowe ukośniki oraz białe znaki
 */
export function normalizeFolderPath(path: string): string {
	if (!path) return '';
	return path
		.trim()
		.replace(/\\/g, '/')
		.replace(/\/+/g, '/')
		.replace(/^\/+|\/+$/g, '')
		.trim();
}

/**
 * Sprawdza czy dana ścieżka pliku lub folderu znajduje się w podanym folderze bazowym
 * (lub jest dokładnie tym folderem).
 * Porównanie jest niewrażliwe na wielkość liter (case-insensitive).
 */
export function isPathInFolder(filePath: string, folderPath: string): boolean {
	const normFile = normalizeFolderPath(filePath).toLowerCase();
	const normFolder = normalizeFolderPath(folderPath).toLowerCase();

	if (!normFolder) return false;

	return normFile === normFolder || normFile.startsWith(normFolder + '/');
}

/**
 * Sprawdza czy plik o danej ścieżce jest dozwolony według reguł Include i Exclude:
 * 1. Jeśli ścieżka pasuje do któregokolwiek folderu z listy exclude (blacklist) -> odrzucona (false).
 * 2. Jeśli lista include (whitelist) zawiera co najmniej jeden folder -> ścieżka musi leżeć w przynajmniej jednym z nich.
 * 3. Jeśli lista include jest pusta -> dozwolone są wszystkie pliki (które nie zostały wykluczone).
 */
export function isFileAllowed(
	filePath: string,
	includeFolders: string[] = [],
	excludeFolders: string[] = []
): boolean {
	const validExcludes = (excludeFolders || []).map(normalizeFolderPath).filter(Boolean);
	const validIncludes = (includeFolders || []).map(normalizeFolderPath).filter(Boolean);

	// 1. Sprawdź czarną listę (ma bezwzględne pierwszeństwo)
	for (const ex of validExcludes) {
		if (isPathInFolder(filePath, ex)) {
			return false;
		}
	}

	// 2. Jeśli zdefiniowano białą listę, plik musi leżeć w jednym ze wskazanych folderów
	if (validIncludes.length > 0) {
		return validIncludes.some(inc => isPathInFolder(filePath, inc));
	}

	// 3. Brak ograniczeń białej listy
	return true;
}
