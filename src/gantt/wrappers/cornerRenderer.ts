/**
 * 甘特图 Corner 左上角渲染 (Gantt Calendar Pro)
 *
 * 职责：绘制序号列标题、任务列标题、两者之间的分隔线以及与时间轴对齐的分隔线。
 */

import { i18n } from '../../i18n/i18n';

export interface CornerRenderOptions {
	svg: SVGSVGElement | null;
	taskNumberColumnWidth: number;
	taskColumnWidth: number;
	headerHeight: number;
}

export function renderCorner(opts: CornerRenderOptions): void {
	const { svg, taskNumberColumnWidth, taskColumnWidth, headerHeight } = opts;
	if (!svg) return;

	const ns = 'http://www.w3.org/2000/svg';
	const width = taskColumnWidth;
	const height = headerHeight;

	while (svg.firstChild) {
		svg.removeChild(svg.firstChild);
	}

	// Tło całego narożnika
	const bg = activeDocument.createElementNS(ns, 'rect');
	bg.setAttribute('x', '0');
	bg.setAttribute('y', '0');
	bg.setAttribute('width', String(width));
	bg.setAttribute('height', String(height));
	bg.setAttribute('fill', 'var(--background-secondary)');
	svg.appendChild(bg);

	// Górny pasek tytułowy narożnika (wyrównany z miesiącami/tygodniami)
	const topBarHeight = 42;
	const topBg = activeDocument.createElementNS(ns, 'rect');
	topBg.setAttribute('x', '0');
	topBg.setAttribute('y', '0');
	topBg.setAttribute('width', String(width));
	topBg.setAttribute('height', String(topBarHeight));
	topBg.setAttribute('fill', 'var(--background-secondary-alt, rgba(0,0,0,0.08))');
	svg.appendChild(topBg);

	const brandText = activeDocument.createElementNS(ns, 'text');
	brandText.setAttribute('x', '12');
	brandText.setAttribute('y', '26');
	brandText.setAttribute('font-size', '11');
	brandText.setAttribute('font-weight', '700');
	brandText.setAttribute('fill', 'var(--text-muted)');
	brandText.textContent = 'Gantt Pro';
	svg.appendChild(brandText);

	// Pozioma linia oddzielająca nagłówek (na wysokości 42px)
	const hLine = activeDocument.createElementNS(ns, 'line');
	hLine.setAttribute('x1', '0');
	hLine.setAttribute('y1', String(topBarHeight));
	hLine.setAttribute('x2', String(width));
	hLine.setAttribute('y2', String(topBarHeight));
	hLine.setAttribute('stroke', 'var(--background-modifier-border)');
	hLine.setAttribute('stroke-width', '1');
	svg.appendChild(hLine);

	// Dolna sekcja (wysokość 42-76px = 34px): Etykiety kolumn
	const bottomCenterY = topBarHeight + (height - topBarHeight) / 2 + 4;
	const priorityColWidth = 76;

	// 1. Zadanie / Projekt (kolumna środkowa od taskNumberColumnWidth do width - priorityColWidth)
	const taskText = activeDocument.createElementNS(ns, 'text');
	taskText.setAttribute('x', String(taskNumberColumnWidth + 12));
	taskText.setAttribute('y', String(bottomCenterY));
	taskText.setAttribute('text-anchor', 'start');
	taskText.setAttribute('font-size', '11');
	taskText.setAttribute('font-weight', '600');
	taskText.setAttribute('fill', 'var(--text-muted)');
	taskText.textContent = 'ZADANIE';
	svg.appendChild(taskText);

	// 2. Priorytet / Liczba (prawa kolumna 76px)
	const priorityText = activeDocument.createElementNS(ns, 'text');
	priorityText.setAttribute('x', String(width - priorityColWidth / 2));
	priorityText.setAttribute('y', String(bottomCenterY));
	priorityText.setAttribute('text-anchor', 'middle');
	priorityText.setAttribute('font-size', '11');
	priorityText.setAttribute('font-weight', '600');
	priorityText.setAttribute('fill', 'var(--text-muted)');
	priorityText.textContent = 'PRIORYTET';
	svg.appendChild(priorityText);

	// Pionowa linia dzieląca numer i zadanie
	const dividerLine = activeDocument.createElementNS(ns, 'line');
	dividerLine.setAttribute('x1', String(taskNumberColumnWidth));
	dividerLine.setAttribute('y1', String(topBarHeight));
	dividerLine.setAttribute('x2', String(taskNumberColumnWidth));
	dividerLine.setAttribute('y2', String(height));
	dividerLine.setAttribute('stroke', 'var(--background-modifier-border)');
	dividerLine.setAttribute('stroke-width', '1');
	svg.appendChild(dividerLine);

	// Pionowa linia dzieląca zadanie i priorytet
	const priorityDivider = activeDocument.createElementNS(ns, 'line');
	priorityDivider.setAttribute('x1', String(width - priorityColWidth));
	priorityDivider.setAttribute('y1', String(topBarHeight));
	priorityDivider.setAttribute('x2', String(width - priorityColWidth));
	priorityDivider.setAttribute('y2', String(height));
	priorityDivider.setAttribute('stroke', 'var(--background-modifier-border)');
	priorityDivider.setAttribute('stroke-width', '0.5');
	priorityDivider.setAttribute('opacity', '0.6');
	svg.appendChild(priorityDivider);
}
