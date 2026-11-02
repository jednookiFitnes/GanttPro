import { useCallback, useRef, type DragEvent as ReactDragEvent } from 'react';
import { setCssProps } from '../../utils/bem';

/**
 * HTML5 拖放（DnD）的 React 封装
 * 统一管理 drag data、拖拽视觉反馈与放置高亮状态
 */

export interface DragSourceOptions {
	/** 拖拽时携带的任务标识（格式 filePath:lineNumber） */
	taskId: string;
	/** 是否启用拖拽 */
	enabled?: boolean;
	/** 拖拽开始回调 */
	onDragStart?: () => void;
	/** 拖拽结束回调（无论是否成功放置） */
	onDragEnd?: () => void;
}

export interface DragSourceProps {
	draggable: boolean;
	'data-task-id': string | undefined;
	onDragStart: (e: ReactDragEvent<HTMLElement>) => void;
	onDragEnd: (e: ReactDragEvent<HTMLElement>) => void;
}

export function useDragSource(options: DragSourceOptions): DragSourceProps {
	const { taskId, enabled = true, onDragStart, onDragEnd } = options;
	const onDragStartRef = useRef(onDragStart);
	const onDragEndRef = useRef(onDragEnd);
	onDragStartRef.current = onDragStart;
	onDragEndRef.current = onDragEnd;

	const handleDragStart = useCallback((e: ReactDragEvent<HTMLElement>) => {
		if (!enabled) return;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('taskId', taskId);
		setCssProps(e.currentTarget, { opacity: '0.6' });
		onDragStartRef.current?.();
	}, [taskId, enabled]);

	const handleDragEnd = useCallback((e: ReactDragEvent<HTMLElement>) => {
		setCssProps(e.currentTarget, { opacity: '1' });
		onDragEndRef.current?.();
	}, []);

	return {
		draggable: enabled,
		'data-task-id': enabled ? taskId : undefined,
		onDragStart: handleDragStart,
		onDragEnd: handleDragEnd,
	};
}

export interface DropTargetOptions {
	/** 放置回调：接收拖拽的任务标识 */
	onDrop: (taskId: string, e: ReactDragEvent<HTMLElement>) => void;
	/** 高亮 class（拖动经过时添加） */
	activeClass?: string;
}

export interface DropTargetProps {
	onDragOver: (e: ReactDragEvent<HTMLElement>) => void;
	onDragLeave: (e: ReactDragEvent<HTMLElement>) => void;
	onDrop: (e: ReactDragEvent<HTMLElement>) => void;
}

/**
 * 放置目标 hook：自动管理 dragover 高亮（同类目标间互斥）
 */
export function useDropTarget(options: DropTargetOptions): DropTargetProps {
	const { onDrop, activeClass } = options;
	const onDropRef = useRef(onDrop);
	const activeClassRef = useRef(activeClass);
	onDropRef.current = onDrop;
	activeClassRef.current = activeClass;
	const currentRef = useRef<HTMLElement | null>(null);

	const handleDragOver = useCallback((e: ReactDragEvent<HTMLElement>) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		const el = e.currentTarget;
		if (currentRef.current !== el) {
			if (currentRef.current && activeClassRef.current) {
				currentRef.current.classList.remove(activeClassRef.current);
			}
			if (activeClassRef.current) el.classList.add(activeClassRef.current);
			currentRef.current = el;
		}
	}, []);

	const handleDragLeave = useCallback((e: ReactDragEvent<HTMLElement>) => {
		const el = e.currentTarget;
		const related = e.relatedTarget as HTMLElement | null;
		if (related && el.contains(related)) return;
		if (currentRef.current === el) {
			if (activeClassRef.current) el.classList.remove(activeClassRef.current);
			currentRef.current = null;
		}
	}, []);

	const handleDrop = useCallback((e: ReactDragEvent<HTMLElement>) => {
		e.preventDefault();
		const el = e.currentTarget;
		if (currentRef.current === el && activeClassRef.current) {
			el.classList.remove(activeClassRef.current);
		}
		currentRef.current = null;
		const taskId = e.dataTransfer?.getData('taskId') || '';
		onDropRef.current(taskId, e);
	}, []);

	return {
		onDragOver: handleDragOver,
		onDragLeave: handleDragLeave,
		onDrop: handleDrop,
	};
}