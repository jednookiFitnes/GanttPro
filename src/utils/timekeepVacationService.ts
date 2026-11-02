import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';
import type { IPluginContext } from '../types';
import { Logger } from './logger';

export interface VacationEntryInfo {
	dateKey: string;      // YYYY-MM-DD
	project: string;      // np. "99-001 - NIEOBECNOŚCI"
	type: string;         // np. "U_W - urlop wypoczynkowy"
	remarks?: string;
}

function formatDateKey(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/**
 * Serwis integrujący wtyczkę Gantt Calendar Pro z danymi urlopowymi z Timekeep Pro.
 * Odczytuje zarejestrowane godziny i dni wolne oraz buforuje je dla silnika Gantta.
 */
export class TimekeepVacationService {
	private app: App;
	private plugin: IPluginContext;
	private vacationMap: Map<string, VacationEntryInfo> = new Map();
	private isWatching = false;
	private unsubscribeWatchAll: (() => void) | null = null;

	constructor(app: App, plugin: IPluginContext) {
		this.app = app;
		this.plugin = plugin;
	}

	private isProjectMatch(project: string): boolean {
		const configuredProject = (this.plugin.settings.vacationTimekeepProject || '99-001 - NIEOBECNOŚCI').trim().toLowerCase();
		const normProject = (project || '').trim().toLowerCase();
		return normProject.includes(configuredProject) || (configuredProject.length > 0 && configuredProject.includes(normProject));
	}

	private isTypeMatch(type: string): boolean {
		const configuredTypesStr = (this.plugin.settings.vacationTimekeepTypes || 'U_W - urlop wypoczynkowy').trim();
		const normType = (type || '').trim().toLowerCase();
		const allowedTypes = configuredTypesStr
			.split(',')
			.map(t => t.trim().toLowerCase())
			.filter(Boolean);

		if (allowedTypes.length === 0) {
			return true;
		}

		return allowedTypes.some(allowed => normType === allowed || normType.startsWith(allowed) || normType.includes(allowed));
	}

	/**
	 * Rekurencyjne przetwarzanie wpisów Timekeep (pojedyncze i grupy z podwpisami)
	 */
	private processEntry(
		entry: any,
		parentProject?: string,
		parentType?: string,
		targetMap: Map<string, VacationEntryInfo> = this.vacationMap
	): void {
		if (!entry || typeof entry !== 'object') return;

		const hasOwnProj = Boolean(entry.project && entry.project.trim());
		const hasOwnType = Boolean(entry.type && entry.type.trim());

		const isParentProjMatched = Boolean(parentProject && this.isProjectMatch(parentProject));
		const isParentTypeMatched = Boolean(parentType && this.isTypeMatch(parentType));

		const projToTest = hasOwnProj ? entry.project : (parentProject || '');
		const typeToTest = hasOwnType ? entry.type : (parentType || '');

		const isProjMatched = isParentProjMatched || this.isProjectMatch(projToTest);
		const isTypeMatched = isParentTypeMatched || this.isTypeMatch(typeToTest);

		const effProject = isParentProjMatched ? parentProject! : projToTest;
		const effType = isParentTypeMatched ? parentType! : typeToTest;

		if (Array.isArray(entry.subEntries) && entry.subEntries.length > 0) {
			for (const sub of entry.subEntries) {
				this.processEntry(sub, effProject, effType, targetMap);
			}
		}

		if (isProjMatched && isTypeMatched && entry.startTime) {
			const startDate = new Date(entry.startTime);
			if (!isNaN(startDate.getTime())) {
				const startKey = formatDateKey(startDate);
				targetMap.set(startKey, {
					dateKey: startKey,
					project: effProject,
					type: effType,
					remarks: entry.remarks || '',
				});

				if (entry.endTime) {
					const endDate = new Date(entry.endTime);
					if (!isNaN(endDate.getTime())) {
						const cur = new Date(startDate);
						cur.setDate(cur.getDate() + 1);
						while (cur <= endDate) {
							const curKey = formatDateKey(cur);
							targetMap.set(curKey, {
								dateKey: curKey,
								project: effProject,
								type: effType,
								remarks: entry.remarks || '',
							});
							cur.setDate(cur.getDate() + 1);
						}
					}
				}
			}
		}
	}

	/**
	 * Załaduj wszystkie urlopy z wtyczki Timekeep (zarówno przez API jak i system plików)
	 */
	async loadVacations(): Promise<void> {
		if (!this.plugin.settings.vacationHighlightEnabled) {
			this.vacationMap.clear();
			return;
		}

		const newMap = new Map<string, VacationEntryInfo>();
		let loadedViaApi = false;

		try {
			const timekeepPlugin = (this.app as any).plugins?.getPlugin('timekeep-pro')
				|| (this.app as any).plugins?.getPlugin('timekeep');

			if (timekeepPlugin?.dataService) {
				const items = await timekeepPlugin.dataService.loadAll();
				if (Array.isArray(items)) {
					for (const item of items) {
						if (item.timekeep && Array.isArray(item.timekeep.entries)) {
							for (const entry of item.timekeep.entries) {
								this.processEntry(entry, undefined, undefined, newMap);
							}
						}
					}
					loadedViaApi = true;
				}

				if (!this.unsubscribeWatchAll && typeof timekeepPlugin.dataService.watchAll === 'function') {
					this.unsubscribeWatchAll = timekeepPlugin.dataService.watchAll(() => {
						void this.loadVacations().then(() => {
							this.plugin.refreshCalendarViews();
						});
					});
				}
			}
		} catch (e) {
			Logger.warn('TimekeepVacationService', 'Nie udało się pobrać danych przez API Timekeep:', e);
		}

		// Fallback lub uzupełnienie z plików na dysku
		try {
			const dirsToCheck = [
				`${this.app.vault.configDir}/plugins/timekeep-pro/data`,
				`${this.app.vault.configDir}/plugins/timekeep/data`
			];

			for (const dir of dirsToCheck) {
				const normDir = typeof normalizePath === 'function' ? normalizePath(dir) : dir.replace(/\\/g, '/');
				const exists = await this.app.vault.adapter.exists(normDir);
				if (!exists) continue;

				const list = await this.app.vault.adapter.list(normDir);
				for (const file of list.files) {
					if (!file.endsWith('.timekeep.json')) continue;
					try {
						const rawText = await this.app.vault.adapter.read(file);
						const data = JSON.parse(rawText);
						if (data && Array.isArray(data.entries)) {
							for (const entry of data.entries) {
								this.processEntry(entry, undefined, undefined, newMap);
							}
						}
					} catch (parseErr) {
						// Pomiń uszkodzony pojedynczy plik
					}
				}
			}
		} catch (fileErr) {
			Logger.warn('TimekeepVacationService', 'Błąd podczas odczytu plików sidecar Timekeep:', fileErr);
		}

		this.vacationMap = newMap;
		this.ensureWatcher();
	}

	/**
	 * Rejestruje nasłuchiwanie na modyfikacje plików w vault
	 */
	private ensureWatcher(): void {
		if (this.isWatching) return;
		this.isWatching = true;

		// Nasłuchuj na modyfikacje plików .timekeep.json w przechowalni
		this.app.vault.on('modify', (file) => {
			if (file.path && file.path.endsWith('.timekeep.json')) {
				void this.loadVacations().then(() => {
					this.plugin.refreshCalendarViews();
				});
			}
		});
	}

	/**
	 * Sprawdza czy dany dzień jest dniem urlopowym
	 */
	getVacation(date: Date): VacationEntryInfo | null {
		if (!this.plugin.settings.vacationHighlightEnabled) return null;
		const key = formatDateKey(date);
		return this.vacationMap.get(key) || null;
	}

	/**
	 * Zwraca mapę wszystkich załadowanych urlopów
	 */
	getAllVacations(): Map<string, VacationEntryInfo> {
		return this.vacationMap;
	}

	/**
	 * Sprzątanie zasobów
	 */
	destroy(): void {
		if (this.unsubscribeWatchAll) {
			this.unsubscribeWatchAll();
			this.unsubscribeWatchAll = null;
		}
		this.vacationMap.clear();
	}
}
