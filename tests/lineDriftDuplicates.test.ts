import { MarkdownDataSource } from '../src/data-layer/MarkdownDataSource';
import { TaskRepository } from '../src/data-layer/TaskRepository';
import { EventBus } from '../src/data-layer/EventBus';
import { TFile } from 'obsidian';

function makeApp(files: Record<string, string>) {
	const fileOf = (path: string) => {
		const f = new TFile() as TFile & { extension: string; stat: { mtime: number; ctime: number; size: number } };
		f.path = path;
		f.extension = 'md';
		f.stat = { mtime: Date.now(), ctime: Date.now(), size: 100 };
		return f;
	};
	return {
		vault: {
			getAbstractFileByPath: (path: string) => fileOf(path),
			getMarkdownFiles: () => [{ path: 'a.md', extension: 'md', stat: { ctime: 0, mtime: 0, size: 0 } }],
			read: async (f: { path: string }) => files[f.path],
			on: () => ({}),
			offref: () => {},
		},
		metadataCache: { on: () => ({}) },
	} as never;
}

const anyDs = (ds: MarkdownDataSource) =>
	ds as unknown as { processFileModification: (p: string) => Promise<void> };

describe('Line drift duplicate bug in TaskRepository', () => {
	it('multiple line insertions should NOT create duplicate tasks in TaskRepository', async () => {
		const files: Record<string, string> = {
			'notes/test.md': [
				'# Header',
				'',
				'- [ ] Task 1 📅 2026-11-04',
				'- [ ] Task 2 📅 2026-11-04'
			].join('\n')
		};

		const eventBus = new EventBus();
		const repository = new TaskRepository(eventBus);

		const ds = new MarkdownDataSource(makeApp(files) as never, eventBus, {
			enabled: true,
			syncDirection: 'import-only',
			autoSync: false,
			conflictResolution: 'local-win',
			globalFilter: '',
			enabledFormats: ['tasks', 'dataview'],
		});

		repository.registerDataSource(ds);

		// Initial scan / load
		await anyDs(ds).processFileModification('notes/test.md');

		expect(repository.getAllTasks()).toHaveLength(2);
		expect(repository.getAllTasks().map(t => t.lineNumber)).toEqual([3, 4]);

		// Paste image 1 (adds 2 lines above tasks)
		files['notes/test.md'] = [
			'# Header',
			'',
			'![[img1.png]]',
			'',
			'- [ ] Task 1 📅 2026-11-04',
			'- [ ] Task 2 📅 2026-11-04'
		].join('\n');
		await anyDs(ds).processFileModification('notes/test.md');

		expect(repository.getAllTasks()).toHaveLength(2);
		expect(repository.getAllTasks().map(t => t.lineNumber)).toEqual([5, 6]);

		// Paste image 2 (adds another 2 lines above tasks)
		files['notes/test.md'] = [
			'# Header',
			'',
			'![[img1.png]]',
			'',
			'![[img2.png]]',
			'',
			'- [ ] Task 1 📅 2026-11-04',
			'- [ ] Task 2 📅 2026-11-04'
		].join('\n');
		await anyDs(ds).processFileModification('notes/test.md');

		expect(repository.getAllTasks()).toHaveLength(2);
		expect(repository.getAllTasks().map(t => t.lineNumber)).toEqual([7, 8]);
	});

	it('deleting a task after multiple line drifts cleans it up completely without orphans', async () => {
		const files: Record<string, string> = {
			'notes/test.md': [
				'# Header',
				'- [ ] Task 1 📅 2026-11-04',
				'- [ ] Task 2 📅 2026-11-04'
			].join('\n')
		};

		const eventBus = new EventBus();
		const repository = new TaskRepository(eventBus);

		const ds = new MarkdownDataSource(makeApp(files) as never, eventBus, {
			enabled: true,
			syncDirection: 'import-only',
			autoSync: false,
			conflictResolution: 'local-win',
			globalFilter: '',
			enabledFormats: ['tasks', 'dataview'],
		});

		repository.registerDataSource(ds);
		await anyDs(ds).processFileModification('notes/test.md');

		// Shift lines down
		files['notes/test.md'] = [
			'# Header',
			'Some added text 1',
			'Some added text 2',
			'- [ ] Task 1 📅 2026-11-04',
			'- [ ] Task 2 📅 2026-11-04'
		].join('\n');
		await anyDs(ds).processFileModification('notes/test.md');

		// Now remove Task 1
		files['notes/test.md'] = [
			'# Header',
			'Some added text 1',
			'Some added text 2',
			'- [ ] Task 2 📅 2026-11-04'
		].join('\n');
		await anyDs(ds).processFileModification('notes/test.md');

		expect(repository.getAllTasks()).toHaveLength(1);
		expect(repository.getAllTasks()[0].description).toBe('Task 2');
		expect(repository.getAllTasks()[0].lineNumber).toBe(4);
	});

	it('duplicate task texts in the same file shifting lines should never duplicate in cache', async () => {
		const files: Record<string, string> = {
			'notes/test.md': [
				'- [ ] Same text 📅 2026-11-04',
				'- [ ] Same text 📅 2026-11-04'
			].join('\n')
		};

		const eventBus = new EventBus();
		const repository = new TaskRepository(eventBus);

		const ds = new MarkdownDataSource(makeApp(files) as never, eventBus, {
			enabled: true,
			syncDirection: 'import-only',
			autoSync: false,
			conflictResolution: 'local-win',
			globalFilter: '',
			enabledFormats: ['tasks', 'dataview'],
		});

		repository.registerDataSource(ds);
		await anyDs(ds).processFileModification('notes/test.md');

		expect(repository.getAllTasks()).toHaveLength(2);

		// Shift lines down 3 times
		for (let i = 1; i <= 3; i++) {
			files['notes/test.md'] = '\n'.repeat(i * 2) + [
				'- [ ] Same text 📅 2026-11-04',
				'- [ ] Same text 📅 2026-11-04'
			].join('\n');
			await anyDs(ds).processFileModification('notes/test.md');
		}

		expect(repository.getAllTasks()).toHaveLength(2);
	});
});
