import { useState, type JSX } from 'react';
import type { App } from 'obsidian';
import type { SyncResult } from '../../data-layer/feishu-sync/FeishuTaskSync';
import { i18n, isChineseLanguage } from '../../i18n/i18n';
import { SyncResultModalClasses as C } from '../../utils/bem';
import { Modal } from '../components/Modal';
import { openReactModal } from './modalHost';

export interface SyncResultDialogProps {
	title: string;
	result: SyncResult;
	onClose: () => void;
}

/**
 * 同步结果弹窗（React）
 *
 * 展示同步操作的详细结果，包括统计摘要和每个变更任务的具体信息。
 */
export function SyncResultDialog({ title, result, onClose }: SyncResultDialogProps): JSX.Element {
	const [open, setOpen] = useState(true);

	const handleClose = () => {
		setOpen(false);
		onClose();
	};

	const stats = [
		{ label: i18n.t('modals.syncResult.pushed'), count: result.pushed, hasData: result.pushed > 0 },
		{ label: i18n.t('modals.syncResult.pulled'), count: result.pulled, hasData: result.pulled > 0 },
		{ label: i18n.t('modals.syncResult.conflicted'), count: result.conflicted, hasData: result.conflicted > 0 },
		{ label: i18n.t('modals.syncResult.skipped'), count: result.skipped, hasData: result.skipped > 0 },
	];
	const activeStats = stats.filter(s => s.hasData);

	return (
		<Modal open={open} onClose={handleClose} title={title}>
			<div
				className={[C.elements.summary, ...(activeStats.length === 0 ? [C.modifiers.summaryMuted] : [])].join(' ')}
			>
				{activeStats.length === 0
					? i18n.t('modals.syncResult.noChange')
					: activeStats.map(stat => (
							<span key={stat.label} className={C.elements.summaryItem}>
								{isChineseLanguage() ? `${stat.label} ${stat.count} 个` : `${stat.label}: ${stat.count}`}
							</span>
					  ))}
			</div>

			{result.details.length > 0 ? (
				<div className={C.elements.detailList}>
					{result.details.map((detail, idx) => {
						const isConflict = detail.type === 'conflict';
						const isPush = isConflict
							? detail.conflictResolution === 'push'
							: detail.type.startsWith('push');
						return (
							<div
								key={idx}
								className={[
									C.elements.detailItem,
									detail.success ? C.modifiers.success : C.modifiers.failed,
									isPush ? C.modifiers.push : C.modifiers.pull,
								].join(' ')}
							>
								<span className={C.elements.detailIcon}>{`${idx + 1}.`}</span>
								<span className={C.elements.detailIcon}>{detail.success ? '✅' : '❌'}</span>

								{isConflict && detail.conflictResolution ? (
									<>
										<span className={C.elements.detailLabel}>
											{(detail.conflictResolution === 'pull'
												? i18n.t('modals.syncResult.pull')
												: i18n.t('modals.syncResult.push')) + i18n.t('modals.syncResult.update')}
										</span>
										<span className={[C.elements.detailLabel, C.modifiers.detailLabelConflict].join(' ')}>
											{i18n.t('modals.syncResult.conflict')}
										</span>
									</>
								) : (
									<span className={C.elements.detailLabel}>{detail.label}</span>
								)}

								<span className={C.elements.detailDesc}>{detail.taskDescription}</span>

								{detail.error ? <div className={C.elements.detailError}>{detail.error}</div> : null}
							</div>
						);
					})}
				</div>
			) : null}

			<div className={C.elements.footer}>
				<button className={C.elements.footerButton} onClick={handleClose}>
					{i18n.t('common.ok')}
				</button>
			</div>
		</Modal>
	);
}

/**
 * 命令式同步结果弹窗（兼容旧 API，内部走全局 React Modal 宿主）
 */
export function showSyncResultModal(_app: App, title: string, result: SyncResult): void {
	const close = openReactModal(
		<SyncResultDialog
			title={title}
			result={result}
			onClose={() => {
				close();
			}}
		/>
	);
}