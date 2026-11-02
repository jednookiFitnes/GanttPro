/**
 * 甘特图 Header 时间轴渲染 (Gantt Calendar Pro - 3-Tier Multi-Level Header)
 *
 * 职责：在 SVG header 区域绘制3层时间轴：
 * 1. Rząd 1 (Miesiące, Y: 0-22px): np. "Październik 2026"
 * 2. Rząd 2 (Tygodnie, Y: 22-42px): np. "Tydzień 40" z numerem tygodnia w roku
 * 3. Rząd 3 (Dni, Y: 42-76px):
 *    - na górze numer dnia (np. 14)
 *    - na dole skrócona nazwa dnia (np. Pn, Wt, Śr, Czw, Pt, So, Nd)
 *    - wyróżnienie polskich świąt (kolor czerwony, kropka, tooltip)
 *    - wyróżnienie weekendów (szrafura / tło)
 *    - wyróżnienie dzisiejszego dnia (kolor akcentu)
 */

import type { TimeGranularity } from '../types';
import { getDateForUnit, isSameUnit } from './dateGeometry';
import { getTodayInTimezone } from '../../dateUtils/timezone';
import {
	getPolishHoliday,
	isWeekend,
	POLISH_DAY_ABBR,
	POLISH_MONTH_NAMES,
	getIsoWeekNumber,
} from '../../utils/holidaysPl';
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

export interface HeaderRenderOptions {
	svg: SVGSVGElement | null;
	minDate: Date;
	totalUnits: number;
	granularity: TimeGranularity;
	columnWidth: number;
	headerHeight: number;
	padding: number;
	getVacation?: (date: Date) => VacationEntryInfo | null;
	vacationColor?: string;
}

export function renderHeader(opts: HeaderRenderOptions): void {
	const { svg, minDate, totalUnits, granularity, columnWidth, headerHeight, padding } = opts;
	if (!svg) return;

	const ns = 'http://www.w3.org/2000/svg';
	const width = totalUnits * columnWidth + padding * 2;

	// Wyczyść ewentualną poprzednią zawartość
	while (svg.firstChild) {
		svg.removeChild(svg.firstChild);
	}

	// Tło całego nagłówka
	const headerBg = activeDocument.createElementNS(ns, 'rect');
	headerBg.setAttribute('x', '0');
	headerBg.setAttribute('y', '0');
	headerBg.setAttribute('width', String(width));
	headerBg.setAttribute('height', String(headerHeight));
	headerBg.setAttribute('fill', 'var(--background-secondary)');
	svg.appendChild(headerBg);

	// Wysokości poszczególnych poziomów nagłówka
	const monthRowHeight = 22;
	const weekRowHeight = 20;
	const daysRowY = monthRowHeight + weekRowHeight; // 42px
	const daysRowHeight = headerHeight - daysRowY;    // 34px (przy headerHeight=76)

	const today = getTodayInTimezone();

	// Przygotuj daty dla wszystkich jednostek
	const unitDates: Date[] = [];
	for (let i = 0; i < totalUnits; i++) {
		unitDates.push(getDateForUnit(minDate, i, granularity));
	}

	// ==========================================
	// 1. POZIOM 1: MIESIĄCE (Y: 0 do 22px)
	// ==========================================
	let currentMonthIndex = -1;
	let monthStartUnit = 0;

	for (let i = 0; i < totalUnits; i++) {
		const d = unitDates[i];
		const m = d.getMonth();
		const isLast = i === totalUnits - 1;

		if (currentMonthIndex !== -1 && (m !== currentMonthIndex || isLast)) {
			const endUnit = isLast && m === currentMonthIndex ? i + 1 : i;
			const blockStartX = monthStartUnit * columnWidth;
			const blockWidth = (endUnit - monthStartUnit) * columnWidth;

			// Tło bloku miesiąca (mocniej zaakcentowane)
			const monthBg = activeDocument.createElementNS(ns, 'rect');
			monthBg.setAttribute('x', String(blockStartX));
			monthBg.setAttribute('y', '0');
			monthBg.setAttribute('width', String(blockWidth));
			monthBg.setAttribute('height', String(monthRowHeight));
			monthBg.setAttribute('fill', currentMonthIndex % 2 === 0 ? 'var(--background-secondary-alt, #222226)' : 'var(--background-secondary, #1a1a1d)');
			svg.appendChild(monthBg);

			// Tekst miesiąca - mocno zaakcentowany (ikona, bold, 12px)
			const monthName = POLISH_MONTH_NAMES[currentMonthIndex];
			const year = unitDates[monthStartUnit].getFullYear();
			const monthText = activeDocument.createElementNS(ns, 'text');
			monthText.setAttribute('x', String(blockStartX + blockWidth / 2));
			monthText.setAttribute('y', '16');
			monthText.setAttribute('text-anchor', 'middle');
			monthText.setAttribute('font-size', '12');
			monthText.setAttribute('font-weight', '700');
			monthText.setAttribute('letter-spacing', '0.5px');
			monthText.setAttribute('fill', 'var(--text-normal, #f8fafc)');
			monthText.textContent = `📅 ${monthName.toUpperCase()} ${year}`;
			svg.appendChild(monthText);

			// Wyraźna pionowa linia podziału miesiąca
			const monthDivLine = activeDocument.createElementNS(ns, 'line');
			monthDivLine.setAttribute('x1', String(blockStartX + blockWidth));
			monthDivLine.setAttribute('y1', '0');
			monthDivLine.setAttribute('x2', String(blockStartX + blockWidth));
			monthDivLine.setAttribute('y2', String(monthRowHeight));
			monthDivLine.setAttribute('stroke', 'var(--background-modifier-border-focus, #52525b)');
			monthDivLine.setAttribute('stroke-width', '2');
			svg.appendChild(monthDivLine);

			monthStartUnit = i;
		}

		currentMonthIndex = m;
	}

	// Pozioma linia oddzielająca miesiące od tygodni
	const monthBottomLine = activeDocument.createElementNS(ns, 'line');
	monthBottomLine.setAttribute('x1', '0');
	monthBottomLine.setAttribute('y1', String(monthRowHeight));
	monthBottomLine.setAttribute('x2', String(width));
	monthBottomLine.setAttribute('y2', String(monthRowHeight));
	monthBottomLine.setAttribute('stroke', 'var(--background-modifier-border, #3f3f46)');
	monthBottomLine.setAttribute('stroke-width', '1.5');
	svg.appendChild(monthBottomLine);

	// ==========================================
	// 2. POZIOM 2: TYGODNIE (Y: 22 do 42px)
	// ==========================================
	let currentWeekNumber = -1;
	let weekStartUnit = 0;

	for (let i = 0; i < totalUnits; i++) {
		const d = unitDates[i];
		const w = getIsoWeekNumber(d);
		const isLast = i === totalUnits - 1;

		if (currentWeekNumber !== -1 && (w !== currentWeekNumber || isLast)) {
			const endUnit = isLast && w === currentWeekNumber ? i + 1 : i;
			const blockStartX = weekStartUnit * columnWidth;
			const blockWidth = (endUnit - weekStartUnit) * columnWidth;

			// Tło bloku tygodnia
			const weekBg = activeDocument.createElementNS(ns, 'rect');
			weekBg.setAttribute('x', String(blockStartX));
			weekBg.setAttribute('y', String(monthRowHeight));
			weekBg.setAttribute('width', String(blockWidth));
			weekBg.setAttribute('height', String(weekRowHeight));
			weekBg.setAttribute('fill', currentWeekNumber % 2 === 0 ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.03)');
			svg.appendChild(weekBg);

			// Tekst tygodnia - sam numer tygodnia, powiększony 2x (18px, bold)
			const weekText = activeDocument.createElementNS(ns, 'text');
			weekText.setAttribute('x', String(blockStartX + blockWidth / 2));
			weekText.setAttribute('y', String(monthRowHeight + 16));
			weekText.setAttribute('text-anchor', 'middle');
			weekText.setAttribute('font-size', '18');
			weekText.setAttribute('font-weight', '800');
			weekText.setAttribute('fill', 'var(--text-normal, #e2e8f0)');
			weekText.textContent = String(currentWeekNumber);
			svg.appendChild(weekText);

			// Wyraźniejsza pionowa linia podziału tygodnia
			const weekDivLine = activeDocument.createElementNS(ns, 'line');
			weekDivLine.setAttribute('x1', String(blockStartX + blockWidth));
			weekDivLine.setAttribute('y1', String(monthRowHeight));
			weekDivLine.setAttribute('x2', String(blockStartX + blockWidth));
			weekDivLine.setAttribute('y2', String(headerHeight));
			weekDivLine.setAttribute('stroke', 'var(--background-modifier-border, #3f3f46)');
			weekDivLine.setAttribute('stroke-width', '1.5');
			svg.appendChild(weekDivLine);

			weekStartUnit = i;
		}

		currentWeekNumber = w;
	}

	// Pozioma linia oddzielająca tygodnie od dni
	const weekBottomLine = activeDocument.createElementNS(ns, 'line');
	weekBottomLine.setAttribute('x1', '0');
	weekBottomLine.setAttribute('y1', String(daysRowY));
	weekBottomLine.setAttribute('x2', String(width));
	weekBottomLine.setAttribute('y2', String(daysRowY));
	weekBottomLine.setAttribute('stroke', 'var(--background-modifier-border)');
	weekBottomLine.setAttribute('stroke-width', '1');
	svg.appendChild(weekBottomLine);

	// ==========================================
	// 3. POZIOM 3: DNI (Y: 42 do 76px)
	// ==========================================
	for (let i = 0; i < totalUnits; i++) {
		const unitDate = unitDates[i];
		const gridLineX = i * columnWidth;
		const cellCenterX = gridLineX + columnWidth / 2;

		const isCurrentUnit = isSameUnit(unitDate, today, granularity);
		const holidayName = getPolishHoliday(unitDate);
		const vacation = opts.getVacation ? opts.getVacation(unitDate) : null;
		const weekend = isWeekend(unitDate);

		// Weekendowe tło w nagłówku
		if (weekend) {
			const weekendCellBg = activeDocument.createElementNS(ns, 'rect');
			weekendCellBg.setAttribute('x', String(gridLineX));
			weekendCellBg.setAttribute('y', String(daysRowY));
			weekendCellBg.setAttribute('width', String(columnWidth));
			weekendCellBg.setAttribute('height', String(daysRowHeight));
			weekendCellBg.setAttribute('fill', 'rgba(0,0,0,0.18)');
			svg.appendChild(weekendCellBg);
		}

		// Świąteczne lub urlopowe tło w nagłówku
		if (holidayName) {
			const holidayCellBg = activeDocument.createElementNS(ns, 'rect');
			holidayCellBg.setAttribute('x', String(gridLineX));
			holidayCellBg.setAttribute('y', String(daysRowY));
			holidayCellBg.setAttribute('width', String(columnWidth));
			holidayCellBg.setAttribute('height', String(daysRowHeight));
			holidayCellBg.setAttribute('fill', 'rgba(239, 68, 68, 0.12)');
			svg.appendChild(holidayCellBg);
		} else if (vacation && !weekend) {
			const vacationCellBg = activeDocument.createElementNS(ns, 'rect');
			vacationCellBg.setAttribute('x', String(gridLineX));
			vacationCellBg.setAttribute('y', String(daysRowY));
			vacationCellBg.setAttribute('width', String(columnWidth));
			vacationCellBg.setAttribute('height', String(daysRowHeight));
			vacationCellBg.setAttribute('fill', hexToRgba(opts.vacationColor || '#f97316', 0.15));
			svg.appendChild(vacationCellBg);
		}

		// Dzisiejsze podświetlenie
		if (isCurrentUnit) {
			const todayCellBg = activeDocument.createElementNS(ns, 'rect');
			todayCellBg.setAttribute('x', String(gridLineX));
			todayCellBg.setAttribute('y', String(daysRowY));
			todayCellBg.setAttribute('width', String(columnWidth));
			todayCellBg.setAttribute('height', String(daysRowHeight));
			todayCellBg.setAttribute('fill', 'var(--interactive-accent)');
			todayCellBg.setAttribute('opacity', '0.18');
			svg.appendChild(todayCellBg);

			const todayUnderline = activeDocument.createElementNS(ns, 'line');
			todayUnderline.setAttribute('x1', String(gridLineX));
			todayUnderline.setAttribute('y1', String(daysRowY + daysRowHeight - 2));
			todayUnderline.setAttribute('x2', String(gridLineX + columnWidth));
			todayUnderline.setAttribute('y2', String(daysRowY + daysRowHeight - 2));
			todayUnderline.setAttribute('stroke', 'var(--interactive-accent)');
			todayUnderline.setAttribute('stroke-width', '2.5');
			svg.appendChild(todayUnderline);
		}

		// Grupa dla komórki dnia (z tooltipem title)
		const dayGroup = activeDocument.createElementNS(ns, 'g');
		dayGroup.setAttribute('cursor', 'pointer');

		// Tooltip dla święta / urlopu / dnia
		const titleElem = activeDocument.createElementNS(ns, 'title');
		const dayFullName = POLISH_DAY_ABBR[unitDate.getDay()];
		let tooltipText = `${unitDate.getDate()} ${POLISH_MONTH_NAMES[unitDate.getMonth()]} (${dayFullName})`;
		if (holidayName && vacation) {
			tooltipText += ` - ŚWIĘTO: ${holidayName} | 🏖️ URLOP: ${vacation.type}`;
		} else if (holidayName) {
			tooltipText += ` - ŚWIĘTO: ${holidayName}`;
		} else if (vacation) {
			tooltipText += ` - 🏖️ URLOP: ${vacation.type}`;
		}
		titleElem.textContent = tooltipText;
		dayGroup.appendChild(titleElem);

		// Kolor tekstu
		let dayTextColor = 'var(--text-muted)';
		let dayFontWeight = '400';

		if (isCurrentUnit) {
			dayTextColor = 'var(--interactive-accent)';
			dayFontWeight = '700';
		} else if (holidayName) {
			dayTextColor = 'var(--text-error, #f87171)';
			dayFontWeight = '700';
		} else if (vacation) {
			dayTextColor = opts.vacationColor || '#f97316';
			dayFontWeight = '700';
		} else if (weekend) {
			dayTextColor = 'var(--text-muted)';
			dayFontWeight = '500';
		}

		// 1. Numer dnia (na górze, Y: 56px)
		const dayNumberText = activeDocument.createElementNS(ns, 'text');
		dayNumberText.setAttribute('x', String(cellCenterX));
		dayNumberText.setAttribute('y', String(daysRowY + 15));
		dayNumberText.setAttribute('text-anchor', 'middle');
		dayNumberText.setAttribute('font-size', '12');
		dayNumberText.setAttribute('font-weight', dayFontWeight);
		dayNumberText.setAttribute('fill', dayTextColor);
		dayNumberText.textContent = String(unitDate.getDate());
		dayGroup.appendChild(dayNumberText);

		// 2. Skrócona nazwa dnia (na dole, Y: 69px)
		const dayNameText = activeDocument.createElementNS(ns, 'text');
		dayNameText.setAttribute('x', String(cellCenterX));
		dayNameText.setAttribute('y', String(daysRowY + 28));
		dayNameText.setAttribute('text-anchor', 'middle');
		dayNameText.setAttribute('font-size', '10');
		dayNameText.setAttribute('font-weight', isCurrentUnit || holidayName || vacation ? '600' : '400');
		dayNameText.setAttribute('fill', dayTextColor);
		dayNameText.textContent = POLISH_DAY_ABBR[unitDate.getDay()];
		dayGroup.appendChild(dayNameText);

		// Wskaźniki kropkowe (święto i/lub urlop)
		if (holidayName && vacation) {
			const holidayDot = activeDocument.createElementNS(ns, 'circle');
			holidayDot.setAttribute('cx', String(cellCenterX + 9));
			holidayDot.setAttribute('cy', String(daysRowY + 8));
			holidayDot.setAttribute('r', '2.2');
			holidayDot.setAttribute('fill', 'var(--text-error, #f87171)');
			dayGroup.appendChild(holidayDot);

			const vacationDot = activeDocument.createElementNS(ns, 'circle');
			vacationDot.setAttribute('cx', String(cellCenterX + 15));
			vacationDot.setAttribute('cy', String(daysRowY + 8));
			vacationDot.setAttribute('r', '2.2');
			vacationDot.setAttribute('fill', opts.vacationColor || '#f97316');
			dayGroup.appendChild(vacationDot);
		} else if (holidayName) {
			const dot = activeDocument.createElementNS(ns, 'circle');
			dot.setAttribute('cx', String(cellCenterX + 12));
			dot.setAttribute('cy', String(daysRowY + 8));
			dot.setAttribute('r', '2.5');
			dot.setAttribute('fill', 'var(--text-error, #f87171)');
			dayGroup.appendChild(dot);
		} else if (vacation) {
			const dot = activeDocument.createElementNS(ns, 'circle');
			dot.setAttribute('cx', String(cellCenterX + 12));
			dot.setAttribute('cy', String(daysRowY + 8));
			dot.setAttribute('r', '2.5');
			dot.setAttribute('fill', opts.vacationColor || '#f97316');
			dayGroup.appendChild(dot);
		}

		svg.appendChild(dayGroup);

		// Pionowa linia podziału dnia
		const dayDivLine = activeDocument.createElementNS(ns, 'line');
		dayDivLine.setAttribute('x1', String(gridLineX));
		dayDivLine.setAttribute('y1', String(daysRowY));
		dayDivLine.setAttribute('x2', String(gridLineX));
		dayDivLine.setAttribute('y2', String(headerHeight));
		dayDivLine.setAttribute('stroke', 'var(--background-modifier-border)');
		dayDivLine.setAttribute('stroke-width', '0.5');
		dayDivLine.setAttribute('opacity', '0.6');
		svg.appendChild(dayDivLine);
	}
}
