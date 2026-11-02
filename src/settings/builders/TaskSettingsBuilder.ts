import { Setting } from 'obsidian';
import { BaseBuilder } from './BaseBuilder';
import { FolderSuggest, FolderListSetting } from '../components';
import type { BuilderConfig } from '../types';
import { i18n } from '../../i18n/i18n';

/**
 * 任务设置构建器
 * 包含任务基础设置和任务创建设置
 * 任务状态设置由 TaskStatusSettingsBuilder 独立管理
 */
export class TaskSettingsBuilder extends BaseBuilder {
	constructor(config: BuilderConfig) {
		super(config);
	}

	render(): void {
		// ===== 任务基础 =====
		this.createSettingGroup(i18n.t('settings.tasks.basic.groupTitle'), (group) => {
			const addSetting = (cb: (setting: Setting) => void) => {
				group.addSetting(cb);
			};

			// 全局任务筛选标记
			addSetting(setting => {
				setting.setName(i18n.t('settings.tasks.basic.globalFilter.name'))
					.setDesc(i18n.t('settings.tasks.basic.globalFilter.description'))
					.addText(text => text
						.setPlaceholder(i18n.t('settings.tasks.basic.globalFilter.placeholder'))
						.setValue(this.plugin.settings.globalTaskFilter)
						.onChange((value) => {
							this.plugin.settings.globalTaskFilter = value.trim();
							void this.saveAndRefreshViews();
						}));
			});

			// 启用的任务格式
			addSetting(setting => {
				setting.setName(i18n.t('settings.tasks.basic.taskFormat.name'))
					.setDesc(i18n.t('settings.tasks.basic.taskFormat.description'))
					.addDropdown(drop => {
						drop.addOptions({
							'tasks': i18n.t('settings.tasks.basic.taskFormat.options.tasks'),
							'dataview': i18n.t('settings.tasks.basic.taskFormat.options.dataview'),
							'both': i18n.t('settings.tasks.basic.taskFormat.options.both'),
						});

						const formats = this.plugin.settings.enabledTaskFormats;
						if (formats.includes('tasks') && formats.includes('dataview')) drop.setValue('both');
						else if (formats.includes('tasks')) drop.setValue('tasks');
						else if (formats.includes('dataview')) drop.setValue('dataview');

						drop.onChange((value) => {
							this.plugin.settings.enabledTaskFormats = (value === 'both') ? ['tasks', 'dataview'] : [value];
							void this.saveAndRefreshViews();
						});
					});
			});

			// 任务文本是否显示 Global Filter
			addSetting(setting => {
				setting.setName(i18n.t('settings.tasks.basic.showGlobalFilter.name'))
					.setDesc(i18n.t('settings.tasks.basic.showGlobalFilter.description'))
					.addToggle(toggle => toggle
						.setValue(this.plugin.settings.showGlobalFilterInTaskText)
						.onChange((value) => {
							this.plugin.settings.showGlobalFilterInTaskText = value;
							void this.saveAndRefreshViews();
						}));
			});

			// 包含的任务文件夹（Pokazuj taski z wybranych folderów）
			addSetting(setting => {
				new FolderListSetting({
					setting,
					app: this.plugin.app,
					name: i18n.t('settings.tasks.basic.includeFolders.name'),
					description: i18n.t('settings.tasks.basic.includeFolders.description'),
					placeholder: i18n.t('settings.tasks.basic.includeFolders.placeholder'),
					emptyHint: i18n.t('settings.tasks.basic.includeFolders.empty'),
					addButtonText: i18n.t('settings.tasks.basic.includeFolders.add'),
					folders: this.plugin.settings.includeTaskFolders || [],
					onChange: async (folders) => {
						this.plugin.settings.includeTaskFolders = folders;
						await this.saveAndRefreshViews();
					},
				});
			});

			// 忽略的任务文件夹（Ignoruj taski z wybranych folderów）
			addSetting(setting => {
				new FolderListSetting({
					setting,
					app: this.plugin.app,
					name: i18n.t('settings.tasks.basic.excludeFolders.name'),
					description: i18n.t('settings.tasks.basic.excludeFolders.description'),
					placeholder: i18n.t('settings.tasks.basic.excludeFolders.placeholder'),
					emptyHint: i18n.t('settings.tasks.basic.excludeFolders.empty'),
					addButtonText: i18n.t('settings.tasks.basic.excludeFolders.add'),
					folders: this.plugin.settings.excludeTaskFolders || [],
					onChange: async (folders) => {
						this.plugin.settings.excludeTaskFolders = folders;
						await this.saveAndRefreshViews();
					},
				});
			});

			// 任务笔记文件夹路径
			addSetting(setting => {
				setting.setName(i18n.t('settings.tasks.basic.taskNotePath.name'))
					.setDesc(i18n.t('settings.tasks.basic.taskNotePath.description'))
					.addSearch(cb => {
						new FolderSuggest(this.plugin.app, cb.inputEl);
						cb.setPlaceholder('Example: Tasks')
							.setValue(this.plugin.settings.taskNotePath)
							.onChange((value) => {
								const trimmed = value.trim().replace(/\/$/, '');
								this.plugin.settings.taskNotePath = trimmed;
								void this.saveAndRefreshViews();
							});
					});
			});
		});

		// ===== 任务创建 =====
		this.createSettingGroup(i18n.t('settings.tasks.creation.groupTitle'), (group) => {
			const addSetting = (cb: (setting: Setting) => void) => {
				group.addSetting(cb);
			};

			// 新任务所在标题
			addSetting(setting => {
				setting.setName(i18n.t('settings.tasks.creation.newTaskHeading.name'))
					.setDesc(i18n.t('settings.tasks.creation.newTaskHeading.description'))
					.addText(text => text
						.setPlaceholder(i18n.t('settings.tasks.creation.newTaskHeading.placeholder'))
						.setValue(this.plugin.settings.newTaskHeading || '')
						.onChange((value) => {
							this.plugin.settings.newTaskHeading = value || undefined;
							void this.saveAndRefreshViews();
						}));
			});

			// 默认任务优先级
			addSetting(setting => {
				setting.setName(i18n.t('settings.tasks.creation.defaultPriority.name'))
					.setDesc(i18n.t('settings.tasks.creation.defaultPriority.description'))
					.addDropdown(drop => drop
						.addOptions({
							'highest': i18n.t('settings.tasks.creation.defaultPriority.options.highest'),
							'high': i18n.t('settings.tasks.creation.defaultPriority.options.high'),
							'medium': i18n.t('settings.tasks.creation.defaultPriority.options.medium'),
							'low': i18n.t('settings.tasks.creation.defaultPriority.options.low'),
							'lowest': i18n.t('settings.tasks.creation.defaultPriority.options.lowest'),
							'normal': i18n.t('settings.tasks.creation.defaultPriority.options.normal'),
						})
						.setValue(this.plugin.settings.defaultTaskPriority || 'medium')
						.onChange((value) => {
							this.plugin.settings.defaultTaskPriority = value as 'highest' | 'high' | 'medium' | 'low' | 'lowest' | 'normal';
							void this.saveAndRefreshViews();
						}));
			});

			// 周期任务实例显示数量
			addSetting(setting => {
				setting.setName(i18n.t('settings.tasks.creation.recurringLimit.name'))
					.setDesc(i18n.t('settings.tasks.creation.recurringLimit.description'))
					.addText(text => text
						.setPlaceholder('5')
						.setValue(String(this.plugin.settings.recurringTaskDisplayLimit ?? 5))
						.onChange((value) => {
							const num = parseInt(value);
							if (!isNaN(num) && num >= 0) {
								this.plugin.settings.recurringTaskDisplayLimit = num;
								void this.saveAndRefreshViews();
							}
						}));
			});
		});
	}
}
