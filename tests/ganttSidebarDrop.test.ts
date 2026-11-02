import { TaskDataAdapter } from '../src/gantt/adapters/taskDataAdapter';
import type { GCTask } from '../src/types';
import type { DateFieldType, GanttChartTask } from '../src/gantt/types';
import { getDateForUnit } from '../src/gantt/wrappers/dateGeometry';
import { TimeGranularity } from '../src/gantt/types';

import { formatDate } from '../src/dateUtils/dateUtilsIndex';

describe('Gantt sidebar task drop & date assignment logic', () => {
	const startField: DateFieldType = 'startDate';
	const endField: DateFieldType = 'dueDate';

	function createSidebarTask(overrides?: Partial<GCTask>): GCTask {
		return {
			filePath: 'Projekty/BRATEX.md',
			fileName: 'BRATEX.md',
			lineNumber: 42,
			content: '- [ ] Poprawić oznaczenia puszek sumujących wag',
			description: 'Poprawić oznaczenia puszek sumujących wag',
			completed: false,
			priority: 'normal',
			...overrides,
		};
	}

	it('computes unitIndex and targetDate correctly without padding offset', () => {
		const minDate = new Date(2026, 8, 26); // 2026-09-26
		const columnWidth = 50;

		// Column 0: x in [0, 50)
		const dropX0 = 25;
		const unitIndex0 = Math.max(0, Math.floor(dropX0 / columnWidth));
		expect(unitIndex0).toBe(0);
		const targetDate0 = getDateForUnit(minDate, unitIndex0, TimeGranularity.DAY);
		expect(formatDate(targetDate0, 'yyyy-MM-dd')).toBe('2026-09-26');

		// Column 32: x = 1620 (around 28 Oct 2026)
		const dropX32 = 1620;
		const unitIndex32 = Math.max(0, Math.floor(dropX32 / columnWidth));
		expect(unitIndex32).toBe(32);
		const targetDate32 = getDateForUnit(minDate, unitIndex32, TimeGranularity.DAY);
		expect(formatDate(targetDate32, 'yyyy-MM-dd')).toBe('2026-10-28');
	});

	it('assigns single-day start and due dates for a task without existing dates', () => {
		const rawTask = createSidebarTask();
		const targetDate = new Date(2026, 9, 28); // 2026-10-28

		// Task was not in Gantt view previously
		const existingGantt = TaskDataAdapter.toGanttChartTask(rawTask, startField, endField);
		expect(existingGantt).toBeNull();

		// Drop logic determination
		const hasDates = rawTask.startDate && rawTask.dueDate;
		const durationDays = hasDates
			? Math.max(0, Math.round((rawTask.dueDate!.getTime() - rawTask.startDate!.getTime()) / 86400000))
			: 0;

		const newStart = targetDate;
		const newEnd = new Date(targetDate.getTime() + durationDays * 86400000);

		expect(formatDate(newStart, 'yyyy-MM-dd')).toBe('2026-10-28');
		expect(formatDate(newEnd, 'yyyy-MM-dd')).toBe('2026-10-28');

		// Simulating the task after write-back
		const updatedTask: GCTask = {
			...rawTask,
			startDate: newStart,
			dueDate: newEnd,
			datePrecision: { [startField]: 'day', [endField]: 'day' },
		};

		// It should now qualify as a valid GanttChartTask!
		const ganttTask = TaskDataAdapter.toGanttChartTask(updatedTask, startField, endField);
		expect(ganttTask).not.toBeNull();
		expect(ganttTask!.start).toBe('2026-10-28');
		expect(ganttTask!.end).toBe('2026-10-28');
		expect(ganttTask!.name).toBe('Poprawić oznaczenia puszek sumujących wag');
	});

	it('preserves multi-day duration when dropping a task that already had dates', () => {
		const rawTask = createSidebarTask({
			startDate: new Date(2026, 9, 1),
			dueDate: new Date(2026, 9, 4), // 3 days difference
		});
		const targetDate = new Date(2026, 9, 28);

		const durationDays = Math.max(0, Math.round((rawTask.dueDate!.getTime() - rawTask.startDate!.getTime()) / 86400000));
		expect(durationDays).toBe(3);

		const newStart = targetDate;
		const newEnd = new Date(targetDate.getTime() + durationDays * 86400000);

		expect(formatDate(newStart, 'yyyy-MM-dd')).toBe('2026-10-28');
		expect(formatDate(newEnd, 'yyyy-MM-dd')).toBe('2026-10-31');

		const updatedTask: GCTask = {
			...rawTask,
			startDate: newStart,
			dueDate: newEnd,
		};
		const ganttTask = TaskDataAdapter.toGanttChartTask(updatedTask, startField, endField);
		expect(ganttTask).not.toBeNull();
		expect(ganttTask!.start).toBe('2026-10-28');
		expect(ganttTask!.end).toBe('2026-10-31');
	});

	it('maps priority colors correctly for all priority levels', () => {
		const { getPriorityBarColor } = require('../src/tasks/taskGrouper');
		expect(getPriorityBarColor('highest')).toBe('var(--priority-highest-color, #ef4444)');
		expect(getPriorityBarColor('high')).toBe('var(--priority-high-color, #f97316)');
		expect(getPriorityBarColor('medium')).toBe('var(--priority-medium-color, #eab308)');
		expect(getPriorityBarColor('normal')).toBe('var(--priority-normal-color, #3b82f6)');
		expect(getPriorityBarColor('low')).toBe('var(--priority-low-color, #6b7280)');
		expect(getPriorityBarColor('lowest')).toBe('var(--priority-lowest-color, #9ca3af)');
		expect(getPriorityBarColor('none')).toBe('var(--priority-none-color, #9ca3af)');
		expect(getPriorityBarColor(undefined)).toBe('var(--priority-normal-color, #3b82f6)');
	});

	it('compensates scrollLeft when minDate shifts earlier upon task addition', () => {
		const columnWidth = 50;
		const oldMinDate = new Date(2026, 9, 10);
		const newMinDate = new Date(2026, 9, 5); // 5 days earlier
		const savedScrollLeft = 400;

		const diffDays = Math.round((newMinDate.getTime() - oldMinDate.getTime()) / 86400000);
		const targetScrollLeft = Math.max(0, savedScrollLeft - diffDays * columnWidth);

		// diffDays is -5, so targetScrollLeft = 400 - (-5 * 50) = 650
		expect(targetScrollLeft).toBe(650);
	});
});
