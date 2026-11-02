import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
	type JSX,
	type ReactElement,
	type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ModalClasses } from '../../utils/bem';

export interface ModalProviderContextValue {
	/** 命令式打开一个 React 模态框元素，返回关闭函数 */
	openModal: (element: ReactElement) => () => void;
}

const ModalProviderContext = createContext<ModalProviderContextValue | null>(null);

export function useModal(): ModalProviderContextValue {
	const ctx = useContext(ModalProviderContext);
	if (!ctx) throw new Error('useModal must be used within ModalProvider');
	return ctx;
}

/**
 * 命令式模态框宿主：允许在任何地方（组件/事件处理器）打开 React 模态框
 * 所有打开的模态框渲染在同一个 body portal 容器内
 */
export function ModalProvider({ children }: { children: ReactNode }): JSX.Element {
	const [modals, setModals] = useState<Array<{ id: number; element: ReactElement }>>([]);

	const openModal = useCallback((element: ReactElement) => {
		const id = Date.now() + Math.random();
		setModals((prev) => [...prev, { id, element }]);
		return () => {
			setModals((prev) => prev.filter((m) => m.id !== id));
		};
	}, []);

	const value = useMemo(() => ({ openModal }), [openModal]);

	return (
		<ModalProviderContext.Provider value={value}>
			{children}
			{createPortal(
				<div className={ModalClasses.host}>
					{modals.map((m) => (
						<div key={m.id} className={ModalClasses.entry}>
							{m.element}
						</div>
					))}
				</div>,
				document.body
			)}
		</ModalProviderContext.Provider>
	);
}