import { TimekeepVacationService } from '../src/utils/timekeepVacationService';

describe('TimekeepVacationService', () => {
	let mockApp: any;
	let mockPlugin: any;

	beforeEach(() => {
		mockPlugin = {
			settings: {
				vacationHighlightEnabled: true,
				vacationTimekeepProject: '99-001 - NIEOBECNOŚCI',
				vacationTimekeepTypes: 'U_W - urlop wypoczynkowy, U_NG - odbiór nadgodzin',
				vacationHighlightColor: '#f97316',
			},
			refreshCalendarViews: jest.fn(),
		};

		mockApp = {
			vault: {
				configDir: '.obsidian',
				adapter: {
					exists: jest.fn().mockResolvedValue(true),
					list: jest.fn().mockResolvedValue({
						files: ['.obsidian/plugins/timekeep-pro/data/2026-W41.timekeep.json'],
					}),
					read: jest.fn().mockResolvedValue(JSON.stringify({
						entries: [
							{
								project: '99-001 - NIEOBECNOŚCI',
								type: 'U_W - urlop wypoczynkowy',
								startTime: '2026-10-07T06:00:00.000Z',
								endTime: '2026-10-07T14:00:00.000Z',
								subEntries: null,
							},
							{
								project: 'Inny projekt',
								type: 'Spotkanie',
								startTime: '2026-10-08T08:00:00.000Z',
								endTime: '2026-10-08T09:00:00.000Z',
								subEntries: null,
							},
						],
					})),
				},
				on: jest.fn(),
			},
			plugins: {
				getPlugin: jest.fn().mockReturnValue(null),
			},
		};
	});

	it('poprawnie odczytuje i parsuje wpis urlopowy z plików JSON', async () => {
		const service = new TimekeepVacationService(mockApp, mockPlugin);
		await service.loadVacations();

		const vacationDay = new Date(2026, 9, 7); // 2026-10-07
		const nonVacationDay = new Date(2026, 9, 8); // 2026-10-08

		const vacationInfo = service.getVacation(vacationDay);
		expect(vacationInfo).not.toBeNull();
		expect(vacationInfo?.project).toBe('99-001 - NIEOBECNOŚCI');
		expect(vacationInfo?.type).toBe('U_W - urlop wypoczynkowy');

		const nonVacationInfo = service.getVacation(nonVacationDay);
		expect(nonVacationInfo).toBeNull();
	});

	it('obsługuje grupy i podwpisy (subEntries)', async () => {
		mockApp.vault.adapter.read.mockResolvedValue(JSON.stringify({
			entries: [
				{
					project: '99-001 - NIEOBECNOŚCI',
					type: 'U_W - urlop wypoczynkowy',
					startTime: null,
					endTime: null,
					subEntries: [
						{
							project: 'Część 1',
							type: 'U_W - urlop wypoczynkowy',
							startTime: '2026-10-05T06:00:00.000Z',
							endTime: '2026-10-05T14:00:00.000Z',
							subEntries: null,
						},
					],
				},
			],
		}));

		const service = new TimekeepVacationService(mockApp, mockPlugin);
		await service.loadVacations();

		const day = new Date(2026, 9, 5); // 2026-10-05
		const vacationInfo = service.getVacation(day);
		expect(vacationInfo).not.toBeNull();
		expect(vacationInfo?.project).toBe('99-001 - NIEOBECNOŚCI');
	});

	it('zwraca null jeśli wyróżnianie urlopów jest wyłączone w opcjach', async () => {
		mockPlugin.settings.vacationHighlightEnabled = false;
		const service = new TimekeepVacationService(mockApp, mockPlugin);
		await service.loadVacations();

		const vacationDay = new Date(2026, 9, 7);
		expect(service.getVacation(vacationDay)).toBeNull();
	});
});
