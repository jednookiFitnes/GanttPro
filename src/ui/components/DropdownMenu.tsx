import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type JSX,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { DropdownMenuClasses } from '../../utils/bem';
import { isPolishLanguage, isChineseLanguage } from '../../i18n/i18n';
import { Icon } from './Icon';
import { MOTION, panelVariants, easeOutTransition } from '../motion';

export { DropdownMenuClasses } from '../../utils/bem';

export interface MenuItemDef {
	key: string;
	title: ReactNode;
	checked?: boolean;
	disabled?: boolean;
	icon?: string;
	/** 点击后是否关闭菜单（多选场景设为 true，默认 false） */
	keepOpen?: boolean;
	onClick?: () => void;
}

export interface DropdownMenuSection {
	items: MenuItemDef[];
}

export interface DropdownMenuProps {
	/** 触发器渲染函数：接收 open 开关事件与 aria 属性 */
	children: (props: { onClick: (e: ReactMouseEvent) => void; 'aria-expanded': boolean }) => ReactNode;
	/** 菜单内容：数组内每项为一段，段之间显示分隔线（与 content 二选一） */
	sections?: DropdownMenuSection[];
	/** 自定义菜单内容渲染（优先级高于 sections，如树形结构） */
	content?: (close: () => void) => ReactNode;
	header?: ReactNode;
	/** 打开前回调（可用于动态计算 sections） */
	onOpen?: () => void;
	onClose?: () => void;
	className?: string;
	/** 菜单面板对齐方向 */
	align?: 'left' | 'right';
	/** 覆盖菜单面板内联样式（如宽度） */
	panelStyle?: CSSProperties;
}

/**
 * 声明式下拉菜单：替换 Obsidian 原生 new Menu()
 * 通过 portal 渲染到 body，点击外部 / Escape 关闭
 */
export function DropdownMenu({
	children,
	sections = [],
	content,
	header,
	onOpen,
	onClose,
	className,
	align = 'right',
	panelStyle,
}: DropdownMenuProps): JSX.Element {
	const [open, setOpen] = useState(false);
	const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);

	const openMenu = useCallback((e: ReactMouseEvent) => {
		e.stopPropagation();
		e.preventDefault();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		setAnchorRect(rect);
		onOpen?.();
		setOpen(true);
	}, [onOpen]);

	const closeMenu = useCallback(() => {
		setOpen(false);
		setAnchorRect(null);
		onClose?.();
	}, [onClose]);

	useEffect(() => {
		if (!open) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				closeMenu();
			}
		};
		const handleKeydown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') closeMenu();
		};
		// 延迟注册，避免触发自身的冒泡事件
		const t = window.setTimeout(() => {
			document.addEventListener('click', handleClickOutside);
			document.addEventListener('keydown', handleKeydown);
		}, 0);
		return () => {
			window.clearTimeout(t);
			document.removeEventListener('click', handleClickOutside);
			document.removeEventListener('keydown', handleKeydown);
		};
	}, [open, closeMenu]);

	const allItems = sections.flatMap((s) => s.items);

	const style: CSSProperties | undefined = anchorRect
		? {
				position: 'fixed',
				top: Math.min(anchorRect.bottom + 4, window.innerHeight - 10),
				left: align === 'right' ? Math.max(anchorRect.right - 200, 8) : anchorRect.left,
				...panelStyle,
			}
		: undefined;

	return (
		<div className={className}>
			{children({ onClick: openMenu, 'aria-expanded': open })}
			{createPortal(
				<AnimatePresence>
					{open && anchorRect ? (
						<motion.div
							key="dropdown-menu"
							ref={menuRef}
							className={DropdownMenuClasses.container}
							style={style}
							variants={panelVariants}
							initial="initial"
							animate="animate"
							exit="exit"
							transition={easeOutTransition(MOTION.dur.fast)}
						>
							{header ? <div className={DropdownMenuClasses.header}>{header}</div> : null}
							{content ? (
								content(closeMenu)
							) : (
								<>
									{allItems.length === 0 ? (
										<div className={DropdownMenuClasses.empty}>{isPolishLanguage() ? 'Brak opcji' : (isChineseLanguage() ? '无选项' : 'No options')}</div>
									) : (
										sections.map((section, si) => (
											<div key={si} className={DropdownMenuClasses.section}>
												{section.items.map((item) => (
													<button
														key={item.key}
														className={`${DropdownMenuClasses.item}${item.checked ? ` ${DropdownMenuClasses.itemChecked}` : ''}${item.disabled ? ` ${DropdownMenuClasses.itemDisabled}` : ''}`}
														disabled={item.disabled}
														onClick={() => {
															if (item.disabled) return;
															item.onClick?.();
															if (!item.keepOpen) closeMenu();
														}}
													>
														{item.icon ? <Icon icon={item.icon} className={DropdownMenuClasses.itemIcon} /> : null}
														<span className={DropdownMenuClasses.itemLabel}>{item.title}</span>
														{item.checked ? (
															<Icon icon="check" className={DropdownMenuClasses.itemCheck} />
														) : null}
													</button>
												))}
											</div>
										))
									)}
								</>
							)}
						</motion.div>
					) : null}
				</AnimatePresence>,
				document.body
			)}
		</div>
	);
}