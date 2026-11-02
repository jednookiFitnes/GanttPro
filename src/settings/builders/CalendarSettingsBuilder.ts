import { Setting } from 'obsidian';
import { SettingsClasses } from '../../utils/bem';
import { BaseBuilder } from './BaseBuilder';
import { FolderSuggest, FileSuggest } from '../components';
import type { BuilderConfig } from '../types';
import { getObsidianDailyNoteSettings, isObsidianDailyNoteAvailable } from '../../utils/dailyNoteSettingsBridge';
import { i18n, isPolishLanguage, isChineseLanguage } from '../../i18n/i18n';

/**
 * 日历设置构建器
 * 包含 Daily Note 相关的基础配置（文件夹路径、文件名格式、模板等）
 */
export class CalendarSettingsBuilder extends BaseBuilder {
	constructor(config: BuilderConfig) {
		super(config);
	}

	render(): void {
		this.createSettingGroup('Daily Notes', (group) => {
			const addSetting = (cb: (setting: Setting) => void) => {
				group.addSetting(cb);
			};

			// 用于包裹可切换的设置区域
			const obsidianSection = this.containerEl.createDiv();
			const manualSection = this.containerEl.createDiv();

			const updateVisibility = () => {
				obsidianSection.classList.toggle(SettingsClasses.elements.sectionHidden, !this.plugin.settings.followObsidianDailyNote);
				manualSection.classList.toggle(SettingsClasses.elements.sectionHidden, this.plugin.settings.followObsidianDailyNote);
			};

			// 使用 Obsidian 日记设置开关
			addSetting(setting => {
				setting.setName(i18n.t('settings.calendar.useObsidianDailyNote.name'))
					.setDesc(i18n.t('settings.calendar.useObsidianDailyNote.description'))
					.addToggle(toggle => toggle
						.setValue(this.plugin.settings.followObsidianDailyNote)
						.onChange((value) => {
							void (async () => {
								this.plugin.settings.followObsidianDailyNote = value;
								await this.saveAndRefreshViews();
								updateVisibility();
							})();
						}));
			});

			// === Obsidian 模式设置（只读） ===
			const available = isObsidianDailyNoteAvailable();
			if (available) {
				const obsidianSettings = getObsidianDailyNoteSettings();
				const folder = obsidianSettings.folder || (isPolishLanguage() ? '(Katalog główny)' : (isChineseLanguage() ? '(根目录)' : '(Root folder)'));
				const format = obsidianSettings.format || 'YYYY-MM-DD';
				const template = obsidianSettings.template || (isPolishLanguage() ? '(Brak)' : (isChineseLanguage() ? '(无)' : '(None)'));

				new Setting(obsidianSection)
					.setName(i18n.t('settings.calendar.obsidianMode.folder.name'))
					.setDesc(i18n.t('settings.calendar.obsidianMode.folder.description'))
					.addText(text => text.setValue(folder).setDisabled(true));

				new Setting(obsidianSection)
					.setName(i18n.t('settings.calendar.obsidianMode.format.name'))
					.setDesc(i18n.t('settings.calendar.obsidianMode.format.descriptionReadonly', { format }))
					.addText(text => text.setValue(format).setDisabled(true));

				new Setting(obsidianSection)
					.setName(i18n.t('settings.calendar.obsidianMode.template.name'))
					.setDesc(template)
					.addText(text => text.setValue(template).setDisabled(true));
			} else {
				new Setting(obsidianSection)
					.setName(i18n.t('settings.calendar.obsidianMode.notDetected.name'))
					.setDesc(i18n.t('settings.calendar.obsidianMode.notDetected.description'));
			}

			// === 手动模式设置 ===
			new Setting(manualSection)
				.setName(i18n.t('settings.calendar.manualMode.folder.name'))
				.setDesc(i18n.t('settings.calendar.manualMode.folder.description'))
				.addSearch(cb => {
					new FolderSuggest(this.plugin.app, cb.inputEl);
					cb.setPlaceholder('Example: DailyNotes')
						.setValue(this.plugin.settings.dailyNotePath)
						.onChange(async (value) => {
							const trimmed = value.trim().replace(/\/$/, '');
							this.plugin.settings.dailyNotePath = trimmed;
							await this.saveAndRefreshViews();
						});
				});

			new Setting(manualSection)
				.setName(i18n.t('settings.calendar.manualMode.format.name'))
				.setDesc(i18n.t('settings.calendar.manualMode.format.description'))
				.addText(text => text
					.setPlaceholder('Yyyy-mm-dd')
					.setValue(this.plugin.settings.dailyNoteNameFormat)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteNameFormat = value;
						await this.saveAndRefreshViews();
					}));

			new Setting(manualSection)
				.setName(i18n.t('settings.calendar.manualMode.template.name'))
				.setDesc(i18n.t('settings.calendar.manualMode.template.description'))
				.addSearch(cb => {
					new FileSuggest(this.plugin.app, cb.inputEl);
					cb.setPlaceholder('Templates/Daily Note.md')
						.setValue(this.plugin.settings.dailyNoteTemplatePath)
						.onChange(async (value) => {
							this.plugin.settings.dailyNoteTemplatePath = value.trim();
							await this.saveAndRefreshViews();
						});
				});

			// 初始显隐
			updateVisibility();
		});
	}
}
