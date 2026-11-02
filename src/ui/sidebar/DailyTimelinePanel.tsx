import { useCallback, useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import { Notice } from 'obsidian';
import type { GCTask, StatusFilterState } from '../../types';
import { DEFAULT_STATUS_FILTER_STATE } from '../../types';
import type { DateFieldType } from '../../settings/types';
import { i18n } from '../../i18n/i18n';
import { SidebarClasses } from '../../utils/bem';
import { buildSidebarConfig } from '../../components/TaskCard';
import { getTodayInTimezone } from '../../dateUtils/timezone';
import { formatDate } from '../../dateUtils/dateUtilsIndex';
import { updateTaskProperties } from '../../tasks/taskUpdater';
import { generateVirtualInstances } from '../../tasks/virtualTaskGenerator';
import { getTaskInterval, buildDayTimelineModel, formatMinutes } from '../views/week/timelineModel';
import { DayTimelineCanvas } from '../views/week/DayTimelineCanvas';
import { Logger } from '../../utils/logger';
import { usePlugin, useApp } from '../pluginContext';
import { useCalendarStore } from '../store/calendarStore';
import { useDropTarget } from '../utils/useDragAndDrop';
import { resolveTaskFromDrop } from '../utils/taskDropResolver';
import { Icon } from '../components/Icon';
import { TaskCard } from '../components/TaskCard';
import { DropdownMenu, type DropdownMenuSection } from '../components/DropdownMenu';
import { TagTreeFilter } from '../components/TagTreeFilter';
import { DEFAULT_TASK_STATUSES, type TaskStatus } from '../../tasks/taskStatus';
import { getPriorityBarColor } from '../../tasks/taskGrouper';

type PriorityFilter = 'all' | 'highest' | 'high' | 'medium' | 'normal' | 'low' | 'lowest';

function getPriorities(): Array<{ key: PriorityFilter; label: string }> {
	return [
		{ key: 'all', label: i18n.t('sidebar.taskList.priority.all') },
		{ key: 'highest', label: i18n.t('sidebar.taskList.priority.highest') },
		{ key: 'high', label: i18n.t('sidebar.taskList.priority.high') },
		{ key: 'medium', label: i18n.t('sidebar.taskList.priority.medium') },
		{ key: 'normal', label: i18n.t('sidebar.taskList.priority.normal') },
		{ key: 'low', label: i18n.t('sidebar.taskList.priority.low') },
		{ key: 'lowest', label: i18n.t('sidebar.taskList.priority.lowest') },
	];
}

function inferStatus(task: GCTask): string {
	if (task.status) return task.status;
	if (task.completed) return 'done';
	if (task.cancelled) return 'canceled';
	return 'todo';
}

/** dataTransfer.taskId（filePath:lineNumber）→ 任务查找 */
function findTaskById(tasks: GCTask[], taskId: string, fallbackTasks?: GCTask[]): GCTask | null {
	const colonIndex = taskId.lastIndexOf(':');
	if (colonIndex === -1) return null;
	const filePath = taskId.substring(0, colonIndex);
	const lineNumber = parseInt(taskId.substring(colonIndex + 1), 10);
	return (
		tasks.find((t) => t.filePath === filePath && t.lineNumber === lineNumber) ||
		fallbackTasks?.find((t) => t.filePath === filePath && t.lineNumber === lineNumber) ||
		null
	);
}

/** 归零到本地午夜（Date 比较以 getTime 为准，需先抹平时分秒） */
function atMidnight(date: Date): Date {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}

/** 按日历日平移：跨月/跨年/闰日由 Date 归一化，仍是本地午夜 */
function shiftDay(date: Date, delta: number): Date {
	const d = new Date(date);
	d.setDate(d.getDate() + delta);
	d.setHours(0, 0, 0, 0);
	return d;
}

/**
 * 侧边栏 — 每日时间线 Tab（连续画布版）
 * 日期默认"今天"，标题行右侧导航可前后切换；跨天后跟随态自动前进。
 * 支持搜索与按状态、优先级、标签筛选及快速隐藏已完成任务。
 * 全天区域（含 ≥24h 长区间任务）+ 共享单日连续画布 DayTimelineCanvas
 */
export function DailyTimelinePanel(): JSX.Element {
	const plugin = usePlugin();
	const app = useApp();
	const tasks = useCalendarStore((s) => s.tasks);
	const refreshTasks = useCalendarStore((s) => s.refreshTasks);

	/** 手动选定的日期；null = 跟随"今天"（默认态，时钟跨天后自动前进） */
	const [pickedDate, setPickedDate] = useState<Date | null>(null);
	const [today, setToday] = useState<Date>(() => atMidnight(getTodayInTimezone()));
	const day = pickedDate ?? today;

	// 筛选状态
	const [searchQuery, setSearchQuery] = useState('');
	const [debouncedQuery, setDebouncedQuery] = useState('');
	const [statusFilter, setStatusFilter] = useState<StatusFilterState>({ ...DEFAULT_STATUS_FILTER_STATE });
	const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
	const [selectedTags, setSelectedTags] = useState<string[]>([]);
	const [tagOperator, setTagOperator] = useState<'OR' | 'AND' | 'NOT'>('OR');
	const [hideCompleted, setHideCompleted] = useState(false);
	const [viewMode, setViewMode] = useState<'canvas' | 'agenda'>(() => plugin.settings.sidebarTimelineViewMode || 'canvas');

	const toggleViewMode = useCallback(() => {
		const next = viewMode === 'canvas' ? 'agenda' : 'canvas';
		setViewMode(next);
		plugin.settings.sidebarTimelineViewMode = next;
		void plugin.saveSettings();
	}, [viewMode, plugin]);

	// 长时间挂起的侧栏（休眠恢复/跨天）：刷新"今天"基线；已手动选定的日期不受影响
	useEffect(() => {
		const syncToday = (): void => {
			const fresh = atMidnight(getTodayInTimezone());
			setToday((prev) => (prev.getTime() === fresh.getTime() ? prev : fresh));
		};
		const onWake = (): void => {
			if (!document.hidden) syncToday();
		};
		document.addEventListener('visibilitychange', onWake);
		window.addEventListener('focus', onWake);
		return () => {
			document.removeEventListener('visibilitychange', onWake);
			window.removeEventListener('focus', onWake);
		};
	}, []);

	// 搜索防抖
	useEffect(() => {
		const t = window.setTimeout(() => setDebouncedQuery(searchQuery.trim().toLowerCase()), 300);
		return () => window.clearTimeout(t);
	}, [searchQuery]);

	// 标签聚合计数
	const tagCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const task of tasks) {
			if (task.tags) {
				for (const tag of task.tags) {
					counts.set(tag, (counts.get(tag) || 0) + 1);
				}
			}
		}
		return counts;
	}, [tasks]);

	const config = useMemo(() => buildSidebarConfig(plugin.settings), [plugin.settings]);
	// 时间线内统一使用紧凑变体，高度由块容器按时长撑开
	const timelineConfig = useMemo(() => ({
		...config,
		showFolder: plugin.settings.sidebarShowFolder ?? true,
		variant: 'timeline' as const,
	}), [config, plugin.settings.sidebarShowFolder]);

	// 侧栏语义保持以 dueDate 为读取字段；区间路由用 gantt 起止字段（与周视图一致）
	const dateField: DateFieldType = 'dueDate';
	const startField = plugin.settings.ganttStartField || 'startDate';
	const endField = plugin.settings.ganttEndField || 'dueDate';
	const enabledFormats = plugin.settings.enabledTaskFormats || [];

	// 过滤候选任务
	const candidates = useMemo(() => {
		let result = tasks;

		if (statusFilter.selectedStatuses.length > 0) {
			result = result.filter((t) => statusFilter.selectedStatuses.includes(inferStatus(t)));
		} else {
			// 默认排除已取消任务
			result = result.filter((t) => !t.cancelled);
		}

		if (hideCompleted) {
			result = result.filter((t) => !t.completed);
		}

		if (priorityFilter !== 'all') {
			result = result.filter((t) => (t.priority || 'normal') === priorityFilter);
		}

		if (selectedTags.length > 0) {
			const selectedLower = selectedTags.map((t) => t.toLowerCase());
			result = result.filter((t) => {
				if (!t.tags || t.tags.length === 0) return tagOperator === 'NOT';
				const taskLower = t.tags.map((tag) => tag.toLowerCase());
				const matches = (sel: string) =>
					taskLower.some((taskTag) => taskTag === sel || taskTag.startsWith(sel + '/'));
				if (tagOperator === 'OR') return selectedLower.some(matches);
				if (tagOperator === 'AND') return selectedLower.every(matches);
				return !selectedLower.some(matches);
			});
		}

		if (debouncedQuery) {
			result = result.filter((t) =>
				(t.description || '').toLowerCase().includes(debouncedQuery) ||
				(t.content || '').toLowerCase().includes(debouncedQuery) ||
				(t.filePath || '').toLowerCase().includes(debouncedQuery)
			);
		}

		return result;
	}, [tasks, statusFilter, hideCompleted, priorityFilter, selectedTags, tagOperator, debouncedQuery]);

	const model = useMemo(() => {
		const virtualInstances = generateVirtualInstances(
			candidates,
			day,
			day,
			dateField,
			plugin.settings.recurringTaskDisplayLimit ?? 5
		);
		const combined = statusFilter.selectedStatuses.includes('canceled')
			? [...candidates, ...virtualInstances]
			: [...candidates, ...virtualInstances].filter((t) => !t.cancelled);
		return buildDayTimelineModel(combined, day, startField, endField, dateField);
	}, [candidates, day, startField, endField, dateField, statusFilter.selectedStatuses, plugin.settings.recurringTaskDisplayLimit]);

	// Posortowane chronologicznie zadania z godzinami dla widoku agendy (Problem 1: Opcja C)
	const agendaItems = useMemo(() => {
		return [...model.blocks].sort((a, b) => {
			if (a.seg.startMin !== b.seg.startMin) {
				return a.seg.startMin - b.seg.startMin;
			}
			return (a.seg.endMin - a.seg.startMin) - (b.seg.endMin - b.seg.startMin);
		});
	}, [model.blocks]);

	// ===== 状态筛选菜单 =====
	const statusSections: DropdownMenuSection[] = useMemo(() => {
		const statuses: TaskStatus[] = plugin.settings.taskStatuses || DEFAULT_TASK_STATUSES;
		return [{
			items: statuses.map((status) => ({
				key: `status-${status.key}`,
				title: status.name,
				checked: statusFilter.selectedStatuses.includes(status.key),
				keepOpen: true,
				onClick: () => {
					setStatusFilter((prev) => {
						const selected = prev.selectedStatuses.includes(status.key)
							? prev.selectedStatuses.filter((s) => s !== status.key)
							: [...prev.selectedStatuses, status.key];
						return { selectedStatuses: selected };
					});
				},
			})),
		}];
	}, [statusFilter.selectedStatuses, plugin.settings.taskStatuses]);

	// ===== 优先级筛选菜单 =====
	const prioritySections: DropdownMenuSection[] = useMemo(() => [{
		items: getPriorities().map((p) => ({
			key: `priority-${p.key}`,
			title: p.label,
			icon: p.key === 'all' ? undefined : 'flame',
			checked: priorityFilter === p.key,
			onClick: () => setPriorityFilter(p.key),
		})),
	}], [priorityFilter]);

	const hasStatusFilter = statusFilter.selectedStatuses.length > 0;
	const hasPriorityFilter = priorityFilter !== 'all';
	const hasTagFilter = selectedTags.length > 0;
	const hasActiveFilter = hasStatusFilter || hasPriorityFilter || hasTagFilter || hideCompleted || Boolean(searchQuery);

	const handleClearFilters = useCallback(() => {
		setSearchQuery('');
		setDebouncedQuery('');
		setStatusFilter({ selectedStatuses: [] });
		setPriorityFilter('all');
		setSelectedTags([]);
		setTagOperator('OR');
		setHideCompleted(false);
	}, []);

	// ===== 日期导航 =====
	const goPrevDay = useCallback(() => setPickedDate(shiftDay(day, -1)), [day]);
	const goNextDay = useCallback(() => setPickedDate(shiftDay(day, 1)), [day]);
	const goToday = useCallback(() => setPickedDate(null), []);

	// ===== 全天区拖放：转全天（day 精度） =====
	const handleAllDayDrop = useCallback((taskId: string, e?: ReactDragEvent): void => {
		const allTasks = plugin?.taskCache?.getAllTasks() || tasks;
		const task = resolveTaskFromDrop(e?.dataTransfer, allTasks, app);
		if (!task) return;
		const interval = getTaskInterval(task, startField, endField, dateField);
		const updates: Partial<Record<DateFieldType, Date>> = {};
		let precision: Partial<Record<DateFieldType, 'day' | 'time'>> = {};
		if (interval) {
			updates[startField] = day;
			updates[endField] = day;
			precision = { [startField]: 'day', [endField]: 'day' };
		} else {
			updates[dateField] = day;
			precision = { [dateField]: 'day' };
		}
		void (async () => {
			try {
				const taskToUpdate = { ...task, datePrecision: { ...task.datePrecision, ...precision } };
				await updateTaskProperties(app, taskToUpdate, updates, enabledFormats);
				await plugin.taskCache.refreshFile(task.filePath);
				useCalendarStore.getState().notifyTasksUpdated(plugin.taskCache.getAllTasks(), task.filePath);
			} catch (error) {
				Logger.error('DailyTimelinePanel', 'Set all-day failed:', error);
				new Notice(i18n.t('views.dayView.updateTaskFailed'));
			}
		})();
	}, [tasks, day, app, plugin, startField, endField, dateField, enabledFormats]);

	const allDayDropProps = useDropTarget({
		onDrop: (taskId, e) => handleAllDayDrop(taskId, e),
		activeClass: 'gc-sidebar__all-day--drag-over',
	});

	const weekdayNames = i18n.t('sidebar.dailyTimeline.weekdays') as unknown as string[];
	const isEmpty = model.blocks.length === 0 && model.allday.length === 0;
	const handleRefresh = useCallback(() => refreshTasks(), [refreshTasks]);

	const navPrevLabel = i18n.t('sidebar.dailyTimeline.nav.prevDay');
	const navNextLabel = i18n.t('sidebar.dailyTimeline.nav.nextDay');
	const navTodayLabel = i18n.t('sidebar.dailyTimeline.nav.goToday');

	return (
		<>
			<div className={SidebarClasses.elements.timelineHeader}>
				<div className={SidebarClasses.elements.timelineTitle}>
					{`${formatDate(day, 'MM/dd')} ${weekdayNames[day.getDay()]}`}
				</div>
				<div className={SidebarClasses.elements.timelineNav}>
					<button
						type="button"
						className="clickable-icon"
						aria-label={navPrevLabel}
						onClick={goPrevDay}
					>
						<Icon icon="chevron-left" />
					</button>
					<button
						type="button"
						className={SidebarClasses.elements.timelineTodayBtn}
						aria-label={navTodayLabel}
						disabled={pickedDate === null}
						onClick={goToday}
					>
						{i18n.t('sidebar.dailyTimeline.nav.today')}
					</button>
					<button
						type="button"
						className="clickable-icon"
						aria-label={navNextLabel}
						onClick={goNextDay}
					>
						<Icon icon="chevron-right" />
					</button>
				</div>
			</div>

			<div className={SidebarClasses.elements.searchInput}>
				<input
					type="text"
					placeholder={i18n.t('sidebar.dailyTimeline.searchPlaceholder')}
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
				/>
			</div>

			<div className={SidebarClasses.elements.filterBar}>
				<DropdownMenu sections={statusSections} align="left" className="gc-u-pointer" panelStyle={{ width: '160px' }}>
					{({ onClick }) => (
						<button
							type="button"
							className={`clickable-icon${hasStatusFilter ? ' has-active-filter' : ''}`}
							title={i18n.t('sidebar.dailyTimeline.filterBar.statusFilter')}
							onClick={onClick}
						>
							<Icon icon="filter" />
						</button>
					)}
				</DropdownMenu>

				<DropdownMenu sections={prioritySections} align="left" className="gc-u-pointer">
					{({ onClick }) => (
						<button
							type="button"
							className={`clickable-icon${hasPriorityFilter ? ' has-active-filter' : ''}`}
							title={i18n.t('sidebar.dailyTimeline.filterBar.priorityFilter')}
							onClick={onClick}
						>
							<Icon icon="flame" />
						</button>
					)}
				</DropdownMenu>

				<DropdownMenu
					content={() => (
						<TagTreeFilter
							allTags={Array.from(tagCounts.keys())}
							selectedTags={selectedTags}
							onToggle={(fp) => {
								setSelectedTags((prev) =>
									prev.includes(fp) ? prev.filter((t) => t !== fp) : [...prev, fp]
								);
							}}
							operator={tagOperator}
							onOperatorChange={setTagOperator}
							taskCounts={tagCounts}
						/>
					)}
					align="left"
					className="gc-u-pointer"
					panelStyle={{ width: '220px', maxHeight: '320px', overflowY: 'auto' }}
				>
					{({ onClick }) => (
						<button
							type="button"
							className={`clickable-icon${hasTagFilter ? ' has-active-filter' : ''}`}
							title={i18n.t('sidebar.dailyTimeline.filterBar.tagFilter')}
							onClick={onClick}
						>
							<Icon icon="tags" />
						</button>
					)}
				</DropdownMenu>

				<button
					type="button"
					className={`clickable-icon${hideCompleted ? ' has-active-filter' : ''}`}
					title={hideCompleted ? i18n.t('sidebar.dailyTimeline.filterBar.showCompleted') : i18n.t('sidebar.dailyTimeline.filterBar.hideCompleted')}
					onClick={() => setHideCompleted((prev) => !prev)}
				>
					<Icon icon="check-circle-2" />
				</button>

				{hasActiveFilter && (
					<button
						type="button"
						className="clickable-icon"
						title={i18n.t('sidebar.dailyTimeline.filterBar.clearFilters')}
						onClick={handleClearFilters}
					>
						<Icon icon="filter-x" />
					</button>
				)}

				<div style={{ flex: 1 }} />

				<button
					type="button"
					className={`clickable-icon${viewMode === 'agenda' ? ' has-active-filter' : ''}`}
					title={viewMode === 'agenda' ? i18n.t('sidebar.dailyTimeline.viewMode.timeline') : i18n.t('sidebar.dailyTimeline.viewMode.agenda')}
					onClick={toggleViewMode}
				>
					<Icon icon={viewMode === 'agenda' ? 'clock' : 'list'} />
				</button>
			</div>

			{isEmpty ? (
				<div className={SidebarClasses.elements.emptyState}>
					{hasActiveFilter
						? i18n.t('sidebar.dailyTimeline.noMatchingTasks')
						: i18n.t('sidebar.dailyTimeline.noTasks')}
				</div>
			) : null}

			{viewMode === 'canvas' ? (
				<>
					{/* 全天区域（始终渲染为拖放目标）：day 精度命中 + 覆盖当日的 ≥24h 长区间 */}
					<div className={SidebarClasses.elements.timelineAllDay} {...allDayDropProps}>
						<div className={SidebarClasses.elements.timelineAllDayLabel}>
							{i18n.t('sidebar.dailyTimeline.allDay')}
						</div>
						<div className={SidebarClasses.elements.timelineAllDayTasks}>
							{model.allday.map(({ task, timeLabel }) => (
								<div key={`${task.filePath}:${task.lineNumber}`} className={`${SidebarClasses.elements.timelineAllDayItem} priority-${(task.priority || 'normal').toLowerCase()}${task.completed ? ' is-completed' : ''}`}>
									<TaskCard task={task} config={timelineConfig} onRefresh={handleRefresh} />
									{timeLabel ? (
										<span className={SidebarClasses.elements.timelineAllDayTime}>{timeLabel}</span>
									) : null}
								</div>
							))}
						</div>
					</div>

					{/* 连续时间画布（启用 cascadeOverlap: Problem 1 Opcja A） */}
					<DayTimelineCanvas
						day={day}
						model={model}
						config={timelineConfig}
						tasks={tasks}
						refresh={handleRefresh}
						startHourBaseline={6}
						endHourBaseline={18}
						cascadeOverlap={true}
					/>
				</>
			) : (
				<div className="gc-timeline-agenda">
					{/* Sekcja All Day w widoku agendy */}
					{model.allday.length > 0 && (
						<div className="gc-timeline-agenda__section" {...allDayDropProps}>
							<div className="gc-timeline-agenda__section-title">
								<Icon icon="calendar" className="gc-timeline-agenda__icon" />
								<span>{i18n.t('sidebar.dailyTimeline.allDay')}</span>
								<span className="gc-timeline-agenda__count">{model.allday.length}</span>
							</div>
							<div className="gc-timeline-agenda__items">
								{model.allday.map(({ task }) => (
									<div key={`${task.filePath}:${task.lineNumber}`} className={`gc-timeline-agenda__item priority-${(task.priority || 'normal').toLowerCase()}${task.completed ? ' is-completed' : ''}`}>
										<TaskCard task={task} config={timelineConfig} onRefresh={handleRefresh} />
									</div>
								))}
							</div>
						</div>
					)}

					{/* Sekcja zadań o określonych godzinach w widoku agendy (Problem 1 Opcja C) */}
					<div className="gc-timeline-agenda__section">
						<div className="gc-timeline-agenda__section-title">
							<Icon icon="clock" className="gc-timeline-agenda__icon" />
							<span>{i18n.t('sidebar.dailyTimeline.timedTasks')}</span>
							<span className="gc-timeline-agenda__count">{agendaItems.length}</span>
						</div>
						{agendaItems.length === 0 ? (
							<div className="gc-timeline-agenda__empty">
								{i18n.t('sidebar.dailyTimeline.noTimedTasks')}
							</div>
						) : (
							<div className="gc-timeline-agenda__timeline-list">
								{agendaItems.map(({ block, seg }) => {
									const timeRange = `${formatMinutes(seg.startMin)} – ${formatMinutes(seg.endMin)}`;
									const priorityColor = block.task.completed
										? 'var(--gc-task-completed, #52c41a)'
										: getPriorityBarColor(block.task.priority);
									return (
										<div
											key={`${block.task.filePath}:${block.task.lineNumber}`}
											className={`gc-timeline-agenda__row priority-${(block.task.priority || 'normal').toLowerCase()}${block.task.completed ? ' is-completed' : ''}`}
											style={{ '--priority-bar-color': priorityColor } as CSSProperties}
										>
											<div className="gc-timeline-agenda__time-col">
												<span className="gc-timeline-agenda__time-badge">{timeRange}</span>
											</div>
											<div className="gc-timeline-agenda__card-col">
												<TaskCard task={block.task} config={timelineConfig} onRefresh={handleRefresh} />
											</div>
										</div>
									);
								})}
							</div>
						)}
					</div>
				</div>
			)}
		</>
	);
}
