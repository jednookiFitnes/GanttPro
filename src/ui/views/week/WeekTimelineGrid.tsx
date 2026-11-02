import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';
import { createPortal } from 'react-dom';
import type { Dispatch, SetStateAction, DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Notice } from 'obsidian';
import { type GCTask, getTaskDateField } from '../../../types';
import type { DateFieldType } from '../../../settings/types';
import type { TaskCardConfig } from '../../../components/TaskCard/TaskCardConfig';
import { WeekViewClasses, ContextMenuClasses, setCssProps } from '../../../utils/bem';
import { usePlugin, useApp } from '../../pluginContext';
import { useTaskTooltip } from '../../components/TooltipProvider';
import { TaskCard } from '../../components/TaskCard';
import { Icon } from '../../components/Icon';
import { taskKey } from '../../utils/taskKey';
import { updateTaskProperties } from '../../../tasks/taskUpdater';
import { isVirtualTask } from '../../../tasks/virtualTaskGenerator';
import type { TaskUpdates } from '../../../tasks/taskSerializer';
import { openCreateTaskModal } from '../../modals/TaskFormModal';
import { getPriorityBarColor } from '../../../tasks/taskGrouper';
import { i18n } from '../../../i18n/i18n';
import { Logger } from '../../../utils/logger';
import {
	type WeekTimelineModel,
	type TimeBlock,
	type TimeBlockSegment,
	type DaySegment,
	getTaskInterval,
	clampSingleFieldWrite,
	clampForwardPointEnd,
	minutesToPx,
	pxToMinutes,
	snapMinutes,
	formatMinutes,
	DAY_PX,
	MIN_DURATION_MIN,
	DEFAULT_POINT_DURATION_MIN,
	MINUTES_PER_DAY,
} from './timelineModel';

import { useBlockResize, isBlockResizing, setBlockDragMeta, getBlockDragMeta, clearBlockDragMeta } from './useBlockResize';
import { useCanvasTouchDrag } from './useCanvasTouchDrag';
import { resolveTaskFromDrop } from '../../utils/taskDropResolver';

/** 全天行单行高度（卡片 24px + 间距 4px，与 CSS 令牌对应） */
const ALLDAY_ROW_PX = 28;

/** 折叠态全天行可见的横跨条行数，超出收进 "+N" 折叠行 */
const ALLDAY_COLLAPSED_LANES = 3;

/**
 * 创建手势的像素位移阈值：超过该位移才视为拖拽选区。
 * 不能用吸附步长判断——点击时 1-2px 抖动就可能让吸附分钟跨过舍入中点跳一格，
 * 导致按下瞬间 1 小时预览坍缩为 15 分钟选区（对齐甘特拖拽的 3px hasMoved 模式）
 */
const CREATE_DRAG_THRESHOLD_PX = 5;

export interface WeekTimelineDayInfo {
	date: Date;
	isToday: boolean;
	weekday: number;
	day: number;
	lunarText?: string | null;
}

export interface WeekTimelineGridProps {
	days: WeekTimelineDayInfo[];
	dayNames: string[];
	weekStart: Date;
	model: WeekTimelineModel;
	/** 本周任务全集（真实 + 虚拟实例），用于拖放源查找 */
	tasks: GCTask[];
	config: TaskCardConfig;
	showLunar: boolean;
	refreshTasks: () => void;
	updateSeq: number;
	/** 可见日窗口（周内索引，默认全 7 天；手机端 3 日滑动窗口） */
	visibleDayIdxs?: number[];
	/** 横向 swipe 翻页回调（手机端；桌面不传） */
	onSwipe?: (dir: -1 | 1) => void;
}

/** 拖放指示线状态 */
interface DropLineState {
	dayIndex: number;
	min: number;
}

/** 整块拖动的落点预览状态（块上边缘吸附位置 + 任务时长） */
interface DropPreviewState {
	dayIndex: number;
	startMin: number;
	endMin: number;
}

/** ghost 快速创建载荷 */
export type QuickCreate =
	| { type: 'point'; dayIndex: number; min: number }
	| { type: 'range'; dayIndex: number; startMin: number; endMin: number };

/**
 * 周视图连续时间画布：
 * 表头行 + 全天行（横跨条）+ 24 小时连续画布（按分钟绝对定位的时间块）。
 * 交互：点击/拖拽空白创建、块边缘拖拽改起止时间、HTML5 拖放整体平移。
 */
export function WeekTimelineGrid({
	days,
	dayNames,
	weekStart,
	model,
	tasks,
	config,
	showLunar,
	refreshTasks,
	updateSeq,
	visibleDayIdxs,
	onSwipe,
}: WeekTimelineGridProps): JSX.Element {
	const plugin = usePlugin();
	const app = useApp();
	const tooltip = useTaskTooltip();

	// 可见日窗口（默认全周）；窗口内渲染位置 pos 与周索引 dayIdx 解耦
	const visibleIdxs = visibleDayIdxs ?? [0, 1, 2, 3, 4, 5, 6];
	const colCount = visibleIdxs.length;
	const swipeStartRef = useRef<{ x: number; y: number; pointerType: string } | null>(null);

	const handleGridPointerDown = useCallback((e: ReactPointerEvent) => {
		swipeStartRef.current = { x: e.clientX, y: e.clientY, pointerType: e.pointerType };
	}, []);

	const handleGridPointerUp = useCallback((e: ReactPointerEvent) => {
		const start = swipeStartRef.current;
		swipeStartRef.current = null;
		if (!start || !onSwipe) return;
		const dx = e.clientX - start.x;
		const dy = e.clientY - start.y;
		// 横向位移显著大于纵向且超阈值才视为翻页（纵向留给滚动/创建手势）
		if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
			onSwipe(dx < 0 ? 1 : -1);
		}
	}, [onSwipe]);

	const dateField = plugin.settings.dateFilterField || 'dueDate';
	const startField = plugin.settings.ganttStartField || 'startDate';
	const endField = plugin.settings.ganttEndField || 'dueDate';
	const enabledFormats = plugin.settings.enabledTaskFormats || [];

	const [dropLine, setDropLine] = useState<DropLineState | null>(null);
	/** 整块拖动的落点预览（块上边缘吸附位置 + 任务时长） */
	const [dropPreview, setDropPreview] = useState<DropPreviewState | null>(null);
	/** 拖放悬停高亮的列（块拖动与外部拖入都显示列高亮，指示线仅外部拖入） */
	const [dragOverCol, setDragOverCol] = useState<number | null>(null);
	const [alldayDragDay, setAlldayDragDay] = useState<number | null>(null);
	const gridRef = useRef<HTMLDivElement | null>(null);

	const hasToday = days.some((d) => d.isToday);
	const allDayLabel = i18n.t('views.weekView.allDay');

	/** 本周第 dayIndex 天的 00:00 */
	const dayDate = useCallback((dayIndex: number): Date => {
		const d = new Date(weekStart);
		d.setDate(d.getDate() + dayIndex);
		d.setHours(0, 0, 0, 0);
		return d;
	}, [weekStart]);

	/** 当日 00:00 + 分钟偏移（min 可为 1440 = 次日 00:00） */
	const atMinutes = useCallback((base: Date, min: number): Date => {
		const d = new Date(base);
		d.setHours(0, 0, 0, 0);
		d.setMinutes(min);
		return d;
	}, []);

	// ===== 统一写回（复用 updateTaskProperties 的行号漂移校验/文件锁/保时序列化链路） =====
	const persistTaskUpdate = useCallback(async (
		task: GCTask,
		updates: TaskUpdates,
		precisionPatch: Partial<Record<DateFieldType, 'day' | 'time'>>,
		errorKey: string,
	): Promise<boolean> => {
		try {
			tooltip.cancel();
			// 浅拷贝：不变异 store 中的共享任务对象
			const taskToUpdate = { ...task, datePrecision: { ...task.datePrecision, ...precisionPatch } };
			await updateTaskProperties(app, taskToUpdate, updates, enabledFormats);
			// 立即刷新指定文件缓存（跳过文件事件防抖），再通知视图
			await plugin.taskCache.refreshFile(task.filePath);
			refreshTasks();
			return true;
		} catch (error) {
			Logger.error('WeekTimelineGrid', 'Task update failed:', error);
			new Notice(i18n.t(errorKey));
			return false;
		}
	}, [app, plugin, enabledFormats, refreshTasks, tooltip]);

	// ===== resize 提交：点任务升级为区间任务 =====
	const commitResize = useCallback((
		block: TimeBlock,
		seg: TimeBlockSegment,
		edge: 'top' | 'bottom',
		newStartMin: number,
		newEndMin: number,
		blockEl: HTMLElement,
	): void => {
		const day = dayDate(seg.dayIndex);
		const updates: Partial<Record<DateFieldType, Date>> = {};
		let precision: Partial<Record<DateFieldType, 'day' | 'time'>> = {};

		if (block.isPoint) {
			// 点任务 resize 即升级为区间任务：按 WYSIWYG 提交拖拽预览所见的边界
			// （被拖的边缘写入新时刻，另一边缘保持预览位置并落盘，前向/后向锚定通用）
			if (edge === 'top') {
				updates[startField] = atMinutes(day, newStartMin);
				updates[endField] = block.end;
			} else {
				updates[startField] = block.start;
				updates[endField] = atMinutes(day, newEndMin);
			}
			precision = { [startField]: 'time', [endField]: 'time' };
		} else if (edge === 'top') {
			updates[startField] = atMinutes(day, newStartMin);
			precision = { [startField]: 'time' };
		} else {
			updates[endField] = atMinutes(day, newEndMin);
			precision = { [endField]: 'time' };
		}

		void (async () => {
			const ok = await persistTaskUpdate(block.task, updates, precision, 'views.dayView.updateTimeFailed');
			if (!ok) {
				// 写回失败：还原乐观样式
				blockEl.style.top = `${minutesToPx(seg.startMin)}px`;
				blockEl.style.height = `${minutesToPx(seg.endMin - seg.startMin)}px`;
			}
		})();
	}, [dayDate, atMinutes, startField, endField, persistTaskUpdate]);

	const beginResize = useBlockResize(commitResize);

	// ===== 拖放落点：整体平移块（保留时长与精度；minutes = 块上边缘的吸附时刻） =====
	const commitBlockMove = useCallback((task: GCTask, dayIndex: number, minutes: number): void => {
		const day = dayDate(dayIndex);
		const interval = getTaskInterval(task, startField, endField, dateField);
		const updates: Partial<Record<DateFieldType, Date>> = {};
		let precision: Partial<Record<DateFieldType, 'day' | 'time'>> = {};

		const durationMin = interval
			? Math.round((interval.end.getTime() - interval.start.getTime()) / 60000)
			: 0;

		const startIsTime = task.datePrecision?.[startField] === 'time';
		const endIsTime = task.datePrecision?.[endField] === 'time';

		const isExistingTimedBlock = interval
			&& interval.kind === 'interval'
			&& durationMin < MINUTES_PER_DAY
			&& startIsTime
			&& endIsTime;

		if (isExistingTimedBlock) {
			const dayOf = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
			const sameDayOrigin = dayOf(interval.start) === dayOf(interval.end);
			const anchorMin = sameDayOrigin && durationMin <= MINUTES_PER_DAY
				? Math.max(0, Math.min(minutes, MINUTES_PER_DAY - durationMin))
				: minutes;
			const newStart = atMinutes(day, anchorMin);
			const shiftMs = newStart.getTime() - interval.start.getTime();
			updates[startField] = newStart;
			const shiftedEnd = new Date(interval.end.getTime() + shiftMs);
			updates[endField] = shiftedEnd;
			precision = { [startField]: 'time', [endField]: 'time' };
		} else if (interval && interval.kind === 'point') {
			const pDuration = Math.round((interval.end.getTime() - interval.start.getTime()) / 60000);
			const anchorMin = Math.max(0, Math.min(minutes, MINUTES_PER_DAY - pDuration));
			updates[startField] = atMinutes(day, anchorMin);
			updates[endField] = atMinutes(day, anchorMin + pDuration);
			precision = { [startField]: 'time', [endField]: 'time' };
		} else {
			// 全天任务 / 从 ALL DAY 拖入 / 外部视图拖入：
			// 必须添加 start time 和 due time（转为当日时间块）
			const startMin = Math.max(0, Math.min(minutes, MINUTES_PER_DAY - MIN_DURATION_MIN));
			updates[startField] = atMinutes(day, startMin);
			precision[startField] = 'time';

			let targetEndMin: number | null = null;
			const existingEndVal = getTaskDateField(task, endField) || getTaskDateField(task, dateField);
			const existingEndPrecision = task.datePrecision?.[endField] || task.datePrecision?.[dateField];
			if (existingEndVal && existingEndPrecision === 'time') {
				const endDayMs = new Date(existingEndVal).setHours(0, 0, 0, 0);
				const targetDayMs = new Date(day).setHours(0, 0, 0, 0);
				if (endDayMs === targetDayMs) {
					const existingMinutes = existingEndVal.getHours() * 60 + existingEndVal.getMinutes();
					if (existingMinutes >= startMin + MIN_DURATION_MIN) {
						targetEndMin = existingMinutes;
					}
				}
			}

			if (targetEndMin === null) {
				const daySegs = (model.days[dayIndex] || []).map((s) => s.seg);
				targetEndMin = clampForwardPointEnd(startMin, daySegs, DEFAULT_POINT_DURATION_MIN);
				if (targetEndMin < startMin + MIN_DURATION_MIN) {
					targetEndMin = Math.min(startMin + DEFAULT_POINT_DURATION_MIN, MINUTES_PER_DAY);
				}
			}

			if (startField !== endField) {
				updates[endField] = atMinutes(day, targetEndMin);
				precision[endField] = 'time';
			}

			if (dateField !== startField && dateField !== endField) {
				updates[dateField] = updates[endField] ?? atMinutes(day, targetEndMin);
				precision[dateField] = 'time';
			}
		}

		void persistTaskUpdate(task, updates, precision, 'views.dayView.updateTimeFailed');
	}, [dayDate, atMinutes, startField, endField, dateField, model.days, persistTaskUpdate]);

	// ===== 全天行拖放：转全天（day 精度） =====
	const commitAlldayMove = useCallback((task: GCTask, dayIndex: number): void => {
		const day = dayDate(dayIndex);
		const interval = getTaskInterval(task, startField, endField, dateField);
		const updates: Partial<Record<DateFieldType, Date>> = {};
		let precision: Partial<Record<DateFieldType, 'day' | 'time'>> = {};

		if (interval) {
			// 时间块 → 全天：起止都落到目标日（区间任务收敛为单日全天条）
			updates[startField] = day;
			updates[endField] = day;
			precision = { [startField]: 'day', [endField]: 'day' };
		} else {
			// 对端钳制：落点越过对端点所在日时钳到对端点日，避免制造倒置数据
			updates[dateField] = clampSingleFieldWrite(task, dateField, day, startField, endField);
			precision = { [dateField]: 'day' };
		}

		void persistTaskUpdate(task, updates, precision, 'views.dayView.updateTaskFailed');
	}, [dayDate, startField, endField, dateField, persistTaskUpdate]);

	// 触屏整块拖动（长按 500ms 起拖；提交与落点预览复用现有链路）
	const beginBlockTouchPress = useCanvasTouchDrag({
		onCommit: commitBlockMove,
		setPreview: setDropPreview,
		columnSelector: '.' + WeekViewClasses.elements.dayCol,
	});

	// ===== 空白快速创建 =====
	const handleQuickCreate = useCallback((payload: QuickCreate): void => {
		const dayInfo = days[payload.dayIndex];
		if (!dayInfo) return;
		if (payload.type === 'range') {
			openCreateTaskModal({
				app,
				plugin,
				targetDate: dayInfo.date,
				targetRange: { start: atMinutes(dayInfo.date, payload.startMin), end: atMinutes(dayInfo.date, payload.endMin) },
				onSuccess: refreshTasks,
			});
			return;
		}
		// 单击 = 前向 1 小时区间：预填 startDate + dueDate（createdDate 由弹窗默认当日），
		// 保存后为双时刻区间任务，渲染与 hover 虚拟框完全重合，不留空开始字段。
		// 下方空隙不足默认时长时按空隙收缩（与 ghost 预览同源判定）；无空隙不弹窗
		const min = payload.min;
		const daySegs = model.days[payload.dayIndex] || [];
		const endMin = clampForwardPointEnd(min, daySegs.map((s) => s.seg));
		if (endMin <= min) return;
		openCreateTaskModal({
			app,
			plugin,
			targetDate: dayInfo.date,
			targetRange: { start: atMinutes(dayInfo.date, min), end: atMinutes(dayInfo.date, endMin) },
			onSuccess: refreshTasks,
		});
	}, [app, plugin, days, atMinutes, refreshTasks, model]);

	// ===== 当前时间指示线（按分钟直接计算，每 30s 重画） =====
	useEffect(() => {
		if (!hasToday) return;
		const draw = () => {
			const grid = gridRef.current;
			if (!grid) return;
			const line = grid.querySelector<HTMLElement>(`.${WeekViewClasses.elements.currentTimeLine}`);
			const todayCol = grid.querySelector<HTMLElement>(`.${WeekViewClasses.modifiers.dayColToday}`)
				|| grid.querySelector<HTMLElement>(`.${WeekViewClasses.elements.dayCol}`);
			if (!line || !todayCol) return;
			const now = new Date();
			line.style.top = `${todayCol.offsetTop + minutesToPx(now.getHours() * 60 + now.getMinutes())}px`;
			line.style.left = `${todayCol.offsetLeft}px`;
			line.style.width = `${todayCol.offsetWidth}px`;
			setCssProps(line, { display: 'block' });
		};
		draw();
		const timer = window.setInterval(draw, 30_000);
		return () => window.clearInterval(timer);
	}, [hasToday, updateSeq, weekStart, model]);

	// ===== 全天行：lane 布局不设上限，渲染折叠（极端重叠不挤压时间网格） =====
	const totalAlldayLanes = useMemo(() => (
		model.allday.reduce((max, bar) => Math.max(max, bar.lane + 1), 1)
	), [model.allday]);
	const [alldayExpanded, setAlldayExpanded] = useState(false);
	// 切周后回到折叠态
	useEffect(() => { setAlldayExpanded(false); }, [weekStart]);

	/** 折叠态可见的横跨条行数；其余收进"+N"折叠行 */
	const visibleBarLanes = alldayExpanded ? totalAlldayLanes : Math.min(totalAlldayLanes, ALLDAY_COLLAPSED_LANES);
	const hiddenAlldayCount = alldayExpanded ? 0 : model.allday.filter((b) => b.lane >= ALLDAY_COLLAPSED_LANES).length;
	/** 折叠行本身占一行（展开态的"收起"行同理） */
	const alldayChipRow = alldayExpanded ? totalAlldayLanes : visibleBarLanes;
	const alldayRowHeight = (hiddenAlldayCount > 0 || alldayExpanded ? alldayChipRow + 1 : visibleBarLanes) * ALLDAY_ROW_PX;

	// ===== 全天行拖放 =====
	const handleAlldayDragOver = useCallback((e: ReactDragEvent) => {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		const rect = e.currentTarget.getBoundingClientRect();
		const dayIndex = Math.max(0, Math.min(6, Math.floor(((e.clientX - rect.left) / rect.width) * 7)));
		setAlldayDragDay((prev) => (prev === dayIndex ? prev : dayIndex));
	}, []);

	const handleAlldayDragLeave = useCallback((e: ReactDragEvent) => {
		const related = e.relatedTarget as Node | null;
		if (related && e.currentTarget.contains(related)) return;
		setAlldayDragDay(null);
	}, []);

	const handleAlldayDrop = useCallback((e: ReactDragEvent) => {
		e.preventDefault();
		setAlldayDragDay(null);
		const allTasks = plugin?.taskCache?.getAllTasks() || tasks;
		const task = resolveTaskFromDrop(e.dataTransfer, allTasks, app);
		if (!task) return;
		const rect = e.currentTarget.getBoundingClientRect();
		const dayIndex = Math.max(0, Math.min(6, Math.floor(((e.clientX - rect.left) / rect.width) * 7)));
		commitAlldayMove(task, dayIndex);
	}, [tasks, commitAlldayMove, plugin, app]);

	const handleCardRefresh = useCallback(() => refreshTasks(), [refreshTasks]);

	return (
		<div
			className={WeekViewClasses.elements.tasksGrid}
			ref={gridRef}
			style={{
				'--gc-tl-hour-h': `${DAY_PX / 24}px`,
				gridTemplateColumns: `48px repeat(${colCount}, 1fr)`,
				// 触屏：纵向滚动交给浏览器，横向位移留给 swipe 翻页
				touchAction: onSwipe ? 'pan-y' : undefined,
			} as CSSProperties}
			onPointerDown={onSwipe ? handleGridPointerDown : undefined}
			onPointerUp={onSwipe ? handleGridPointerUp : undefined}
		>
			{/* 表头（仅渲染可见日窗口） */}
			<div className={WeekViewClasses.elements.headerSpacer} style={{ gridColumn: '1', gridRow: '1' }} />
			{visibleIdxs.map((dayIdx, pos) => {
				const day = days[dayIdx];
				const vacation = plugin.vacationService?.getVacation(day.date);
				const headerClasses = [
					WeekViewClasses.elements.headerCell,
					day.isToday ? WeekViewClasses.modifiers.today : '',
					vacation ? WeekViewClasses.modifiers.headerCellVacation : '',
				].filter(Boolean).join(' ');
				return (
					<div
						key={`week-h-${dayIdx}`}
						className={headerClasses}
						style={{ gridColumn: `${pos + 2}`, gridRow: '1' }}
						title={vacation ? `🏖️ URLOP: ${vacation.type}${vacation.project ? ` (${vacation.project})` : ''}${vacation.remarks ? ` — ${vacation.remarks}` : ''}` : undefined}
					>
						<div className={WeekViewClasses.elements.dayName}>{dayNames[day.weekday]}</div>
						<div className={`${WeekViewClasses.elements.dayNumber}${vacation ? ` ${WeekViewClasses.modifiers.dayNumberVacation}` : ''}`}>
							{day.day.toString()}
						</div>
						{vacation ? (
							<span
								className={WeekViewClasses.elements.vacationDot}
								title={`🏖️ URLOP: ${vacation.type}${vacation.project ? ` (${vacation.project})` : ''}`}
							/>
						) : null}
						{day.lunarText && showLunar ? (
							<div className={WeekViewClasses.elements.lunarText}>{day.lunarText}</div>
						) : null}
					</div>
				);
			})}

			{/* 全天行 */}
			<div className={WeekViewClasses.elements.alldayGutter} style={{ gridColumn: '1', gridRow: '2' }}>
				{allDayLabel}
			</div>
			<div
				className={WeekViewClasses.elements.alldayRow}
				style={{
					gridColumn: '2 / -1',
					gridRow: '2',
					height: `${alldayRowHeight}px`,
				}}
				onDragOver={handleAlldayDragOver}
				onDragLeave={handleAlldayDragLeave}
				onDrop={handleAlldayDrop}
			>
				{visibleIdxs.map((dayIdx, pos) => {
					const day = days[dayIdx];
					const vacation = plugin.vacationService?.getVacation(day.date);
					const alldayClasses = [
						WeekViewClasses.elements.alldayCell,
						day.isToday ? WeekViewClasses.modifiers.alldayCellToday : '',
						alldayDragDay === dayIdx ? WeekViewClasses.modifiers.alldayCellDragOver : '',
						vacation ? WeekViewClasses.modifiers.alldayCellVacation : '',
					].filter(Boolean).join(' ');
					return (
						<div
							key={`week-ac-${dayIdx}`}
							data-day-idx={dayIdx}
							className={alldayClasses}
							style={{
								position: 'absolute',
								gridColumn: `${pos + 1}`,
								top: 0,
								bottom: 0,
								left: 0,
								right: 0,
							}}
							title={vacation ? `🏖️ URLOP: ${vacation.type}${vacation.project ? ` (${vacation.project})` : ''}` : undefined}
						/>
					);
				})}
				{model.allday.map((bar) => {
					if (!alldayExpanded && bar.lane >= ALLDAY_COLLAPSED_LANES) return null;
					// 横跨条钳制到可见窗口（窗口外部分截断，延续箭头仍指示）
					const clampedStart = Math.max(bar.startDayIndex, visibleIdxs[0]);
					const clampedEnd = Math.min(bar.endDayIndex, visibleIdxs[colCount - 1]);
					if (clampedStart > clampedEnd) return null;
					return (
						<div
							key={`week-ab-${taskKey(bar.task)}`}
							className={`${WeekViewClasses.elements.alldayBar}${bar.continuesBefore || clampedStart > bar.startDayIndex ? ` ${WeekViewClasses.modifiers.alldayBarContinuesBefore}` : ''}${bar.continuesAfter || clampedEnd < bar.endDayIndex ? ` ${WeekViewClasses.modifiers.alldayBarContinuesAfter}` : ''}${bar.stackedIndex > 0 ? ` ${WeekViewClasses.modifiers.alldayBarStacked}` : ''}`}
							style={{
								position: 'absolute',
								gridColumn: `${clampedStart - visibleIdxs[0] + 1} / ${clampedEnd - visibleIdxs[0] + 2}`,
								left: '2px',
								right: '2px',
								top: `${bar.lane * ALLDAY_ROW_PX + (bar.stackedIndex > 0 ? 3 : 0)}px`,
								zIndex: bar.stackedIndex > 0 ? 3 : 1,
							}}
						>
							<TaskCard
								task={bar.task}
								config={config}
								targetDate={days[bar.startDayIndex]?.date}
								onClick={() => tooltip.hide()}
								onRefresh={handleCardRefresh}
							/>
							{/* 长区间任务的起止时刻标注（如 "22:00 → 03:00"） */}
							{bar.timeLabel ? (
								<span className={WeekViewClasses.elements.alldayBarTime}>{bar.timeLabel}</span>
						) : null}
					</div>
				);
			})}
			{/* 折叠/收起行：极端重叠时全天行不超过 3 行横跨条 + 本行 */}
			{(hiddenAlldayCount > 0 || alldayExpanded) ? (
				<div
					className={WeekViewClasses.elements.alldayMore}
					style={{ top: `${alldayChipRow * ALLDAY_ROW_PX}px` }}
					role="button"
					tabIndex={0}
					onClick={() => setAlldayExpanded((v) => !v)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							setAlldayExpanded((v) => !v);
						}
					}}
				>
					{alldayExpanded
						? i18n.t('views.weekView.alldayCollapse')
						: i18n.t('views.weekView.alldayMore', { count: hiddenAlldayCount })}
				</div>
			) : null}
		</div>

		{/* 时间沟槽：24 个整点标签 */}
			<div className={WeekViewClasses.elements.timeGutterSlot} style={{ gridColumn: '1', gridRow: '3' }}>
				{Array.from({ length: 24 }, (_, hour) => (
					<div key={`week-g-${hour}`} className={WeekViewClasses.elements.timeGutterLabel}>
						{`${String(hour).padStart(2, '0')}:00`}
					</div>
				))}
			</div>

			{/* 日列（连续画布，仅渲染可见日窗口；dayIndex 为周索引，colPos 为渲染列位） */}
			{visibleIdxs.map((dayIdx, pos) => (
				<DayColumn
					key={`week-col-${dayIdx}`}
					dayIndex={dayIdx}
					colPos={pos}
					day={days[dayIdx]}
					daySegs={model.days[dayIdx] || []}
					config={config}
					beginResize={beginResize}
					beginTouchPress={beginBlockTouchPress}
					onQuickCreate={handleQuickCreate}
					onBlockMove={commitBlockMove}
					dropLine={dropLine}
					setDropLine={setDropLine}
					dropPreview={dropPreview}
					setDropPreview={setDropPreview}
					dragOverCol={dragOverCol}
					setDragOverCol={setDragOverCol}
					tasks={tasks}
					hideTooltip={() => tooltip.hide()}
					onCardRefresh={handleCardRefresh}
				/>
			))}

			{/* 当前时间指示线 */}
			{hasToday ? (
				<div className={WeekViewClasses.elements.currentTimeLine} style={{ display: 'none' }} />
			) : null}
		</div>
	);
}

// ===== 日列（连续画布 + 时间块 + ghost 创建） =====

/** 事件目标是否位于时间块内（块上的事件不触发空白创建/ghost） */
function isInsideBlock(target: EventTarget | null): boolean {
	return !!(
		target instanceof Element &&
		(target.closest(`.${WeekViewClasses.elements.timeBlock}`) || target.closest('.gc-week-view__more-badge'))
	);
}

/**
 * 页面上是否存在打开的右键菜单。
 * ContextMenuTrigger 会 stopPropagation 掉 contextmenu 事件（列内收不到），
 * 菜单又 portal 到 body 且其 mousemove 会沿 React 树冒泡进列内——
 * 只能直接探测 DOM，不能依赖事件冒泡传递"菜单已打开"状态
 */
function isContextMenuOpen(): boolean {
	return !!document.querySelector(`.${ContextMenuClasses.container}`);
}

interface DayColumnProps {
	/** 周内索引（0-6，模型/状态键） */
	dayIndex: number;
	/** 渲染列位（可见窗口内位置，0 起） */
	colPos: number;
	day: WeekTimelineDayInfo;
	daySegs: DaySegment[];
	config: TaskCardConfig;
	beginResize: ReturnType<typeof useBlockResize>;
	beginTouchPress: ReturnType<typeof useCanvasTouchDrag>;
	onQuickCreate: (payload: QuickCreate) => void;
	onBlockMove: (task: GCTask, dayIndex: number, minutes: number) => void;
	dropLine: DropLineState | null;
	setDropLine: Dispatch<SetStateAction<DropLineState | null>>;
	dropPreview: DropPreviewState | null;
	setDropPreview: Dispatch<SetStateAction<DropPreviewState | null>>;
	dragOverCol: number | null;
	setDragOverCol: Dispatch<SetStateAction<number | null>>;
	tasks: GCTask[];
	hideTooltip: () => void;
	onCardRefresh: () => void;
	isCollapsed?: boolean;
}

function DayColumn({
	dayIndex,
	colPos,
	day,
	daySegs,
	config,
	beginResize,
	beginTouchPress,
	onQuickCreate,
	onBlockMove,
	dropLine,
	setDropLine,
	dropPreview,
	setDropPreview,
	dragOverCol,
	setDragOverCol,
	tasks,
	hideTooltip,
	onCardRefresh,
	isCollapsed,
}: DayColumnProps): JSX.Element {
	const plugin = usePlugin();
	const vacation = plugin.vacationService?.getVacation(day.date);
	const colRef = useRef<HTMLDivElement | null>(null);
	const ghostRef = useRef<HTMLDivElement | null>(null);
	const ghostLabelRef = useRef<HTMLSpanElement | null>(null);
	/** 拖拽选区创建状态（mousedown 于空白处时激活；moved 以像素位移判定，防点击抖动） */
	const createRef = useRef<{ anchorMin: number; anchorY: number; lastMin: number; moved: boolean } | null>(null);
	/** pointercancel 清理经 ref 桥接，避免与 finishCreate 形成循环推断 */
	const cancelCreateRef = useRef<() => void>(() => {});

	const minutesFromEvent = useCallback((clientY: number): number => {
		const col = colRef.current;
		if (!col) return 0;
		const rect = col.getBoundingClientRect();
		return snapMinutes(pxToMinutes(clientY - rect.top), false);
	}, []);

	/** 直接 DOM 更新 ghost（避免 60Hz mousemove 触发 React 重渲染）；钳制在 [0, 24:00] 内 */
	const showGhost = useCallback((startMin: number, endMin: number, dragging: boolean): void => {
		const ghost = ghostRef.current;
		const label = ghostLabelRef.current;
		if (!ghost) return;
		const clampedEnd = Math.min(Math.max(endMin, startMin + 1), MINUTES_PER_DAY);
		setCssProps(ghost, { display: 'block' });
		ghost.style.top = `${minutesToPx(startMin)}px`;
		ghost.style.height = `${minutesToPx(clampedEnd - startMin)}px`;
		ghost.classList.toggle(WeekViewClasses.modifiers.ghostDragging, dragging);
		if (label) label.textContent = dragging
			? `${formatMinutes(startMin)} – ${formatMinutes(clampedEnd)}`
			: formatMinutes(startMin);
	}, []);

	const hideGhost = useCallback((): void => {
		const ghost = ghostRef.current;
		if (ghost) setCssProps(ghost, { display: 'none' });
	}, []);

	/** 光标处快速创建的可用终点（ghost 与创建同源）：钳到 24:00 与下一个块起点 */
	const quickCreateEnd = useCallback((min: number): number => {
		return clampForwardPointEnd(min, daySegs.map((s) => s.seg));
	}, [daySegs]);

	// ===== hover ghost / 拖拽选区 =====
	const handleMouseMove = useCallback((e: ReactPointerEvent) => {
		if (isInsideBlock(e.target)) {
			// 选区拖拽中指针掠过块上：ghost 保持（选区仍跟随指针）
			if (!createRef.current) hideGhost();
			return;
		}
		const minutes = minutesFromEvent(e.clientY);
		const create = createRef.current;
		if (create) {
			create.lastMin = minutes;
			// 像素位移超阈值才算拖拽选区（吸附步长对点击抖动过于敏感）
			if (!create.moved && Math.abs(e.clientY - create.anchorY) > CREATE_DRAG_THRESHOLD_PX) {
				create.moved = true;
			}
			if (!create.moved) {
				// 抖动范围内：维持可用空隙预览（按下瞬间不坍缩）
				showGhost(create.anchorMin, quickCreateEnd(create.anchorMin), true);
				return;
			}
			showGhost(Math.min(create.anchorMin, minutes), Math.max(create.anchorMin, minutes), true);
			return;
		}
		// DOM 物理包含校验：portal 浮层（右键菜单/弹窗）的 mousemove 虽从 React 树冒泡进列内，
		// 但其目标不在本列 DOM 中，不算画布 hover（contextmenu 被 trigger 截断，菜单状态只能直接探测）
		const col = colRef.current;
		if (!col || !col.contains(e.target as Node)) {
			hideGhost();
			return;
		}
		// 菜单打开 / 块边缘 resize 进行中：不出 hover 提示。
		// ghost 终点钳到下一个块起点（与点击创建同源判定）：空隙不足 1 小时按空隙收缩，
		// 光标处即块起点（无空隙）则不显示
		if (isContextMenuOpen() || isBlockResizing()) {
			hideGhost();
			return;
		}
		// hover：可用空隙 ghost + 时刻标签
		const endMin = quickCreateEnd(minutes);
		if (endMin <= minutes) {
			hideGhost();
			return;
		}
		showGhost(minutes, endMin, false);
	}, [minutesFromEvent, showGhost, hideGhost, quickCreateEnd]);

	const handleMouseLeave = useCallback(() => {
		if (!createRef.current) hideGhost();
	}, [hideGhost]);

	const finishCreate = useCallback((): void => {
		const create = createRef.current;
		createRef.current = null;
		document.removeEventListener('pointerup', finishCreate);
		document.removeEventListener('pointercancel', cancelCreateRef.current);
		hideGhost();
		if (!create) return;
		if (create.moved && Math.abs(create.lastMin - create.anchorMin) >= MIN_DURATION_MIN) {
			const start = Math.min(create.anchorMin, create.lastMin);
			const end = Math.max(create.anchorMin, create.lastMin);
			onQuickCreate({ type: 'range', dayIndex, startMin: start, endMin: end });
		} else {
			onQuickCreate({ type: 'point', dayIndex, min: create.anchorMin });
		}
	}, [dayIndex, onQuickCreate, hideGhost]);

	/** 触屏滚动接管手势（pointercancel）：静默放弃创建，不弹窗 */
	const cancelCreate = useCallback((): void => {
		createRef.current = null;
		document.removeEventListener('pointerup', finishCreate);
		document.removeEventListener('pointercancel', cancelCreateRef.current);
		hideGhost();
	}, [finishCreate, hideGhost]);

	cancelCreateRef.current = cancelCreate;

	// ===== Klastrowanie zadań nakładających się w czasie (Opcja 2: Popover +N więcej) =====
	const MAX_CASCADE_VISIBLE = 3;

	interface RawCluster {
		id: string;
		startMin: number;
		endMin: number;
		items: DaySegment[];
	}

	const { displayBlocks, overflowClusters, activeClusters } = useMemo(() => {
		if (!daySegs || daySegs.length === 0) {
			return { displayBlocks: [], overflowClusters: [], activeClusters: new Map<string, RawCluster>() };
		}

		// 1. Sortuj wg czasu rozpoczęcia
		const sorted = [...daySegs].sort(
			(a, b) => a.seg.startMin - b.seg.startMin || a.seg.endMin - b.seg.endMin
		);

		const clusters: RawCluster[] = [];
		let current: RawCluster | null = null;

		for (const item of sorted) {
			if (!current || item.seg.startMin >= current.endMin) {
				current = {
					id: `cluster-d${dayIndex}-${item.seg.startMin}-${item.seg.endMin}-${clusters.length}`,
					startMin: item.seg.startMin,
					endMin: item.seg.endMin,
					items: [item],
				};
				clusters.push(current);
			} else {
				current.items.push(item);
				current.endMin = Math.max(current.endMin, item.seg.endMin);
			}
		}

		const clusterMap = new Map<string, RawCluster>();
		const overflowList: Array<{
			id: string;
			startMin: number;
			endMin: number;
			extraCount: number;
			items: DaySegment[];
		}> = [];
		const visibleBlocks: Array<{
			block: TimeBlock;
			seg: TimeBlockSegment;
			clusterId: string;
			isExtraHidden?: boolean;
		}> = [];

		for (const cl of clusters) {
			clusterMap.set(cl.id, cl);
			const total = cl.items.length;

			// Posortuj zadania wewnątrz klastra wg lane
			const clusterItemsSorted = [...cl.items].sort((a, b) => a.seg.lane - b.seg.lane || a.seg.stackedIndex - b.seg.stackedIndex);

			if (total > MAX_CASCADE_VISIBLE) {
				overflowList.push({
					id: cl.id,
					startMin: cl.startMin,
					endMin: cl.endMin,
					extraCount: total - MAX_CASCADE_VISIBLE,
					items: clusterItemsSorted,
				});
				// Pokaż dokładnie pierwsze 3 karty w kaskadzie
				clusterItemsSorted.slice(0, MAX_CASCADE_VISIBLE).forEach((item) => {
					visibleBlocks.push({
						block: item.block,
						seg: item.seg,
						clusterId: cl.id,
					});
				});
			} else {
				// Wszystkie karty widoczne normalnie
				clusterItemsSorted.forEach((item) => {
					visibleBlocks.push({
						block: item.block,
						seg: item.seg,
						clusterId: cl.id,
					});
				});
			}
		}

		return { displayBlocks: visibleBlocks, overflowClusters: overflowList, activeClusters: clusterMap };
	}, [daySegs, dayIndex]);

	const [openCluster, setOpenCluster] = useState<{
		id: string;
		startMin: number;
		endMin: number;
		items: DaySegment[];
		anchorRect: DOMRect;
	} | null>(null);

	// Synchronizuj otwarty popover przy zmianie modelu (np. po zaznaczeniu checkboxa)
	useEffect(() => {
		if (!openCluster) return;
		const updated = activeClusters.get(openCluster.id);
		if (updated) {
			setOpenCluster((prev) => (prev ? { ...prev, items: updated.items } : null));
		}
	}, [displayBlocks, activeClusters]);

	// Zamknij popover na Escape
	useEffect(() => {
		if (!openCluster) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setOpenCluster(null);
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [openCluster]);

	const handleBadgeClick = useCallback((
		e: React.MouseEvent,
		clusterItems: DaySegment[],
		startMin: number,
		endMin: number,
		clusterId: string
	) => {
		e.stopPropagation();
		e.preventDefault();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		setOpenCluster({
			id: clusterId,
			startMin,
			endMin,
			items: clusterItems,
			anchorRect: rect,
		});
	}, []);

	const handleMouseDown = useCallback((e: ReactPointerEvent) => {
		if (e.button !== 0 || isInsideBlock(e.target)) return;
		// 菜单打开期间：列内的首次点击仅负责关闭菜单，不启动创建
		if (isContextMenuOpen()) return;
		// DOM 物理包含校验：portal 浮层（右键菜单/弹窗）的事件虽从 React 树冒泡进列内，
		// 但其目标不在本列 DOM 中，不能视为画布上的按下
		const col = colRef.current;
		if (!col || !col.contains(e.target as Node)) return;
		e.preventDefault();
		const anchorMin = minutesFromEvent(e.clientY);
		const endMin = quickCreateEnd(anchorMin);
		if (endMin <= anchorMin) return; // 光标处即下一个块起点：无空隙，不启动创建手势
		createRef.current = { anchorMin, anchorY: e.clientY, lastMin: anchorMin, moved: false };
		// 按下瞬间维持 hover 的可用空隙块（仅切换激活样式），像素级拖动后才变为选区
		showGhost(anchorMin, endMin, true);
		// 防御：上一手势未正常收尾时先解绑，避免 finishCreate 重复触发
		document.removeEventListener('pointerup', finishCreate);
		document.removeEventListener('pointercancel', cancelCreateRef.current);
		document.addEventListener('pointerup', finishCreate);
		document.addEventListener('pointercancel', cancelCreateRef.current);
	}, [minutesFromEvent, showGhost, finishCreate, cancelCreate, quickCreateEnd]);

	// ===== HTML5 拖放（整体平移；块拖动按块边缘落点 + 预览块，外部拖入按指针 + 指示线） =====
	const handleDragOver = useCallback((e: ReactDragEvent) => {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		setDragOverCol((prev) => (prev === dayIndex ? prev : dayIndex));
		const meta = getBlockDragMeta();
		if (meta) {
			// 块拖动：落点预览 = 块上边缘吸附位置 + 任务时长（不出指针指示线）
			setDropLine(null);
			const col = colRef.current;
			if (!col) return;
			const topMin = snapMinutes(pxToMinutes(e.clientY - meta.offsetPx - col.getBoundingClientRect().top), false);
			const endMin = Math.min(topMin + meta.durationMin, MINUTES_PER_DAY);
			setDropPreview((prev) => (
				prev && prev.dayIndex === dayIndex && prev.startMin === topMin ? prev : { dayIndex, startMin: topMin, endMin }
			));
			return;
		}
		// 外部拖入：指针吸附线
		setDropPreview(null);
		const min = minutesFromEvent(e.clientY);
		setDropLine((prev) => (prev && prev.dayIndex === dayIndex && prev.min === min ? prev : { dayIndex, min }));
	}, [dayIndex, minutesFromEvent, setDropLine, setDropPreview]);

	const handleDragLeave = useCallback((e: ReactDragEvent) => {
		const related = e.relatedTarget as Node | null;
		if (related && e.currentTarget.contains(related)) return;
		setDropLine(null);
		setDropPreview(null);
		setDragOverCol((prev) => (prev === dayIndex ? null : prev));
	}, [dayIndex, setDropLine, setDropPreview]);

	const handleDrop = useCallback((e: ReactDragEvent) => {
		e.preventDefault();
		setDropLine(null);
		setDropPreview(null);
		setDragOverCol(null);
		const allTasks = plugin?.taskCache?.getAllTasks() || tasks;
		const task = resolveTaskFromDrop(e.dataTransfer, allTasks, app);
		if (!task) {
			Logger.error('WeekTimelineGrid', 'Drop source task not found:', e.dataTransfer?.getData('taskId'));
			return;
		}
		// 块拖动：指针 - 抓取偏移 = 块上边缘位置；外部拖入：指针即块顶
		const meta = getBlockDragMeta();
		const topEdgeClientY = meta ? e.clientY - meta.offsetPx : e.clientY;
		onBlockMove(task, dayIndex, minutesFromEvent(topEdgeClientY));
	}, [tasks, dayIndex, minutesFromEvent, onBlockMove, setDropLine, setDropPreview]);

	const colClasses = [
		WeekViewClasses.elements.dayCol,
		day.isToday ? WeekViewClasses.modifiers.dayColToday : '',
		dragOverCol === dayIndex ? WeekViewClasses.modifiers.dayColDragOver : '',
		vacation ? WeekViewClasses.modifiers.dayColVacation : '',
	].filter(Boolean).join(' ');

	return (
		<div
			ref={colRef}
			className={colClasses}
			data-day-idx={dayIndex}
			style={{ gridColumn: `${colPos + 2}`, gridRow: '3', height: `${DAY_PX}px` }}
			title={vacation ? `🏖️ URLOP: ${vacation.type}${vacation.project ? ` (${vacation.project})` : ''}` : undefined}
			onPointerMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
			onPointerDown={handleMouseDown}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{displayBlocks.map((item) => {
				if (item.isExtraHidden) return null;
				const { block, seg } = item;
				const durationMin = seg.endMin - seg.startMin;
				const resizable = !isVirtualTask(block.task);
				const isOverlapped = seg.laneCount > 1;

				let leftStyle: string;
				let widthStyle: string;
				let zIndexVal = seg.lane + (seg.stackedIndex > 0 ? 4 : 2);

				if (isOverlapped) {
					// Kaskada ze schodkowym przesunięciem (Problem 1: Opcja A)
					const laneStepPercent = Math.min(18, 42 / (seg.laneCount - 1 || 1));
					const leftOffset = seg.lane * laneStepPercent;
					const cardWidth = Math.max(74, 100 - (seg.laneCount - 1) * laneStepPercent);

					leftStyle = `calc(${leftOffset}% + ${(seg.stackedIndex > 0 ? seg.stackedIndex * 3 : 0) + 1}px)`;
					widthStyle = `calc(${cardWidth}% - 2px)`;
				} else {
					leftStyle = `calc(${(seg.lane / seg.laneCount) * 100}% + ${(seg.stackedIndex > 0 ? seg.stackedIndex * 3 : 0) + 1}px)`;
					widthStyle = `calc(${100 / seg.laneCount}% - 2px)`;
				}

				const cls = [
					WeekViewClasses.elements.timeBlock,
					seg.continuesBefore ? WeekViewClasses.modifiers.timeBlockContinuesBefore : '',
					seg.continuesAfter ? WeekViewClasses.modifiers.timeBlockContinuesAfter : '',
					seg.stackedIndex > 0 ? WeekViewClasses.modifiers.timeBlockStacked : '',
					durationMin < 45 ? 'gc-week-view__time-block--single-line' : '',
					durationMin < 20 ? 'gc-week-view__time-block--tiny' : '',
					isOverlapped ? 'gc-week-view__time-block--cascade' : '',
					isOverlapped ? 'gc-week-view__time-block--overlapped' : '',
					`priority-${(block.task.priority || 'normal').toLowerCase()}`,
					block.task.completed ? 'is-completed' : '',
				].filter(Boolean).join(' ');

				const priorityColor = block.task.completed
					? 'var(--gc-task-completed, #52c41a)'
					: getPriorityBarColor(block.task.priority);

				const style: CSSProperties = {
					top: `${minutesToPx(seg.startMin)}px`,
					height: `${minutesToPx(durationMin)}px`,
					left: leftStyle,
					width: widthStyle,
					zIndex: zIndexVal,
					'--priority-bar-color': priorityColor,
				};
				return (
					<div
						key={`${taskKey(block.task)}-d${dayIndex}`}
						className={cls}
						style={style}
						onPointerDown={(e) => beginTouchPress(e, block, e.currentTarget)}
						onDragStart={(e) => {
							// 记录抓取信息：落点按块上边缘计算而非指针（WYSIWYG），
							// 时长用于落点预览与后向点任务锚点（dragover 阶段 getData 不可用）
							const rect = e.currentTarget.getBoundingClientRect();
							setBlockDragMeta({
								offsetPx: e.clientY - rect.top,
								durationMin: Math.round((block.end.getTime() - block.start.getTime()) / 60000),
							});
						}}
						onDragEnd={() => {
							clearBlockDragMeta();
							setDropPreview(null);
						}}
					>
						{durationMin >= 30 ? (
							<span className={WeekViewClasses.elements.timeBlockTime}>
								{`${formatMinutes(seg.startMin)} – ${formatMinutes(seg.endMin)}`}
							</span>
						) : null}
						<TaskCard
							task={block.task}
							config={config}
							targetDate={day.date}
							onClick={hideTooltip}
							onRefresh={onCardRefresh}
						/>
						{/* 仅真实起止边缘有 resize 手柄（虚拟实例不可写回模板，禁编辑） */}
						{!seg.continuesBefore && resizable ? (
							<div
								className={`${WeekViewClasses.elements.handle} ${WeekViewClasses.modifiers.handleTop}`}
								onPointerDown={(e) => {
									const col = colRef.current;
									if (col && e.currentTarget.parentElement) {
										beginResize(e, block, seg, 'top', col, e.currentTarget.parentElement);
									}
								}}
							/>
						) : null}
						{!seg.continuesAfter && resizable ? (
							<div
								className={`${WeekViewClasses.elements.handle} ${WeekViewClasses.modifiers.handleBottom}`}
								onPointerDown={(e) => {
									const col = colRef.current;
									if (col && e.currentTarget.parentElement) {
										beginResize(e, block, seg, 'bottom', col, e.currentTarget.parentElement);
									}
								}}
							/>
						) : null}
					</div>
				);
			})}
			{/* Plakietki "+N więcej" dla klastrów o > 3 zadaniach (Opcja 2) */}
			{overflowClusters.map((cl) => {
				const topPx = minutesToPx(cl.startMin);
				return (
					<button
						key={`badge-${cl.id}`}
						type="button"
						className="gc-week-view__more-badge"
						style={{
							top: `${topPx + 3}px`,
							right: '4px',
						}}
						title={i18n.t('sidebar.dailyTimeline.clusterModalTitle')}
						onPointerDown={(e) => e.stopPropagation()}
						onPointerMove={(e) => e.stopPropagation()}
						onMouseEnter={hideGhost}
						onClick={(e) => handleBadgeClick(e, cl.items, cl.startMin, cl.endMin, cl.id)}
					>
						<Icon icon="layers" className="gc-week-view__more-icon" />
						<span>{i18n.t('sidebar.dailyTimeline.moreTasks', { count: cl.extraCount })}</span>
					</button>
				);
			})}
			{/* 拖放吸附指示线（仅外部来源拖入显示；块拖动用落点预览块） */}
			{dropLine?.dayIndex === dayIndex ? (
				<div
					className={WeekViewClasses.elements.dropLine}
					style={{ top: `${minutesToPx(dropLine.min)}px` }}
				/>
			) : null}
			{/* 整块拖动的落点预览：上边缘吸附位置 + 任务时长 */}
			{dropPreview?.dayIndex === dayIndex ? (
				<div
					className={WeekViewClasses.elements.dropPreview}
					style={{ top: `${minutesToPx(dropPreview.startMin)}px`, height: `${minutesToPx(dropPreview.endMin - dropPreview.startMin)}px` }}
				>
					<span className={WeekViewClasses.elements.ghostLabel}>
						{`${formatMinutes(dropPreview.startMin)} – ${formatMinutes(dropPreview.endMin)}`}
					</span>
				</div>
			) : null}
			{/* 空白快速创建 ghost */}
			<div ref={ghostRef} className={WeekViewClasses.elements.ghost} style={{ display: 'none' }}>
				<span ref={ghostLabelRef} className={WeekViewClasses.elements.ghostLabel} />
				<span className={WeekViewClasses.elements.ghostPlus}><Icon icon="plus" /></span>
			</div>
			{/* Popover ze wszystkimi zadaniami w klastrze (Opcja 2) */}
			{openCluster && createPortal(
				<div
					className="gc-cluster-popover-backdrop"
					onClick={() => setOpenCluster(null)}
				>
					<div
						className="gc-cluster-popover"
						style={{
							position: 'fixed',
							top: `${Math.min(window.innerHeight - 340, Math.max(12, openCluster.anchorRect.bottom + 6))}px`,
							left: `${Math.max(12, Math.min(window.innerWidth - 320, openCluster.anchorRect.right - 280))}px`,
						}}
						onClick={(e) => e.stopPropagation()}
					>
						<div className="gc-cluster-popover__header">
							<div className="gc-cluster-popover__title">
								<Icon icon="clock" className="gc-cluster-popover__icon" />
								<span>{`${formatMinutes(openCluster.startMin)} – ${formatMinutes(openCluster.endMin)}`}</span>
								<span className="gc-cluster-popover__count">
									{openCluster.items.length}
								</span>
							</div>
							<button
								type="button"
								className="clickable-icon gc-cluster-popover__close"
								onClick={() => setOpenCluster(null)}
								aria-label="Close"
							>
								<Icon icon="x" />
							</button>
						</div>

						<div className="gc-cluster-popover__list">
							{openCluster.items.map(({ block }) => (
								<div
									key={`${block.task.filePath}:${block.task.lineNumber}`}
									className={`gc-cluster-popover__item priority-${(block.task.priority || 'normal').toLowerCase()}${block.task.completed ? ' is-completed' : ''}`}
								>
									<TaskCard
										task={block.task}
										config={config}
										targetDate={day.date}
										onClick={hideTooltip}
										onRefresh={onCardRefresh}
									/>
								</div>
							))}
						</div>
					</div>
				</div>,
				document.body
			)}
		</div>
	);
}

// ===== 工具 =====

/** dataTransfer.taskId（filePath:lineNumber）→ 任务查找 */
function findTaskById(tasks: GCTask[], taskId: string): GCTask | null {
	const [filePath, lineNum] = taskId.split(':');
	const lineNumber = parseInt(lineNum, 10);
	return tasks.find((t) => t.filePath === filePath && t.lineNumber === lineNumber) || null;
}
