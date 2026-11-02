import { App, MarkdownView } from 'obsidian';
import type { GCTask } from '../../types';
import { parseSingleTaskLine } from '../../tasks/taskParser/main';

/**
 * Czyści surowy tekst przeciągnięty z notatki / edytora:
 * Usuwa prefiksy listy (- [ ], * [ ], 1. [ ]), emoji Tasks pluginu,
 * pola inline Dataview oraz tagi, zostawiając właściwy opis zadania.
 */
export function cleanTaskString(text: string): string {
	if (!text) return '';
	return text
		// Usuń prefiks listy i checkboxa: np. "- [ ] ", "* [x] ", "1. [ ] ", "> - [ ] "
		.replace(/^[\s\t>]*([-*+]|\d+[.)])\s+\[.\]\s*/, '')
		// Usuń emoji z datami (Tasks plugin): 📅 2026-10-26, ⏳ 2026-10-26, 🛫 2026-10-26, ➕ 2026-10-26, 🔁 ...
		.replace(/[📅⏳🛫➕✅❌🔁]\s*\d{4}-\d{2}-\d{2}/gu, '')
		// Usuń emoji priorytetu: 🔺, ⏫, 🔼, 🔽, ⏬
		.replace(/[🔺⏫🔼🔽⏬]/gu, '')
		// Usuń pola inline Dataview: [due:: 2026-10-26], [priority:: high]
		.replace(/\[[a-zA-Z_][\w-]*::[^\]]*\]/g, '')
		// Usuń ewentualne tagi na końcu linii
		.replace(/#[a-zA-Z0-9_\-/]+/g, '')
		.trim();
}

/**
 * Inteligentnie rozwiązuje zadanie (GCTask) z operacji przeciągania (Drop).
 * Obsługuje:
 * 1. Bezpośrednie ID zadania (taskId = "filePath:lineNumber")
 * 2. Aktywną pozycję kursora / zaznaczenia w edytorze Markdown (nie trzeba zaznaczać całej linii!)
 * 3. Częściowe zaznaczenie (kilka słów, fragment nazwy zadania)
 * 4. Dopasowanie w aktywnym pliku oraz w całym skarbcu (dokładne, podciąg, słowa kluczowe)
 * 5. Dynamiczne parsowanie pojedynczej linii Markdown
 */
export function resolveTaskFromDrop(
	dataTransfer: DataTransfer | null | undefined,
	allTasks: GCTask[],
	app: App
): GCTask | null {
	if (!dataTransfer) return null;

	// ===== 1. Jawny identyfikator taskId (np. z wykresu Gantta, TaskCard, paska bar) =====
	const taskId = dataTransfer.getData('taskId')?.trim();
	if (taskId) {
		const colonIndex = taskId.lastIndexOf(':');
		if (colonIndex !== -1) {
			const filePath = taskId.substring(0, colonIndex);
			const lineNumber = parseInt(taskId.substring(colonIndex + 1), 10);
			const found = allTasks.find((t) => t.filePath === filePath && t.lineNumber === lineNumber);
			if (found) return found;
		}
	}

	const rawText = dataTransfer.getData('text/plain')?.trim() || '';

	// ===== 2. Aktywny widok edytora Markdown (kursor / linia w notatce) =====
	// Użytkownik nie musi zaznaczać całej linii – wystarczy, że kursor lub zaznaczenie
	// znajduje się na linii z taskiem w aktywnej notatce.
	const mdView = app.workspace.getActiveViewOfType(MarkdownView);
	const activeFile = mdView?.file || app.workspace.getActiveFile();

	if (activeFile && mdView?.editor) {
		try {
			const editor = mdView.editor;
			const cursor = editor.getCursor();
			const from = editor.getCursor('from');
			const to = editor.getCursor('to');

			const startLine = Math.min(cursor.line, from.line, to.line);
			const endLine = Math.max(cursor.line, from.line, to.line);

			for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
				const lineText = editor.getLine(lineNum);
				if (/^[\s\t>]*([-*+]|\d+[.)])\s+\[.\]/.test(lineText)) {
					// W GCTask lineNumber jest 1-based
					const taskOnLine = allTasks.find(
						(t) => t.filePath === activeFile.path && t.lineNumber === lineNum + 1
					);
					if (taskOnLine) {
						if (!rawText) return taskOnLine;
						const clean = cleanTaskString(rawText);
						if (
							!clean ||
							lineText.includes(rawText) ||
							lineText.includes(clean) ||
							taskOnLine.content?.includes(clean) ||
							taskOnLine.description?.includes(clean) ||
							clean.includes(taskOnLine.description || '')
						) {
							return taskOnLine;
						}
					} else {
						// Zadanie mogło nie być jeszcze zindeksowane w cache (świeżo wpisane)
						const parsed = parseSingleTaskLine(
							lineText,
							activeFile.path,
							activeFile.basename,
							lineNum + 1
						);
						if (parsed) return parsed;
					}
				}
			}
		} catch {
			// Błąd odczytu edytora (np. brak aktywnego edytora), przejdź do dopasowania tekstowego
		}
	}

	// Jeśli brak tekstu i nie znaleziono z edytora, nie mamy czym dopasować
	if (!rawText) return null;

	// ===== 3. Dopasowanie częściowego lub pełnego tekstu do zadań =====
	const clean = cleanTaskString(rawText);
	const cleanLower = clean.toLowerCase();
	const rawLower = rawText.toLowerCase();

	const fileTasks = activeFile ? allTasks.filter((t) => t.filePath === activeFile.path) : [];

	function scoreTask(t: GCTask): number {
		const desc = (t.description || '').trim();
		const descLower = desc.toLowerCase();
		const content = (t.content || '').trim();
		const contentLower = content.toLowerCase();

		// Dokładne dopasowanie opisu lub treści (100 pkt)
		if (desc === clean || content === rawText || desc === rawText || content === clean) {
			return 100;
		}
		if (descLower === cleanLower || contentLower === rawLower || descLower === rawLower) {
			return 95;
		}

		// Dopasowanie podciągu (opis zadania zawiera przeciągnięty fragment)
		if (cleanLower.length >= 2) {
			if (descLower.includes(cleanLower)) {
				return 80 + Math.min(10, (cleanLower.length / descLower.length) * 10);
			}
			if (contentLower.includes(cleanLower) || contentLower.includes(rawLower)) {
				return 75;
			}
			// Przeciągnięty tekst zawiera cały opis zadania
			if (descLower.length >= 2 && cleanLower.includes(descLower)) {
				return 70;
			}
		}

		// Dopasowanie słów kluczowych (nawet jeśli pominięto słowa łączące)
		const words = cleanLower.split(/[\s,.;:!?()[\]{}"'`~\\/+-]+/).filter((w) => w.length >= 2);
		if (words.length > 0) {
			let matched = 0;
			for (const w of words) {
				if (descLower.includes(w) || contentLower.includes(w)) {
					matched++;
				}
			}
			if (matched === words.length) {
				return 60 + matched;
			}
			if (matched >= 1 && matched / words.length >= 0.5) {
				return 45 + (matched / words.length) * 15;
			}
		}

		return 0;
	}

	// A. Najpierw sprawdź w zadaniach z aktywnego pliku
	if (fileTasks.length > 0) {
		let bestFileTask: GCTask | null = null;
		let bestFileScore = 0;
		for (const t of fileTasks) {
			const s = scoreTask(t);
			if (s > bestFileScore) {
				bestFileScore = s;
				bestFileTask = t;
			}
		}
		if (bestFileTask && bestFileScore >= 45) {
			return bestFileTask;
		}
	}

	// B. Następnie sprawdź we wszystkich zadaniach w skarbcu
	let bestGlobalTask: GCTask | null = null;
	let bestGlobalScore = 0;
	for (const t of allTasks) {
		const s = scoreTask(t);
		if (s > bestGlobalScore) {
			bestGlobalScore = s;
			bestGlobalTask = t;
		}
	}
	if (bestGlobalTask && bestGlobalScore >= 45) {
		return bestGlobalTask;
	}

	// ===== 4. Jeśli tekst to pełna linia Markdown niezindeksowana w cache =====
	if (/^[\s\t>]*([-*+]|\d+[.)])\s+\[.\]/.test(rawText)) {
		const parsed = parseSingleTaskLine(
			rawText,
			activeFile?.path || '',
			activeFile?.basename || ''
		);
		if (parsed) return parsed;
	}

	return null;
}
