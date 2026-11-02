/**
 * SVG 甘特图渲染器
 * 自研实现，参考甘特图设计模式
 * 完全控制渲染、交互和样式
 *
 * 布局结构：
 * ┌────────────┬──────────────────────────────┐
 * │ 空白区域   │ 时间轴（水平固定）           │
 * ├────────────┼──────────────────────────────┤
 * │ 任务列表   │ 甘特图（双向滚动）           │
 * │ (垂直固定) │                              │
 * └────────────┴──────────────────────────────┘
 */

import type { GanttChartTask, GanttChartConfig, DateFieldType } from '../types';
import { TimeGranularity, GRANULARITY_CONFIGS } from '../types';
import { parseLocalDate, findStartGridUnitIndex as findStartIdx, findEndGridUnitIndex as findEndIdx, getGridUnitX as getX, getDateForUnit as getUnit } from './dateGeometry';
import { createTaskDragController } from './taskDragController';
import { renderHeader } from './headerRenderer';
import { renderCorner } from './cornerRenderer';
import { renderGrid, renderTodayLine, renderGroupSummaryBracket } from './gridRenderer';
import { groupGanttTasks, getPriorityInfo, getPriorityBarColor, type GanttGroupMode, type GanttDisplayRow } from '../../tasks/taskGrouper';
import { type IPluginContext, type GCTask, getTaskDateField } from '../../types';
import { GanttClasses, setCssProps } from '../../utils/bem';
import { TooltipManager, type MousePosition } from '../../utils/tooltipManager';
import { isTouchNow } from '../../ui/utils/platform';
import { Logger } from '../../utils/logger';
import { LinkRenderer } from '../../utils/linkRenderer';
import { getTodayInTimezone } from '../../dateUtils/timezone';
import { formatDate } from '../../dateUtils/dateUtilsIndex';
import { openFileInExistingLeaf } from '../../utils/fileOpener';
import { App } from 'obsidian';
import { setBlockDragMeta, clearBlockDragMeta } from '../../ui/views/week/useBlockResize';

/**
 * SVG 元素辅助方法
 */
function addSvgClass(element: Element, className: string): void {
	const existing = element.getAttribute('class') || '';
	const classes = existing.split(' ').filter(c => c);
	if (!classes.includes(className)) {
		classes.push(className);
	}
	element.setAttribute('class', classes.join(' '));
}

/**
 * SVG 甘特图渲染器
 *
 * 使用 SVG 绘制专业的甘特图
 */
export class SvgGanttRenderer {
	// 多个 SVG 元素
	private headerSvg: SVGSVGElement | null = null;   // 时间轴
	private taskListSvg: SVGSVGElement | null = null;  // 任务列表
	private ganttSvg: SVGSVGElement | null = null;     // 甘特图主体
	private cornerSvg: SVGSVGElement | null = null;    // 左上角空白

	private config: GanttChartConfig;
	private tasks: GanttChartTask[] = [];
	private container: HTMLElement;
	private plugin: IPluginContext;
	private app: App | null;  // Obsidian App 实例

	// 时间颗粒度
	private granularity: TimeGranularity = TimeGranularity.DAY;

	// 尺寸相关
	private headerHeight = 76;
	private rowHeight = 40;
	private columnWidth = 50;
	private taskNumberColumnWidth = 40;  // 任务序号列宽度
	private taskColumnWidth = 260;  // 任务列宽度（包含序号列）
	private resizerWidth = 4;  // 分隔条宽度
	private padding = 18;

	// Grupowanie zadań (Gantt Calendar Pro)
	private groupMode: GanttGroupMode = 'folder';
	private collapsedGroups: Set<string> = new Set<string>();
	private displayRows: GanttDisplayRow[] = [];

	// 日期范围（用于滚动到今天）
	private minDate: Date | null = null;
	private totalUnits = 0;  // 颗粒度单元数（原totalDays）

	// 布局容器 - 单个 Grid 包含所有元素
	private mainGrid: HTMLElement | null = null;
	private headerContainer: HTMLElement | null = null;
	private taskListContainer: HTMLElement | null = null;
	private ganttContainer: HTMLElement | null = null;
	private cornerContainer: HTMLElement | null = null;
	private resizer: HTMLElement | null = null;  // 分隔条元素

	// 拖动状态
	private isResizing = false;
	// Document-level resize listeners are kept as fields so destroy() can
	// always detach them (anonymous listeners would leak per engine rebuild).
	private resizeMoveHandler: ((e: MouseEvent) => void) | null = null;
	private resizeEndHandler: ((e: MouseEvent) => void) | null = null;

	// 行背景元素引用（用于鼠标悬停高亮）
	private rowBgElements = {
		taskList: [] as SVGRectElement[],
		gantt: [] as SVGRectElement[],
	};
	private currentHighlightRow = -1;

	// 事件回调
	private onDateChange?: (task: GanttChartTask, start: Date, end: Date) => void | Promise<void>;
	private onProgressChange?: (task: GanttChartTask, progress: number) => void | Promise<void>;
	private startField: DateFieldType = 'startDate';
	private endField: DateFieldType = 'dueDate';

	constructor(
		container: HTMLElement,
		config: GanttChartConfig,
		plugin: IPluginContext,
		_originalTasks: GCTask[] = [],
		app: App | null = null,
		startField: DateFieldType = 'startDate',
		endField: DateFieldType = 'dueDate',
	) {
		this.container = container;
		this.config = config;
		this.plugin = plugin;
		this.originalTasks = _originalTasks || [];
		this.app = app ?? plugin?.app ?? null;
		this.startField = startField;
		this.endField = endField;

		// 从配置读取尺寸与分组模式
		this.headerHeight = config.header_height ?? 76;
		this.columnWidth = config.column_width ?? 50;
		this.groupMode = config.group_by ?? 'folder';
		this.taskNumberColumnWidth = 36;  // 固定序号列宽度
		this.taskColumnWidth = 320;       // Łączna szerokość kolumny zadań (numer 36px + treść + priorytet 80px)
		this.padding = config.padding ?? 18;

		// 初始化时间颗粒度
		this.granularity = config.granularity ?? TimeGranularity.DAY;
	}

	/**
	 * Aktualizuje zbiór oryginalnych zadań (używany m.in. przy drop z sidebara)
	 */
	setOriginalTasks(tasks: GCTask[]): void {
		this.originalTasks = tasks;
	}

	/**
	 * Przełącza zwinięcie/rozwinięcie danej grupy zadań
	 */
	toggleGroupCollapse(groupId: string): void {
		if (this.collapsedGroups.has(groupId)) {
			this.collapsedGroups.delete(groupId);
		} else {
			this.collapsedGroups.add(groupId);
		}
		this.render();
	}

	/**
	 * Zmienia tryb grupowania
	 */
	setGroupMode(mode: GanttGroupMode): void {
		if (this.groupMode === mode) return;
		this.groupMode = mode;
		this.collapsedGroups.clear();
		this.render();
	}

	/**
	 * 初始化渲染器
	 */
	init(tasks: GanttChartTask[]): void {
		this.tasks = tasks;
		this.render();
	}

	/**
	 * 刷新任务数据
	 */
	refresh(tasks: GanttChartTask[]): void {
		this.tasks = tasks;
		this.render();
	}

	/**
	 * 更新配置（支持颗粒度切换）
	 */
	updateConfig(config: Partial<GanttChartConfig>): void {
		// 更新颗粒度
		if (config.granularity) {
			this.granularity = config.granularity;
		}

		// 更新配置对象
		this.config = { ...this.config, ...config };

		// 更新尺寸配置（如果提供）
		if (config.header_height !== undefined) {
			this.headerHeight = config.header_height;
		}
		if (config.column_width !== undefined) {
			this.columnWidth = config.column_width;
		}
		if (config.padding !== undefined) {
			this.padding = config.padding;
		}
		if (config.group_by !== undefined && config.group_by !== this.groupMode) {
			this.groupMode = config.group_by;
			this.collapsedGroups.clear();
		}

		// 重新渲染
		this.render();
	}

	/**
	 * 增量更新任务（不完整重建视图）
	 * 只更新受影响的 DOM 元素，保持滚动位置
	 */
	updateTasks(newTasks: GanttChartTask[]): void {
		const oldTasks = this.tasks;
		this.tasks = newTasks;

		// Gdy aktywne jest grupowanie, wykonaj pełny render
		if (this.groupMode !== 'none') {
			this.render();
			return;
		}

		// 构建任务ID映射
		const oldTaskMap = new Map(oldTasks.map(t => [t.id, t]));
		const newTaskMap = new Map(newTasks.map(t => [t.id, t]));

		// 找出新增、删除、修改的任务
		const added = newTasks.filter(t => !oldTaskMap.has(t.id));
		const removed = oldTasks.filter(t => !newTaskMap.has(t.id));
		const modified = newTasks.filter(t => {
			const old = oldTaskMap.get(t.id);
			return old && this.isTaskDifferent(old, t);
		});

		// 修改后的任务日期若超出当前网格范围（如同步拉回一个远期日期），
		// 增量路径复用旧 minDate 会把条画到负坐标/画布之外——升级为全量渲染
		const outOfRange = modified.some(t => this.isTaskOutsideRenderedRange(t));

		// Jeśli dodano lub usunięto zadanie, lub data wykracza poza zakres - pełny render z zachowaniem pozycji
		if (added.length > 0 || removed.length > 0 || outOfRange) {
			this.render();
			return;
		}

		// 执行增量更新
		this.updateTaskListIncremental(added, removed, modified, newTasks);
		this.updateGanttAreaIncremental(added, removed, modified, newTasks);
	}

	/**
	 * 检查任务是否发生变化
	 */
	private isTaskDifferent(old: GanttChartTask, current: GanttChartTask): boolean {
		return old.start !== current.start ||
			   old.end !== current.end ||
			   old.leadStart !== current.leadStart ||
			   old.progress !== current.progress ||
			   old.completed !== current.completed ||
			   old.name !== current.name ||
			   old.priority !== current.priority ||
			   old.custom_class !== current.custom_class;
	}

	/**
	 * 检查任务（含引导段起点）是否落在当前渲染的日期范围内。
	 * 增量更新复用既有网格，越界任务必须触发全量重绘重建日期范围。
	 */
	private isTaskOutsideRenderedRange(task: GanttChartTask): boolean {
		if (!this.minDate) return true;
		const start = SvgGanttRenderer.parseLocalDate(task.leadStart ?? task.start);
		const end = SvgGanttRenderer.parseLocalDate(task.end);
		const maxDate = new Date(this.minDate.getTime() + this.totalUnits * (GRANULARITY_CONFIGS[this.granularity]?.milliseconds || 86400000));
		return start < this.minDate || end > maxDate;
	}

	/**
	 * 设置事件处理器
	 */
	setEventHandlers(handlers: {
		onDateChange?: (task: GanttChartTask, start: Date, end: Date) => void | Promise<void>;
		onProgressChange?: (task: GanttChartTask, progress: number) => void | Promise<void>;
	}): void {
		this.onDateChange = handlers.onDateChange;
		this.onProgressChange = handlers.onProgressChange;
	}

	/**
	 * 主渲染方法 - 使用单个 Grid 布局实现冻结效果
	 * Grid 结构：
	 * ┌────────────┬──────────────────────────────┐
	 * │ 空白区域   │ 时间轴（sticky）             │
	 * ├────────────┼──────────────────────────────┤
	 * │ 任务列表   │ 甘特图（双向滚动）           │
	 * └────────────┴──────────────────────────────┘
	 */
	private render(): void {
		if (this.taskDragState.isDragging) {
			this.dragController?.destroy();
			this.taskDragState.isDragging = false;
		}
		// Preserve scroll across full re-renders (config change / bulk task change).
		const savedScrollLeft = this.ganttContainer?.scrollLeft ?? 0;
		const savedScrollTop = this.ganttContainer?.scrollTop ?? 0;
		const oldMinDate = this.minDate;
		const isInitialRender = !oldMinDate && savedScrollLeft === 0;

		// 清空容器
		this.container.empty();

		// 计算日期范围
		const { minDate, totalUnits, granularity } = this.calculateDateRange();

		// 保存日期范围信息（用于滚动到今天）
		this.minDate = minDate;
		this.totalUnits = totalUnits;

		// Przygotuj wiersze do wyświetlenia wg trybu grupowania (Gantt Calendar Pro)
		this.displayRows = groupGanttTasks(this.tasks, this.groupMode, this.collapsedGroups);

		// 计算尺寸
		const totalRows = this.displayRows.length;
		const ganttWidth = totalUnits * this.columnWidth + this.padding * 2;
		const rowsHeight = totalRows * this.rowHeight;

		// 创建单个 Grid 容器
		this.mainGrid = this.container.createDiv(GanttClasses.elements.mainGrid);
		// 设置 CSS 变量用于控制任务列宽度与表头高度
		setCssProps(this.mainGrid, {
			'--task-column-width': `${this.taskColumnWidth}px`,
			'--gantt-header-height': `${this.headerHeight}px`,
		});

		// 1. 左上角空白区域 (Corner: taskColumnWidth x headerHeight)
		this.cornerContainer = this.mainGrid.createDiv(GanttClasses.elements.corner);
		this.cornerSvg = this.createSvgElement(
			this.cornerContainer,
			this.taskColumnWidth,
			this.headerHeight,
			GanttClasses.elements.cornerSvg
		);
		this.renderCorner(this.cornerSvg);

		// 2. 顶部时间轴容器（可水平滚动）
		this.headerContainer = this.mainGrid.createDiv(GanttClasses.elements.header);
		this.headerSvg = this.createSvgElement(
			this.headerContainer,
			ganttWidth,
			this.headerHeight,
			GanttClasses.elements.headerSvg
		);
		this.renderHeader(this.headerSvg, minDate, totalUnits, granularity);

		// 3. 左侧任务列表容器（冻结窗格，不随甘特图横向滚动）
		this.taskListContainer = this.mainGrid.createDiv(GanttClasses.elements.tasklist);
		this.taskListSvg = this.createSvgElement(
			this.taskListContainer,
			this.taskColumnWidth,
			rowsHeight,
			GanttClasses.elements.tasklistSvg
		);
		this.renderTaskList(this.taskListSvg);

		// 4. 右侧甘特图容器（双向滚动）
		this.ganttContainer = this.mainGrid.createDiv(GanttClasses.elements.chart);
		this.ganttSvg = this.createSvgElement(
			this.ganttContainer,
			ganttWidth,
			rowsHeight,
			GanttClasses.elements.chartSvg
		);
		// 初始化拖拽控制器（必须在 renderGanttChart 之前）
		this.dragController = createTaskDragController(
			this as unknown as import('./renderContext').IRenderContext,
			() => this.tasks,
			this.onDateChange,
			(task: GanttChartTask) => this.handleTaskClick(task),
		);

		this.renderGanttChart(this.ganttSvg, minDate, totalUnits, rowsHeight, granularity);

		// 5. 创建分隔条（覆盖在 Grid 上）
		this.resizer = this.mainGrid.createDiv(GanttClasses.elements.resizer);
		this.setupSyncScrolling();
		this.setupResizer();
		this.setupRowHighlight();
		this.setupDropReceiver();

		// Zachowaj stabilne położenie scrolla, kompensując przesunięcie minDate w siatce
		let targetScrollLeft = savedScrollLeft;
		if (!isInitialRender && oldMinDate && minDate && this.columnWidth) {
			const diffDays = Math.round((minDate.getTime() - oldMinDate.getTime()) / 86400000);
			targetScrollLeft = Math.max(0, savedScrollLeft - diffDays * this.columnWidth);
		}

		const restoreScroll = () => {
			if (!this.ganttContainer) return;

			const scrollX = isInitialRender ? this.getTodayScrollLeft() : targetScrollLeft;

			this.ganttContainer.scrollLeft = scrollX;
			if (this.headerContainer) {
				this.headerContainer.scrollLeft = scrollX;
			}
			if (this.taskListContainer) {
				this.taskListContainer.scrollTop = savedScrollTop;
			}
			this.ganttContainer.scrollTop = savedScrollTop;
		};
		restoreScroll();
		window.requestAnimationFrame(restoreScroll);
	}

	/**
	 * 计算日期范围
	 */
	private calculateDateRange(): {
		minDate: Date;
		maxDate: Date;
		totalUnits: number;  // 颗粒度单元数（原totalDays）
		granularity: TimeGranularity
	} {
		const config = GRANULARITY_CONFIGS[this.granularity];

		const today = getTodayInTimezone();

		if (this.tasks.length === 0) {
			const defaultUnits = 30; // 默认30个单元
			return {
				minDate: today,
				maxDate: new Date(today.getTime() + defaultUnits * config.milliseconds),
				totalUnits: defaultUnits,
				granularity: this.granularity
			};
		}

		const dates = [
			today,
			...this.tasks.flatMap(t => [
				SvgGanttRenderer.parseLocalDate(t.start),
				SvgGanttRenderer.parseLocalDate(t.end),
				...(t.leadStart ? [SvgGanttRenderer.parseLocalDate(t.leadStart)] : [])
			])
		].filter(d => !isNaN(d.getTime()));

		let minDate = new Date(Math.min(...dates.map(d => d.getTime())));
		let maxDate = new Date(Math.max(...dates.map(d => d.getTime())));

		// 根据颗粒度对齐网格边界
		minDate = config.gridAligner(minDate);
		maxDate = config.gridAligner(maxDate);

		// 确保maxDate > minDate（至少1个单元）
		if (maxDate <= minDate) {
			maxDate = new Date(minDate.getTime() + config.milliseconds);
		}

		// 添加边距（前2后2个单元）
		const paddingUnits = 2;
		if (!this.granularity || (this.granularity as string) === 'day' || this.granularity === TimeGranularity.DAY) {
			minDate = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate() - paddingUnits);
			maxDate = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate() + paddingUnits);
			const utcMin = Date.UTC(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
			const utcMax = Date.UTC(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate());
			const totalUnits = Math.round((utcMax - utcMin) / 86400000);
			return { minDate, maxDate, totalUnits, granularity: this.granularity };
		}

		minDate = new Date(minDate.getTime() - paddingUnits * config.milliseconds);
		maxDate = new Date(maxDate.getTime() + paddingUnits * config.milliseconds);

		// 计算总单元数
		const totalUnits = Math.ceil((maxDate.getTime() - minDate.getTime()) / config.milliseconds);

		return { minDate, maxDate, totalUnits, granularity: this.granularity };
	}

	/**
	 * 创建 SVG 元素的辅助方法
	 */
	/**
	 * Parse YYYY-MM-DD strings as LOCAL dates.
	 * new Date('YYYY-MM-DD') parses as UTC midnight, which shifts the whole
	 * grid by one day in any timezone west of UTC. All grid math must use
	 * local midnight, matching how tasks are serialized back to markdown.
	 */
	private static parseLocalDate(dateStr: string): Date {
		return parseLocalDate(dateStr);
	}

	private createSvgElement(
		container: HTMLElement,
		width: number,
		height: number,
		className: string
	): SVGSVGElement {
		const svg = container.createSvg('svg');
		svg.setAttribute('width', String(width));
		svg.setAttribute('height', String(height));
		svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
		addSvgClass(svg, className);
		return svg;
	}

	/**
	 * 设置同步滚动
	 */
	private setupSyncScrolling(): void {
		if (!this.headerContainer || !this.taskListContainer || !this.ganttContainer) return;

		const headerContainer = this.headerContainer;
		const taskListContainer = this.taskListContainer;
		const ganttContainer = this.ganttContainer;

		// chart 容器滚动 → 同步到 header 和 tasklist
		ganttContainer.addEventListener('scroll', () => {
			if (Math.abs(headerContainer.scrollLeft - ganttContainer.scrollLeft) >= 1) {
				headerContainer.scrollLeft = ganttContainer.scrollLeft;
			}
			if (Math.abs(taskListContainer.scrollTop - ganttContainer.scrollTop) >= 1) {
				taskListContainer.scrollTop = ganttContainer.scrollTop;
			}
		}, { passive: true });

		// header 容器滚动 → 同步到 chart
		headerContainer.addEventListener('scroll', () => {
			if (Math.abs(ganttContainer.scrollLeft - headerContainer.scrollLeft) >= 1) {
				ganttContainer.scrollLeft = headerContainer.scrollLeft;
			}
		}, { passive: true });

		// tasklist 容器滚动 → 同步到 chart
		taskListContainer.addEventListener('scroll', () => {
			if (Math.abs(ganttContainer.scrollTop - taskListContainer.scrollTop) >= 1) {
				ganttContainer.scrollTop = taskListContainer.scrollTop;
			}
		}, { passive: true });
	}

	/**
	 * 设置分隔条拖动
	 * 使用 CSS 变量控制宽度，确保所有区域同步变化
	 */
	private setupResizer(): void {
		if (!this.resizer || !this.mainGrid) return;

		// Re-render safety: detach previous document listeners before registering
		this.removeResizeListeners();

		const resizer = this.resizer;
		const mainGrid = this.mainGrid;

		// 鼠标按下开始拖动
		resizer.addEventListener('pointerdown', (e) => {
			this.isResizing = true;
			setCssProps(activeDocument.body, { cursor: 'col-resize', userSelect: 'none' });

			e.preventDefault();
		});

		let resizeRaf: number | null = null;

		// 鼠标移动调整宽度
		this.resizeMoveHandler = (e) => {
			if (!this.isResizing || !mainGrid) return;

			const layoutRect = mainGrid.getBoundingClientRect();
			const newWidth = Math.round(e.clientX - layoutRect.left);

			// 限制最小和最大宽度
			const minWidth = 120;
			const maxWidth = layoutRect.width - this.resizerWidth - 200;

			if (newWidth >= minWidth && newWidth <= maxWidth) {
				this.taskColumnWidth = newWidth;
				setCssProps(mainGrid, { '--task-column-width': `${newWidth}px` });

				if (resizeRaf === null) {
					resizeRaf = window.requestAnimationFrame(() => {
						resizeRaf = null;
						const rowsHeight = this.displayRows.length * this.rowHeight;

						// Aktualizuj narożnik (nagłówki ZADANIE i PRIORYTET dopasowują się idealnie)
						if (this.cornerSvg) {
							this.cornerSvg.setAttribute('width', String(this.taskColumnWidth));
							this.cornerSvg.setAttribute('height', String(this.headerHeight));
							this.cornerSvg.setAttribute('viewBox', `0 0 ${this.taskColumnWidth} ${this.headerHeight}`);
							this.renderCorner(this.cornerSvg);
						}

						// Aktualizuj listę zadań (zarówno height jak i viewBox = rowsHeight, brak zniekształceń!)
						if (this.taskListSvg) {
							this.taskListSvg.setAttribute('width', String(this.taskColumnWidth));
							this.taskListSvg.setAttribute('height', String(rowsHeight));
							this.taskListSvg.setAttribute('viewBox', `0 0 ${this.taskColumnWidth} ${rowsHeight}`);
							this.renderTaskList(this.taskListSvg);
						}
					});
				}
			}
		};

		// 鼠标释放结束拖动
		this.resizeEndHandler = () => {
			if (this.isResizing) {
				this.isResizing = false;
				setCssProps(activeDocument.body, { cursor: '', userSelect: '' });
				if (resizeRaf !== null) {
					window.cancelAnimationFrame(resizeRaf);
					resizeRaf = null;
				}

				const rowsHeight = this.displayRows.length * this.rowHeight;

				if (this.cornerSvg) {
					this.cornerSvg.setAttribute('width', String(this.taskColumnWidth));
					this.cornerSvg.setAttribute('height', String(this.headerHeight));
					this.cornerSvg.setAttribute('viewBox', `0 0 ${this.taskColumnWidth} ${this.headerHeight}`);
					this.renderCorner(this.cornerSvg);
				}

				if (this.taskListSvg) {
					this.taskListSvg.setAttribute('width', String(this.taskColumnWidth));
					this.taskListSvg.setAttribute('height', String(rowsHeight));
					this.taskListSvg.setAttribute('viewBox', `0 0 ${this.taskColumnWidth} ${rowsHeight}`);
					this.renderTaskList(this.taskListSvg);
				}
			}
		};

		activeDocument.addEventListener('pointermove', this.resizeMoveHandler);
		activeDocument.addEventListener('pointerup', this.resizeEndHandler);
	}

	private removeResizeListeners(): void {
		if (this.resizeMoveHandler) {
			activeDocument.removeEventListener('pointermove', this.resizeMoveHandler);
			this.resizeMoveHandler = null;
		}
		if (this.resizeEndHandler) {
			activeDocument.removeEventListener('pointerup', this.resizeEndHandler);
			this.resizeEndHandler = null;
		}
		this.isResizing = false;
	}

	/**
	 * 设置行悬停高亮
	 * 监听任务列表和甘特图区域的鼠标移动，高亮对应的行
	 */
	private setupRowHighlight(): void {
		if (!this.taskListContainer || !this.ganttContainer) return;

		// 更新行高亮的辅助方法
		const updateHighlight = (rowIndex: number) => {
			// 如果行索引超出范围或没有变化，直接返回
			if (rowIndex < 0 || rowIndex >= this.displayRows.length || rowIndex === this.currentHighlightRow) {
				return;
			}

			// 清除之前的高亮
			if (this.currentHighlightRow >= 0) {
				const oldTaskListRow = this.rowBgElements.taskList[this.currentHighlightRow];
				const oldGanttRow = this.rowBgElements.gantt[this.currentHighlightRow];
				if (oldTaskListRow) {
					addSvgClass(oldTaskListRow, GanttClasses.elements.rowBg);
					const classes = oldTaskListRow.getAttribute('class')?.split(' ') || [];
					const newClasses = classes.filter(c => c !== GanttClasses.elements.rowHighlight);
					oldTaskListRow.setAttribute('class', newClasses.join(' '));
					// 恢复原始背景
					if (this.currentHighlightRow % 2 === 0) {
						oldTaskListRow.setAttribute('fill', 'var(--background-secondary)');
						oldTaskListRow.setAttribute('opacity', '0.3');
					} else {
						oldTaskListRow.setAttribute('fill', 'transparent');
					}
				}
				if (oldGanttRow) {
					addSvgClass(oldGanttRow, GanttClasses.elements.rowBg);
					const classes = oldGanttRow.getAttribute('class')?.split(' ') || [];
					const newClasses = classes.filter(c => c !== GanttClasses.elements.rowHighlight);
					oldGanttRow.setAttribute('class', newClasses.join(' '));
					// 恢复原始背景
					if (this.currentHighlightRow % 2 === 0) {
						oldGanttRow.setAttribute('fill', 'var(--background-secondary)');
						oldGanttRow.setAttribute('opacity', '0.3');
					} else {
						oldGanttRow.setAttribute('fill', 'transparent');
					}
				}
			}

			// 添加新的高亮
			const newTaskListRow = this.rowBgElements.taskList[rowIndex];
			const newGanttRow = this.rowBgElements.gantt[rowIndex];
			if (newTaskListRow) {
				const classes = newTaskListRow.getAttribute('class')?.split(' ') || [];
				const newClasses = classes.filter(c => c !== GanttClasses.elements.rowBg);
				newClasses.push(GanttClasses.elements.rowHighlight);
				newTaskListRow.setAttribute('class', newClasses.join(' '));
			}
			if (newGanttRow) {
				const classes = newGanttRow.getAttribute('class')?.split(' ') || [];
				const newClasses = classes.filter(c => c !== GanttClasses.elements.rowBg);
				newClasses.push(GanttClasses.elements.rowHighlight);
				newGanttRow.setAttribute('class', newClasses.join(' '));
			}

			this.currentHighlightRow = rowIndex;
		};

		// 清除高亮的辅助方法
		const clearHighlight = () => {
			if (this.currentHighlightRow >= 0) {
				const oldTaskListRow = this.rowBgElements.taskList[this.currentHighlightRow];
				const oldGanttRow = this.rowBgElements.gantt[this.currentHighlightRow];
				if (oldTaskListRow) {
					addSvgClass(oldTaskListRow, GanttClasses.elements.rowBg);
					const classes = oldTaskListRow.getAttribute('class')?.split(' ') || [];
					const newClasses = classes.filter(c => c !== GanttClasses.elements.rowHighlight);
					oldTaskListRow.setAttribute('class', newClasses.join(' '));
					// 恢复原始背景
					if (this.currentHighlightRow % 2 === 0) {
						oldTaskListRow.setAttribute('fill', 'var(--background-secondary)');
						oldTaskListRow.setAttribute('opacity', '0.3');
					} else {
						oldTaskListRow.setAttribute('fill', 'transparent');
					}
				}
				if (oldGanttRow) {
					addSvgClass(oldGanttRow, GanttClasses.elements.rowBg);
					const classes = oldGanttRow.getAttribute('class')?.split(' ') || [];
					const newClasses = classes.filter(c => c !== GanttClasses.elements.rowHighlight);
					oldGanttRow.setAttribute('class', newClasses.join(' '));
					// 恢复原始背景
					if (this.currentHighlightRow % 2 === 0) {
						oldGanttRow.setAttribute('fill', 'var(--background-secondary)');
						oldGanttRow.setAttribute('opacity', '0.3');
					} else {
						oldGanttRow.setAttribute('fill', 'transparent');
					}
				}
				this.currentHighlightRow = -1;
			}
		};

		// 监听任务列表容器的鼠标移动
		this.taskListContainer.addEventListener('mousemove', (e) => {
			const rect = this.taskListContainer!.getBoundingClientRect();
			const offsetY = e.clientY - rect.top + this.taskListContainer!.scrollTop;
			const rowIndex = Math.floor(offsetY / this.rowHeight);
			updateHighlight(rowIndex);
		});

		// 监听任务列表容器的鼠标离开
		this.taskListContainer.addEventListener('mouseleave', () => {
			clearHighlight();
		});

		// 监听甘特图容器的鼠标移动
		this.ganttContainer.addEventListener('mousemove', (e) => {
			const rect = this.ganttContainer!.getBoundingClientRect();
			const offsetY = e.clientY - rect.top + this.ganttContainer!.scrollTop;
			const rowIndex = Math.floor(offsetY / this.rowHeight);
			updateHighlight(rowIndex);
		});

		// 监听甘特图容器的鼠标离开
		this.ganttContainer.addEventListener('mouseleave', () => {
			clearHighlight();
		});
	}

	/**
	 * 设置从侧边栏拖拽任务到甘特图的 drop 接收
	 */
	private setupDropReceiver(): void {
		if (!this.ganttContainer) return;

		const targets = [this.ganttContainer, this.headerContainer].filter((el): el is HTMLElement => el !== null);

		const handleDragOver = (e: DragEvent) => {
			e.preventDefault();
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'move';
			}
			this.ganttContainer?.addClass(GanttClasses.modifiers.chartDropTarget);
		};

		const handleDragLeave = (e: DragEvent) => {
			const currentTarget = e.currentTarget as HTMLElement | null;
			const related = e.relatedTarget as HTMLElement | null;
			if (currentTarget && related && currentTarget.contains(related)) return;
			this.ganttContainer?.removeClass(GanttClasses.modifiers.chartDropTarget);
		};

		const handleDrop = (e: DragEvent) => {
			e.preventDefault();
			this.ganttContainer?.removeClass(GanttClasses.modifiers.chartDropTarget);

			if (!e.dataTransfer) return;
			const taskId = e.dataTransfer.getData('taskId');
			if (!taskId) return;

			// taskId 格式: "filePath:lineNumber"
			const colonIndex = taskId.lastIndexOf(':');
			if (colonIndex === -1) return;
			const filePath = taskId.substring(0, colonIndex);
			const lineNumber = parseInt(taskId.substring(colonIndex + 1), 10);

			// 1. 在已渲染的甘特图任务列表中查找
			let ganttTask = this.tasks.find(t =>
				t.filePath === filePath && t.lineNumber === lineNumber
			);

			let sourceTask: GCTask | undefined;
			if (!ganttTask) {
				// 2. 在原始任务全集或 taskCache 中查找（从侧边栏拖入的任务尚未包含起止日期）
				sourceTask = this.originalTasks?.find(t =>
					t.filePath === filePath && t.lineNumber === lineNumber
				) || this.plugin?.taskCache?.getAllTasks()?.find(t =>
					t.filePath === filePath && t.lineNumber === lineNumber
				);

				if (!sourceTask) {
					Logger.error('SvgGanttRenderer', 'Dropped task not found:', taskId);
					return;
				}

				ganttTask = {
					id: `${sourceTask.filePath}:${sourceTask.lineNumber}`,
					name: sourceTask.description || sourceTask.content,
					start: '',
					end: '',
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
					startSourceField: this.startField,
				};
			}

			if (!this.onDateChange) return;

			const minDate = this.minDate ?? getTodayInTimezone();

			// 根据 drop 的 x 坐标计算目标日期（网格从 x=0 开始）
			const container = this.ganttContainer!;
			const rect = container.getBoundingClientRect();
			const dropX = e.clientX - rect.left + container.scrollLeft;
			const unitIndex = Math.max(0, Math.floor(dropX / this.columnWidth));
			const clampedUnit = this.totalUnits > 0 ? Math.min(this.totalUnits - 1, unitIndex) : unitIndex;
			const targetDate = this.getDateForUnit(minDate, clampedUnit, this.granularity);

			// Wyznaczenie długości zadania: jeśli miało już obie daty, zachowujemy interwał
			let durationDays = 0;
			if (sourceTask) {
				const existingStart = getTaskDateField(sourceTask, this.startField);
				const existingEnd = getTaskDateField(sourceTask, this.endField);
				if (existingStart && existingEnd && !isNaN(existingStart.getTime()) && !isNaN(existingEnd.getTime())) {
					durationDays = Math.max(0, Math.round((existingEnd.getTime() - existingStart.getTime()) / 86400000));
				} else {
					durationDays = 0;
				}
			} else if (ganttTask.start && ganttTask.end) {
				const originalStart = SvgGanttRenderer.parseLocalDate(ganttTask.start);
				const originalEnd = SvgGanttRenderer.parseLocalDate(ganttTask.end);
				durationDays = Math.max(0, Math.round(
					(originalEnd.getTime() - originalStart.getTime()) / 86400000
				));
			}

			const newStart = targetDate;
			const newEnd = new Date(targetDate.getTime() + durationDays * 86400000);

			void this.onDateChange(ganttTask, newStart, newEnd);
		};

		for (const target of targets) {
			target.addEventListener('dragover', handleDragOver);
			target.addEventListener('dragleave', handleDragLeave);
			target.addEventListener('drop', handleDrop);
		}
	}

	/**
	 * 渲染左上角空白区域（包含序号和任务列标题）
	 */
	private renderCorner(svg: SVGSVGElement | null): void {
		renderCorner({
			svg,
			taskNumberColumnWidth: this.taskNumberColumnWidth,
			taskColumnWidth: this.taskColumnWidth,
			headerHeight: this.headerHeight,
		});
	}

	/**
	 * 渲染任务列表（左侧）
	 */
	private renderTaskList(svg: SVGSVGElement | null): void {
		if (!svg) return;

		while (svg.firstChild) {
			svg.removeChild(svg.firstChild);
		}

		const ns = 'http://www.w3.org/2000/svg';
		const totalWidth = this.taskColumnWidth;
		const numberWidth = this.taskNumberColumnWidth;
		const priorityWidth = 76;
		const contentWidth = Math.max(120, totalWidth - numberWidth);
		const rowsHeight = this.displayRows.length * this.rowHeight;

		svg.setAttribute('width', String(totalWidth));
		svg.setAttribute('height', String(rowsHeight));
		svg.setAttribute('viewBox', `0 0 ${totalWidth} ${rowsHeight}`);

		// 清空行背景元素数组
		this.rowBgElements.taskList = [];

		// Tło całego obszaru listy zadań
		const bg = activeDocument.createElementNS(ns, 'rect');
		bg.setAttribute('x', '0');
		bg.setAttribute('y', '0');
		bg.setAttribute('width', String(totalWidth));
		bg.setAttribute('height', String(this.displayRows.length * this.rowHeight));
		bg.setAttribute('fill', 'var(--background-primary)');
		svg.appendChild(bg);

		// 绘制任务与分组行
		let taskCounter = 1;
		this.displayRows.forEach((row, index) => {
			const y = index * this.rowHeight;

			if (row.type === 'group') {
				const group = row.group;
				const rowGroup = activeDocument.createElementNS(ns, 'g');
				rowGroup.setAttribute('data-group-row', group.id);

				// Tło wiersza grupy
				const rowBg = activeDocument.createElementNS(ns, 'rect');
				rowBg.setAttribute('x', '0');
				rowBg.setAttribute('y', String(y));
				rowBg.setAttribute('width', String(totalWidth));
				rowBg.setAttribute('height', String(this.rowHeight));
				rowBg.setAttribute('data-row-index', String(index));
				addSvgClass(rowBg, GanttClasses.elements.rowBg);
				rowBg.setAttribute('fill', 'var(--background-secondary)');
				rowBg.setAttribute('opacity', '0.7');
				rowBg.setAttribute('cursor', 'pointer');
				rowBg.addEventListener('click', () => {
					this.toggleGroupCollapse(group.id);
				});
				rowGroup.appendChild(rowBg);
				this.rowBgElements.taskList.push(rowBg);

				// Kolumna zwijania ▾ / ▸ (szerokość 36px)
				const numberForeignObj = activeDocument.createElementNS(ns, 'foreignObject');
				numberForeignObj.setAttribute('x', '0');
				numberForeignObj.setAttribute('y', String(y));
				numberForeignObj.setAttribute('width', String(numberWidth));
				numberForeignObj.setAttribute('height', String(this.rowHeight));

				const chevronDiv = createDiv();
				chevronDiv.className = GanttClasses.elements.taskNumberCell;
				chevronDiv.addClass('gc-u-flex', 'gc-u-items-center', 'gc-u-pointer');
				setCssProps(chevronDiv, { justifyContent: 'center', height: '100%', fontSize: '13px', color: 'var(--text-muted)' });
				chevronDiv.textContent = group.collapsed ? '▸' : '▾';
				chevronDiv.addEventListener('click', (e) => {
					e.stopPropagation();
					this.toggleGroupCollapse(group.id);
				});
				numberForeignObj.appendChild(chevronDiv);
				rowGroup.appendChild(numberForeignObj);

				// Kolumna zawartości -> Tytuł grupy, ikona i licznik zadań
				const contentForeignObj = activeDocument.createElementNS(ns, 'foreignObject');
				contentForeignObj.setAttribute('x', String(numberWidth));
				contentForeignObj.setAttribute('y', String(y));
				contentForeignObj.setAttribute('width', String(contentWidth));
				contentForeignObj.setAttribute('height', String(this.rowHeight));

				const contentDiv = createDiv();
				contentDiv.className = GanttClasses.elements.taskContentCell;
				contentDiv.addClass('gc-u-flex', 'gc-u-items-center', 'gc-u-pointer');
				setCssProps(contentDiv, {
					height: '100%',
					width: '100%',
					boxSizing: 'border-box',
					fontSize: '12px',
					fontWeight: '600',
					color: 'var(--text-normal)',
					gap: '6px',
					padding: '0 4px 0 6px',
				});
				contentDiv.addEventListener('click', (e) => {
					e.stopPropagation();
					this.toggleGroupCollapse(group.id);
				});

				const iconSpan = createSpan();
				iconSpan.textContent = group.icon;
				setCssProps(iconSpan, { flexShrink: '0', display: 'flex', alignItems: 'center' });
				contentDiv.appendChild(iconSpan);

				const titleSpan = createSpan();
				titleSpan.textContent = group.title;
				setCssProps(titleSpan, {
					flex: '1',
					minWidth: '0',
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
				});
				contentDiv.appendChild(titleSpan);

				// Licznik tasków w grupie (badge w prawej kolumnie)
				const priorityContainer = createDiv();
				setCssProps(priorityContainer, {
					width: `${priorityWidth}px`,
					flexShrink: '0',
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'center',
				});

				const badgeSpan = createSpan();
				badgeSpan.textContent = String(group.count);
				setCssProps(badgeSpan, {
					fontSize: '10px',
					fontWeight: '700',
					padding: '2px 8px',
					borderRadius: '10px',
					backgroundColor: 'var(--background-modifier-border, rgba(255, 255, 255, 0.1))',
					border: '1px solid var(--background-modifier-border)',
					color: 'var(--text-muted)',
				});
				priorityContainer.appendChild(badgeSpan);
				contentDiv.appendChild(priorityContainer);

				contentForeignObj.appendChild(contentDiv);
				rowGroup.appendChild(contentForeignObj);

				// Pionowa linia dzieląca numer i zadanie
				const dividerLine = activeDocument.createElementNS(ns, 'line');
				dividerLine.setAttribute('x1', String(numberWidth));
				dividerLine.setAttribute('y1', String(y));
				dividerLine.setAttribute('x2', String(numberWidth));
				dividerLine.setAttribute('y2', String((index + 1) * this.rowHeight));
				dividerLine.setAttribute('stroke', 'var(--background-modifier-border)');
				dividerLine.setAttribute('stroke-width', '1');
				rowGroup.appendChild(dividerLine);

				// Pionowa linia dzieląca zadanie i priorytet
				const pDividerLine = activeDocument.createElementNS(ns, 'line');
				pDividerLine.setAttribute('x1', String(totalWidth - priorityWidth));
				pDividerLine.setAttribute('y1', String(y));
				pDividerLine.setAttribute('x2', String(totalWidth - priorityWidth));
				pDividerLine.setAttribute('y2', String((index + 1) * this.rowHeight));
				pDividerLine.setAttribute('stroke', 'var(--background-modifier-border)');
				pDividerLine.setAttribute('stroke-width', '0.5');
				pDividerLine.setAttribute('opacity', '0.6');
				rowGroup.appendChild(pDividerLine);

				// Pozioma linia podziału
				const line = activeDocument.createElementNS(ns, 'line');
				line.setAttribute('x1', '0');
				line.setAttribute('y1', String((index + 1) * this.rowHeight));
				line.setAttribute('x2', String(totalWidth));
				line.setAttribute('y2', String((index + 1) * this.rowHeight));
				line.setAttribute('stroke', 'var(--background-modifier-border)');
				line.setAttribute('stroke-width', '1');
				rowGroup.appendChild(line);

				svg.appendChild(rowGroup);
				return;
			}

			// === Wiersz zadania ===
			const task = row.task;
			const rowGroup = activeDocument.createElementNS(ns, 'g');
			rowGroup.setAttribute('data-task-row', task.id);

			const isCompleted = task.completed || task.progress === 100;

			// Tło wiersza
			const rowBg = activeDocument.createElementNS(ns, 'rect');
			rowBg.setAttribute('x', '0');
			rowBg.setAttribute('y', String(y));
			rowBg.setAttribute('width', String(totalWidth));
			rowBg.setAttribute('height', String(this.rowHeight));
			rowBg.setAttribute('data-row-index', String(index));
			addSvgClass(rowBg, GanttClasses.elements.rowBg);
			if (index % 2 === 0) {
				rowBg.setAttribute('fill', 'var(--background-secondary)');
				rowBg.setAttribute('opacity', '0.3');
			} else {
				rowBg.setAttribute('fill', 'transparent');
			}
			rowGroup.appendChild(rowBg);
			this.rowBgElements.taskList.push(rowBg);

			// === Numer zadania (kolumna 36px) ===
			const numberForeignObj = activeDocument.createElementNS(ns, 'foreignObject');
			numberForeignObj.setAttribute('x', '0');
			numberForeignObj.setAttribute('y', String(y));
			numberForeignObj.setAttribute('width', String(numberWidth));
			numberForeignObj.setAttribute('height', String(this.rowHeight));

			const numberDiv = createDiv();
			numberDiv.className = GanttClasses.elements.taskNumberCell;
			numberDiv.addClass('gc-u-flex', 'gc-u-items-center', 'gc-u-text-muted', 'gc-u-font-medium');
			setCssProps(numberDiv, { justifyContent: 'center', height: '100%', fontSize: '11px' });
			numberDiv.textContent = String(taskCounter++);
			numberForeignObj.appendChild(numberDiv);
			rowGroup.appendChild(numberForeignObj);

			// === Treść zadania + Priorytet ===
			const contentForeignObj = activeDocument.createElementNS(ns, 'foreignObject');
			contentForeignObj.setAttribute('x', String(numberWidth));
			contentForeignObj.setAttribute('y', String(y));
			contentForeignObj.setAttribute('width', String(contentWidth));
			contentForeignObj.setAttribute('height', String(this.rowHeight));

			const contentDiv = createDiv();
			contentDiv.className = GanttClasses.elements.taskContentCell;
			contentDiv.addClass('gc-u-flex', 'gc-u-items-center');
			setCssProps(contentDiv, {
				height: '100%',
				width: '100%',
				boxSizing: 'border-box',
				fontSize: '12px',
				color: 'var(--text-normal)',
				gap: '6px',
				padding: row.isChild ? '0 4px 0 16px' : '0 4px 0 6px',
			});

			// Jeśli dziecko w grupie - wcięcie ze znakiem drzewa
			if (row.isChild) {
				const branch = createSpan();
				branch.textContent = '└';
				setCssProps(branch, { color: 'var(--text-faint, #666)', fontSize: '11px', flexShrink: '0' });
				contentDiv.appendChild(branch);
			}

			// === Checkbox zadania ===
			const checkbox = this.createTaskCheckbox(task, isCompleted);
			setCssProps(checkbox, { flexShrink: '0' });
			contentDiv.appendChild(checkbox);

			// === Tekst zadania ===
			const textContainer = createDiv();
			textContainer.className = 'gantt-task-list-item__text';
			textContainer.addClass('gc-u-whitespace-nowrap', 'gc-u-pointer');
			setCssProps(textContainer, {
				flex: '1',
				minWidth: '0',
				overflow: 'hidden',
				textOverflow: 'ellipsis',
			});

			// Kliknięcie przenosi do notatki
			textContainer.addEventListener('click', (e) => {
				if ((e.target as HTMLElement).tagName !== 'A') {
					e.stopPropagation();
					this.hidePopup();
					this.handleTaskListItemClick(task);
				}
			});
			textContainer.addEventListener('contextmenu', (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();
				this.hidePopup();
				if (this.config.on_context_menu) {
					this.config.on_context_menu(task, e);
				}
			});

			const gf = (this.plugin?.settings?.globalTaskFilter || '').trim();
			const displayText = (this.plugin?.settings?.showGlobalFilterInTaskText && gf)
				? gf + ' ' + task.name
				: task.name;
			this.renderTaskDescriptionWithLinks(textContainer, displayText);

			// Pokaż kartę tooltipa (tę samą co na pasku zadania)
			textContainer.addEventListener('mouseenter', (event: MouseEvent) => {
				if (isTouchNow() || this.taskDragState.isDragging) return;
				this.showPopup(task, textContainer, { x: event.clientX, y: event.clientY });
			});
			textContainer.addEventListener('mouseleave', () => {
				this.hidePopup();
			});

			contentDiv.appendChild(textContainer);

			// Priorytet zadania (badge w prawej kolumnie)
			const priorityContainer = createDiv();
			setCssProps(priorityContainer, {
				width: `${priorityWidth}px`,
				flexShrink: '0',
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
			});

			const pInfo = getPriorityInfo(task.priority);
			const pBadge = createDiv();
			pBadge.textContent = pInfo.label;
			const pColor = pInfo.color || '#6b7280';
			setCssProps(pBadge, {
				fontSize: '10px',
				fontWeight: '600',
				padding: '2px 6px',
				borderRadius: '4px',
				backgroundColor: `color-mix(in srgb, ${pColor} 18%, transparent)`,
				border: `1px solid color-mix(in srgb, ${pColor} 40%, transparent)`,
				color: pColor,
				textAlign: 'center',
				whiteSpace: 'nowrap',
			});
			priorityContainer.appendChild(pBadge);
			contentDiv.appendChild(priorityContainer);

			contentForeignObj.appendChild(contentDiv);
			rowGroup.appendChild(contentForeignObj);

			// Linia dzieląca numer i zadanie
			const dividerLine = activeDocument.createElementNS(ns, 'line');
			dividerLine.setAttribute('x1', String(numberWidth));
			dividerLine.setAttribute('y1', String(y));
			dividerLine.setAttribute('x2', String(numberWidth));
			dividerLine.setAttribute('y2', String((index + 1) * this.rowHeight));
			dividerLine.setAttribute('stroke', 'var(--background-modifier-border)');
			dividerLine.setAttribute('stroke-width', '1');
			rowGroup.appendChild(dividerLine);

			// Pionowa linia dzieląca zadanie i priorytet
			const pDividerLine = activeDocument.createElementNS(ns, 'line');
			pDividerLine.setAttribute('x1', String(totalWidth - priorityWidth));
			pDividerLine.setAttribute('y1', String(y));
			pDividerLine.setAttribute('x2', String(totalWidth - priorityWidth));
			pDividerLine.setAttribute('y2', String((index + 1) * this.rowHeight));
			pDividerLine.setAttribute('stroke', 'var(--background-modifier-border)');
			pDividerLine.setAttribute('stroke-width', '0.5');
			pDividerLine.setAttribute('opacity', '0.6');
			rowGroup.appendChild(pDividerLine);

			// Pozioma linia oddzielająca wiersze
			const line = activeDocument.createElementNS(ns, 'line');
			line.setAttribute('x1', '0');
			line.setAttribute('y1', String((index + 1) * this.rowHeight));
			line.setAttribute('x2', String(totalWidth));
			line.setAttribute('y2', String((index + 1) * this.rowHeight));
			line.setAttribute('stroke', 'var(--background-modifier-border)');
			line.setAttribute('stroke-width', '0.5');
			rowGroup.appendChild(line);
			svg.appendChild(rowGroup);
		});
	}

	/**
	 * 渲染任务描述为富文本（包含可点击的链接）
	 * 支持与 BaseViewRenderer 相同的链接格式
	 */
	private renderTaskDescriptionWithLinks(container: HTMLElement, text: string): void {
		if (this.app) {
			LinkRenderer.renderTaskDescriptionWithLinks(container, text, this.app);
		} else {
			container.textContent = text;
		}
	}

	/**
	 * 创建任务复选框
	 */
	private createTaskCheckbox(
		ganttTask: GanttChartTask,
		isCompleted: boolean
	): HTMLInputElement {
		const checkbox = createEl('input');
		checkbox.type = 'checkbox';
		checkbox.checked = isCompleted;
		checkbox.className = GanttClasses.elements.taskCheckbox;
		checkbox.addClass('gc-u-pointer');
		setCssProps(checkbox, { flexShrink: '0', width: '16px', height: '16px', margin: '0', accentColor: 'var(--interactive-accent)' });

		// 阻止点击事件冒泡到任务列表项
		checkbox.addEventListener('click', (e) => {
			e.stopPropagation();
		});

		// 监听复选框变化
		checkbox.addEventListener('change', (e) => {
			e.stopPropagation();
			const newCompletedState = (e.target as HTMLInputElement).checked;

			// 通过 onProgressChange 回调更新任务
			if (this.onProgressChange) {
				Promise.resolve(this.onProgressChange(ganttTask, newCompletedState ? 100 : 0)).catch((error) => {
					Logger.error('SvgGanttRenderer', 'Error updating task completion:', error);
					// 恢复复选框状态
					checkbox.checked = isCompleted;
				});
			}
		});

		return checkbox;
	}

	/**
	 * 处理任务列表项点击事件 - 跳转到文件
	 */
	private handleTaskListItemClick(task: GanttChartTask): void {
		if (!task.filePath || !task.lineNumber || !this.app) return;

		// 使用 openFileInExistingLeaf 跳转到文件
		void openFileInExistingLeaf(this.app, task.filePath, task.lineNumber);
	}

	/**
	 * 渲染头部（时间轴）- 支持颗粒度
	 */
	private renderHeader(
		svg: SVGSVGElement | null,
		minDate: Date,
		totalUnits: number,
		granularity: TimeGranularity
	): void {
		renderHeader({
			svg, minDate, totalUnits, granularity,
			columnWidth: this.columnWidth,
			headerHeight: this.headerHeight,
			padding: this.padding,
			getVacation: (date: Date) => this.plugin?.vacationService?.getVacation(date) ?? null,
			vacationColor: this.plugin?.settings?.vacationHighlightColor,
		});
	}

	/**
	 * 渲染甘特图主体（网格线 + 任务条）
	 */
	private renderGanttChart(
		svg: SVGSVGElement | null,
		minDate: Date,
		totalUnits: number,
		rowsHeight: number,
		granularity: TimeGranularity
	): void {
		if (!svg) return;

		while (svg.firstChild) {
			svg.removeChild(svg.firstChild);
		}

		const ns = 'http://www.w3.org/2000/svg';
		// 移除左侧 padding，只保留右侧 padding
		const width = totalUnits * this.columnWidth + this.padding;
		const height = rowsHeight;

		svg.setAttribute('width', String(width));
		svg.setAttribute('height', String(height));
		svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

		// 背景 - 从 x=0 开始（与任务列表分隔线对齐）
		const bg = activeDocument.createElementNS(ns, 'rect');
		bg.setAttribute('x', '0');
		bg.setAttribute('y', '0');
		bg.setAttribute('width', String(width));
		bg.setAttribute('height', String(height));
		bg.setAttribute('fill', 'var(--background-primary)');
		svg.appendChild(bg);

		// 清空甘特图行背景元素数组
		this.rowBgElements.gantt = [];

		// 绘制网格线（传递 width 用于水平线）
		this.renderGrid(ns, svg, minDate, totalUnits, width, height, granularity);

		// 绘制任务条
		this.renderTaskBars(ns, svg, minDate, totalUnits, granularity);

		// 绘制今天线（放在任务条之后渲染，保证线与 DZIŚ badge są na wierzchu i nie są zakrywane przez taski）
		renderTodayLine(ns, svg, minDate, totalUnits, height, granularity, this.columnWidth);
	}

	/**
	 * 获取指定单元的日期 - 辅助方法
	 */
	private getDateForUnit(minDate: Date, unitIndex: number, granularity: TimeGranularity): Date {
		return getUnit(minDate, unitIndex, granularity);
	}

	/**
	 * 根据开始日期查找对应的网格单元索引
	 * 向上取整确保任务条从正确的网格线开始
	 *
	 * @param startDate - 开始日期
	 * @param minDate - 最小日期（网格起点）
	 * @returns 网格单元索引（整数，与 renderGrid 中的 i 对应）
	 */
	private findStartGridUnitIndex(startDate: Date, minDate: Date): number {
		return findStartIdx(startDate, minDate, { columnWidth: this.columnWidth, granularity: this.granularity });
	}

	/**
	 * 根据结束日期查找对应的网格单元索引
	 * 结束日期应该对齐到下一个网格单元的开始，确保包含结束日期当天
	 *
	 * @param endDate - 结束日期
	 * @param minDate - 最小日期（网格起点）
	 * @returns 网格单元索引（整数，表示结束网格线的位置）
	 */
	private findEndGridUnitIndex(endDate: Date, minDate: Date): number {
		return findEndIdx(endDate, minDate, { columnWidth: this.columnWidth, granularity: this.granularity });
	}

	/**
	 * 根据网格单元索引计算精确的 x 坐标
	 * 与 renderGrid 中的计算方式完全一致：x = i * this.columnWidth
	 *
	 * @param unitIndex - 网格单元索引
	 * @returns x 坐标
	 */
	private getGridUnitX(unitIndex: number): number {
		return getX(unitIndex, this.columnWidth);
	}

	/**
	 * 渲染网格线 - 支持颗粒度
	 */
	private renderGrid(
		ns: string,
		svg: SVGSVGElement | null,
		minDate: Date,
		totalUnits: number,
		width: number,
		height: number,
		granularity: TimeGranularity
	): void {
		renderGrid(
			ns,
			{ svg, minDate, totalUnits, granularity, columnWidth: this.columnWidth, rowHeight: this.rowHeight,
			  tasksLength: this.displayRows.length, width, height, padding: this.padding,
			  getVacation: (date: Date) => this.plugin?.vacationService?.getVacation(date) ?? null,
			  vacationColor: this.plugin?.settings?.vacationHighlightColor },
			this.rowBgElements.gantt,
		);
	}

	/**
	 * 渲染任务条 - 支持颗粒度（保持原始精度）
	 */
	private renderTaskBars(
		ns: string,
		svg: SVGSVGElement | null,
		minDate: Date,
		totalUnits: number,
		granularity: TimeGranularity
	): void {
		if (!svg) return;

		const tasksGroup = activeDocument.createElementNS(ns, 'g');
		addSvgClass(tasksGroup, GanttClasses.elements.tasks);

		this.displayRows.forEach((row, index) => {
			if (row.type === 'group') {
				// Wiersz grupy na osi czasu pozostaje czysty (klamra usunięta na życzenie)
				return;
			}

			const task = row.task;
			const taskStart = SvgGanttRenderer.parseLocalDate(task.start);
			const taskEnd = SvgGanttRenderer.parseLocalDate(task.end);

			// 使用网格单元索引定位（依赖于网格）
			const startUnitIndex = this.findStartGridUnitIndex(taskStart, minDate);
			const endUnitIndex = this.findEndGridUnitIndex(taskEnd, minDate);

			// 计算位置（与网格垂直线使用相同的计算方式）
			const x = this.getGridUnitX(startUnitIndex);
			const y = index * this.rowHeight + (this.rowHeight - 24) / 2;
			const duration = endUnitIndex - startUnitIndex;
			const barWidth = Math.max(duration * this.columnWidth, 20);  // 不减 8，确保右端对齐网格线

			// 任务条组
			const barGroup = activeDocument.createElementNS(ns, 'g');
			addSvgClass(barGroup, GanttClasses.elements.barGroup);
			barGroup.setAttribute('data-task-bar', task.id);

			// Lead-in segment (creation → start): muted, non-interactive context bar.
			// Only drawn when it has positive width (created strictly before start).
			let leadBar: SVGRectElement | null = null;
			if (task.leadStart) {
				const leadStartDate = SvgGanttRenderer.parseLocalDate(task.leadStart);
				const leadStartUnitIndex = this.findStartGridUnitIndex(leadStartDate, minDate);
				const leadX = this.getGridUnitX(leadStartUnitIndex);
				const leadWidth = Math.max(x - leadX, 0);
				if (leadWidth > 0) {
					leadBar = activeDocument.createElementNS(ns, 'rect') as SVGRectElement;
					leadBar.setAttribute('x', String(leadX));
					leadBar.setAttribute('y', String(y));
					leadBar.setAttribute('width', String(leadWidth));
					leadBar.setAttribute('height', '24');
					leadBar.setAttribute('rx', '4');
					leadBar.classList.add(GanttClasses.elements.leadBar);
				}
			}

			// 任务条背景
			const bar = activeDocument.createElementNS(ns, 'rect');
			bar.setAttribute('x', String(x));
			bar.setAttribute('y', String(y));
			bar.setAttribute('width', String(Math.max(barWidth, 20)));
			bar.setAttribute('height', '24');
			bar.setAttribute('rx', '4');

			// Określenie koloru paska zadania wg priorytetu
			let fillColor = getPriorityBarColor(task.priority);
			if (task.completed || task.progress === 100) {
				fillColor = 'var(--gc-task-completed, #52c41a)';
			}

			bar.setAttribute('fill', fillColor);
			bar.setAttribute('opacity', '0.85');
			bar.setAttribute('cursor', 'pointer');
			bar.classList.add('task-bar');
			bar.classList.add(`priority-${(task.priority || 'normal').toLowerCase()}`);

			// 进度条
			let progressElement: SVGRectElement | null = null;
			if (task.progress > 0 && task.progress < 100) {
				const progressWidth = barWidth * task.progress / 100;
				const elem = activeDocument.createElementNS(ns, 'rect') as SVGRectElement;
				elem.setAttribute('x', String(x));
				elem.setAttribute('y', String(y));
				elem.setAttribute('width', String(Math.max(progressWidth - 8, 0)));
				elem.setAttribute('height', '24');
				elem.setAttribute('rx', '4');
				elem.setAttribute('fill', fillColor);
				elem.setAttribute('opacity', '0.4');
				progressElement = elem;
				elem.classList.add('task-progress');
			}

			// 条尾时刻标注：任一端点带时刻的任务（与时间画布 timeLabel 同语义）
			let timeBadge: SVGTextElement | null = null;
			if (task.timeLabel) {
				timeBadge = activeDocument.createElementNS(ns, 'text') as SVGTextElement;
				timeBadge.setAttribute('x', String(x + barWidth + 6));
				timeBadge.setAttribute('y', String(y + 16));
				timeBadge.setAttribute('font-size', '9');
				timeBadge.setAttribute('fill', 'var(--text-muted)');
				timeBadge.setAttribute('pointer-events', 'none');
				timeBadge.classList.add(GanttClasses.elements.barTime);
				timeBadge.textContent = task.timeLabel;
			}

			// === 添加拖动手柄 ===
			const HANDLE_HIT_AREA = 12;
			const HANDLE_VISUAL_SIZE = 4;

			// 左侧手柄 - 修改开始时间
			const leftHandle = activeDocument.createElementNS(ns, 'rect');
			leftHandle.setAttribute('x', String(x));
			leftHandle.setAttribute('y', String(y));
			leftHandle.setAttribute('width', String(HANDLE_HIT_AREA));
			leftHandle.setAttribute('height', '24');
			leftHandle.setAttribute('fill', 'transparent');
			setCssProps(leftHandle as unknown as HTMLElement, { cursor: 'w-resize' });
			leftHandle.classList.add(GanttClasses.elements.handleLeft);

			// 左侧视觉提示
			const leftVisual = activeDocument.createElementNS(ns, 'rect');
			leftVisual.setAttribute('x', String(x + 2));
			leftVisual.setAttribute('y', String(y + 8));
			leftVisual.setAttribute('width', String(HANDLE_VISUAL_SIZE));
			leftVisual.setAttribute('height', '8');
			leftVisual.setAttribute('rx', '1');
			leftVisual.setAttribute('fill', 'white');
			leftVisual.setAttribute('opacity', '0.5');
			setCssProps(leftVisual as unknown as HTMLElement, { pointerEvents: 'none' });

			// 右侧手柄 - 修改结束时间
			const rightHandleX = x + Math.max(barWidth, 20) - HANDLE_HIT_AREA;
			const rightHandle = activeDocument.createElementNS(ns, 'rect');
			rightHandle.setAttribute('x', String(rightHandleX));
			rightHandle.setAttribute('y', String(y));
			rightHandle.setAttribute('width', String(HANDLE_HIT_AREA));
			rightHandle.setAttribute('height', '24');
			rightHandle.setAttribute('fill', 'transparent');
			setCssProps(rightHandle as unknown as HTMLElement, { cursor: 'e-resize' });
			rightHandle.classList.add(GanttClasses.elements.handleRight);

			// 右侧视觉提示
			const rightVisual = activeDocument.createElementNS(ns, 'rect');
			rightVisual.setAttribute('x', String(rightHandleX + HANDLE_HIT_AREA - 2 - HANDLE_VISUAL_SIZE));
			rightVisual.setAttribute('y', String(y + 8));
			rightVisual.setAttribute('width', String(HANDLE_VISUAL_SIZE));
			rightVisual.setAttribute('height', '8');
			rightVisual.setAttribute('rx', '1');
			rightVisual.setAttribute('fill', 'white');
			rightVisual.setAttribute('opacity', '0.5');
			setCssProps(rightVisual as unknown as HTMLElement, { pointerEvents: 'none' });

			const barWidthClamped = Math.max(barWidth, 20);

			// HTML5 可拖拽任务条（支持拖拽至 Daily Timeline）
			const barForeign = activeDocument.createElementNS(ns, 'foreignObject') as SVGForeignObjectElement;
			barForeign.setAttribute('x', String(x));
			barForeign.setAttribute('y', String(y));
			barForeign.setAttribute('width', String(barWidthClamped));
			barForeign.setAttribute('height', '24');
			barForeign.classList.add('task-bar-foreign');
			setCssProps(barForeign as unknown as HTMLElement, { overflow: 'visible' });

			const barDiv = createDiv();
			barDiv.className = `task-bar task-bar-drag priority-${(task.priority || 'normal').toLowerCase()}`;
			barDiv.setAttribute('draggable', 'true');
			barDiv.setAttribute('data-task-id', `${task.filePath}:${task.lineNumber}`);
			setCssProps(barDiv, {
				width: '100%',
				height: '100%',
				display: 'block',
				position: 'relative',
				borderRadius: '4px',
				backgroundColor: fillColor,
				opacity: '0.85',
				cursor: 'grab',
				boxSizing: 'border-box',
				userSelect: 'none',
			});

			if (task.progress > 0 && task.progress < 100) {
				const progressDiv = createDiv();
				progressDiv.className = 'task-progress-fill';
				setCssProps(progressDiv, {
					position: 'absolute',
					top: '0',
					left: '0',
					width: `${task.progress}%`,
					height: '100%',
					borderRadius: '4px',
					backgroundColor: fillColor,
					opacity: '0.4',
					pointerEvents: 'none',
				});
				barDiv.appendChild(progressDiv);
			}
			barForeign.appendChild(barDiv);

			// HTML5 Drag & Drop handlers
			barDiv.addEventListener('dragstart', (e: DragEvent) => {
				if (!e.dataTransfer) return;
				const taskId = `${task.filePath}:${task.lineNumber}`;
				e.dataTransfer.effectAllowed = 'move';
				e.dataTransfer.setData('taskId', taskId);
				e.dataTransfer.setData('text/plain', taskId);

				let durationMin = 60;
				if (task.start && task.end) {
					const s = SvgGanttRenderer.parseLocalDate(task.start);
					const en = SvgGanttRenderer.parseLocalDate(task.end);
					const diffMin = Math.round((en.getTime() - s.getTime()) / 60000);
					if (diffMin > 0 && diffMin < 1440) {
						durationMin = diffMin;
					}
				}

				const rect = barDiv.getBoundingClientRect();
				const offsetPx = Math.max(0, e.clientY - rect.top);
				setBlockDragMeta({
					offsetPx,
					durationMin,
				});

				const offsetInBar = e.clientX - rect.left;
				const offsetDays = Math.max(0, Math.floor(offsetInBar / this.columnWidth));
				e.dataTransfer.setData('ganttOffsetDays', String(offsetDays));

				barDiv.style.opacity = '0.5';
				bar.setAttribute('opacity', '0.5');
			});

			barDiv.addEventListener('dragend', () => {
				clearBlockDragMeta();
				barDiv.style.opacity = '0.85';
				bar.setAttribute('opacity', '0.85');
			});

			barDiv.addEventListener('click', (e) => {
				if (this.taskDragState.justFinishedDragging) return;
				if (e.button !== 0) return;
				e.stopPropagation();
				this.handleTaskClick(task);
			});

			barDiv.addEventListener('mouseenter', (event: MouseEvent) => {
				if (isTouchNow()) return;
				barDiv.style.opacity = '1';
				bar.setAttribute('opacity', '1');
				this.showPopup(task, barDiv, { x: event.clientX, y: event.clientY });
			});
			barDiv.addEventListener('mouseleave', () => {
				barDiv.style.opacity = '0.85';
				bar.setAttribute('opacity', '0.85');
				this.hidePopup();
			});

			// 设置拖动事件（handles 与 touch 拖动）
			this.setupTaskBarDragging(barGroup as SVGGElement, barForeign as unknown as SVGRectElement, leftHandle as SVGRectElement, rightHandle as SVGRectElement, task, minDate);

			// 右键菜单
			barGroup.addEventListener('contextmenu', (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();
				this.hidePopup();
				if (this.config.on_context_menu) {
					this.config.on_context_menu(task, e);
				}
			});

			// leadBar 悬停事件（黑色引导区域 tooltip）
			if (leadBar) {
				const leadBarEl = leadBar;
				leadBarEl.addEventListener('mouseenter', (event: MouseEvent) => {
					if (isTouchNow()) return;
					this.showPopup(task, leadBarEl, { x: event.clientX, y: event.clientY });
				});
				leadBarEl.addEventListener('mouseleave', () => {
					this.hidePopup();
				});
				leadBarEl.addEventListener('contextmenu', (e: MouseEvent) => {
					e.preventDefault();
					e.stopPropagation();
					this.hidePopup();
					if (this.config.on_context_menu) {
						this.config.on_context_menu(task, e);
					}
				});
				barGroup.appendChild(leadBarEl);
			}
			barGroup.appendChild(bar);               // SVG 矩形底衬
			barGroup.appendChild(barForeign);         // HTML5 可拖拽层
			if (timeBadge) {
				barGroup.appendChild(timeBadge);
			}
			barGroup.appendChild(leftHandle);        // 左侧手柄（resize-left）
			barGroup.appendChild(leftVisual);        // 左侧视觉小点
			barGroup.appendChild(rightHandle);       // 右侧手柄（resize-right）
			barGroup.appendChild(rightVisual);       // 右侧视觉小点
			tasksGroup.appendChild(barGroup);
		});

		svg.appendChild(tasksGroup);
	}

	/**
	 * 处理任务点击
	 */
	private handleTaskClick(task: GanttChartTask): void {
		if (this.config.on_click) {
			this.config.on_click(task);
		}
	}

	/**
	 * 显示弹窗（使用全局 TooltipManager）
	 * @param task - 甘特图任务
	 * @param targetElement - 目标元素
	 * @param mousePosition - 鼠标位置（可选）
	 */
	private showPopup(task: GanttChartTask, targetElement: Element, mousePosition?: MousePosition): void {
		if (!this.plugin || !task.filePath) return;

		// 从 this.tasks 中获取最新的任务对象（避免使用闭包中的旧对象）
		// 因为 updateTasks 只更新视觉属性，不更新事件监听器引用的任务对象
		const latestTask = this.tasks.find(t => t.id === task.id);
		if (!latestTask) return;

		const tooltipManager = TooltipManager.getInstance(this.plugin);
		tooltipManager.show(latestTask as unknown as GCTask, targetElement as HTMLElement, mousePosition);
	}

	/**
	 * 隐藏弹窗（使用全局 TooltipManager）
	 */
	private hidePopup(): void {
		if (!this.plugin) return;

		const tooltipManager = TooltipManager.getInstance(this.plugin);
		tooltipManager.hide();
	}

	/** 拖拽控制器 */
	private dragController: ReturnType<typeof createTaskDragController> | null = null;

	/**
	 * 拖动状态
	 */
	private taskDragState = {
		isDragging: false,
		dragType: 'none' as 'none' | 'move' | 'resize-left' | 'resize-right',
		task: null as GanttChartTask | null,
		startX: 0,
		originalStart: null as Date | null,
		originalEnd: null as Date | null,
		taskMinDate: null as Date | null,
		hasMoved: false,
		barElement: null as SVGRectElement | null,
		leftHandleElement: null as SVGRectElement | null,
		rightHandleElement: null as SVGRectElement | null,
		leftVisualElement: null as SVGRectElement | null,
		rightVisualElement: null as SVGRectElement | null,
		justFinishedDragging: false, // 标志位：刚结束拖动，用于屏蔽点击事件
	};

	/**
	 * 设置任务条拖动事件
	 */
	private setupTaskBarDragging(
		barGroup: SVGGElement,
		bar: SVGRectElement,
		leftHandle: SVGRectElement,
		rightHandle: SVGRectElement,
		task: GanttChartTask,
		minDate: Date
	): void {
		this.dragController?.setupTaskBarDragging(barGroup, bar, leftHandle, rightHandle, task, minDate);
	}

	/**
	 * 日期加减天数
	 */
	private addDays(date: Date, days: number): Date {
		return this.dragController?.addDays(date, days) ?? new Date(date);
	}

	/**
	 * 增量更新任务列表区域
	 */
	private updateTaskListIncremental(
		added: GanttChartTask[],
		removed: GanttChartTask[],
		modified: GanttChartTask[],
		allTasks: GanttChartTask[]
	): void {
		const svg = this.taskListSvg;
		if (!svg) return;

		// 1. 移除删除的任务
		removed.forEach(task => {
			const row = svg.querySelector(`[data-task-row="${task.id}"]`);
			if (row) row.remove();
		});

		// 2. 更新现有任务
		const modifiedIds = new Set(modified.map(t => t.id));
		allTasks.forEach((task, index) => {
			const row = svg.querySelector(`[data-task-row="${task.id}"]`);
			if (row) {
				// 更新复选框状态
				const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
				if (checkbox) {
					const isCompleted = task.completed || task.progress === 100;
					checkbox.checked = isCompleted;
				}
				// 更新序号
				const numberCell = row.querySelector(`.${GanttClasses.elements.taskNumberCell}`);
				if (numberCell) {
					numberCell.textContent = String(index + 1);
				}
				// 任务名变更时重渲染文本（此前改名后列表显示旧标题直到全量重绘）
				if (modifiedIds.has(task.id)) {
					const textContainer = row.querySelector('.gantt-task-list-item__text');
					if (textContainer instanceof HTMLElement) {
						const gf = (this.plugin?.settings?.globalTaskFilter || '').trim();
						const displayText = (this.plugin?.settings?.showGlobalFilterInTaskText && gf)
							? gf + ' ' + task.name
							: task.name;
						textContainer.empty();
						this.renderTaskDescriptionWithLinks(textContainer, displayText);
					}
				}
			}
		});

		// 3. 简化处理：如果任务数量变化，重新渲染整个列表
		if (added.length > 0 || removed.length > 0) {
			// 重新渲染任务列表
			while (svg.firstChild) {
				svg.removeChild(svg.firstChild);
			}
			this.renderTaskList(svg);
			// Keep SVG height in sync with the new row count (old height would clip).
			const listHeight = this.headerHeight + this.tasks.length * this.rowHeight;
			svg.setAttribute('height', String(listHeight));
			if (this.ganttSvg) {
				this.ganttSvg.setAttribute('height', String(listHeight));
			}
		}
	}

	/**
	 * 增量更新甘特图区域
	 */
	private updateGanttAreaIncremental(
		added: GanttChartTask[],
		removed: GanttChartTask[],
		modified: GanttChartTask[],
		allTasks: GanttChartTask[]
	): void {
		if (!this.ganttSvg) return;

		const tasksGroup = this.ganttSvg.querySelector(`.${GanttClasses.elements.tasks}`) as SVGGElement;
		if (!tasksGroup) return;

		// 1. 移除删除的任务条
		removed.forEach(task => {
			const barGroup = tasksGroup.querySelector(`[data-task-bar="${task.id}"]`);
			if (barGroup) barGroup.remove();
		});

		// 2. 更新现有任务条
		modified.forEach(task => {
			const barGroup = tasksGroup.querySelector(`[data-task-bar="${task.id}"]`) as SVGGElement;
			if (barGroup) {
				this.updateTaskBarElement(barGroup, task);
			}
		});

		// 3. 添加新任务条（简化处理：重新渲染整个甘特图区域）
		if (added.length > 0 && this.ganttSvg) {
			// Preserve scroll across the redraw
			const savedScrollLeft = this.ganttContainer?.scrollLeft ?? 0;
			const savedScrollTop = this.ganttContainer?.scrollTop ?? 0;

			// Clear stale layers first: renderGanttChart / renderHeader only append
			while (this.ganttSvg.firstChild) {
				this.ganttSvg.removeChild(this.ganttSvg.firstChild);
			}

			const { minDate, totalUnits, granularity } = this.calculateDateRange();
			this.minDate = minDate;
			this.totalUnits = totalUnits;
			const ganttWidth = totalUnits * this.columnWidth + this.padding * 2;
			const rowsHeight = this.displayRows.length * this.rowHeight;

			this.ganttSvg.setAttribute('width', String(ganttWidth));
			this.ganttSvg.setAttribute('height', String(rowsHeight));
			this.ganttSvg.setAttribute('viewBox', `0 0 ${ganttWidth} ${rowsHeight}`);

			// Header must be redrawn as well: an extended date range with stale
			// labels would desync from the grid drawn below it.
			if (this.headerSvg) {
				while (this.headerSvg.firstChild) {
					this.headerSvg.removeChild(this.headerSvg.firstChild);
				}
				this.headerSvg.setAttribute('width', String(ganttWidth));
				this.renderHeader(this.headerSvg, minDate, totalUnits, granularity);
			}

			this.renderGanttChart(this.ganttSvg, minDate, totalUnits, rowsHeight, granularity);

			if (this.ganttContainer) {
				this.ganttContainer.scrollLeft = savedScrollLeft;
				this.ganttContainer.scrollTop = savedScrollTop;
			}
		}
	}

	/**
	 * 更新单个任务条元素 - 支持颗粒度
	 */
	private updateTaskBarElement(barGroup: SVGGElement, task: GanttChartTask): void {
		// Reuse the currently rendered range: bars must stay aligned with the
		// visible grid, and this avoids an O(n) range scan per modified task.
		if (!this.minDate) return;
		const minDate = this.minDate;
		const startDate = SvgGanttRenderer.parseLocalDate(task.start);
		const endDate = SvgGanttRenderer.parseLocalDate(task.end);
		const rowIndex = Math.max(0, this.tasks.findIndex(t => t.id === task.id));
		const HANDLE_HIT_AREA = 12;
		const HANDLE_VISUAL_SIZE = 4;

		// 使用网格单元索引定位（依赖于网格）
		const startUnitIndex = this.findStartGridUnitIndex(startDate, minDate);
		const endUnitIndex = this.findEndGridUnitIndex(endDate, minDate);

		// 计算位置（与网格垂直线使用相同的计算方式）
		const x = this.getGridUnitX(startUnitIndex);
		const y = rowIndex * this.rowHeight + (this.rowHeight - 24) / 2;
		const duration = endUnitIndex - startUnitIndex;
		const barWidth = Math.max(duration * this.columnWidth, 20);  // 不减 8，确保右端对齐网格线

		// 更新任务条位置和宽度
		const bar = barGroup.querySelector('.task-bar') as SVGRectElement;
		if (bar) {
			bar.setAttribute('x', String(x));
			bar.setAttribute('width', String(barWidth));
			bar.setAttribute('y', String(y));

			// 更新颜色（根据完成状态及优先级）
			const isCompleted = task.completed || task.progress === 100;
			if (isCompleted) {
				bar.setAttribute('fill', 'var(--gc-task-completed, #52c41a)');
			} else {
				bar.setAttribute('fill', getPriorityBarColor(task.priority));
			}
			bar.classList.forEach(cls => {
				if (cls.startsWith('priority-')) bar.classList.remove(cls);
			});
			bar.classList.add(`priority-${(task.priority || 'normal').toLowerCase()}`);
		}

		const barForeign = barGroup.querySelector('.task-bar-foreign') as SVGForeignObjectElement;
		if (barForeign) {
			barForeign.setAttribute('x', String(x));
			barForeign.setAttribute('width', String(barWidth));
			barForeign.setAttribute('y', String(y));
			const barDiv = barForeign.querySelector('.task-bar-drag') as HTMLElement;
			if (barDiv) {
				const isCompleted = task.completed || task.progress === 100;
				const fillColor = isCompleted
					? 'var(--gc-task-completed, #52c41a)'
					: getPriorityBarColor(task.priority);
				barDiv.style.backgroundColor = fillColor;
				barDiv.className = `task-bar task-bar-drag priority-${(task.priority || 'normal').toLowerCase()}`;
			}
		}

		// 更新进度条
		const progressRect = barGroup.querySelector('.task-progress') as SVGRectElement;
		if (progressRect) {
			const progressWidth = barWidth * (task.progress / 100);
			progressRect.setAttribute('x', String(x));
			progressRect.setAttribute('y', String(y));
			progressRect.setAttribute('width', String(progressWidth));
		}

		// Update lead-in segment (creation → start) geometry.
		// The bar may need to appear or disappear after a drag (e.g. start
		// dragged before/after creation), so create/remove it as needed —
		// not just reposition an existing one.
		this.applyLeadBar(barGroup, this.resolveLeadStart(task, startDate), x, y);

		// === 更新手柄和小白点位置 ===
		// 左侧手柄
		const leftHandle = barGroup.querySelector('.gc-gantt-view__handle-left') as SVGRectElement;
		if (leftHandle) {
			leftHandle.setAttribute('x', String(x));
			leftHandle.setAttribute('y', String(y));
		}

		// 左侧小白点（使用 style 选择器，因为创建时设置了 pointerEvents）
		const leftVisual = Array.from(barGroup.querySelectorAll('rect')).find(
			r => r.style?.pointerEvents === 'none' &&
				parseFloat(r.getAttribute('x') || '0') < x + barWidth / 2  // 左侧的小白点
		);
		if (leftVisual) {
			leftVisual.setAttribute('x', String(x + 2));
			leftVisual.setAttribute('y', String(y + 8));
		}

		// 右侧手柄
		const rightHandleX = x + barWidth - HANDLE_HIT_AREA;
		const rightHandle = barGroup.querySelector('.gc-gantt-view__handle-right') as SVGRectElement;
		if (rightHandle) {
			rightHandle.setAttribute('x', String(rightHandleX));
			rightHandle.setAttribute('y', String(y));
		}

		// 右侧小白点（使用 style 选择器，因为创建时设置了 pointerEvents）
		const rightVisual = Array.from(barGroup.querySelectorAll('rect')).find(
			r => r.style?.pointerEvents === 'none' &&
				parseFloat(r.getAttribute('x') || '0') >= x + barWidth / 2  // 右侧的小白点
		);
		if (rightVisual) {
			rightVisual.setAttribute('x', String(rightHandleX + HANDLE_HIT_AREA - 2 - HANDLE_VISUAL_SIZE));
			rightVisual.setAttribute('y', String(y + 8));
		}
	}

	/**
	 * Resolve the lead-in segment start for a task at its CURRENT bar start.
	 * `task.leadStart` is fixed at parse time (undefined when created == start),
	 * so derive it live from createdDate: the segment exists whenever creation
	 * strictly precedes the bar start — including mid-drag while the user is
	 * still pulling the left handle.
	 */
	private resolveLeadStart(task: GanttChartTask, barStartDate: Date): string | undefined {
		if (task.leadStart) return task.leadStart;
		const created = task.createdDate;
		if (created && !isNaN(created.getTime()) && created.getTime() < barStartDate.getTime()) {
			return formatDate(created, 'yyyy-MM-dd');
		}
		return undefined;
	}

	/**
	 * Create / remove / reposition the lead-in segment (creation → start)
	 * inside a task bar group. Used by live-drag visuals and incremental
	 * updates so a drag that makes the segment appear, disappear or resize
	 * is reflected without a full re-render.
	 */
	private applyLeadBar(barGroup: SVGGElement, leadStart: string | undefined, barX: number, y: number): void {
		if (!this.minDate) return;
		const leadBar = barGroup.querySelector('.gc-gantt-view__lead-bar');

		if (!leadStart) {
			leadBar?.remove();
			return;
		}

		const leadStartDate = SvgGanttRenderer.parseLocalDate(leadStart);
		const leadStartUnitIndex = this.findStartGridUnitIndex(leadStartDate, this.minDate);
		const leadX = this.getGridUnitX(leadStartUnitIndex);
		const leadWidth = Math.max(barX - leadX, 0);
		if (leadWidth <= 0) {
			leadBar?.remove();
			return;
		}

		let target = leadBar;
		if (!target) {
			target = createSvg('rect');
			target.setAttribute('height', '24');
			target.setAttribute('rx', '4');
			target.classList.add(GanttClasses.elements.leadBar);
			// 引导条必须位于主条/进度条之下（DOM 顺序即层级）
			if (barGroup.firstChild) {
				barGroup.insertBefore(target, barGroup.firstChild);
			} else {
				barGroup.appendChild(target);
			}
		}
		target.setAttribute('x', String(leadX));
		target.setAttribute('y', String(y));
		target.setAttribute('width', String(leadWidth));
	}

	/**
	 * Oblicza pozycję scrollLeft, która centruje kolumnę dzisiejszego dnia w widoku
	 */
	public getTodayScrollLeft(): number {
		if (!this.ganttContainer || !this.minDate) return 0;

		const today = getTodayInTimezone();
		let unitsDiff: number;
		if (!this.granularity || (this.granularity as string) === 'day' || this.granularity === TimeGranularity.DAY) {
			const utcToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
			const utcMin = Date.UTC(this.minDate.getFullYear(), this.minDate.getMonth(), this.minDate.getDate());
			unitsDiff = Math.round((utcToday - utcMin) / 86400000);
		} else {
			const config = GRANULARITY_CONFIGS[this.granularity];
			unitsDiff = Math.round((today.getTime() - this.minDate.getTime()) / config.milliseconds);
		}

		if (unitsDiff >= 0 && unitsDiff <= this.totalUnits) {
			// Środek kolumny dzisiejszego dnia
			const todayX = unitsDiff * this.columnWidth + this.columnWidth / 2;
			const containerWidth = this.ganttContainer.clientWidth;
			if (containerWidth > 0) {
				return Math.max(0, Math.round(todayX - containerWidth / 2));
			}
			return Math.max(0, Math.round(todayX - 400));
		}
		return 0;
	}

	/**
	 * 滚动到今天 - 支持颗粒度
	 */
	scrollToToday(): void {
		if (!this.ganttContainer || !this.minDate) return;

		let retries = 0;
		const doScroll = () => {
			if (!this.ganttContainer || !this.minDate) return;

			const containerWidth = this.ganttContainer.clientWidth;
			if (containerWidth <= 0 && retries++ < 5 && this.ganttContainer.isConnected) {
				window.requestAnimationFrame(doScroll);
				return;
			}

			const scrollLeft = this.getTodayScrollLeft();
			this.ganttContainer.scrollLeft = scrollLeft;
			if (this.headerContainer) {
				this.headerContainer.scrollLeft = scrollLeft;
			}
		};

		doScroll();
		window.requestAnimationFrame(doScroll);
	}

	/**
	 * 获取滚动位置
	 */
	getScrollPosition(): { scrollLeft: number; scrollTop: number } {
		return {
			scrollLeft: this.ganttContainer?.scrollLeft ?? 0,
			scrollTop: this.ganttContainer?.scrollTop ?? 0
		};
	}

	/**
	 * 设置滚动位置
	 */
	setScrollPosition(scrollLeft: number, scrollTop: number): void {
		if (this.ganttContainer) {
			window.requestAnimationFrame(() => {
				if (this.ganttContainer) {
					this.ganttContainer.scrollLeft = scrollLeft;
					this.ganttContainer.scrollTop = scrollTop;
					if (this.headerContainer) {
						this.headerContainer.scrollLeft = scrollLeft;
					}
					if (this.taskListContainer) {
						this.taskListContainer.scrollTop = scrollTop;
					}
				}
			});
		}
	}

	/**
	 * 滚动到最左边
	 */
	scrollToLeft(): void {
		if (this.ganttContainer) {
			this.ganttContainer.scrollLeft = 0;
			if (this.headerContainer) {
				this.headerContainer.scrollLeft = 0;
			}
		}
	}

	/**
	 * 滚动到最右边
	 */
	scrollToRight(): void {
		if (this.ganttContainer) {
			const maxScroll = this.ganttContainer.scrollWidth;
			this.ganttContainer.scrollLeft = maxScroll;
			if (this.headerContainer) {
				this.headerContainer.scrollLeft = maxScroll;
			}
		}
	}

	/**
	 * 销毁渲染器
	 */
	destroy(): void {
		this.hidePopup();

		// Detach document-level listeners: destroying the view during an active
		// drag/resize would otherwise keep this renderer alive forever.
		this.dragController?.destroy();
		this.dragController = null;
		this.removeResizeListeners();
		setCssProps(activeDocument.body, { cursor: '', userSelect: '' });
		this.taskDragState.isDragging = false;
		this.taskDragState.justFinishedDragging = false;
		this.headerSvg = null;
		this.taskListSvg = null;
		this.ganttSvg = null;
		this.cornerSvg = null;
		this.headerContainer = null;
		this.taskListContainer = null;
		this.ganttContainer = null;
		this.cornerContainer = null;
		this.mainGrid = null;
		this.resizer = null;
		this.tasks = [];
	}

	/**
	 * 获取 SVG 元素（保留兼容性）
	 */
	getSvgElement(): SVGSVGElement | null {
		return this.ganttSvg;
	}
}
