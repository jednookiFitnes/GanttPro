import en from './locales/en.json';
import zh from './locales/zh.json';
import { getLanguage } from 'obsidian';

type TranslationMap = Record<string, unknown>;

const LOCALES: Record<string, TranslationMap> = { en, zh };
let currentLocale: TranslationMap = en;
let isInitialized = false;
let languageOverride: string | null = null;

export function getObsidianLanguage(): string {
	try {
		return getLanguage() || 'en';
	} catch {
		return 'en';
	}
}

export function resolveEffectiveLanguage(): string {
	if (languageOverride && languageOverride !== 'system') {
		return languageOverride;
	}
	return getObsidianLanguage();
}

function resolve(obj: TranslationMap, path: string): unknown {
	const keys = path.split('.');
	let current: unknown = obj;
	for (const key of keys) {
		if (current == null || typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

function interpolate(template: string, params?: Record<string, unknown>): string {
	if (!params) return template;
	return template.replace(/\{\{(\w+)\}\}/g, (_match: string, key: string) =>
		params[key] != null ? String(params[key]) : `{{${key}}}`
	);
}

export async function initializeI18n(language?: string): Promise<void> {
	if (language) {
		languageOverride = language;
	}
	const lang = resolveEffectiveLanguage();
	currentLocale = LOCALES[lang] || LOCALES['en'] || en;
	isInitialized = true;
}

export function setLanguage(language: string): void {
	languageOverride = language;
	const lang = resolveEffectiveLanguage();
	currentLocale = LOCALES[lang] || LOCALES['en'] || en;
}

export function isChineseLanguage(): boolean {
	const lang = resolveEffectiveLanguage();
	return lang === 'zh';
}

export function isPolishLanguage(): boolean {
	const lang = resolveEffectiveLanguage();
	if (lang.toLowerCase().startsWith('pl')) return true;
	if (typeof window !== 'undefined' && (window as unknown as { moment?: { locale?: () => string } }).moment?.locale?.() === 'pl') {
		return true;
	}
	return false;
}

const POLISH_OVERRIDES: Record<string, string> = {
	// Foldery i filtry zadań
	'settings.tasks.basic.includeFolders.name': 'Pokazuj taski z wybranych folderów',
	'settings.tasks.basic.includeFolders.description': 'Pokazuj tylko zadania z tych folderów oraz ich podfolderów. Pozostaw puste, aby pokazywać zadania ze wszystkich folderów.',
	'settings.tasks.basic.includeFolders.placeholder': 'Wybierz lub wpisz ścieżkę folderu...',
	'settings.tasks.basic.includeFolders.add': 'Dodaj',
	'settings.tasks.basic.includeFolders.empty': 'Wszystkie foldery są uwzględnione (brak ograniczeń)',
	'settings.tasks.basic.excludeFolders.name': 'Ignoruj taski z wybranych folderów',
	'settings.tasks.basic.excludeFolders.description': 'Ignoruj zadania z tych folderów oraz ich podfolderów. Ma pierwszeństwo przed folderami uwzględnionymi.',
	'settings.tasks.basic.excludeFolders.placeholder': 'Wybierz lub wpisz ścieżkę folderu...',
	'settings.tasks.basic.excludeFolders.add': 'Dodaj',
	'settings.tasks.basic.excludeFolders.empty': 'Żadne foldery nie są ignorowane',

	// Sidebar Daily Timeline
	'sidebar.dailyTimeline.filterBar.statusFilter': 'Filtruj wg statusu',
	'sidebar.dailyTimeline.filterBar.priorityFilter': 'Filtruj wg priorytetu',
	'sidebar.dailyTimeline.filterBar.tagFilter': 'Filtruj wg tagów',
	'sidebar.dailyTimeline.filterBar.hideCompleted': 'Ukryj ukończone',
	'sidebar.dailyTimeline.filterBar.showCompleted': 'Pokaż ukończone',
	'sidebar.dailyTimeline.filterBar.clearFilters': 'Wyczyść filtry',
	'sidebar.dailyTimeline.searchPlaceholder': 'Szukaj zadań...',
	'sidebar.dailyTimeline.noMatchingTasks': 'Brak zadań pasujących do filtrów',
	'sidebar.dailyTimeline.moreTasks': '+{{count}} więcej',
	'sidebar.dailyTimeline.clusterModalTitle': 'Zadania w tym przedziale',

	// Sidebar Task List
	'sidebar.taskList.priority.all': 'Wszystkie priorytety',
	'sidebar.taskList.priority.highest': 'Najwyższy',
	'sidebar.taskList.priority.high': 'Wysoki',
	'sidebar.taskList.priority.medium': 'Średni',
	'sidebar.taskList.priority.normal': 'Normalny',
	'sidebar.taskList.priority.low': 'Niski',
	'sidebar.taskList.priority.lowest': 'Najniższy',
	'sidebar.taskList.sortOptions.byPriority': 'Wg priorytetu',
	'sidebar.taskList.sortOptions.byDueDate': 'Wg terminu',
	'sidebar.taskList.sortOptions.byStartDate': 'Wg daty rozpoczęcia',
	'sidebar.taskList.dateFilterOptions.all': 'Wszystkie daty',
	'sidebar.taskList.dateFilterOptions.today': 'Dzisiaj',
	'sidebar.taskList.dateFilterOptions.thisWeek': 'Ten tydzień',
	'sidebar.taskList.dateFilterOptions.thisMonth': 'Ten miesiąc',
	'sidebar.taskList.ganttFilterOptions.all': 'Wszystkie zadania',
	'sidebar.taskList.ganttFilterOptions.notInGantt': 'Poza Ganttem (brak start/due)',
	'sidebar.taskList.ganttFilterOptions.inGantt': 'W tablicy Gantt (start i due)',

	// Task Statuses
	'taskStatus.todo': 'Do zrobienia',
	'taskStatus.todoDescription': 'Zadanie oczekujące na wykonanie',
	'taskStatus.done': 'Ukończone',
	'taskStatus.doneDescription': 'Zadanie zrealizowane',
	'taskStatus.important': 'Ważne',
	'taskStatus.importantDescription': 'Zadanie o wysokim priorytecie',
	'taskStatus.canceled': 'Anulowane',
	'taskStatus.canceledDescription': 'Zadanie anulowane',
	'taskStatus.inProgress': 'W toku',
	'taskStatus.inProgressDescription': 'Zadanie aktualnie wykonywane',
	'taskStatus.question': 'Pytanie / Do wyjaśnienia',
	'taskStatus.questionDescription': 'Zadanie wymagające doprecyzowania',

	// Common Priorities
	'common.priority.highest': 'Najwyższy',
	'common.priority.high': 'Wysoki',
	'common.priority.medium': 'Średni',
	'common.priority.normal': 'Normalny',
	'common.priority.low': 'Niski',
	'common.priority.lowest': 'Najniższy',

	// Context Menu
	'contextMenu.editTask': 'Edytuj zadanie',
	'contextMenu.createNote': 'Utwórz notatkę z zadania',
	'contextMenu.createNoteAlias': 'Utwórz notatkę jako alias zadania',
	'contextMenu.statusImportant': 'Oznacz jako ważne (!)',
	'contextMenu.statusQuestion': 'Oznacz jako pytanie (?)',
	'contextMenu.statusProgress': 'Oznacz w toku (/)',
	'contextMenu.statusTodo': 'Oznacz do zrobienia ( )',
	'contextMenu.statusDone': 'Oznacz ukończone (x)',
	'contextMenu.statusCancel': 'Anuluj zadanie (-)',
	'contextMenu.postpone.title': 'Odłóż zadanie',
	'contextMenu.postpone.days1': '+1 dzień (jutro)',
	'contextMenu.postpone.days3': '+3 dni',
	'contextMenu.postpone.days7': '+7 dni (tydzień)',
	'contextMenu.setDueDate.title': 'Ustaw termin wykonania',
	'contextMenu.setDueDate.tomorrow': 'Jutro',
	'contextMenu.setDueDate.days3': 'Za 3 dni',
	'contextMenu.setDueDate.days7': 'Za 7 dni',
	'contextMenu.deleteTask': 'Usuń zadanie',
	'contextMenu.restoreTask': 'Przywróć zadanie',
	'contextMenu.commands.enterNoteName': 'Wpisz nazwę notatki',

	// Toolbar
	'toolbar.sort.options.dueDate': 'Termin wykonania',
	'toolbar.sort.options.priority': 'Priorytet',
	'toolbar.sort.options.description': 'Opis',
	'toolbar.sort.options.createdDate': 'Data utworzenia',
	'toolbar.sort.options.startDate': 'Data rozpoczęcia',
	'toolbar.sort.options.scheduledDate': 'Data zaplanowania',
	'toolbar.sort.options.completionDate': 'Data ukończenia',

	// Calendar / Festivals / Lunar
	'settings.calendarView.lunarFestival.groupTitle': 'Święta i dni wolne',
	'settings.calendarView.lunarFestival.showLunar.name': 'Pokaż święta w kalendarzu',
	'settings.calendarView.lunarFestival.showLunar.description': 'Wyświetlaj polskie święta i dni wolne w widoku roku, miesiąca i tygodnia',
	'settings.calendarView.lunarFestival.showFestivals.name': 'Wyróżnienie świąt kolorami',
	'settings.calendarView.lunarFestival.showFestivals.description': 'Wyróżniaj dni świąteczne dedykowanym kolorem',
	'settings.general.language.name': 'Język interfejsu',
	'settings.general.language.description': 'Wybierz język interfejsu wtyczki (domyślnie język Obsidian)',
	'settings.general.language.options.system': 'Zgodnie z systemem Obsidian',
	'settings.general.language.options.en': 'English',
	'settings.general.language.options.zh': '中文',
	'settings.general.language.options.pl': 'Polski',

	// Common
	'common.ok': 'OK',
	'common.cancel': 'Anuluj',
	'common.save': 'Zapisz',
	'common.close': 'Zamknij',
	'common.delete': 'Usuń',
	'common.edit': 'Edytuj',
	'common.loading': 'Ładowanie...',
	'common.recurrence.every': 'Co',
	'common.recurrence.day': 'dzień',
	'common.recurrence.days': 'dni',
	'common.recurrence.week': 'tydzień',
	'common.recurrence.weeks': 'tygodni',
	'common.recurrence.month': 'miesiąc',
	'common.recurrence.months': 'miesięcy',
	'common.recurrence.year': 'rok',
	'common.recurrence.years': 'lat',
};

function translate(key: string, params?: Record<string, unknown>): string {
	if (isPolishLanguage() && POLISH_OVERRIDES[key]) {
		return interpolate(POLISH_OVERRIDES[key], params);
	}
	const locale = isInitialized ? currentLocale : (LOCALES[getObsidianLanguage()] || en);
	let value = resolve(locale, key);
	if (value == null && locale !== en) {
		value = resolve(en, key);
	}
	if (typeof value === 'string') {
		return interpolate(value, params);
	}
	if (Array.isArray(value)) {
		return value as unknown as string;
	}
	return key;
}

export const i18n = { t: translate };
