import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { i18n, isPolishLanguage, isChineseLanguage } from '../../i18n/i18n';
import { EditTaskModalClasses } from '../../utils/bem';
import { Icon } from '../components/Icon';
import { buildRepeatRule, parseRepeatToConfig, validateRepeatRule, type RepeatConfig } from '../../utils/repeatRules';

export interface RepeatSectionProps {
	/** 当前 repeat 规则（null 表示无周期） */
	value: string | null;
	/** 规则变化回调 */
	onChange: (rule: string | null) => void;
	/** i18n 前缀：创建表单或编辑表单（weekdays/placeholder 等 key 不同） */
	prefix: 'createTask' | 'editTask';
}

interface RepeatUiState {
	freq: '' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
	interval: number;
	days: number[];
	monthDay: string;
	whenDone: boolean;
	manualRule: string;
}

/** 从 repeat 规则初始化 UI 状态 */
function initUiState(rule: string | null): RepeatUiState {
	if (!rule) {
		return { freq: '', interval: 1, days: [], monthDay: '', whenDone: false, manualRule: '' };
	}
	const config = parseRepeatToConfig(rule);
	if (!config) {
		return {
			freq: 'custom',
			interval: 1,
			days: [],
			monthDay: '',
			whenDone: rule.toLowerCase().includes('when done'),
			manualRule: rule,
		};
	}
	const isStandardRule =
		config.interval === 1 &&
		(!config.days || config.days.length <= 1) &&
		(!config.monthDay || config.monthDay === 1);
	if (isStandardRule) {
		return {
			freq: config.frequency,
			interval: config.interval,
			days: config.days ?? [],
			monthDay: typeof config.monthDay === 'number' ? String(config.monthDay) : (config.monthDay === 'last' ? 'last' : ''),
			whenDone: config.whenDone,
			manualRule: rule,
		};
	}
	return {
		freq: 'custom',
		interval: config.interval,
		days: config.days ?? [],
		monthDay: typeof config.monthDay === 'number' ? String(config.monthDay) : (config.monthDay === 'last' ? 'last' : ''),
		whenDone: config.whenDone,
		manualRule: rule,
	};
}

/** 从 UI 状态计算规则字符串，返回 { rule, error } */
function computeRule(ui: RepeatUiState, prefix: 'createTask' | 'editTask'): { rule: string | null; error: string | null } {
	if (!ui.freq) return { rule: null, error: null };

	if (ui.freq === 'custom') {
		const manualRule = ui.manualRule.trim();
		if (!manualRule) return { rule: null, error: null };
		if (!validateRepeatRule(manualRule)) {
			return { rule: null, error: i18n.t(`modals.${prefix}.repeat.validationError`) };
		}
		return { rule: manualRule, error: null };
	}

	let monthDayValue: number | string | undefined;
	if (ui.freq === 'monthly' && ui.monthDay) {
		if (ui.monthDay === 'last') {
			monthDayValue = 'last';
		} else {
			const dayNum = parseInt(ui.monthDay);
			if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
				monthDayValue = dayNum;
			}
		}
	}

	const config: RepeatConfig = {
		frequency: ui.freq,
		interval: ui.interval,
		days: ui.days.length > 0 ? ui.days : undefined,
		monthDay: monthDayValue,
		whenDone: ui.whenDone,
	};

	return { rule: buildRepeatRule(config), error: null };
}

/**
 * 周期设置板块（React）
 *
 * 折叠式 UI：频率选择 + 间隔 + 星期/月日 + when done + 预览 + 规则说明 + 错误提示
 */
export function RepeatSection({ value, onChange, prefix }: RepeatSectionProps): JSX.Element {
	const [expanded, setExpanded] = useState(() => !!value);
	const [ui, setUi] = useState<RepeatUiState>(() => initUiState(value));

	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	const { rule, error } = useMemo(() => computeRule(ui, prefix), [ui, prefix]);
	useEffect(() => {
		onChangeRef.current(rule);
	}, [rule]);

	const freqLabels: Record<string, string> = {
		daily: i18n.t(`modals.${prefix}.repeat.frequencies.daily`),
		weekly: i18n.t(`modals.${prefix}.repeat.frequencies.weekly`),
		monthly: i18n.t(`modals.${prefix}.repeat.frequencies.monthly`),
		yearly: i18n.t(`modals.${prefix}.repeat.frequencies.yearly`),
		custom: i18n.t(`modals.${prefix}.repeat.frequencies.custom`),
	};

	const freqOptions = [
		{ value: '', label: i18n.t('common.recurrence.none') },
		{ value: 'daily', label: i18n.t('common.recurrence.day') },
		{ value: 'weekly', label: i18n.t('common.recurrence.week') },
		{ value: 'monthly', label: i18n.t('common.recurrence.month') },
		{ value: 'yearly', label: i18n.t('common.recurrence.year') },
		{ value: 'custom', label: i18n.t('common.recurrence.custom') },
	];

	const dayNames = i18n.t(`modals.${prefix}.repeat.weekdays`) as unknown as string[];

	const summary = ui.freq
		? ui.interval > 1
			? i18n.t(`modals.${prefix}.repeat.intervalTemplate`, { interval: String(ui.interval), label: freqLabels[ui.freq] })
			: freqLabels[ui.freq]
		: i18n.t('common.recurrence.none');

	const selectFreq = (freq: RepeatUiState['freq']) => {
		setUi((prev) => ({
			...prev,
			freq,
			days: [],
			monthDay: '',
			manualRule: freq === 'custom' ? (prev.interval === 1 ? 'every week' : `every ${prev.interval} weeks`) + (prev.whenDone ? ' when done' : '') : '',
		}));
	};

	const clearAll = () => {
		setUi({ freq: '', interval: 1, days: [], monthDay: '', whenDone: false, manualRule: '' });
	};

	return (
		<div className={EditTaskModalClasses.elements.repeatSection}>
			{/* 可点击的折叠标题行 */}
			<div
				className="gc-u-flex-between gc-u-pointer gc-u-p-sm"
				style={{ marginBottom: expanded ? '12px' : '0' }}
				onClick={(e) => {
					if ((e.target as HTMLElement).tagName === 'BUTTON') return;
					setExpanded(!expanded);
				}}
			>
				<div className="gc-u-flex-center gc-u-gap-sm">
					<span className="gc-u-transition" style={{ transform: expanded ? 'rotate(90deg)' : undefined }}>
						<Icon icon="chevron-right" />
					</span>
					<label className={EditTaskModalClasses.elements.sectionLabel} style={{ marginBottom: '0' }}>
						{i18n.t('modals.editTask.recurrenceLabel')}
					</label>
					<span className="gc-u-text-sm gc-u-text-muted">{summary}</span>
				</div>
				<button
					className={[EditTaskModalClasses.elements.repeatClearBtn, 'gc-u-p-xs', 'gc-u-text-sm', 'gc-u-text-muted'].join(' ')}
					style={{ display: ui.freq ? undefined : 'none' }}
					onClick={clearAll}
				>
					{isPolishLanguage() ? '× Wyczyść' : (isChineseLanguage() ? '× 清除' : '× Clear')}
				</button>
			</div>

			{expanded ? (
				<div className={EditTaskModalClasses.elements.repeatGrid}>
					{/* 频率选择行 */}
					<div className={`${EditTaskModalClasses.elements.repeatRow} gc-u-flex-center gc-u-flex-wrap`} style={{ gap: '8px', marginBottom: '12px' }}>
						<span>{i18n.t('common.recurrence.every')}</span>
						<input
							type="number"
							min="1"
							className={EditTaskModalClasses.elements.repeatIntervalInput}
							style={{ width: '60px', padding: '4px 8px' }}
							value={String(ui.interval)}
							onChange={(e) => setUi({ ...ui, interval: parseInt(e.target.value) || 1 })}
						/>
						<select
							className={EditTaskModalClasses.elements.repeatFreqSelect}
							style={{ padding: '4px 8px' }}
							value={ui.freq}
							onChange={(e) => selectFreq(e.target.value as RepeatUiState['freq'])}
						>
							{freqOptions.map((opt) => (
								<option key={opt.value} value={opt.value}>
									{opt.label}
								</option>
							))}
						</select>

						{/* 自定义规则输入 */}
						{ui.freq === 'custom' ? (
							<input
								type="text"
								className={EditTaskModalClasses.elements.repeatManualInput}
								style={{ flex: '1', minWidth: '200px', padding: '4px 8px' }}
								placeholder={i18n.t(`modals.${prefix}.repeat.customPlaceholder`)}
								value={ui.manualRule}
								onChange={(e) => setUi({ ...ui, manualRule: e.target.value })}
							/>
						) : null}

						{/* 每周模式：星期选择 */}
						{ui.freq === 'weekly' ? (
							<span className={`${EditTaskModalClasses.elements.repeatDaysContainer} gc-u-items-center gc-u-gap-xs`} style={{ display: 'flex' }}>
								<span>{'  '}</span>
								{dayNames.map((dayName, idx) => {
									const active = ui.days.includes(idx);
									return (
										<button
											key={idx}
											type="button"
											className={[EditTaskModalClasses.elements.repeatDayCheckbox, 'gc-u-pointer', 'gc-u-text-sm'].join(' ')}
											style={{
												padding: '4px 6px',
												minWidth: '28px',
												border: '1px solid var(--background-modifier-border)',
												borderRadius: '4px',
												backgroundColor: active ? 'var(--interactive-accent)' : 'var(--background-secondary)',
												color: active ? 'var(--text-on-accent)' : 'var(--text-normal)',
												borderColor: active ? 'var(--interactive-accent)' : 'var(--background-modifier-border)',
											}}
											onClick={() => {
												const next = active ? ui.days.filter(d => d !== idx) : [...ui.days, idx];
												setUi({ ...ui, days: next });
											}}
										>
											{dayName}
										</button>
									);
								})}
							</span>
						) : null}

						{/* 每月模式：日期选择 */}
						{ui.freq === 'monthly' ? (
							<span className={`${EditTaskModalClasses.elements.repeatMonthContainer} gc-u-items-center gc-u-gap-xs`} style={{ display: 'flex' }}>
								<span>{'  '}</span>
								<input
									type="number"
									min="1"
									max="31"
									className={EditTaskModalClasses.elements.repeatMonthSelect}
									style={{ width: '60px', padding: '4px 6px', fontSize: 'var(--font-ui-small)' }}
									placeholder={i18n.t(`modals.${prefix}.repeat.monthlyDayPlaceholder`)}
									value={ui.monthDay === 'last' ? '' : ui.monthDay}
									onChange={(e) => setUi({ ...ui, monthDay: e.target.value })}
								/>
							</span>
						) : null}
					</div>

					{/* 重复方式选择 */}
					<div
						className={`${EditTaskModalClasses.elements.repeatWhenDoneContainer} gc-u-flex-center gc-u-gap-sm`}
						style={{ marginBottom: '12px', fontSize: 'var(--font-ui-small)', color: 'var(--text-muted)' }}
					>
						<span>{i18n.t('modals.createTask.repeat.modeLabel')}</span>
						<input
							type="radio"
							className={EditTaskModalClasses.elements.repeatWhenDoneToggle}
							name="repeat-type"
							id="repeat-fixed"
							checked={!ui.whenDone}
							onChange={() => setUi({ ...ui, whenDone: false })}
						/>
						<label htmlFor="repeat-fixed" style={{ fontSize: 'var(--font-ui-small)' }}>
							{i18n.t('modals.createTask.repeat.fixedDate')}
						</label>
						<input
							type="radio"
							className={EditTaskModalClasses.elements.repeatWhenDoneToggle}
							name="repeat-type"
							id="repeat-when-done"
							checked={ui.whenDone}
							onChange={() => setUi({ ...ui, whenDone: true })}
						/>
						<label
							htmlFor="repeat-when-done"
							style={{ fontSize: 'var(--font-ui-small)' }}
							title={i18n.t('modals.createTask.repeat.whenDoneTooltip')}
						>
							{i18n.t('modals.createTask.repeat.whenDone')}
						</label>
					</div>

					{/* 预览摘要 */}
					<div
						className={`${EditTaskModalClasses.elements.repeatPreview} gc-u-flex-center`}
						style={{
							padding: '8px 12px',
							backgroundColor: 'var(--background-modifier-hover)',
							borderRadius: '4px',
							fontSize: 'var(--font-ui-small)',
							color: 'var(--text-muted)',
							marginBottom: '12px',
							minHeight: '36px',
						}}
					>
						<span className={EditTaskModalClasses.elements.repeatPreviewText}>{rule ?? 'No repeat'}</span>
					</div>

					{/* 规则说明 */}
					<div
						className={EditTaskModalClasses.elements.repeatRulesHint}
						style={{
							marginTop: '8px',
							padding: '8px',
							backgroundColor: 'var(--background-modifier-hover)',
							borderRadius: '4px',
							fontSize: 'var(--font-ui-smaller)',
						}}
					>
						<div
							className={`${EditTaskModalClasses.elements.repeatRulesHintTitle} gc-u-font-medium`}
							style={{ marginBottom: '4px' }}
						>
							{i18n.t('modals.createTask.repeat.rulesHintTitle')}
						</div>
						<div className={`${EditTaskModalClasses.elements.repeatRulesHintList} gc-u-text-muted`} style={{ whiteSpace: 'pre-line' }}>
							{i18n.t('modals.createTask.repeat.rulesHintList')}
						</div>
					</div>

					{/* 错误提示 */}
					{error ? (
						<div className={`${EditTaskModalClasses.elements.repeatErrorMsg} gc-u-text-sm`} style={{ color: 'var(--text-error)', marginTop: '4px' }}>
							{error}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}