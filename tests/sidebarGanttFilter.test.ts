import { hasGanttDates, filterTasks, GanttFilter } from '../src/ui/sidebar/TaskListPanel';
import type { GCTask, StatusFilterState } from '../src/types';
import { DEFAULT_STATUS_FILTER_STATE } from '../src/types';

describe('Sidebar Gantt Filter', () => {
	const createMockTask = (overrides: Partial<GCTask>): GCTask => ({
		id: 'task-1',
		description: 'Test task',
		completed: false,
		cancelled: false,
		priority: 'normal',
		tags: [],
		filePath: 'folder/note.md',
		lineNumber: 10,
		...overrides,
	});

	describe('hasGanttDates', () => {
		it('returns false for task without any dates', () => {
			const task = createMockTask({});
			expect(hasGanttDates(task)).toBe(false);
		});

		it('returns false for task with only startDate', () => {
			const task = createMockTask({
				startDate: new Date('2026-10-04'),
			});
			expect(hasGanttDates(task)).toBe(false);
		});

		it('returns false for task with only dueDate', () => {
			const task = createMockTask({
				dueDate: new Date('2026-10-04'),
			});
			expect(hasGanttDates(task)).toBe(false);
		});

		it('returns true for task with both startDate and dueDate', () => {
			const task = createMockTask({
				startDate: new Date('2026-10-04'),
				dueDate: new Date('2026-10-06'),
			});
			expect(hasGanttDates(task)).toBe(true);
		});

		it('returns false when dates are invalid NaN dates', () => {
			const task = createMockTask({
				startDate: new Date('invalid-date'),
				dueDate: new Date('2026-10-06'),
			});
			expect(hasGanttDates(task)).toBe(false);
		});

		it('supports custom startField and endField', () => {
			const task = createMockTask({
				scheduledDate: new Date('2026-10-05'),
				dueDate: new Date('2026-10-08'),
			});
			expect(hasGanttDates(task, 'scheduledDate', 'dueDate')).toBe(true);
			expect(hasGanttDates(task, 'startDate', 'dueDate')).toBe(false);
		});
	});

	describe('filterTasks with ganttFilter', () => {
		const emptyStatusFilter: StatusFilterState = { ...DEFAULT_STATUS_FILTER_STATE };

		const taskInGantt = createMockTask({
			id: 'in-gantt',
			description: 'Scheduled Task',
			startDate: new Date('2026-10-01'),
			dueDate: new Date('2026-10-05'),
		});

		const taskOnlyDue = createMockTask({
			id: 'only-due',
			description: 'Needs scheduling (has due)',
			dueDate: new Date('2026-10-05'),
		});

		const taskNoDates = createMockTask({
			id: 'no-dates',
			description: 'Backlog Task without dates',
		});

		const allTasks = [taskInGantt, taskOnlyDue, taskNoDates];

		it('returns all tasks when ganttFilter is "all"', () => {
			const filtered = filterTasks(
				allTasks,
				emptyStatusFilter,
				'all',
				[],
				'OR',
				'all',
				'all'
			);
			expect(filtered).toHaveLength(3);
			expect(filtered.map(t => t.id)).toEqual(['in-gantt', 'only-due', 'no-dates']);
		});

		it('filters out tasks in Gantt when ganttFilter is "not-in-gantt"', () => {
			const filtered = filterTasks(
				allTasks,
				emptyStatusFilter,
				'all',
				[],
				'OR',
				'all',
				'not-in-gantt'
			);
			expect(filtered).toHaveLength(2);
			expect(filtered.map(t => t.id)).toEqual(['only-due', 'no-dates']);
			expect(filtered.find(t => t.id === 'in-gantt')).toBeUndefined();
		});

		it('returns only tasks in Gantt when ganttFilter is "in-gantt"', () => {
			const filtered = filterTasks(
				allTasks,
				emptyStatusFilter,
				'all',
				[],
				'OR',
				'all',
				'in-gantt'
			);
			expect(filtered).toHaveLength(1);
			expect(filtered[0].id).toBe('in-gantt');
		});

		it('combines ganttFilter with priority filter correctly', () => {
			const urgentNoDates = createMockTask({
				id: 'urgent-no-dates',
				description: 'Urgent Backlog Task',
				priority: 'highest',
			});
			const urgentInGantt = createMockTask({
				id: 'urgent-in-gantt',
				description: 'Urgent Scheduled Task',
				priority: 'highest',
				startDate: new Date('2026-10-01'),
				dueDate: new Date('2026-10-05'),
			});

			const testTasks = [...allTasks, urgentNoDates, urgentInGantt];

			const filtered = filterTasks(
				testTasks,
				emptyStatusFilter,
				'highest',
				[],
				'OR',
				'all',
				'not-in-gantt'
			);

			expect(filtered).toHaveLength(1);
			expect(filtered[0].id).toBe('urgent-no-dates');
		});
	});
});
