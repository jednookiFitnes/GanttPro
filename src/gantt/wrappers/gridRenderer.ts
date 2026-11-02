/**
 * 甘特图 Grid 网格 + Today 线 + Weekend/Holiday 渲染 (Gantt Calendar Pro)
 *
 * 职责：
 * - Wzorce szrafowania (SVG patterns) dla weekendów
 * - Kolumny weekendowe z ukośnym szrafowaniem (soboty i niedziele)
 * - Wyróżnienie polskich świąt (kolorystyczny akcent kolumny)
 * - Wyraźny podział tygodni (grubsze pionowe linie przed poniedziałkiem)
 * - Poziome i pionowe linie siatki, tła wierszy (w tym wiersze grup)
 * - Wskaźnik dzisiejszego dnia (Today line)
 */

import type { TimeGranularity } from '../types';
import { GRANULARITY_CONFIGS } from '../types';
import { getDateForUnit } from './dateGeometry';
import { getTodayInTimezone } from '../../dateUtils/timezone';
import { GanttClasses } from '../../utils/bem';
import { getPolishHoliday, isWeekend } from '../../utils/holidaysPl';

function addSvgClass(element: Element, className: string): void {
	const existing = element.getAttribute('class');
	if (existing) {
		if (!existing.split(' ').includes(className)) {
			element.setAttribute('class', `${existing} ${className}`);
		}
	} else {
		element.setAttribute('class', className);
	}
}

import type { VacationEntryInfo } from '../../utils/timekeepVacationService';

function hexToRgba(hex: string, alpha: number): string {
	if (!hex) return `rgba(249, 115, 22, ${alpha})`;
	let clean = hex.replace('#', '').trim();
	if (clean.length === 3) {
		clean = clean.split('').map(c => c + c).join('');
	}
	if (clean.length === 6) {
		const r = parseInt(clean.substring(0, 2), 16);
		const g = parseInt(clean.substring(2, 4), 16);
		const b = parseInt(clean.substring(4, 6), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
	return `rgba(249, 115, 22, ${alpha})`;
}

export interface GridRenderOptions {
	svg: SVGSVGElement | null;
	minDate: Date;
	totalUnits: number;
	granularity: TimeGranularity;
	columnWidth: number;
	rowHeight: number;
	tasksLength: number;
	width: number;
	height: number;
	padding: number;
	getVacation?: (date: Date) => VacationEntryInfo | null;
	vacationColor?: string;
}

/**
 * Zapewnia istnienie wzorców SVG dla szrafowania weekendów i świąt
 */
export function ensureSvgPatterns(ns: string, svg: SVGSVGElement): void {
	let defs = svg.querySelector('defs');
	if (!defs) {
		defs = activeDocument.createElementNS(ns, 'defs');
		svg.insertBefore(defs, svg.firstChild);
	}

	if (!svg.querySelector('#gantt-weekend-hatch')) {
		const pattern = activeDocument.createElementNS(ns, 'pattern');
		pattern.setAttribute('id', 'gantt-weekend-hatch');
		pattern.setAttribute('width', '8');
		pattern.setAttribute('height', '8');
		pattern.setAttribute('patternUnits', 'userSpaceOnUse');
		pattern.setAttribute('patternTransform', 'rotate(45)');

		const line = activeDocument.createElementNS(ns, 'line');
		line.setAttribute('x1', '0');
		line.setAttribute('y1', '0');
		line.setAttribute('x2', '0');
		line.setAttribute('y2', '8');
		line.setAttribute('stroke', 'var(--background-modifier-border)');
		line.setAttribute('stroke-width', '1.2');
		line.setAttribute('opacity', '0.45');
		pattern.appendChild(line);

		defs.appendChild(pattern);
	}

	if (!svg.querySelector('#gantt-vacation-hatch')) {
		const pattern = activeDocument.createElementNS(ns, 'pattern');
		pattern.setAttribute('id', 'gantt-vacation-hatch');
		pattern.setAttribute('width', '8');
		pattern.setAttribute('height', '8');
		pattern.setAttribute('patternUnits', 'userSpaceOnUse');
		pattern.setAttribute('patternTransform', 'rotate(-45)');

		const line = activeDocument.createElementNS(ns, 'line');
		line.setAttribute('x1', '0');
		line.setAttribute('y1', '0');
		line.setAttribute('x2', '0');
		line.setAttribute('y2', '8');
		line.setAttribute('stroke', '#ef4444');
		line.setAttribute('stroke-width', '1.2');
		line.setAttribute('opacity', '0.45');
		pattern.appendChild(line);

		defs.appendChild(pattern);
	}
}

/**
 * Renderuje tła kolumn: szrafowanie sobót i niedziel oraz polskie święta
 */
export function renderColumnHighlights(
	ns: string,
	svg: SVGSVGElement,
	opts: GridRenderOptions
): void {
	const { minDate, totalUnits, granularity, columnWidth, height } = opts;
	ensureSvgPatterns(ns, svg);

	const highlightsGroup = activeDocument.createElementNS(ns, 'g');
	highlightsGroup.setAttribute('class', 'gantt-grid-highlights');

	for (let i = 0; i < totalUnits; i++) {
		const unitDate = getDateForUnit(minDate, i, granularity);
		const weekend = isWeekend(unitDate);
		const holidayName = getPolishHoliday(unitDate);
		const vacation = opts.getVacation ? opts.getVacation(unitDate) : null;
		const x = i * columnWidth;

		if (weekend) {
			// Szrafura weekendowa
			const weekendRect = activeDocument.createElementNS(ns, 'rect');
			weekendRect.setAttribute('x', String(x));
			weekendRect.setAttribute('y', '0');
			weekendRect.setAttribute('width', String(columnWidth));
			weekendRect.setAttribute('height', String(height));
			weekendRect.setAttribute('fill', 'url(#gantt-weekend-hatch)');
			weekendRect.setAttribute('opacity', '0.5');
			highlightsGroup.appendChild(weekendRect);

			// Przyciemnienie tła weekendu
			const tintRect = activeDocument.createElementNS(ns, 'rect');
			tintRect.setAttribute('x', String(x));
			tintRect.setAttribute('y', '0');
			tintRect.setAttribute('width', String(columnWidth));
			tintRect.setAttribute('height', String(height));
			tintRect.setAttribute('fill', 'rgba(0, 0, 0, 0.12)');
			highlightsGroup.appendChild(tintRect);
		}

		if (vacation && !weekend) {
			// Subtelna czerwona szrafura urlopowa
			const vacationHatchRect = activeDocument.createElementNS(ns, 'rect');
			vacationHatchRect.setAttribute('x', String(x));
			vacationHatchRect.setAttribute('y', '0');
			vacationHatchRect.setAttribute('width', String(columnWidth));
			vacationHatchRect.setAttribute('height', String(height));
			vacationHatchRect.setAttribute('fill', 'url(#gantt-vacation-hatch)');
			vacationHatchRect.setAttribute('opacity', '0.7');
			highlightsGroup.appendChild(vacationHatchRect);
		}

		if (holidayName) {
			// Delikatny czerwony akcent polskiego święta
			const holidayRect = activeDocument.createElementNS(ns, 'rect');
			holidayRect.setAttribute('x', String(x));
			holidayRect.setAttribute('y', '0');
			holidayRect.setAttribute('width', String(columnWidth));
			holidayRect.setAttribute('height', String(height));
			holidayRect.setAttribute('fill', 'rgba(239, 68, 68, 0.07)');
			highlightsGroup.appendChild(holidayRect);
		} else if (vacation && !weekend) {
			// Pomarańczowy akcent urlopu
			const vacationRect = activeDocument.createElementNS(ns, 'rect');
			vacationRect.setAttribute('x', String(x));
			vacationRect.setAttribute('y', '0');
			vacationRect.setAttribute('width', String(columnWidth));
			vacationRect.setAttribute('height', String(height));
			vacationRect.setAttribute('fill', hexToRgba(opts.vacationColor || '#f97316', 0.08));
			highlightsGroup.appendChild(vacationRect);
		}

		// Delikatne tło kolumny dla dzisiejszego dnia
		const today = getTodayInTimezone();
		if (
			unitDate.getFullYear() === today.getFullYear() &&
			unitDate.getMonth() === today.getMonth() &&
			unitDate.getDate() === today.getDate()
		) {
			const todayColBg = activeDocument.createElementNS(ns, 'rect');
			todayColBg.setAttribute('x', String(x));
			todayColBg.setAttribute('y', '0');
			todayColBg.setAttribute('width', String(columnWidth));
			todayColBg.setAttribute('height', String(height));
			todayColBg.setAttribute('fill', 'var(--interactive-accent)');
			todayColBg.setAttribute('opacity', '0.08');
			highlightsGroup.appendChild(todayColBg);
		}
	}

	svg.appendChild(highlightsGroup);
}

/**
 * 渲染网格（垂直线 + 行背景 + 水平线）
 * 返回行背景元素数组，供后续拖拽高亮使用
 */
export function renderGrid(
	ns: string,
	opts: GridRenderOptions,
	rowBgStorage: SVGRectElement[]
): void {
	const { svg, minDate, totalUnits, granularity, columnWidth, rowHeight, tasksLength, width, height } = opts;
	if (!svg) return;

	// Najpierw narysuj wyróżnienia kolumn (weekendy i święta)
	renderColumnHighlights(ns, svg, opts);

	const gridGroup = activeDocument.createElementNS(ns, 'g');
	addSvgClass(gridGroup, GanttClasses.elements.grid);

	// 垂直线（时间单元分隔）
	for (let i = 0; i <= totalUnits; i++) {
		const unitDate = getDateForUnit(minDate, i, granularity);
		const isMonday = unitDate.getDay() === 1; // Początek tygodnia (poniedziałek)
		const x = i * columnWidth;

		const line = activeDocument.createElementNS(ns, 'line');
		line.setAttribute('x1', String(x));
		line.setAttribute('y1', '0');
		line.setAttribute('x2', String(x));
		line.setAttribute('y2', String(height));

		if (isMonday) {
			// Wyraźniejsza linia podziału tygodni
			line.setAttribute('stroke', 'var(--background-modifier-border)');
			line.setAttribute('stroke-width', '1.2');
			line.setAttribute('stroke-dasharray', 'none');
		} else {
			line.setAttribute('stroke', 'var(--background-modifier-border)');
			line.setAttribute('stroke-width', '0.5');
			line.setAttribute('stroke-dasharray', '2 2');
			line.setAttribute('opacity', '0.6');
		}

		gridGroup.appendChild(line);
	}

	// 行背景（斑马纹）
	for (let i = 0; i < tasksLength; i++) {
		const y = i * rowHeight;
		const rowBg = activeDocument.createElementNS(ns, 'rect') as SVGRectElement;
		rowBg.setAttribute('x', '0');
		rowBg.setAttribute('y', String(y));
		rowBg.setAttribute('width', String(width));
		rowBg.setAttribute('height', String(rowHeight));
		rowBg.setAttribute('data-row-index', String(i));
		addSvgClass(rowBg, GanttClasses.elements.rowBg);
		rowBg.setAttribute('fill', i % 2 === 0 ? 'var(--background-secondary)' : 'transparent');
		if (i % 2 === 0) rowBg.setAttribute('opacity', '0.3');
		gridGroup.appendChild(rowBg);
		rowBgStorage.push(rowBg);
	}

	// 水平线（任务行分隔）
	for (let i = 0; i <= tasksLength; i++) {
		const y = i * rowHeight;
		const line = activeDocument.createElementNS(ns, 'line');
		line.setAttribute('x1', '0');
		line.setAttribute('y1', String(y));
		line.setAttribute('x2', String(width));
		line.setAttribute('y2', String(y));
		line.setAttribute('stroke', 'var(--background-modifier-border)');
		line.setAttribute('stroke-width', '0.5');
		gridGroup.appendChild(line);
	}

	svg.appendChild(gridGroup);
}

/**
/**
 * 渲染今天线 (Dziś) - Wyraźna linia ciągła z plakietką DZIŚ i poświatą (wg preview)
 */
export function renderTodayLine(
	ns: string,
	svg: SVGSVGElement | null,
	minDate: Date,
	totalUnits: number,
	height: number,
	_granularity: TimeGranularity,
	columnWidth: number
): void {
	if (!svg) return;

	const today = getTodayInTimezone();
	// Obliczenie różnicy dni kalendarzowych
	const utcToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
	const utcMin = Date.UTC(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
	const unitsDiff = Math.round((utcToday - utcMin) / 86400000);

	if (unitsDiff >= 0 && unitsDiff <= totalUnits) {
		const x = unitsDiff * columnWidth + columnWidth / 2;

		const todayGroup = activeDocument.createElementNS(ns, 'g');
		todayGroup.setAttribute('class', 'gantt-today-line');
		todayGroup.setAttribute('pointer-events', 'none');

		// Poświata linii
		const glowLine = activeDocument.createElementNS(ns, 'line');
		glowLine.setAttribute('x1', String(x));
		glowLine.setAttribute('y1', '0');
		glowLine.setAttribute('x2', String(x));
		glowLine.setAttribute('y2', String(height));
		glowLine.setAttribute('stroke', 'var(--interactive-accent, #e58537)');
		glowLine.setAttribute('stroke-width', '6');
		glowLine.setAttribute('opacity', '0.25');
		todayGroup.appendChild(glowLine);

		// Ciągła linia pionowa (2px)
		const line = activeDocument.createElementNS(ns, 'line');
		line.setAttribute('x1', String(x));
		line.setAttribute('y1', '0');
		line.setAttribute('x2', String(x));
		line.setAttribute('y2', String(height));
		line.setAttribute('stroke', 'var(--interactive-accent, #e58537)');
		line.setAttribute('stroke-width', '2');
		todayGroup.appendChild(line);

		// Plakietka DZIŚ u góry linii
		const badgeW = 34;
		const badgeH = 16;
		const badgeRect = activeDocument.createElementNS(ns, 'rect');
		badgeRect.setAttribute('x', String(x - badgeW / 2));
		badgeRect.setAttribute('y', '4');
		badgeRect.setAttribute('width', String(badgeW));
		badgeRect.setAttribute('height', String(badgeH));
		badgeRect.setAttribute('rx', '4');
		badgeRect.setAttribute('fill', 'var(--interactive-accent, #e58537)');
		todayGroup.appendChild(badgeRect);

		const badgeText = activeDocument.createElementNS(ns, 'text');
		badgeText.setAttribute('x', String(x));
		badgeText.setAttribute('y', '16');
		badgeText.setAttribute('text-anchor', 'middle');
		badgeText.setAttribute('font-size', '9');
		badgeText.setAttribute('font-weight', '800');
		badgeText.setAttribute('letter-spacing', '0.5px');
		badgeText.setAttribute('fill', '#ffffff');
		badgeText.textContent = 'DZIŚ';
		todayGroup.appendChild(badgeText);

		svg.appendChild(todayGroup);
	}
}

/**
 * Renderuje klamrę podsumowującą dla wiersza grupy na osi czasu
 * (Pozostawiona pusta zgodnie z żądaniem usunięcia klamry)
 */
export function renderGroupSummaryBracket(
	_ns: string,
	_svg: SVGSVGElement,
	_x: number,
	_y: number,
	_width: number,
	_rowHeight: number,
	_title: string,
	_count: number
): void {
	// Klamra usunięta na życzenie użytkownika - czysty wiersz grupy na siatce
}
