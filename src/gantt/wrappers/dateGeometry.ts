/**
 * 甘特图日期几何与网格对齐
 *
 * 纯函数模块：无状态、无 DOM 依赖，所有函数接收必要的参数。
 * 由 GanttGeometry 类封装渲染器的共享尺寸配置（columnWidth、granularity）。
 */

import { TimeGranularity, GRANULARITY_CONFIGS } from '../types';

/**
 * 甘特图几何计算所需的共享尺寸配置
 */
export interface GanttGeometryConfig {
	columnWidth: number;
	granularity: TimeGranularity;
}

/**
 * 解析 YYYY-MM-DD 格式的日期字符串为本地日期（避免 UTC 时区偏移）。
 * 与任务序列化回 Markdown 的格式一致。
 */
export function parseLocalDate(dateStr: string): Date {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
	if (match) {
		return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	}
	return new Date(dateStr);
}

/**
 * 单元索引 -> Date
 * Używamy czystej arytmetyki kalendarzowej, aby uniknąć anomalii DST (np. 25-godzinnej doby przy zmianie czasu jesienią)
 */
export function getDateForUnit(minDate: Date, unitIndex: number, granularity: TimeGranularity): Date {
	if (!granularity || (granularity as string) === 'day' || granularity === TimeGranularity.DAY) {
		return new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate() + unitIndex);
	}
	const config = GRANULARITY_CONFIGS[granularity];
	return new Date(minDate.getTime() + unitIndex * config.milliseconds);
}

/**
 * 判断两个日期是否在同一颗粒度单元（仅周视图）
 */
export function isSameUnit(date1: Date, date2: Date, _granularity: TimeGranularity): boolean {
	return date1.getFullYear() === date2.getFullYear() &&
		date1.getMonth() === date2.getMonth() &&
		date1.getDate() === date2.getDate();
}

/**
 * 判断是否为主要网格线（每7天加粗，仅周视图）
 */
export function isMajorGridLine(unitIndex: number, _granularity: TimeGranularity): boolean {
	return unitIndex % 7 === 0;
}

/**
 * 根据开始日期查找对应的网格单元索引
 */
export function findStartGridUnitIndex(startDate: Date, minDate: Date, config: GanttGeometryConfig): number {
	if (!config.granularity || (config.granularity as string) === 'day' || config.granularity === TimeGranularity.DAY) {
		const utcStart = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
		const utcMin = Date.UTC(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
		return Math.round((utcStart - utcMin) / 86400000);
	}
	const normalized = new Date(startDate);
	normalized.setHours(0, 0, 0, 0);
	const offsetUnits = (normalized.getTime() - minDate.getTime()) / GRANULARITY_CONFIGS[config.granularity].milliseconds;
	return Math.ceil(offsetUnits);
}

/**
 * 根据结束日期查找对应的网格单元索引（加一天确保包含结束日当天）
 */
export function findEndGridUnitIndex(endDate: Date, minDate: Date, config: GanttGeometryConfig): number {
	if (!config.granularity || (config.granularity as string) === 'day' || config.granularity === TimeGranularity.DAY) {
		const utcEnd = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1);
		const utcMin = Date.UTC(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
		return Math.round((utcEnd - utcMin) / 86400000);
	}
	const normalized = new Date(endDate);
	normalized.setHours(0, 0, 0, 0);
	normalized.setDate(normalized.getDate() + 1);
	const offsetUnits = (normalized.getTime() - minDate.getTime()) / GRANULARITY_CONFIGS[config.granularity].milliseconds;
	return Math.ceil(offsetUnits);
}

/**
 * 单元索引 -> x 坐标
 */
export function getGridUnitX(unitIndex: number, columnWidth: number): number {
	return unitIndex * columnWidth;
}
