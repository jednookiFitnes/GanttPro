import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type JSX,
	type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { App, TFolder } from 'obsidian';
import { AnimatePresence, motion } from 'motion/react';
import { ProjectSelectorClasses } from '../../utils/bem';
import { Icon } from './Icon';
import { getAvailableProjectFolders } from '../../tasks/taskProjectMover';
import { MOTION, panelVariants, easeOutTransition } from '../motion';
import { isPolishLanguage, isChineseLanguage } from '../../i18n/i18n';

export interface ProjectSelectorPopoverProps {
	app: App;
	projectsFolderPath?: string;
	currentFolderPath?: string;
	anchorRect: DOMRect | null;
	open: boolean;
	onClose: () => void;
	onSelect: (folder: TFolder) => void;
}

/**
 * Pływający popover z wyszukiwarką projektów dla pigułki na karcie zadania (TaskCard)
 */
export function ProjectSelectorPopover({
	app,
	projectsFolderPath,
	currentFolderPath,
	anchorRect,
	open,
	onClose,
	onSelect,
}: ProjectSelectorPopoverProps): JSX.Element | null {
	const [searchQuery, setSearchQuery] = useState('');
	const inputRef = useRef<HTMLInputElement | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);

	const allFolders = useMemo(() => {
		if (!open) return [];
		return getAvailableProjectFolders(app, projectsFolderPath);
	}, [app, projectsFolderPath, open]);

	const filteredFolders = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return allFolders;
		return allFolders.filter((f) => f.name.toLowerCase().includes(q));
	}, [allFolders, searchQuery]);

	// Auto focus po otwarciu
	useEffect(() => {
		if (open) {
			setSearchQuery('');
			const timer = window.setTimeout(() => {
				inputRef.current?.focus();
			}, 30);
			return () => window.clearTimeout(timer);
		}
	}, [open]);

	// Zamknięcie po kliknięciu poza lub Escape
	useEffect(() => {
		if (!open) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				onClose();
			}
		};
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				onClose();
			}
		};

		const t = window.setTimeout(() => {
			document.addEventListener('click', handleClickOutside);
			document.addEventListener('keydown', handleKeyDown);
		}, 0);

		return () => {
			window.clearTimeout(t);
			document.removeEventListener('click', handleClickOutside);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [open, onClose]);

	if (!open || !anchorRect) return null;

	const style: CSSProperties = {
		position: 'fixed',
		top: Math.min(anchorRect.bottom + 6, window.innerHeight - 320),
		left: Math.max(Math.min(anchorRect.left, window.innerWidth - 300), 10),
		zIndex: 99999,
		width: 290,
	};

	const normCurrent = currentFolderPath ? currentFolderPath.replace(/\\/g, '/').toLowerCase() : '';

	return createPortal(
		<AnimatePresence>
			<motion.div
				ref={containerRef}
				className={ProjectSelectorClasses.container}
				style={style}
				variants={panelVariants}
				initial="initial"
				animate="animate"
				exit="exit"
				transition={easeOutTransition(MOTION.dur.fast)}
				onClick={(e) => e.stopPropagation()}
			>
				<div className={ProjectSelectorClasses.header}>
					<div className="gc-project-selector__search-wrapper">
						<Icon icon="search" className="gc-project-selector__search-icon" />
						<input
							ref={inputRef}
							type="text"
							className={ProjectSelectorClasses.searchInput}
							placeholder={isPolishLanguage() ? 'Szukaj projektu...' : (isChineseLanguage() ? '搜索项目...' : 'Search project...')}
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && filteredFolders.length > 0) {
									e.preventDefault();
									onSelect(filteredFolders[0]);
									onClose();
								}
							}}
						/>
						{searchQuery ? (
							<button
								type="button"
								className="gc-project-selector__clear-btn"
								onClick={() => setSearchQuery('')}
							>
								×
							</button>
						) : null}
					</div>
				</div>

				<div className={ProjectSelectorClasses.list}>
					{filteredFolders.length === 0 ? (
						<div className={ProjectSelectorClasses.empty}>
							{isPolishLanguage() ? 'Nie znaleziono projektów' : (isChineseLanguage() ? '未找到项目' : 'No projects found')}
						</div>
					) : (
						filteredFolders.map((folder) => {
							const normFolder = folder.path.replace(/\\/g, '/').toLowerCase();
							const isCurrent = normCurrent.length > 0 && normCurrent.startsWith(normFolder);
							return (
								<button
									key={folder.path}
									type="button"
									className={`${ProjectSelectorClasses.item}${isCurrent ? ` ${ProjectSelectorClasses.itemSelected}` : ''}`}
									onClick={() => {
										onSelect(folder);
										onClose();
									}}
								>
									<span className={ProjectSelectorClasses.itemIcon}>📁</span>
									<span className={ProjectSelectorClasses.itemName} title={folder.name}>
										{folder.name}
									</span>
									{isCurrent ? (
										<Icon icon="check" className={ProjectSelectorClasses.itemCheck} />
									) : null}
								</button>
							);
						})
					)}
				</div>
			</motion.div>
		</AnimatePresence>,
		document.body
	);
}

export interface ProjectSelectorFormFieldProps {
	app: App;
	projectsFolderPath?: string;
	selectedFolder: TFolder | null;
	onSelect: (folder: TFolder | null) => void;
}

/**
 * Komponent wyboru projektu dla formularza Create New Task
 */
export function ProjectSelectorFormField({
	app,
	projectsFolderPath,
	selectedFolder,
	onSelect,
}: ProjectSelectorFormFieldProps): JSX.Element {
	const [isOpen, setIsOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const dropdownRef = useRef<HTMLDivElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const allFolders = useMemo(() => {
		return getAvailableProjectFolders(app, projectsFolderPath);
	}, [app, projectsFolderPath]);

	const filteredFolders = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return allFolders;
		return allFolders.filter((f) => f.name.toLowerCase().includes(q));
	}, [allFolders, searchQuery]);

	const toggleOpen = useCallback((e: ReactMouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsOpen((prev) => !prev);
	}, []);

	useEffect(() => {
		if (isOpen) {
			setSearchQuery('');
			const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
			return () => window.clearTimeout(timer);
		}
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (
				dropdownRef.current &&
				!dropdownRef.current.contains(e.target as Node) &&
				triggerRef.current &&
				!triggerRef.current.contains(e.target as Node)
			) {
				setIsOpen(false);
			}
		};
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				setIsOpen(false);
			}
		};
		document.addEventListener('click', handleClickOutside);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('click', handleClickOutside);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [isOpen]);

	return (
		<div className="gc-project-form-field" style={{ position: 'relative', width: '100%' }}>
			<button
				ref={triggerRef}
				type="button"
				className={`gc-project-form-field__trigger${selectedFolder ? ' gc-project-form-field__trigger--has-value' : ''}`}
				onClick={toggleOpen}
			>
				<span className="gc-project-form-field__trigger-icon">📁</span>
				<span className="gc-project-form-field__trigger-text">
					{selectedFolder
						? selectedFolder.name
						: (isPolishLanguage() ? 'Brak projektu (Daily Note)' : (isChineseLanguage() ? '无项目 (Daily Note)' : 'No project (Daily Note)'))}
				</span>
				<Icon icon="chevron-down" className="gc-project-form-field__trigger-arrow" />
			</button>

			{isOpen ? (
				<div
					ref={dropdownRef}
					className="gc-project-form-field__dropdown"
					onClick={(e) => e.stopPropagation()}
				>
					<div className="gc-project-selector__search-wrapper" style={{ padding: '6px 8px' }}>
						<Icon icon="search" className="gc-project-selector__search-icon" />
						<input
							ref={inputRef}
							type="text"
							className={ProjectSelectorClasses.searchInput}
							placeholder={isPolishLanguage() ? 'Szukaj projektu...' : (isChineseLanguage() ? '搜索项目...' : 'Search project...')}
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									if (filteredFolders.length > 0) {
										onSelect(filteredFolders[0]);
										setIsOpen(false);
									}
								}
							}}
						/>
					</div>

					<div className={ProjectSelectorClasses.list} style={{ maxHeight: '180px' }}>
						{/* Opcja brak projektu */}
						<button
							type="button"
							className={`${ProjectSelectorClasses.item}${!selectedFolder ? ` ${ProjectSelectorClasses.itemSelected}` : ''}`}
							onClick={() => {
								onSelect(null);
								setIsOpen(false);
							}}
						>
							<span className={ProjectSelectorClasses.itemIcon}>📝</span>
							<span className={ProjectSelectorClasses.itemName}>
								{isPolishLanguage() ? 'Brak projektu (Daily Note)' : (isChineseLanguage() ? '无项目 (Daily Note)' : 'No project (Daily Note)')}
							</span>
							{!selectedFolder ? (
								<Icon icon="check" className={ProjectSelectorClasses.itemCheck} />
							) : null}
						</button>

						{filteredFolders.map((folder) => {
							const isSelected = selectedFolder?.path === folder.path;
							return (
								<button
									key={folder.path}
									type="button"
									className={`${ProjectSelectorClasses.item}${isSelected ? ` ${ProjectSelectorClasses.itemSelected}` : ''}`}
									onClick={() => {
										onSelect(folder);
										setIsOpen(false);
									}}
								>
									<span className={ProjectSelectorClasses.itemIcon}>📁</span>
									<span className={ProjectSelectorClasses.itemName} title={folder.name}>
										{folder.name}
									</span>
									{isSelected ? (
										<Icon icon="check" className={ProjectSelectorClasses.itemCheck} />
									) : null}
								</button>
							);
						})}

						{filteredFolders.length === 0 && searchQuery ? (
							<div className={ProjectSelectorClasses.empty}>
								{isPolishLanguage() ? 'Nie znaleziono projektów' : (isChineseLanguage() ? '未找到项目' : 'No projects found')}
							</div>
						) : null}
					</div>
				</div>
			) : null}
		</div>
	);
}
