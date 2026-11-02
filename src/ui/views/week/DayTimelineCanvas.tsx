import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';
import { createPortal } from 'react-dom';
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Notice } from 'obsidian';
import { type GCTask, getTaskDateField } from '../../../types';
import type { DateFieldType } from '../../../settings/types';
import type { TaskCardConfig } from '../../../components/TaskCard/TaskCardConfig';
import { DayCanvasClasses, ContextMenuClasses, setCssProps } from '../../../utils/bem';
import { usePlugin, useApp } from '../../pluginContext';
import { TaskCard } from '../../components/TaskCard';
import { Icon } from '../../components/Icon';
import { updateTaskProperties } from '../../../tasks/taskUpdater';
import type { TaskUpdates } from '../../../tasks/taskSerializer';
import { isVirtualTask } from '../../../tasks/virtualTaskGenerator';
import { openCreateTaskModal } from '../../modals/TaskFormModal';
import { getPriorityBarColor } from '../../../tasks/taskGrouper';
import { i18n } from '../../../i18n/i18n';
import { Logger } from '../../../utils/logger';
import {
	type TimeBlock,
	type TimeBlockSegment,
	type DayTimelineModel,
	getTaskInterval,
	clampSingleFieldWrite,
	clampForwardPointEnd,
	minutesToPx,
	pxToMinutes,
	snapMinutes,
	formatMinutes,
	HOUR_PX,
	DAY_PX,
	MIN_DURATION_MIN,
	DEFAULT_POINT_DURATION_MIN,
	MINUTES_PER_DAY,
} from './timelineModel';

import { useBlockResize, isBlockResizing, setBlockDragMeta, getBlockDragMeta, clearBlockDragMeta } from './useBlockResize';
import { useCanvasTouchDrag } from './useCanvasTouchDrag';
import { resolveTaskFromDrop } from '../../utils/taskDropResolver';

/**
 * 创建手势的像素位移阈值（与周视图一致）：超过才视为拖拽选区
 */
const CREATE_DRAG_THRESHOLD_PX = 5;

/** 事件目标是否位于时间块内 */
function isInsideBlock(target: EventTarget | null): boolean {
	return !!(
		target instanceof Element &&
		(target.closest(`.${DayCanvasClasses.elements.block}`) || target.closest('.gc-day-canvas__more-badge'))
	);
}

/** 页面上是否存在打开的右键菜单（trigger 截断冒泡，只能直接探测 DOM） */
function isContextMenuOpen(): boolean {
	return !!document.querySelector(`.${ContextMenuClasses.container}`);
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

/** 快速创建载荷 */
type QuickCreate =
	| { type: 'point'; min: number }
	| { type: 'range'; startMin: number; endMin: number };

export interface DayTimelineCanvasProps {
	/** 画布呈现的日期（00:00） */
	day: Date;
	/** 单日时间线模型（buildDayTimelineModel 产物） */
	model: DayTimelineModel;
	/** 画布内卡片配置（timeline 变体） */
	config: TaskCardConfig;
	/** 任务全集（拖放源查找） */
	tasks: GCTask[];
	/** 写回成功后的刷新回调 */
	refresh: () => void;
	/** 默认起始展示小时（默认 6，若任务早于此小时则自动向前扩展至更早时间） */
	startHourBaseline?: number;
	/** 默认结束展示小时（默认 18，若任务晚于此小时则自动向后扩展至更晚时间） */
	endHourBaseline?: number;
	/** Układ kaskadowy nakładających się zadań (schodkowy z rozszerzaniem na hover) */
	cascadeOverlap?: boolean;
}

/**
 * 单日连续时间画布（共享组件：日视图任务区 + 侧栏每日时间线）。
 * 与周视图同语义：分钟级定位、点击/拖选空白创建、边缘拖拽改起止时间、
 * 块边缘落点的 HTML5 拖放 + 触屏长按拖动、落点预览、当前时间线。
 */
export function DayTimelineCanvas({
	day,
	model,
	config,
	tasks,
	refresh,
	startHourBaseline = 6,
	endHourBaseline = 18,
	cascadeOverlap = false,
}: DayTimelineCanvasProps): JSX.Element {
	const plugin = usePlugin();
	const app = useApp();

	const dateField = 'dueDate';
	const startField = plugin.settings.ganttStartField || 'startDate';
	const endField = plugin.settings.ganttEndField || 'dueDate';
	const enabledFormats = plugin.settings.enabledTaskFormats || [];

	const { visibleStartHour, visibleEndHour } = useMemo(() => {
		let sHour = startHourBaseline;
		let eHour = endHourBaseline;

		for (const { seg } of model.blocks) {
			const segStartHour = Math.floor(seg.startMin / 60);
			const segEndHour = Math.ceil(seg.endMin / 60);
			if (segStartHour < sHour) {
				sHour = Math.max(0, segStartHour);
			}
			if (segEndHour > eHour) {
				eHour = Math.min(24, segEndHour);
			}
		}

		if (eHour <= sHour) eHour = Math.min(24, sHour + 1);

		return { visibleStartHour: sHour, visibleEndHour: eHour };
	}, [model.blocks, startHourBaseline, endHourBaseline]);

	const canvasStartMin = visibleStartHour * 60;
	const canvasEndMin = visibleEndHour * 60;
	const totalHours = visibleEndHour - visibleStartHour;
	const canvasHeight = totalHours * HOUR_PX;

	const canvasRef = useRef<HTMLDivElement | null>(null);
	const ghostRef = useRef<HTMLDivElement | null>(null);
	const ghostLabelRef = useRef<HTMLSpanElement | null>(null);
	const createRef = useRef<{ anchorMin: number; anchorY: number; lastMin: number; moved: boolean } | null>(null);
	/** pointercancel 清理经 ref 桥接，避免与 finishCreate 形成循环推断 */
	const cancelCreateRef = useRef<() => void>(() => {});

	// ===== 拖放 UI 状态 =====
	const [dropLine, setDropLine] = useState<number | null>(null);
	const [dropPreview, setDropPreview] = useState<{ startMin: number; endMin: number } | null>(null);
	const [dragOver, setDragOver] = useState(false);

	/** 当日 00:00 + 分钟偏移（可超 1440 = 次日 00:00） */
	const atMinutes = useCallback((min: number): Date => {
		const d = new Date(day);
		d.setMinutes(min);
		return d;
	}, [day]);

	// ===== 统一写回 =====
	const persistTaskUpdate = useCallback(async (
		task: GCTask,
		updates: TaskUpdates,
		precisionPatch: Partial<Record<DateFieldType, 'day' | 'time'>>,
		errorKey: string,
	): Promise<boolean> => {
		try {
			const taskToUpdate = { ...task, datePrecision: { ...task.datePrecision, ...precisionPatch } };
			await updateTaskProperties(app, taskToUpdate, updates, enabledFormats);
			await plugin.taskCache.refreshFile(task.filePath);
			refresh();
			return true;
		} catch (error) {
			Logger.error('DayTimelineCanvas', 'Task update failed:', error);
			new Notice(i18n.t(errorKey));
			return false;
		}
	}, [app, plugin, enabledFormats, refresh]);

	// ===== resize 提交（WYSIWYG，与周视图同规则） =====
	const commitResize = useCallback((
		block: TimeBlock,
		seg: TimeBlockSegment,
		edge: 'top' | 'bottom',
		newStartMin: number,
		newEndMin: number,
		blockEl: HTMLElement,
	): void => {
		const updates: Partial<Record<DateFieldType, Date>> = {};
		let precision: Partial<Record<DateFieldType, 'day' | 'time'>> = {};

		if (block.isPoint) {
			if (edge === 'top') {
				updates[startField] = atMinutes(newStartMin);
				updates[endField] = block.end;
			} else {
				updates[startField] = block.start;
				updates[endField] = atMinutes(newEndMin);
			}
			precision = { [startField]: 'time', [endField]: 'time' };
		} else if (edge === 'top') {
			updates[startField] = atMinutes(newStartMin);
			precision = { [startField]: 'time' };
		} else {
			updates[endField] = atMinutes(newEndMin);
			precision = { [endField]: 'time' };
		}

		void (async () => {
			const ok = await persistTaskUpdate(block.task, updates, precision, 'views.dayView.updateTimeFailed');
			if (!ok) {
				blockEl.style.top = `${minutesToPx(seg.startMin - canvasStartMin)}px`;
				blockEl.style.height = `${minutesToPx(seg.endMin - seg.startMin)}px`;
			}
		})();
	}, [atMinutes, startField, endField, persistTaskUpdate]);

	const beginResize = useBlockResize(commitResize);

	// ===== 整块拖放落点（minutes = 块上边缘吸附时刻） =====
	const commitBlockMove = useCallback((task: GCTask, minutes: number): void => {
		const interval = getTaskInterval(task, startField, endField, dateField);
		const updates: Partial<Record<DateFieldType, Date>> = {};
		let precision: Partial<Record<DateFieldType, 'day' | 'time'>> = {};

		const durationMin = interval
			? Math.round((interval.end.getTime() - interval.start.getTime()) / 60000)
			: 0;

		const startIsTime = task.datePrecision?.[startField] === 'time';
		const endIsTime = task.datePrecision?.[endField] === 'time';

		// 检查任务是否已经是一个当日定时区间块（两端均有 time 精度，时长 < 24h）
		const isExistingTimedBlock = interval
			&& interval.kind === 'interval'
			&& durationMin < MINUTES_PER_DAY
			&& startIsTime
			&& endIsTime;

		if (isExistingTimedBlock) {
			// 仅原本同日的区间做当日容纳钳制，跨夜区间允许继续跨夜
			const dayMsOf = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
			const sameDayOrigin = dayMsOf(interval.start) === dayMsOf(interval.end);
			const anchorMin = sameDayOrigin && durationMin <= MINUTES_PER_DAY
				? Math.max(0, Math.min(minutes, MINUTES_PER_DAY - durationMin))
				: minutes;
			const newStart = atMinutes(anchorMin);
			const shiftMs = newStart.getTime() - interval.start.getTime();
			updates[startField] = newStart;
			const shiftedEnd = new Date(interval.end.getTime() + shiftMs);
			updates[endField] = shiftedEnd;
			precision = { [startField]: 'time', [endField]: 'time' };
		} else if (interval && interval.kind === 'point') {
			// 拖动点任务 = 双写起止并自动升级为区间任务（与周视图同语义）
			const pDuration = Math.round((interval.end.getTime() - interval.start.getTime()) / 60000);
			const anchorMin = Math.max(0, Math.min(minutes, MINUTES_PER_DAY - pDuration));
			updates[startField] = atMinutes(anchorMin);
			updates[endField] = atMinutes(anchorMin + pDuration);
			precision = { [startField]: 'time', [endField]: 'time' };
		} else {
			// 全天任务 / 从 ALL DAY 拖入 / 外部视图拖入：
			// 必须添加 start time 和 due time（转为当日时间块）
			const startMin = Math.max(0, Math.min(minutes, MINUTES_PER_DAY - MIN_DURATION_MIN));
			updates[startField] = atMinutes(startMin);
			precision[startField] = 'time';

			// 计算截止时间 targetEndMin：
			// 1. 若任务在目标日已有一个截止时间（endField 或 dateField），且该时间晚于 startMin，则保留该截止时间
			// 2. 否则按默认时长（1小时 / clampForwardPointEnd）推算截止时间
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
				const segs = model.blocks.map((b) => b.seg);
				targetEndMin = clampForwardPointEnd(startMin, segs, DEFAULT_POINT_DURATION_MIN);
				if (targetEndMin < startMin + MIN_DURATION_MIN) {
					targetEndMin = Math.min(startMin + DEFAULT_POINT_DURATION_MIN, MINUTES_PER_DAY);
				}
			}

			if (startField !== endField) {
				updates[endField] = atMinutes(targetEndMin);
				precision[endField] = 'time';
			}

			if (dateField !== startField && dateField !== endField) {
				updates[dateField] = updates[endField] ?? atMinutes(targetEndMin);
				precision[dateField] = 'time';
			}
		}

		void persistTaskUpdate(task, updates, precision, 'views.dayView.updateTimeFailed');
	}, [atMinutes, startField, endField, dateField, day, model.blocks, persistTaskUpdate]);

	// 触屏整块拖动（长按 500ms 起拖；单日画布 dayIndex 恒为 0）
	const beginBlockTouchPress = useCanvasTouchDrag({
		onCommit: (task, _dayIndex, minutes) => commitBlockMove(task, minutes),
		setPreview: (prev) => setDropPreview(prev && { startMin: prev.startMin, endMin: prev.endMin }),
		columnSelector: `.${DayCanvasClasses.elements.canvas}`,
		startMin: canvasStartMin,
	});

	// ===== 空白快速创建（单击 = 前向 1 小时区间，拖拽 = 选区） =====

	/** 光标处快速创建的可用终点（ghost 与创建同源）：钳到 24:00 与下一个块起点 */
	const quickCreateEnd = useCallback((min: number): number => {
		let end = Math.min(min + DEFAULT_POINT_DURATION_MIN, canvasEndMin);
		for (const { seg } of model.blocks) {
			if (seg.startMin >= min && seg.startMin < end) {
				end = seg.startMin;
			}
		}
		return end;
	}, [model.blocks, canvasEndMin]);

	const handleQuickCreate = useCallback((payload: QuickCreate): void => {
		if (payload.type === 'range') {
			openCreateTaskModal({
				app,
				plugin,
				targetDate: day,
				targetRange: { start: atMinutes(payload.startMin), end: atMinutes(payload.endMin) },
				onSuccess: () => {},
			});
			return;
		}
		// 下方空隙不足默认时长时按空隙收缩（与 ghost 预览一致）；无空隙不弹窗
		const endMin = quickCreateEnd(payload.min);
		if (endMin <= payload.min) return;
		openCreateTaskModal({
			app,
			plugin,
			targetDate: day,
			targetRange: { start: atMinutes(payload.min), end: atMinutes(endMin) },
			onSuccess: () => {},
		});
	}, [app, plugin, day, atMinutes, quickCreateEnd]);

	const minutesFromEvent = useCallback((clientY: number): number => {
		const canvas = canvasRef.current;
		if (!canvas) return canvasStartMin;
		const rect = canvas.getBoundingClientRect();
		const rawMinutes = canvasStartMin + pxToMinutes(clientY - rect.top);
		const snapped = snapMinutes(rawMinutes, false);
		return Math.max(canvasStartMin, Math.min(canvasEndMin, snapped));
	}, [canvasStartMin, canvasEndMin]);

	const showGhost = useCallback((gStartMin: number, gEndMin: number, dragging: boolean): void => {
		const ghost = ghostRef.current;
		const label = ghostLabelRef.current;
		if (!ghost) return;
		const clampedEnd = Math.min(Math.max(gEndMin, gStartMin + 1), canvasEndMin);
		setCssProps(ghost, { display: 'block' });
		ghost.style.top = `${minutesToPx(gStartMin - canvasStartMin)}px`;
		ghost.style.height = `${minutesToPx(clampedEnd - gStartMin)}px`;
		ghost.classList.toggle(DayCanvasClasses.modifiers.ghostDragging, dragging);
		if (label) label.textContent = dragging
			? `${formatMinutes(gStartMin)} – ${formatMinutes(clampedEnd)}`
			: formatMinutes(gStartMin);
	}, [canvasStartMin, canvasEndMin]);

	const hideGhost = useCallback((): void => {
		const ghost = ghostRef.current;
		if (ghost) setCssProps(ghost, { display: 'none' });
	}, []);

	// ===== hover ghost / 拖拽选区 =====
	const handlePointerMove = useCallback((e: ReactPointerEvent) => {
		if (isInsideBlock(e.target)) {
			if (!createRef.current) hideGhost();
			return;
		}
		const minutes = minutesFromEvent(e.clientY);
		const create = createRef.current;
		if (create) {
			create.lastMin = minutes;
			if (!create.moved && Math.abs(e.clientY - create.anchorY) > CREATE_DRAG_THRESHOLD_PX) {
				create.moved = true;
			}
			if (!create.moved) {
				showGhost(create.anchorMin, quickCreateEnd(create.anchorMin), true);
				return;
			}
			showGhost(Math.min(create.anchorMin, minutes), Math.max(create.anchorMin, minutes), true);
			return;
		}
		// portal 浮层冒泡 / 菜单与 resize 进行中：不出 hover 提示。
		// ghost 终点钳到下一个块起点（与点击创建同源判定）：空隙不足 1 小时按空隙收缩，
		// 光标处即块起点（无空隙）则不显示
		const canvas = canvasRef.current;
		if (!canvas || !canvas.contains(e.target as Node)) {
			hideGhost();
			return;
		}
		if (isContextMenuOpen() || isBlockResizing()) {
			hideGhost();
			return;
		}
		const endMin = quickCreateEnd(minutes);
		if (endMin <= minutes) {
			hideGhost();
			return;
		}
		showGhost(minutes, endMin, false);
	}, [minutesFromEvent, showGhost, hideGhost, quickCreateEnd]);

	const handlePointerLeave = useCallback(() => {
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
			onQuickCreateRange(create.anchorMin, create.lastMin);
		} else {
			handleQuickCreate({ type: 'point', min: create.anchorMin });
		}
		// eslint 未配置 exhaustive-deps；依赖经下方 ref 桥接
	}, [hideGhost, handleQuickCreate]);

	/** 触屏滚动接管手势（pointercancel）：静默放弃创建，不弹窗 */
	const cancelCreate = useCallback((): void => {
		createRef.current = null;
		document.removeEventListener('pointerup', finishCreate);
		document.removeEventListener('pointercancel', cancelCreateRef.current);
		hideGhost();
	}, [finishCreate, hideGhost]);
	cancelCreateRef.current = cancelCreate;

	/** 选区创建（独立函数避免 finishCreate 循环依赖） */
	const onQuickCreateRange = useCallback((anchor: number, last: number) => {
		handleQuickCreate({
			type: 'range',
			startMin: Math.min(anchor, last),
			endMin: Math.max(anchor, last),
		});
	}, [handleQuickCreate]);

	const handlePointerDown = useCallback((e: ReactPointerEvent) => {
		if (e.button !== 0 || isInsideBlock(e.target)) return;
		if (isContextMenuOpen()) return;
		const canvas = canvasRef.current;
		if (!canvas || !canvas.contains(e.target as Node)) return;
		e.preventDefault();
		const anchorMin = minutesFromEvent(e.clientY);
		const endMin = quickCreateEnd(anchorMin);
		if (endMin <= anchorMin) return; // 光标处即下一个块起点：无空隙，不启动创建手势
		createRef.current = { anchorMin, anchorY: e.clientY, lastMin: anchorMin, moved: false };
		showGhost(anchorMin, endMin, true);
		document.removeEventListener('pointerup', finishCreate);
		document.removeEventListener('pointercancel', cancelCreateRef.current);
		document.addEventListener('pointerup', finishCreate);
		document.addEventListener('pointercancel', cancelCreateRef.current);
	}, [minutesFromEvent, showGhost, finishCreate, quickCreateEnd]);

	// ===== HTML5 拖放（块拖动按块边缘落点 + 预览块；外部拖入按指针 + 指示线） =====
	const handleDragOver = useCallback((e: ReactDragEvent) => {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		setDragOver(true);
		const meta = getBlockDragMeta();
		if (meta) {
			setDropLine(null);
			const canvas = canvasRef.current;
			if (!canvas) return;
			const topMin = Math.max(
				canvasStartMin,
				Math.min(
					canvasEndMin - meta.durationMin,
					snapMinutes(canvasStartMin + pxToMinutes(e.clientY - meta.offsetPx - canvas.getBoundingClientRect().top), false)
				)
			);
			const previewEndMin = Math.min(topMin + meta.durationMin, canvasEndMin);
			setDropPreview((prev) => (prev && prev.startMin === topMin ? prev : { startMin: topMin, endMin: previewEndMin }));
			return;
		}
		setDropPreview(null);
		setDropLine(minutesFromEvent(e.clientY));
	}, [canvasStartMin, canvasEndMin, minutesFromEvent, setDropLine, setDropPreview]);

	const handleDragLeave = useCallback((e: ReactDragEvent) => {
		const related = e.relatedTarget as Node | null;
		if (related && e.currentTarget.contains(related)) return;
		setDropLine(null);
		setDropPreview(null);
		setDragOver(false);
	}, [setDropLine, setDropPreview]);

	const handleDrop = useCallback((e: ReactDragEvent) => {
		e.preventDefault();
		setDropLine(null);
		setDropPreview(null);
		setDragOver(false);

		const allTasks = plugin?.taskCache?.getAllTasks() || tasks;
		const task = resolveTaskFromDrop(e.dataTransfer, allTasks, app);

		if (!task) {
			Logger.warn('DayTimelineCanvas', 'Drop source task not found:', e.dataTransfer?.getData('taskId') || e.dataTransfer?.getData('text/plain'));
			return;
		}
		const meta = getBlockDragMeta();
		const topEdgeClientY = meta ? e.clientY - meta.offsetPx : e.clientY;
		commitBlockMove(task, minutesFromEvent(topEdgeClientY));
	}, [tasks, minutesFromEvent, commitBlockMove, plugin, app]);

	// ===== 当前时间指示线（仅画布日为今天时显示；30s 刷新） =====
	const isToday = useMemo(() => {
		const now = new Date();
		const d0 = new Date(day);
		return now.getFullYear() === d0.getFullYear() && now.getMonth() === d0.getMonth() && now.getDate() === d0.getDate();
	}, [day]);

	const [nowTop, setNowTop] = useState<number | null>(null);
	useEffect(() => {
		if (!isToday) {
			setNowTop(null);
			return;
		}
		const update = () => {
			const now = new Date();
			const nowMin = now.getHours() * 60 + now.getMinutes();
			if (nowMin >= canvasStartMin && nowMin <= canvasEndMin) {
				setNowTop(minutesToPx(nowMin - canvasStartMin));
			} else {
				setNowTop(null);
			}
		};
		update();
		const timer = window.setInterval(update, 30_000);
		return () => window.clearInterval(timer);
	}, [isToday, model, canvasStartMin, canvasEndMin]);

	// ===== Klastrowanie zadań nakładających się w czasie (Opcja 2: Popover +N więcej) =====
	const MAX_CASCADE_VISIBLE = 3;

	interface RawCluster {
		id: string;
		startMin: number;
		endMin: number;
		items: Array<{ block: TimeBlock; seg: TimeBlockSegment }>;
	}

	const { displayBlocks, overflowClusters, activeClusters } = useMemo(() => {
		if (!model.blocks || model.blocks.length === 0) {
			return { displayBlocks: [], overflowClusters: [], activeClusters: new Map<string, RawCluster>() };
		}

		// 1. Sortuj wg czasu rozpoczęcia
		const sorted = [...model.blocks].sort(
			(a, b) => a.seg.startMin - b.seg.startMin || a.seg.endMin - b.seg.endMin
		);

		const clusters: RawCluster[] = [];
		let current: RawCluster | null = null;

		for (const item of sorted) {
			if (!current || item.seg.startMin >= current.endMin) {
				current = {
					id: `cluster-${item.seg.startMin}-${item.seg.endMin}-${clusters.length}`,
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
			items: Array<{ block: TimeBlock; seg: TimeBlockSegment }>;
		}> = [];
		const visibleBlocks: Array<{
			block: TimeBlock;
			seg: TimeBlockSegment;
			clusterId: string;
		}> = [];

		for (const cl of clusters) {
			clusterMap.set(cl.id, cl);
			const total = cl.items.length;

			// Posortuj zadania wewnątrz klastra wg lane (lane 0 najniżej, lane 2 najwyżej)
			const clusterItemsSorted = [...cl.items].sort((a, b) => a.seg.lane - b.seg.lane || a.seg.stackedIndex - b.seg.stackedIndex);

			if (cascadeOverlap && total > MAX_CASCADE_VISIBLE) {
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
	}, [model.blocks, cascadeOverlap]);

	const [openCluster, setOpenCluster] = useState<{
		id: string;
		startMin: number;
		endMin: number;
		items: Array<{ block: TimeBlock; seg: TimeBlockSegment }>;
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
		clusterItems: Array<{ block: TimeBlock; seg: TimeBlockSegment }>,
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

	const vacation = plugin.vacationService?.getVacation(day);
	const canvasCls = [
		DayCanvasClasses.elements.canvas,
		dragOver ? DayCanvasClasses.modifiers.canvasDragOver : '',
		vacation ? DayCanvasClasses.modifiers.canvasVacation : '',
	].filter(Boolean).join(' ');

	return (
		<div className={DayCanvasClasses.elements.body}>
			{/* 时间沟槽 */}
			<div className={DayCanvasClasses.elements.gutter} style={{ position: 'relative' }}>
				{Array.from({ length: totalHours }, (_, i) => {
					const hour = visibleStartHour + i;
					return (
						<div key={hour} className={DayCanvasClasses.elements.timeLabel}>
							{`${String(hour).padStart(2, '0')}:00`}
						</div>
					);
				})}
				<div className="gc-day-canvas__time-label-end">
					{`${String(visibleEndHour).padStart(2, '0')}:00`}
				</div>
			</div>
			{/* 连续画布 */}
			<div
				ref={canvasRef}
				data-day-idx={0}
				className={canvasCls}
				title={vacation ? `🏖️ URLOP: ${vacation.type}${vacation.project ? ` (${vacation.project})` : ''}` : undefined}
				style={{ height: `${canvasHeight}px`, '--gc-tl-hour-h': `${HOUR_PX}px` } as CSSProperties}
				onPointerMove={handlePointerMove}
				onPointerLeave={handlePointerLeave}
				onPointerDown={handlePointerDown}
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

					if (cascadeOverlap && isOverlapped) {
						// Kaskada ze schodkowym przesunięciem (Problem 1: Opcja A):
						// Każda karta zachowuje czytelną szerokość min. 74%, kolejne pasy są przesunięte w prawo
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
						DayCanvasClasses.elements.block,
						seg.continuesBefore ? DayCanvasClasses.modifiers.blockContinuesBefore : '',
						seg.continuesAfter ? DayCanvasClasses.modifiers.blockContinuesAfter : '',
						seg.stackedIndex > 0 ? DayCanvasClasses.modifiers.blockStacked : '',
						durationMin < 45 ? (DayCanvasClasses.modifiers.blockSingleLine ?? 'gc-day-canvas__block--single-line') : '',
						durationMin < 20 ? (DayCanvasClasses.modifiers.blockTiny ?? 'gc-day-canvas__block--tiny') : '',
						isOverlapped && cascadeOverlap ? 'gc-day-canvas__block--cascade' : '',
						isOverlapped ? 'gc-day-canvas__block--overlapped' : '',
						`priority-${(block.task.priority || 'normal').toLowerCase()}`,
						block.task.completed ? 'is-completed' : '',
					].filter(Boolean).join(' ');
					const priorityColor = block.task.completed
						? 'var(--gc-task-completed, #52c41a)'
						: getPriorityBarColor(block.task.priority);
					const style: CSSProperties = {
						top: `${minutesToPx(seg.startMin - canvasStartMin)}px`,
						height: `${minutesToPx(durationMin)}px`,
						left: leftStyle,
						width: widthStyle,
						zIndex: zIndexVal,
						'--priority-bar-color': priorityColor,
					} as CSSProperties;
					return (
						<div
							key={`${block.task.filePath}:${block.task.lineNumber}`}
							className={cls}
							style={style}
							onPointerDown={(e) => beginBlockTouchPress(e, block, e.currentTarget)}
							onDragStart={(e) => {
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
								<span className={DayCanvasClasses.elements.blockTime}>
									{`${formatMinutes(seg.startMin)} – ${formatMinutes(seg.endMin)}`}
								</span>
							) : null}
							<TaskCard task={block.task} config={config} disableLongPressMenu onRefresh={refresh} />

							{!seg.continuesBefore && resizable ? (
								<div
									className={`${DayCanvasClasses.elements.handle} ${DayCanvasClasses.modifiers.handleTop}`}
									onPointerDown={(e) => {
										const canvas = canvasRef.current;
										if (canvas && e.currentTarget.parentElement) {
											beginResize(e, block, seg, 'top', canvas, e.currentTarget.parentElement, canvasStartMin);
										}
									}}
								/>
							) : null}
							{!seg.continuesAfter && resizable ? (
								<div
									className={`${DayCanvasClasses.elements.handle} ${DayCanvasClasses.modifiers.handleBottom}`}
									onPointerDown={(e) => {
										const canvas = canvasRef.current;
										if (canvas && e.currentTarget.parentElement) {
											beginResize(e, block, seg, 'bottom', canvas, e.currentTarget.parentElement, canvasStartMin);
										}
									}}
								/>
							) : null}
						</div>
					);
				})}
				{/* Plakietki "+N więcej" dla klastrów o > 3 zadaniach (Opcja 2) */}
				{overflowClusters.map((cl) => {
					const topPx = minutesToPx(cl.startMin - canvasStartMin);
					return (
						<button
							key={`badge-${cl.id}`}
							type="button"
							className="gc-day-canvas__more-badge"
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
							<Icon icon="layers" className="gc-day-canvas__more-icon" />
							<span>{i18n.t('sidebar.dailyTimeline.moreTasks', { count: cl.extraCount })}</span>
						</button>
					);
				})}
				{/* 拖放吸附指示线（外部来源） */}
				{dropLine !== null ? (
					<div className={DayCanvasClasses.elements.dropLine} style={{ top: `${minutesToPx(dropLine - canvasStartMin)}px` }} />
				) : null}
				{/* 整块拖动落点预览 */}
				{dropPreview ? (
					<div
						className={DayCanvasClasses.elements.dropPreview}
						style={{ top: `${minutesToPx(dropPreview.startMin - canvasStartMin)}px`, height: `${minutesToPx(dropPreview.endMin - dropPreview.startMin)}px` }}
					>
						<span className={DayCanvasClasses.elements.ghostLabel}>
							{`${formatMinutes(dropPreview.startMin)} – ${formatMinutes(dropPreview.endMin)}`}
						</span>
					</div>
				) : null}
				{/* 当前时间指示线 */}
				{nowTop !== null ? (
					<div className={DayCanvasClasses.elements.currentTime} style={{ top: nowTop }} />
				) : null}
				{/* 空白快速创建 ghost */}
				<div ref={ghostRef} className={DayCanvasClasses.elements.ghost} style={{ display: 'none' }}>
					<span ref={ghostLabelRef} className={DayCanvasClasses.elements.ghostLabel} />
					<span className={DayCanvasClasses.elements.ghostPlus}><Icon icon="plus" /></span>
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
										<TaskCard task={block.task} config={config} onRefresh={refresh} />
									</div>
								))}
							</div>
						</div>
					</div>,
					document.body
				)}
			</div>
		</div>
	);
}
