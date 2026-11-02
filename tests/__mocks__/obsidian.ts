// Minimal mock for Obsidian module used in tests
export class App {}
export class TFile {
	path = "";
}
export class Plugin {}
export class MarkdownRenderer {
	static render(_app: App, _markdown: string, _el: HTMLElement, _path: string): void {}
}
export class Modal {
	app: App;
	contentEl: HTMLElement = (typeof document !== 'undefined') ? document.createElement('div') : ({} as HTMLElement);
	constructor(app?: App) { this.app = app || (new App()); }
	open(): void {}
	close(): void {}
}
export class Setting {
	constructor(_el?: HTMLElement) {}
	setName(_name: string): this { return this; }
	setDesc(_desc: string): this { return this; }
	addText(_cb: unknown): this { return this; }
	addButton(_cb: unknown): this { return this; }
}
export class Notice {
	constructor(_msg: string) {}
}
export class Menu {
	addItem(_cb: unknown): this { return this; }
}
export function setIcon(_el: HTMLElement, _icon: string): void {}
export function getLanguage(): string { return 'en'; }
export function normalizePath(path: string): string {
	return path ? path.replace(/\\/g, '/').replace(/\/+/g, '/') : '';
}

