import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { isChineseLanguage } from '../../i18n/i18n';
import { Notice } from 'obsidian';
import { sortTasks } from '../../tasks/taskSorter';
import { GanttClasses, ViewClasses } from '../../utils/bem';
import { Logger } from '../../utils/logger';
import { generateVirtualInstances } from '../../tasks/virtualTaskGenerator';
import {
	GanttChartAdapter,
	TaskUpdateHandler,
	TaskDataAdapter,
	type GanttChartConfig,
	type GanttChartTask,
	TimeGranularity,
} from '../../gantt';
import { i18n } from '../../i18n/i18n';
import { getTodayInTimezone } from '../../dateUtils/timezone';
import { formatDate } from '../../dateUtils/dateUtilsIndex';
import { usePlugin, useApp } from '../pluginContext';
import { useCalendarStore, selectViewFilter } from '../store/calendarStore';
import { ContextMenu } from '../components/ContextMenu';
import { buildTaskContextMenuSections } from '../components/taskContextMenu';
import type { GCTask } from '../../types';

const GANTT_CONFIG: Omit<GanttChartConfig, 'on_click' | 'on_date_change' | 'on_progress_change'> = {
	view_mode: 'week',
	granularity: TimeGranularity.DAY,
	language: isChineseLanguage() ? 'zh' : 'pl',
	header_height: 76,
	column_width: 50,
	step: 24,
	bar_height: 24,
	bar_corner_radius: 4,
	arrow_curve: 5,
	padding: 18,
	date_format: 'YYYY-MM-DD',
};

export function GanttView(): JSX.Element {
	const plugin = usePlugin();
	const app = useApp();
	const tasks = useCalendarStore((s) => s.tasks);
	const filter = useCalendarStore((s) => selectViewFilter(s, 'gantt'));
	const ganttScroll = useCalendarStore((s) => s.ganttScroll);
	const ganttGroupBy = useCalendarStore((s) => s.ganttGroupBy);
	const refreshTasks = useCalendarStore((s) => s.refreshTasks);

	const startField = plugin.settings.ganttStartField;
	const endField = plugin.settings.ganttEndField;

	const containerRef = useRef<HTMLDivElement | null>(null);
	const engineRef = useRef<GanttChartAdapter | null>(null);
	const readyRef = useRef(false);
	const syncedSigRef = useRef('');
	const lastGanttRef = useRef<GanttChartTask[]>([]);
	const hasInitializedRef = useRef(false);
	const savedScrollRef = useRef<{ scrollLeft: number; scrollTop: number } | null>(null);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const [contextMenuState, setContextMenuState] = useState<{ x: number; y: number; task: GCTask } | null>(null);

	const handleContextMenu = useCallback((ganttTask: GanttChartTask, event: MouseEvent) => {
		const foundTask = allTasksRef.current.find(
			(t) => t.filePath === ganttTask.filePath && t.lineNumber === ganttTask.lineNumber
		) || plugin?.taskCache?.getAllTasks()?.find(
			(t) => t.filePath === ganttTask.filePath && t.lineNumber === ganttTask.lineNumber
		);
		if (foundTask) {
			setContextMenuState({ x: event.clientX, y: event.clientY, task: foundTask });
		}
	}, [plugin]);

	const updateHandlerRef = useRef<TaskUpdateHandler | null>(null);
	if (!updateHandlerRef.current) {
		updateHandlerRef.current = new TaskUpdateHandler(app, plugin);
	}

	const filteredTasks = useMemo(() => {
		const withAssigned = TaskDataAdapter.applyFilters(
			tasks,
			filter.status,
			filter.tag.selectedTags,
			filter.tag.operator
		);
		return sortTasks(withAssigned, filter.sort);
	}, [tasks, filter]);

	// 重复任务：为甘特图生成虚拟实例
	const tasksWithVirtuals = useMemo(() => {
		const recurringLimit = plugin.settings.recurringTaskDisplayLimit ?? 5;
		const ref = new Date();
		const rangeStart = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
		const rangeEnd = new Date(ref.getFullYear() + 1, ref.getMonth(), ref.getDate());
		const virtuals = generateVirtualInstances(
			filteredTasks, rangeStart, rangeEnd,
			startField, recurringLimit,
		);
		return [...filteredTasks, ...virtuals];
	}, [filteredTasks, startField, plugin.settings.recurringTaskDisplayLimit]);

	const ganttTasks = useMemo(() => (
		TaskDataAdapter.toGanttChartTasks(tasksWithVirtuals, startField, endField)
	), [tasksWithVirtuals, startField, endField]);

	const hasTasks = ganttTasks.length > 0;

	const tasksRef = useRef(filteredTasks);
	tasksRef.current = filteredTasks;
	const allTasksRef = useRef(tasks);
	allTasksRef.current = tasks;
	const ganttTasksRef = useRef(ganttTasks);
	ganttTasksRef.current = ganttTasks;
	const startFieldRef = useRef(startField);
	startFieldRef.current = startField;
	const endFieldRef = useRef(endField);
	endFieldRef.current = endField;

	const handleTaskClick = useCallback((ganttTask: GanttChartTask) => {
		updateHandlerRef.current?.handleTaskClick(ganttTask, tasksRef.current);
	}, []);

	const handleDateChange = useCallback(async (ganttTask: GanttChartTask, start: Date, end: Date) => {
		const updateHandler = updateHandlerRef.current;
		if (!updateHandler) return;
		if (!TaskUpdateHandler.validateDateChange(start, end)) {
			new Notice(i18n.t('views.ganttView.invalidDateRange'));
			return;
		}
		try {
			await updateHandler.handleDateChange(
				ganttTask,
				start,
				end,
				startFieldRef.current,
				endFieldRef.current,
				tasksRef.current
			);
			refreshTasks();
		} catch (error) {
			Logger.error('GanttView', 'Error handling date change:', error);
		}
	}, [refreshTasks]);

	const handleProgressChange = useCallback(async (ganttTask: GanttChartTask, progress: number) => {
		const updateHandler = updateHandlerRef.current;
		if (!updateHandler) return;
		try {
			await updateHandler.handleProgressChange(ganttTask, progress, tasksRef.current);
			refreshTasks();
		} catch (error) {
			Logger.error('GanttView', 'Error handling progress change:', error);
		}
	}, [refreshTasks]);

	const config = useMemo<GanttChartConfig>(() => ({
		...GANTT_CONFIG,
		group_by: ganttGroupBy,
		on_click: handleTaskClick,
		on_context_menu: handleContextMenu,
		on_date_change: (task, start, end) => { void handleDateChange(task, start, end); },
		on_progress_change: (task, progress) => { void handleProgressChange(task, progress); },
	}), [ganttGroupBy, handleTaskClick, handleContextMenu, handleDateChange, handleProgressChange]);

	const destroyEngine = useCallback(() => {
		if (engineRef.current) {
			savedScrollRef.current = engineRef.current.getScrollPosition();
			engineRef.current.destroy();
			engineRef.current = null;
		}
		readyRef.current = false;
		syncedSigRef.current = '';
		lastGanttRef.current = [];
	}, []);

	const buildEngine = useCallback(() => {
		const el = containerRef.current;
		if (!el || engineRef.current) return;
		const engine = new GanttChartAdapter(
			el,
			config,
			plugin,
			allTasksRef.current,
			startFieldRef.current,
			endFieldRef.current
		);
		engineRef.current = engine;
		readyRef.current = false;
		void engine.init(ganttTasksRef.current).then(() => {
			readyRef.current = true;
			setErrorMsg(null);
			syncedSigRef.current = tasksSignature(ganttTasksRef.current);
			lastGanttRef.current = ganttTasksRef.current;
			if (!hasInitializedRef.current) {
				hasInitializedRef.current = true;
				engine.scrollToToday();
			} else if (savedScrollRef.current) {
				engine.setScrollPosition(savedScrollRef.current.scrollLeft, savedScrollRef.current.scrollTop);
			}
		}).catch((error) => {
			Logger.error('GanttView', 'Error initializing gantt:', error);
			setErrorMsg((error as Error).message);
		});
	}, [config, plugin]);

	useEffect(() => {
		const engine = engineRef.current;
		if (engine && readyRef.current) {
			engine.setOriginalTasks(tasks);
		}
	}, [tasks]);

	useEffect(() => {
		if (!hasTasks) return;
		buildEngine();
		return () => destroyEngine();
	}, [hasTasks, startField, endField, buildEngine, destroyEngine]);

	useEffect(() => {
		const engine = engineRef.current;
		if (!engine || !readyRef.current || !hasTasks) return;
		const sig = tasksSignature(ganttTasks);
		if (sig === syncedSigRef.current) return;
		syncedSigRef.current = sig;
		lastGanttRef.current = ganttTasks;
		engine.updateTasks(ganttTasks);
	}, [ganttTasks, hasTasks, startField, endField]);

	useEffect(() => {
		const engine = engineRef.current;
		if (engine && readyRef.current) {
			engine.updateConfig({ group_by: ganttGroupBy });
		}
	}, [ganttGroupBy]);

	useEffect(() => {
		const engine = engineRef.current;
		if (!engine || !readyRef.current || !hasTasks || !ganttScroll) return;
		switch (ganttScroll.action) {
			case 'left': engine.scrollToLeft(); break;
			case 'today': engine.scrollToToday(); break;
			case 'right': engine.scrollToRight(); break;
		}
	}, [ganttScroll, hasTasks]);

	const emptyReasons = useMemo(() => {
		const reasons: string[] = [];
		if (filter.status.selectedStatuses.length > 0) {
			reasons.push(i18n.t('views.ganttView.currentFilter', { count: filter.status.selectedStatuses.length }));
		}
		if (filter.tag.selectedTags.length > 0) {
			reasons.push(i18n.t('views.ganttView.tagFilter', { tags: filter.tag.selectedTags.join(', ') }));
		}
		if (!startField || !endField) {
			reasons.push(i18n.t('views.ganttView.missingFieldConfig'));
		}
		return reasons;
	}, [filter, startField, endField]);

	const handleEmptyStateDrop = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		const taskId = e.dataTransfer?.getData('taskId');
		if (!taskId) return;
		const colonIndex = taskId.lastIndexOf(':');
		if (colonIndex === -1) return;
		const filePath = taskId.substring(0, colonIndex);
		const lineNumber = parseInt(taskId.substring(colonIndex + 1), 10);
		const sourceTask = tasks.find((t) => t.filePath === filePath && t.lineNumber === lineNumber)
			|| plugin?.taskCache?.getAllTasks()?.find((t) => t.filePath === filePath && t.lineNumber === lineNumber);
		if (!sourceTask) return;
		const today = getTodayInTimezone();
		const syntheticGanttTask: GanttChartTask = {
			id: `${sourceTask.filePath}:${sourceTask.lineNumber}`,
			name: sourceTask.description || sourceTask.content,
			start: formatDate(today, 'yyyy-MM-dd'),
			end: formatDate(today, 'yyyy-MM-dd'),
			progress: sourceTask.completed ? 100 : 0,
			filePath: sourceTask.filePath,
			fileName: sourceTask.fileName,
			lineNumber: sourceTask.lineNumber,
			content: sourceTask.content,
			description: sourceTask.description,
			tags: sourceTask.tags,
			priority: sourceTask.priority,
			format: sourceTask.format,
			status: sourceTask.status,
			completed: sourceTask.completed,
			cancelled: sourceTask.cancelled,
			createdDate: sourceTask.createdDate,
			startDate: sourceTask.startDate,
			dueDate: sourceTask.dueDate,
			scheduledDate: sourceTask.scheduledDate,
			cancelledDate: sourceTask.cancelledDate,
			completionDate: sourceTask.completionDate,
			datePrecision: sourceTask.datePrecision,
			startSourceField: startField,
		};
		void handleDateChange(syntheticGanttTask, today, today);
	}, [tasks, plugin, startField, handleDateChange]);

	if (!hasTasks) {
		return (
			<div
				className={`${ViewClasses.block} ${ViewClasses.modifiers.gantt}`}
				onDragOver={(e) => {
					e.preventDefault();
					e.dataTransfer.dropEffect = 'move';
					e.currentTarget.classList.add(GanttClasses.modifiers.chartDropTarget);
				}}
				onDragLeave={(e) => {
					const related = e.relatedTarget as HTMLElement | null;
					if (related && e.currentTarget.contains(related)) return;
					e.currentTarget.classList.remove(GanttClasses.modifiers.chartDropTarget);
				}}
				onDrop={(e) => {
					e.currentTarget.classList.remove(GanttClasses.modifiers.chartDropTarget);
					handleEmptyStateDrop(e);
				}}
			>
				<div className={GanttClasses.elements.emptyState}>
					<div className={GanttClasses.elements.emptyIcon}>{'📊'}</div>
					<h3 className={GanttClasses.elements.emptyTitle}>{i18n.t('views.ganttView.emptyTitle')}</h3>
					{emptyReasons.length > 0 ? (
						<p className={GanttClasses.elements.emptyReason}>
							{i18n.t('views.ganttView.possibleReasons')}{emptyReasons.join(', ')}
						</p>
					) : null}
					<p className={GanttClasses.elements.emptyHint}>{i18n.t('views.ganttView.checkDatesHint')}</p>
				</div>
			</div>
		);
	}

	return (
		<div className={`${ViewClasses.block} ${ViewClasses.modifiers.gantt}`}>
			{errorMsg ? (
				<div className={GanttClasses.elements.error}>
					{i18n.t('views.ganttView.renderError')}{errorMsg}
				</div>
			) : null}
			<div className={GanttClasses.elements.container}>
				<div ref={containerRef} className={GanttClasses.elements.root} />
			</div>
			{contextMenuState ? (
				<ContextMenu
					state={{ x: contextMenuState.x, y: contextMenuState.y }}
					sections={buildTaskContextMenuSections(app, plugin, contextMenuState.task, refreshTasks)}
					onClose={() => setContextMenuState(null)}
				/>
			) : null}
		</div>
	);
}

function tasksSignature(tasks: GanttChartTask[]): string {
	return tasks.map((t) => `${t.id}|${t.start}|${t.end}|${t.leadStart || ''}|${t.progress}|${t.completed}|${t.priority || ''}|${t.name}|${t.custom_class || ''}`).join('\u0001');
}

/**
 * Full engine rebuild is only needed when the row ORDER changes: bars are
 * positioned by row index, so an insert in the middle shifts every row below.
 * Appending or removing at the tail keeps the prefix sequence intact and can
 * be handled incrementally by the renderer (with stable task ids).
 */
function shouldFullRefresh(oldTasks: GanttChartTask[], newTasks: GanttChartTask[]): boolean {
	const commonLength = Math.min(oldTasks.length, newTasks.length);
	for (let i = 0; i < commonLength; i++) {
		if (oldTasks[i].id !== newTasks[i].id) return true;
	}
	return false;
}