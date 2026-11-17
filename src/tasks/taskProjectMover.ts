import { App, TFile, TFolder } from 'obsidian';
import type { GCTask, IPluginContext } from '../types';
import type { GanttCalendarSettings } from '../settings/types';
import type { CreateTaskData } from '../utils/dailyNoteHelper';
import { serializeNewTask } from '../utils/dailyNoteHelper';
import { refreshTaskView } from './taskUpdater';
import { Logger } from '../utils/logger';

/**
 * Nazwy folderów technicznych ignorowane przy automatycznym pobieraniu projektów
 */
const TECHNICAL_FOLDERS = new Set([
	'attachments',
	'dailynotes',
	'excelexports',
	'kontakty',
]);

/**
 * Pobiera listę bezpośrednich podfolderów projektów ze skonfigurowanego katalogu
 */
export function getAvailableProjectFolders(
	app: App,
	projectsFolderPath?: string
): TFolder[] {
	const rootPath = (projectsFolderPath || '11 - Notes - Trinitec Projekty').trim().replace(/\/$/, '');
	const root = app.vault.getAbstractFileByPath(rootPath);
	if (!(root instanceof TFolder)) {
		return [];
	}

	return root.children
		.filter((child): child is TFolder => child instanceof TFolder)
		.filter((folder) => {
			const nameLower = folder.name.toLowerCase();
			if (folder.name.startsWith('.')) return false;
			if (TECHNICAL_FOLDERS.has(nameLower)) return false;
			return true;
		})
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

/**
 * Sprawdza istnienie lub tworzy notatkę zadań (_tasks.md) w danym folderze projektu
 */
export async function getOrCreateProjectTasksFile(
	app: App,
	projectFolder: TFolder,
	tasksFileName?: string
): Promise<TFile> {
	const baseName = (tasksFileName || '_tasks').trim().replace(/\.md$/i, '') || '_tasks';
	const targetPath = `${projectFolder.path}/${baseName}.md`;
	const existing = app.vault.getAbstractFileByPath(targetPath);

	if (existing instanceof TFile) {
		return existing;
	}

	// Utwórz nowy plik z nagłówkiem # Zadania
	return await app.vault.create(targetPath, '# Zadania\n\n');
}

/**
 * Tworzy nowe zadanie bezpośrednio w pliku _tasks.md wybranego projektu
 */
export async function createTaskInProject(
	app: App,
	taskData: CreateTaskData,
	settings: GanttCalendarSettings,
	projectFolder: TFolder
): Promise<string> {
	const targetFile = await getOrCreateProjectTasksFile(app, projectFolder, settings.projectTasksFileName);
	const taskLine = serializeNewTask(taskData, app);

	const content = await app.vault.read(targetFile);
	const updated = content.endsWith('\n')
		? `${content}${taskLine}\n`
		: (content.length > 0 ? `${content}\n${taskLine}\n` : `${taskLine}\n`);

	await app.vault.modify(targetFile, updated);
	await refreshTaskView(app, targetFile.path);

	return targetFile.path;
}

/**
 * Bezpiecznie przenosi zadanie (oraz wszystkie jego wcięte podzadania/notatki)
 * z pliku źródłowego do pliku _tasks.md w wybranym folderze projektu.
 * Operacja jest cicha (bez wyskakujących powiadomień Notice) z natychmiastowym odświeżeniem.
 */
export async function moveTaskToProject(
	app: App,
	plugin: IPluginContext,
	task: GCTask,
	targetProjectFolder: TFolder,
	onRefresh?: () => void
): Promise<boolean> {
	try {
		const normalizedTarget = targetProjectFolder.path.replace(/\\/g, '/');
		const normalizedTaskFile = task.filePath.replace(/\\/g, '/');

		// Jeśli zadanie już znajduje się w tym folderze projektu - no-op
		if (normalizedTaskFile.startsWith(normalizedTarget + '/')) {
			return false;
		}

		const sourceFile = app.vault.getAbstractFileByPath(task.filePath);
		if (!(sourceFile instanceof TFile)) {
			Logger.error('taskProjectMover', `Source file not found: ${task.filePath}`);
			return false;
		}

		const sourceContent = await app.vault.read(sourceFile);
		const lines = sourceContent.split('\n');
		const taskLineIndex = task.lineNumber - 1;

		if (taskLineIndex < 0 || taskLineIndex >= lines.length) {
			Logger.error('taskProjectMover', `Invalid task line index: ${taskLineIndex}`);
			return false;
		}

		// Oblicz wcięcie zadania nadrzędnego
		const parentIndent = lines[taskLineIndex].match(/^\s*/)?.[0].length ?? 0;
		let lineCount = 1;

		// Pobierz wszystkie wcięte linie podrzędne (subtaski, opisy wielowierszowe)
		while (taskLineIndex + lineCount < lines.length) {
			const nextLine = lines[taskLineIndex + lineCount];

			// Puste linie sprawdzamy z wyprzedzeniem
			if (nextLine.trim().length === 0) {
				let peek = taskLineIndex + lineCount + 1;
				while (peek < lines.length && lines[peek].trim().length === 0) {
					peek++;
				}
				if (peek < lines.length) {
					const peekIndent = lines[peek].match(/^\s*/)?.[0].length ?? 0;
					if (peekIndent > parentIndent) {
						lineCount = peek + 1 - taskLineIndex;
						continue;
					}
				}
				break;
			}

			const nextIndent = nextLine.match(/^\s*/)?.[0].length ?? 0;
			if (nextIndent > parentIndent) {
				lineCount++;
			} else {
				break;
			}
		}

		// Wytnij blok zadania z pliku źródłowego
		const movedLines = lines.splice(taskLineIndex, lineCount);
		await app.vault.modify(sourceFile, lines.join('\n'));

		// Dopisz blok do pliku docelowego _tasks.md
		const targetFile = await getOrCreateProjectTasksFile(app, targetProjectFolder, plugin.settings.projectTasksFileName);
		const targetContent = await app.vault.read(targetFile);
		const blockText = movedLines.join('\n');

		const updatedTarget = targetContent.endsWith('\n')
			? `${targetContent}${blockText}\n`
			: (targetContent.length > 0 ? `${targetContent}\n${blockText}\n` : `${blockText}\n`);

		await app.vault.modify(targetFile, updatedTarget);

		// Natychmiastowe odświeżenie obu plików w pamięci podręcznej i widokach
		await refreshTaskView(app, sourceFile.path);
		await refreshTaskView(app, targetFile.path);

		onRefresh?.();
		return true;
	} catch (error) {
		Logger.error('taskProjectMover', 'Failed to move task to project:', error);
		return false;
	}
}
