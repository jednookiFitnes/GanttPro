import { App, Setting, setIcon } from 'obsidian';
import { FolderSuggest } from './FolderSuggest';
import { SettingsFolderListClasses, setCssProps } from '../../utils/bem';
import { normalizeFolderPath } from '../../utils/folderFilter';

export interface FolderListSettingOptions {
	containerEl?: HTMLElement;
	setting?: Setting;
	app: App;
	name: string;
	description: string;
	placeholder: string;
	emptyHint: string;
	addButtonText: string;
	folders: string[];
	onChange: (folders: string[]) => void | Promise<void>;
}

/**
 * Komponent listy folderów z autouzupełnianiem FolderSuggest, przyciskiem dodawania
 * oraz usuwalnymi pigułkami (tags/chips).
 */
export class FolderListSetting {
	private options: FolderListSettingOptions;
	private setting: Setting;
	private tagsContainer: HTMLElement;
	private emptyHintEl: HTMLElement;
	private inputEl: HTMLInputElement;

	constructor(options: FolderListSettingOptions) {
		this.options = options;
		this.render();
	}

	private render(): void {
		const cls = SettingsFolderListClasses.elements;

		if (this.options.setting) {
			this.setting = this.options.setting
				.setName(this.options.name)
				.setDesc(this.options.description);
		} else if (this.options.containerEl) {
			this.setting = new Setting(this.options.containerEl)
				.setName(this.options.name)
				.setDesc(this.options.description);
		} else {
			throw new Error('FolderListSetting requires either containerEl or setting option');
		}

		// Ustawienie pionowego układu dla pełnej szerokości listy i selektora
		setCssProps(this.setting.settingEl, { flexDirection: 'column', alignItems: 'stretch' });
		setCssProps(this.setting.controlEl, { width: '100%', marginTop: '8px' });

		const control = this.setting.controlEl;
		control.empty();

		const rootContainer = control.createDiv({ cls: cls.container });
		const inputRow = rootContainer.createDiv({ cls: cls.inputRow });

		// Pole wyszukiwania folderu z podpowiedziami FolderSuggest
		this.inputEl = inputRow.createEl('input', {
			type: 'search',
			placeholder: this.options.placeholder,
		});
		setCssProps(this.inputEl, { flex: '1', minWidth: '0' });
		new FolderSuggest(this.options.app, this.inputEl);

		const handleAdd = () => {
			const rawVal = this.inputEl.value;
			const normalized = normalizeFolderPath(rawVal);
			if (!normalized) return;

			// Sprawdź czy folder już istnieje na liście
			const existingIndex = this.options.folders.findIndex(
				f => normalizeFolderPath(f).toLowerCase() === normalized.toLowerCase()
			);
			if (existingIndex !== -1) {
				this.inputEl.value = '';
				return;
			}

			const nextFolders = [...this.options.folders, normalized];
			this.options.folders = nextFolders;
			this.inputEl.value = '';
			this.renderTags();
			void this.options.onChange(nextFolders);
		};

		this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				handleAdd();
			}
		});

		// Przycisk dodawania
		const addBtn = inputRow.createEl('button', {
			text: this.options.addButtonText,
			cls: 'mod-cta',
		});
		addBtn.type = 'button';
		addBtn.addEventListener('click', () => {
			handleAdd();
		});

		// Kontener etykiet i podpowiedź pustego stanu
		this.tagsContainer = rootContainer.createDiv({ cls: cls.tagList });
		this.emptyHintEl = rootContainer.createDiv({
			cls: cls.emptyHint,
			text: this.options.emptyHint,
		});

		this.renderTags();
	}

	private renderTags(): void {
		const cls = SettingsFolderListClasses.elements;
		this.tagsContainer.empty();

		if (!this.options.folders || this.options.folders.length === 0) {
			setCssProps(this.emptyHintEl, { display: 'block' });
			return;
		}

		setCssProps(this.emptyHintEl, { display: 'none' });

		for (const folder of this.options.folders) {
			const tagEl = this.tagsContainer.createDiv({ cls: cls.tag });

			const iconEl = tagEl.createSpan({ cls: cls.tagIcon });
			setIcon(iconEl, 'folder');

			tagEl.createSpan({ cls: cls.tagName, text: folder });

			const removeBtn = tagEl.createSpan({
				cls: cls.tagRemove,
				text: '×',
			});
			removeBtn.setAttribute('aria-label', `Remove ${folder}`);
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const nextFolders = this.options.folders.filter(f => f !== folder);
				this.options.folders = nextFolders;
				this.renderTags();
				void this.options.onChange(nextFolders);
			});
		}
	}
}
