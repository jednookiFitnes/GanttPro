import { Setting } from 'obsidian';
import { BaseBuilder } from './BaseBuilder';
import type { BuilderConfig, DateFieldType } from '../types';
import { i18n } from '../../i18n/i18n';

/**
 * 甘特图构建器
 */
export class GanttViewSettingsBuilder extends BaseBuilder {
	constructor(config: BuilderConfig) {
		super(config);
	}

	render(): void {
		this.createSettingGroup(i18n.t('settings.ganttView.groupTitle'), (group) => {
			const addSetting = (cb: (setting: Setting) => void) => {
				group.addSetting(cb);
			};

			// 起始字段
			addSetting(setting => {
				setting.setName(i18n.t('settings.ganttView.startField.name'))
					.setDesc(i18n.t('settings.ganttView.startField.description'))
					.addDropdown(drop => drop
						.addOptions({
						'createdDate': i18n.t('settings.ganttView.dateFieldOptions.createdDate'),
						'startDate': i18n.t('settings.ganttView.dateFieldOptions.startDate'),
						'scheduledDate': i18n.t('settings.ganttView.dateFieldOptions.scheduledDate'),
						'dueDate': i18n.t('settings.ganttView.dateFieldOptions.dueDate'),
						'completionDate': i18n.t('settings.ganttView.dateFieldOptions.completionDate'),
						'cancelledDate': i18n.t('settings.ganttView.dateFieldOptions.cancelledDate'),
						})
						.setValue(this.plugin.settings.ganttStartField)
						.onChange((value) => {
							void (async () => {
								this.plugin.settings.ganttStartField = value as DateFieldType;
								await this.saveAndRefreshViews();
							})();
						}));
			});

			// 结束字段
			addSetting(setting => {
				setting.setName(i18n.t('settings.ganttView.endField.name'))
					.setDesc(i18n.t('settings.ganttView.endField.description'))
					.addDropdown(drop => drop
						.addOptions({
						'createdDate': i18n.t('settings.ganttView.dateFieldOptions.createdDate'),
						'startDate': i18n.t('settings.ganttView.dateFieldOptions.startDate'),
						'scheduledDate': i18n.t('settings.ganttView.dateFieldOptions.scheduledDate'),
						'dueDate': i18n.t('settings.ganttView.dateFieldOptions.dueDate'),
						'completionDate': i18n.t('settings.ganttView.dateFieldOptions.completionDate'),
						'cancelledDate': i18n.t('settings.ganttView.dateFieldOptions.cancelledDate'),
						})
						.setValue(this.plugin.settings.ganttEndField)
						.onChange((value) => {
							void (async () => {
								this.plugin.settings.ganttEndField = value as DateFieldType;
								await this.saveAndRefreshViews();
							})();
						}));
			});

			// Wyróżnianie urlopów
			addSetting(setting => {
				setting.setName('Wyróżniaj urlopy z Timekeep')
					.setDesc('Zaznaczaj dni urlopowe na osi czasu wykresu Gantta w dedykowanym kolorze (np. pomarańczowym)')
					.addToggle(toggle => toggle
						.setValue(this.plugin.settings.vacationHighlightEnabled)
						.onChange(async (value) => {
							this.plugin.settings.vacationHighlightEnabled = value;
							await this.plugin.saveSettings();
							if ((this.plugin as any).vacationService) {
								await (this.plugin as any).vacationService.loadVacations();
							}
							this.plugin.refreshCalendarViews();
						}));
			});

			// Projekt urlopowy
			addSetting(setting => {
				setting.setName('Projekt Timekeep dla urlopów')
					.setDesc('Nazwa projektu w Timekeep traktowanego jako nieobecność/urlop (np. 99-001 - NIEOBECNOŚCI)')
					.addText(text => text
						.setPlaceholder('99-001 - NIEOBECNOŚCI')
						.setValue(this.plugin.settings.vacationTimekeepProject)
						.onChange(async (value) => {
							this.plugin.settings.vacationTimekeepProject = value;
							await this.plugin.saveSettings();
							if ((this.plugin as any).vacationService) {
								await (this.plugin as any).vacationService.loadVacations();
							}
							this.plugin.refreshCalendarViews();
						}));
			});

			// Typy działań urlopowych
			addSetting(setting => {
				setting.setName('Typy działań urlopowych')
					.setDesc('Typy działań w Timekeep uznawane za urlop/dzień wolny (rozdzielane przecinkami, np. U_W - urlop wypoczynkowy, U_NG - odbiór nadgodzin)')
					.addText(text => text
						.setPlaceholder('U_W - urlop wypoczynkowy')
						.setValue(this.plugin.settings.vacationTimekeepTypes)
						.onChange(async (value) => {
							this.plugin.settings.vacationTimekeepTypes = value;
							await this.plugin.saveSettings();
							if ((this.plugin as any).vacationService) {
								await (this.plugin as any).vacationService.loadVacations();
							}
							this.plugin.refreshCalendarViews();
						}));
			});

			// Kolor wyróżnienia urlopów
			addSetting(setting => {
				setting.setName('Kolor wyróżnienia urlopów')
					.setDesc('Kolor akcentu dla kolumn i nagłówków dni urlopowych na wykresie Gantta')
					.addColorPicker(cp => cp
						.setValue(this.plugin.settings.vacationHighlightColor || '#f97316')
						.onChange(async (value) => {
							this.plugin.settings.vacationHighlightColor = value;
							await this.plugin.saveSettings();
							this.plugin.refreshCalendarViews();
						}));
			});
		});
	}
}
