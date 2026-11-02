import type { App } from 'obsidian';
import type GanttCalendarPlugin from '../../main';
import type { GCTask } from '../../types';
import type { ContextMenuSection } from './ContextMenu';
import { i18n } from '../../i18n/i18n';
import { openEditTaskModal } from '../modals/TaskFormModal';
import { createNoteFromTask } from '../../contextMenu/commands/createNoteFromTask';
import { createNoteFromTaskAlias } from '../../contextMenu/commands/createNoteFromTaskAlias';
import { postponeTask } from '../../contextMenu/commands/postponeTask';
import { cancelTask } from '../../contextMenu/commands/cancelTask';
import { restoreTask } from '../../contextMenu/commands/restoreTask';
import { deleteTask } from '../../contextMenu/commands/deleteTask';
import { setTaskStatus } from '../../contextMenu/commands/setTaskStatus';
import { setTaskPriority } from '../../contextMenu/commands/setPriority';

/**
 * 构造任务的统一右键上下文菜单结构（Daily Timeline、Day View、Gantt View 共享）
 */
export function buildTaskContextMenuSections(
	app: App,
	plugin: GanttCalendarPlugin,
	task: GCTask,
	onRefresh?: () => void,
): ContextMenuSection[] {
	if (!task) return [];
	const enabledFormats = plugin?.settings?.enabledTaskFormats || ['tasks'];
	const taskNotePath = plugin?.settings?.taskNotePath || 'Tasks';
	const refresh = onRefresh || (() => {});
	const isCancelled = task.cancelled === true;

	const priorities: Array<{ value: 'highest' | 'high' | 'medium' | 'low' | 'lowest' | 'normal'; label: string; icon: string }> = [
		{ value: 'highest', label: i18n.t('common.priority.highest'), icon: '🔺' },
		{ value: 'high', label: i18n.t('common.priority.high'), icon: '⏫' },
		{ value: 'medium', label: i18n.t('common.priority.medium'), icon: '🔼' },
		{ value: 'normal', label: i18n.t('common.priority.normal'), icon: '◽' },
		{ value: 'low', label: i18n.t('common.priority.low'), icon: '🔽' },
		{ value: 'lowest', label: i18n.t('common.priority.lowest'), icon: '⏬' },
	];
	const postponeOptions = [
		{ days: 1, label: i18n.t('contextMenu.postpone.days1') },
		{ days: 3, label: i18n.t('contextMenu.postpone.days3') },
		{ days: 7, label: i18n.t('contextMenu.postpone.days7') },
	];
	const setDueDateOptions = [
		{ days: 1, label: i18n.t('contextMenu.setDueDate.tomorrow') },
		{ days: 3, label: i18n.t('contextMenu.setDueDate.days3') },
		{ days: 7, label: i18n.t('contextMenu.setDueDate.days7') },
	];

	return [
		{
			items: [{
				key: 'edit',
				title: i18n.t('contextMenu.editTask'),
				icon: 'pencil',
				onClick: () => {
					openEditTaskModal(app, task, enabledFormats, refresh, true);
				},
			}],
		},
		{
			items: [
				{
					key: 'createNote',
					title: i18n.t('contextMenu.createNote'),
					icon: 'file-plus',
					onClick: () => {
						void createNoteFromTask(app, task, taskNotePath, enabledFormats);
					},
				},
				{
					key: 'createNoteAlias',
					title: i18n.t('contextMenu.createNoteAlias'),
					icon: 'file-plus',
					onClick: () => {
						void createNoteFromTaskAlias(app, task, taskNotePath, enabledFormats);
					},
				},
			],
		},
		{
			items: priorities.map((p) => ({
				key: `priority-${p.value}`,
				title: `${p.icon} ${p.label}`,
				onClick: () => {
					void setTaskPriority(app, task, p.value, enabledFormats, refresh);
				},
			})),
		},
		{
			items: [
				{
					key: 'statusImportant',
					title: i18n.t('contextMenu.statusImportant'),
					onClick: () => {
						void setTaskStatus(app, task, 'important', enabledFormats, refresh);
					},
				},
				{
					key: 'statusQuestion',
					title: i18n.t('contextMenu.statusQuestion'),
					onClick: () => {
						void setTaskStatus(app, task, 'question', enabledFormats, refresh);
					},
				},
			],
		},
		{
			items: [
				...postponeOptions.map((o) => ({
					key: `postpone-${o.days}`,
					title: o.label,
					icon: 'calendar-clock',
					onClick: () => {
						void postponeTask(app, task, o.days, enabledFormats, refresh, false);
					},
				})),
				...setDueDateOptions.map((o) => ({
					key: `due-${o.days}`,
					title: o.label,
					icon: 'calendar-check',
					onClick: () => {
						void postponeTask(app, task, o.days, enabledFormats, refresh, true);
					},
				})),
			],
		},
		{
			items: [
				{
					key: 'cancelRestore',
					title: isCancelled ? i18n.t('contextMenu.restoreTask') : i18n.t('contextMenu.cancelTask'),
					icon: isCancelled ? 'rotate-ccw' : 'x',
					onClick: () => {
						if (isCancelled) {
							void restoreTask(app, task, enabledFormats, refresh);
						} else {
							void cancelTask(app, task, enabledFormats, refresh);
						}
					},
				},
				{
					key: 'delete',
					title: i18n.t('contextMenu.deleteTask'),
					icon: 'trash',
					onClick: () => {
						void deleteTask(app, task, refresh);
					},
				},
			],
		},
	];
}
