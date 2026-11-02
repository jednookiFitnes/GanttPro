import { normalizeFolderPath, isPathInFolder, isFileAllowed } from '../src/utils/folderFilter';

describe('folderFilter', () => {
	describe('normalizeFolderPath', () => {
		it('normalizes slashes and whitespace', () => {
			expect(normalizeFolderPath('  folder/subfolder/  ')).toBe('folder/subfolder');
			expect(normalizeFolderPath('\\folder\\subfolder\\')).toBe('folder/subfolder');
			expect(normalizeFolderPath('/folder/sub/')).toBe('folder/sub');
			expect(normalizeFolderPath('')).toBe('');
		});
	});

	describe('isPathInFolder', () => {
		it('matches direct children and deeper subfolders', () => {
			expect(isPathInFolder('Notes/Work/task.md', 'Notes')).toBe(true);
			expect(isPathInFolder('Notes/Work/task.md', 'Notes/Work')).toBe(true);
			expect(isPathInFolder('Notes/task.md', 'Notes')).toBe(true);
		});

		it('does not match sibling folders with same prefix', () => {
			expect(isPathInFolder('Notes2/task.md', 'Notes')).toBe(false);
			expect(isPathInFolder('Notes_Archive/task.md', 'Notes')).toBe(false);
			expect(isPathInFolder('Notes.md', 'Notes')).toBe(false);
		});

		it('is case-insensitive', () => {
			expect(isPathInFolder('notes/work/task.md', 'Notes')).toBe(true);
			expect(isPathInFolder('Notes/Work/task.md', 'notes/work')).toBe(true);
		});

		it('returns false for empty folder path', () => {
			expect(isPathInFolder('Notes/task.md', '')).toBe(false);
		});
	});

	describe('isFileAllowed', () => {
		it('allows all files when both include and exclude are empty', () => {
			expect(isFileAllowed('Notes/task.md', [], [])).toBe(true);
			expect(isFileAllowed('Projects/Client/spec.md')).toBe(true);
			expect(isFileAllowed('root.md')).toBe(true);
		});

		it('filters by includeFolders (whitelist)', () => {
			const includes = ['Projects', 'Tasks'];
			expect(isFileAllowed('Projects/p1.md', includes, [])).toBe(true);
			expect(isFileAllowed('Projects/nested/sub.md', includes, [])).toBe(true);
			expect(isFileAllowed('Tasks/daily.md', includes, [])).toBe(true);
			expect(isFileAllowed('Personal/diary.md', includes, [])).toBe(false);
			expect(isFileAllowed('root.md', includes, [])).toBe(false);
		});

		it('filters by excludeFolders (blacklist)', () => {
			const excludes = ['Archive', 'Templates'];
			expect(isFileAllowed('Projects/active.md', [], excludes)).toBe(true);
			expect(isFileAllowed('Archive/old.md', [], excludes)).toBe(false);
			expect(isFileAllowed('Templates/daily.md', [], excludes)).toBe(false);
			expect(isFileAllowed('Archive/nested/old.md', [], excludes)).toBe(false);
		});

		it('gives excludeFolders precedence over includeFolders', () => {
			const includes = ['Projects'];
			const excludes = ['Projects/Archive', 'Projects/Secret'];

			expect(isFileAllowed('Projects/active.md', includes, excludes)).toBe(true);
			expect(isFileAllowed('Projects/Archive/2025.md', includes, excludes)).toBe(false);
			expect(isFileAllowed('Projects/Secret/passwords.md', includes, excludes)).toBe(false);
			expect(isFileAllowed('Personal/note.md', includes, excludes)).toBe(false);
		});

		it('handles slashes in configured folders gracefully', () => {
			const includes = ['/Projects/'];
			const excludes = ['\\Projects\\Archive\\'];

			expect(isFileAllowed('Projects/active.md', includes, excludes)).toBe(true);
			expect(isFileAllowed('Projects/Archive/old.md', includes, excludes)).toBe(false);
		});
	});
});
