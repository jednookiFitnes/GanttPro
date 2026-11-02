/**
 * Moduł grupowania zadań w widoku Gantta (po folderze lub priorytecie)
 */

import type { GanttChartTask } from '../gantt/types';

export type GanttGroupMode = 'none' | 'folder' | 'priority';

export interface GanttGroupItem {
	id: string;
	type: 'group';
	title: string;
	icon: string;
	count: number;
	collapsed: boolean;
	folderPath?: string;
	priority?: string;
	badgeColor?: string;
	/** Najwcześniejszy start i najpóźniejszy koniec zadań w grupie dla klamry zbiorczej */
	earliestStart?: string;
	latestEnd?: string;
	/** Wszystkie zadania należące do grupy */
	tasks: GanttChartTask[];
}

export type GanttDisplayRow =
	| { type: 'group'; group: GanttGroupItem }
	| { type: 'task'; task: GanttChartTask; groupKey?: string; isChild?: boolean };

const PRIORITY_LABELS: Record<string, { label: string; icon: string; order: number; color: string }> = {
	'highest': { label: 'Najwyższy', icon: '🔺', order: 1, color: '#ef4444' },
	'high': { label: 'Wysoki', icon: '🔺', order: 2, color: '#f97316' },
	'medium': { label: 'Średni', icon: '🔸', order: 3, color: '#eab308' },
	'normal': { label: 'Normalny', icon: '🔹', order: 4, color: '#3b82f6' },
	'low': { label: 'Niski', icon: '🔽', order: 5, color: '#6b7280' },
	'lowest': { label: 'Najniższy', icon: '⏬', order: 6, color: '#9ca3af' },
	'none': { label: 'Brak', icon: '▫️', order: 7, color: '#9ca3af' },
};

/**
 * Zwraca informacje o priorytecie
 */
export function getPriorityInfo(priority?: string) {
	const key = (priority || 'normal').toLowerCase();
	return PRIORITY_LABELS[key] || { label: priority || 'Normalny', icon: '🔹', order: 4, color: '#3b82f6' };
}

/**
 * Zwraca kolor paska zadania na wykresie Gantta na podstawie priorytetu
 */
export function getPriorityBarColor(priority?: string): string {
	const key = (priority || 'normal').toLowerCase();
	switch (key) {
		case 'highest':
			return 'var(--priority-highest-color, #ef4444)';
		case 'high':
			return 'var(--priority-high-color, #f97316)';
		case 'medium':
			return 'var(--priority-medium-color, #eab308)';
		case 'normal':
			return 'var(--priority-normal-color, #3b82f6)';
		case 'low':
			return 'var(--priority-low-color, #6b7280)';
		case 'lowest':
			return 'var(--priority-lowest-color, #9ca3af)';
		case 'none':
			return 'var(--priority-none-color, #9ca3af)';
		default:
			return PRIORITY_LABELS[key]?.color || '#3b82f6';
	}
}

/**
 * Wyciąga pełną ścieżkę folderu z filePath zadania
 */
export function extractFullFolderPath(filePath?: string): string {
	if (!filePath) return 'Bez przypisania';
	const normalized = filePath.replace(/\\/g, '/');
	const lastSlash = normalized.lastIndexOf('/');
	if (lastSlash <= 0) return 'Katalog główny';
	return normalized.substring(0, lastSlash);
}

/**
 * Wyciąga samą nazwę ostatniego (bezpośredniego) folderu
 */
export function extractLastFolderName(filePathOrFolder?: string): string {
	if (!filePathOrFolder || filePathOrFolder === 'Bez przypisania' || filePathOrFolder === 'Katalog główny') {
		return filePathOrFolder || 'Katalog główny';
	}
	const normalized = filePathOrFolder.replace(/\\/g, '/');
	const parts = normalized.split('/').filter((p) => p.length > 0);
	if (parts.length === 0) return 'Katalog główny';
	if (parts[parts.length - 1].endsWith('.md')) {
		return parts.length >= 2 ? parts[parts.length - 2] : 'Katalog główny';
	}
	return parts[parts.length - 1];
}

/**
 * Wyciąga czytelną nazwę ostatniego folderu dla zadania
 */
export function extractFolderName(filePath?: string): string {
	return extractLastFolderName(filePath);
}

/**
 * Grupuje zadania Gantta i zwraca wiersze do wyświetlenia uwzględniając zwijanie
 */
export function groupGanttTasks(
	tasks: GanttChartTask[],
	mode: GanttGroupMode,
	collapsedGroups: Set<string>
): GanttDisplayRow[] {
	if (mode === 'none') {
		return tasks.map((t) => ({ type: 'task', task: t }));
	}

	const groupsMap = new Map<string, GanttChartTask[]>();

	if (mode === 'folder') {
		for (const task of tasks) {
			const folder = extractFullFolderPath(task.filePath);
			if (!groupsMap.has(folder)) {
				groupsMap.set(folder, []);
			}
			groupsMap.get(folder)!.push(task);
		}
	} else if (mode === 'priority') {
		for (const task of tasks) {
			const pKey = (task.priority || 'normal').toLowerCase();
			if (!groupsMap.has(pKey)) {
				groupsMap.set(pKey, []);
			}
			groupsMap.get(pKey)!.push(task);
		}
	}

	// Sortowanie grup
	const groupKeys = Array.from(groupsMap.keys());
	if (mode === 'folder') {
		groupKeys.sort((a, b) => extractLastFolderName(a).localeCompare(extractLastFolderName(b), 'pl', { numeric: true }));
	} else if (mode === 'priority') {
		groupKeys.sort((a, b) => {
			const orderA = PRIORITY_LABELS[a]?.order ?? 99;
			const orderB = PRIORITY_LABELS[b]?.order ?? 99;
			return orderA - orderB;
		});
	}

	const rows: GanttDisplayRow[] = [];

	for (const key of groupKeys) {
		const groupTasks = groupsMap.get(key) || [];
		if (groupTasks.length === 0) continue;

		const groupId = `group-${mode}-${key}`;
		const isCollapsed = collapsedGroups.has(groupId);

		// Oblicz najwcześniejszy start i najpóźniejszy koniec dla klamry
		let earliestStart = groupTasks[0].start;
		let latestEnd = groupTasks[0].end;
		for (const t of groupTasks) {
			if (t.start < earliestStart) earliestStart = t.start;
			if (t.end > latestEnd) latestEnd = t.end;
		}

		let title = key;
		let icon = '📁';
		let badgeColor: string | undefined;

		if (mode === 'folder') {
			title = extractLastFolderName(key);
			icon = '📁';
		} else if (mode === 'priority') {
			const pInfo = getPriorityInfo(key);
			title = pInfo.label;
			icon = pInfo.icon;
			badgeColor = pInfo.color;
		}

		const groupItem: GanttGroupItem = {
			id: groupId,
			type: 'group',
			title,
			icon,
			count: groupTasks.length,
			collapsed: isCollapsed,
			folderPath: mode === 'folder' ? key : undefined,
			priority: mode === 'priority' ? key : undefined,
			badgeColor,
			earliestStart,
			latestEnd,
			tasks: groupTasks,
		};

		rows.push({ type: 'group', group: groupItem });

		// Jeśli grupa nie jest zwinięta, dodaj jej zadania
		if (!isCollapsed) {
			for (const task of groupTasks) {
				rows.push({ type: 'task', task, groupKey: groupId, isChild: true });
			}
		}
	}

	return rows;
}

export type TaskGroupMode = 'none' | 'folder' | 'priority';

export interface TaskGroupItem<T> {
	id: string;
	key: string;
	mode: 'folder' | 'priority';
	title: string;
	fullPath?: string;
	icon: string;
	badgeColor?: string;
	count: number;
	tasks: T[];
}

/**
 * Uniwersalna funkcja grupująca dowolne zadania (np. GCTask) wg folderu lub priorytetu
 */
export function groupTasks<T extends { filePath?: string; priority?: string }>(
	tasks: T[],
	mode: TaskGroupMode
): TaskGroupItem<T>[] {
	if (mode === 'none') {
		return [];
	}

	const groupsMap = new Map<string, T[]>();

	if (mode === 'folder') {
		for (const task of tasks) {
			const folder = extractFullFolderPath(task.filePath);
			if (!groupsMap.has(folder)) {
				groupsMap.set(folder, []);
			}
			groupsMap.get(folder)!.push(task);
		}
	} else if (mode === 'priority') {
		for (const task of tasks) {
			const pKey = (task.priority || 'normal').toLowerCase();
			if (!groupsMap.has(pKey)) {
				groupsMap.set(pKey, []);
			}
			groupsMap.get(pKey)!.push(task);
		}
	}

	const groupKeys = Array.from(groupsMap.keys());
	if (mode === 'folder') {
		groupKeys.sort((a, b) => extractLastFolderName(a).localeCompare(extractLastFolderName(b), 'pl', { numeric: true }));
	} else if (mode === 'priority') {
		groupKeys.sort((a, b) => {
			const orderA = PRIORITY_LABELS[a]?.order ?? 99;
			const orderB = PRIORITY_LABELS[b]?.order ?? 99;
			return orderA - orderB;
		});
	}

	return groupKeys.map((key) => {
		const groupTasks = groupsMap.get(key) || [];
		const groupId = `group-${mode}-${key}`;
		let title = key;
		let icon = '📁';
		let badgeColor: string | undefined;

		if (mode === 'folder') {
			title = extractLastFolderName(key);
			icon = '📁';
		} else if (mode === 'priority') {
			const pInfo = getPriorityInfo(key);
			title = pInfo.label;
			icon = pInfo.icon;
			badgeColor = pInfo.color;
		}

		return {
			id: groupId,
			key,
			mode,
			title,
			fullPath: mode === 'folder' ? key : undefined,
			icon,
			badgeColor,
			count: groupTasks.length,
			tasks: groupTasks,
		};
	});
}

