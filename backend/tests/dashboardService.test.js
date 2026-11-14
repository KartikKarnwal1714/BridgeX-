jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/services/logService', () => ({
  getSummary: jest.fn(),
  getTrafficSeries: jest.fn(),
}));
jest.mock('../src/services/systemHealthService', () => ({
  getSystemHealth: jest.fn(),
}));

const { pool } = require('../src/config/database');
const logService = require('../src/services/logService');
const systemHealthService = require('../src/services/systemHealthService');
const dashboardService = require('../src/services/dashboardService');

describe('dashboard metrics and health', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses request-log totals and definitions for the same seven-day summary as Analytics', async () => {
    pool.query.mockResolvedValue({ rows: [{ total_apis: 4 }] });
    logService.getSummary.mockResolvedValue({
      totalRequests: 10,
      successfulRequests: 7,
      failedRequests: 3,
      errorRate: 30,
      averageResponseTime: 150,
      available: true,
    });

    const result = await dashboardService.getStats();

    expect(result).toMatchObject({
      totalApis: 4,
      totalRequests: 10,
      successRate: 70,
      failedRequests: 3,
      averageResponseTime: 150,
      logDataAvailable: true,
    });
    const range = logService.getSummary.mock.calls[0][0];
    expect(range.to.getTime() - range.from.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(pool.query.mock.calls[0][0]).not.toMatch(/request_count|success_rate|average_response_time/);
  });

  it('preserves the unavailable state instead of presenting missing logs as real zero traffic', async () => {
    pool.query.mockResolvedValue({ rows: [{ total_apis: 0 }] });
    logService.getSummary.mockResolvedValue({
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      errorRate: 0,
      averageResponseTime: 0,
      available: false,
    });

    await expect(dashboardService.getStats()).resolves.toMatchObject({ logDataAvailable: false, totalRequests: 0 });
  });

  it('reports dependency health from active health checks', async () => {
    systemHealthService.getSystemHealth.mockResolvedValue([
      { name: 'Database (PostgreSQL)', status: 'Healthy', required: true },
      { name: 'MongoDB', status: 'Degraded', required: false },
    ]);

    await expect(dashboardService.getSystemStatus()).resolves.toEqual([
      { name: 'PostgreSQL', status: 'Healthy', required: true },
      { name: 'MongoDB', status: 'Degraded', required: false },
    ]);
  });
});
