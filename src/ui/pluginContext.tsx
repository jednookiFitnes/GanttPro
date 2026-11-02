import { createContext, useContext } from 'react';
import type { IPluginContext } from '../types';

/**
 * React 上下文：向所有 UI 组件提供插件上下文（settings / app / taskCache）
 */
export const PluginContext = createContext<IPluginContext | null>(null);

export function usePlugin(): IPluginContext {
	const ctx = useContext(PluginContext);
	if (!ctx) {
		throw new Error('usePlugin must be used within PluginProvider');
	}
	return ctx;
}

export function useApp(): IPluginContext['app'] {
	return usePlugin().app;
}