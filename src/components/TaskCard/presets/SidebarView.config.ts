import type { TaskCardConfig } from '../TaskCardConfig';
import type { GanttCalendarSettings } from '../../../settings/types';

/**
 * 根据用户设置动态生成侧边栏 TaskCard 配置
 * （静态 SidebarViewConfig 已删除：侧边栏全部走此 builder，无预设消费者）
 */
export function buildSidebarConfig(settings: GanttCalendarSettings): TaskCardConfig {
	return {
		viewModifier: 'sidebar',
		showCheckbox: settings.sidebarShowCheckbox,
		showDescription: true,
		showTags: settings.sidebarShowTags,
		showPriority: settings.sidebarShowPriority,
		showFileLocation: settings.sidebarShowFileLocation,
		showFolder: settings.sidebarShowFolder ?? true,
		showWarning: false,
		showTicktick: settings.sidebarShowTicktick,
		showGlobalFilter: false,
		showTimes: settings.sidebarShowDueDate,
		timeFields: {
			showCreated: false,
			showStart: false,
			showScheduled: false,
			showDue: settings.sidebarShowDueDate,
			showCancelled: false,
			showCompletion: false,
			showOverdueIndicator: true,
		},
		enableTooltip: true,
		enableDrag: true,
		clickable: true,
		compact: true,
		maxLines: 2,
	};
}
