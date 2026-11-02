import { Component, type ReactNode, type JSX } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useCalendarStore } from './store/calendarStore';
import { ToolbarBar } from './components/Toolbar';
import { TooltipProvider } from './components/TooltipProvider';
import { ModalProvider } from './components/ModalProvider';
import { YearView } from './views/YearView';
import { MonthView } from './views/MonthView';
import { WeekView } from './views/WeekView';
import { DayView } from './views/DayView';
import { TaskView } from './views/TaskView';
import { GanttView } from './views/GanttView';
import type { CalendarViewType } from '../types';
import { MOTION, easeOutTransition } from './motion';
import { useEffect } from 'react';
import { isPhoneNow } from './utils/platform';

interface ErrorBoundaryProps {
	children: ReactNode;
	viewKey?: string;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

class ViewErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, info: unknown) {
		console.error('[GanttCalendar ViewErrorBoundary]', error, info);
	}

	componentDidUpdate(prevProps: ErrorBoundaryProps) {
		if (prevProps.viewKey !== this.props.viewKey && this.state.hasError) {
			this.setState({ hasError: false, error: null });
		}
	}

	render() {
		if (this.state.hasError) {
			return (
				<div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-error, #f87171)' }}>
					<h3 style={{ margin: '0 0 8px 0', fontSize: '16px' }}>Wystąpił błąd podczas ładowania widoku</h3>
					<p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 0 16px 0' }}>
						{this.state.error?.message || 'Nieznany błąd renderowania'}
					</p>
					<button
						type="button"
						style={{
							padding: '6px 14px',
							borderRadius: '4px',
							border: '1px solid var(--background-modifier-border)',
							background: 'var(--interactive-accent)',
							color: 'var(--text-on-accent, #ffffff)',
							cursor: 'pointer',
							fontSize: '13px',
						}}
						onClick={() => this.setState({ hasError: false, error: null })}
					>
						Spróbuj ponownie
					</button>
				</div>
			);
		}
		return this.props.children;
	}
}

function renderView(viewType: CalendarViewType): JSX.Element {
	switch (viewType) {
		case 'year':
			return <YearView />;
		case 'month':
			return <MonthView />;
		case 'week':
			return <WeekView />;
		case 'day':
			return <DayView />;
		case 'task':
			return <TaskView />;
		case 'gantt':
			return <GanttView />;
	}
}

/**
 * React 应用根组件
 * 结构：.gantt-calendar-app > (.calendar-toolbar + .calendar-content)
 */
export function App(): JSX.Element {
	// 视图形态类手机样式信号（CSS 用 body.gc-is-phone 作用域，桌面窄窗口不触发）
	useEffect(() => {
		document.body.classList.toggle('gc-is-phone', isPhoneNow());
		return () => document.body.classList.remove('gc-is-phone');
	}, []);

	const viewType = useCalendarStore((s) => s.viewType);
	const settingsVersion = useCalendarStore((s) => s.settingsVersion);

	const isGantt = viewType === 'gantt';
	const isWaterfall = viewType === 'day' || viewType === 'week' || viewType === 'task' || viewType === 'year';

	return (
		<ModalProvider>
			<TooltipProvider>
				<div
					className={`gantt-calendar-app${isGantt ? ' gantt-root' : ''}`}
					style={{ overflow: isWaterfall ? 'auto' : undefined, height: '100%' }}
				>
					<ToolbarBar />
					<AnimatePresence mode="wait" initial={false}>
						{!isGantt ? (
							<motion.div
								key={`${viewType}-${settingsVersion}`}
								className={`calendar-content${isGantt ? ' gantt-mode' : ''}`}
								style={{ overflow: isWaterfall ? 'visible' : undefined }}
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								transition={easeOutTransition(MOTION.dur.normal)}
							>
								<ViewErrorBoundary viewKey={`${viewType}-${settingsVersion}`}>
									{renderView(viewType)}
								</ViewErrorBoundary>
							</motion.div>
						) : (
							<div
								key={`gantt-${settingsVersion}`}
								className="calendar-content gantt-mode"
							>
								<ViewErrorBoundary viewKey={`gantt-${settingsVersion}`}>
									<GanttView />
								</ViewErrorBoundary>
							</div>
						)}
					</AnimatePresence>
				</div>
			</TooltipProvider>
		</ModalProvider>
	);
}
