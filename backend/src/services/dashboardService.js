const { pool } = require('../config/database');
const logService = require('./logService');
const systemHealthService = require('./systemHealthService');

async function getStats() {
  // Dashboard request metrics use the same request-log source and seven-day
  // window as Analytics. The old implementation summed lifetime API counters
  // and averaged per-API rates, so the two screens could never agree.
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 3600 * 1000);
  const [{ rows }, summary] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total_apis FROM apis`),
    logService.getSummary({ from, to }),
  ]);

  return {
    totalApis: rows[0].total_apis,
    totalRequests: summary.totalRequests,
    successRate: summary.totalRequests === 0 ? 0 : Number(((summary.successfulRequests / summary.totalRequests) * 100).toFixed(2)),
    averageResponseTime: summary.averageResponseTime,
    failedRequests: summary.failedRequests,
    logDataAvailable: summary.available,
  };
}

/**
 * Last 7 days of real request traffic, aggregated from the request log.
 * Returns an empty list (not made-up numbers) when the log store is
 * unavailable or no requests have been recorded yet.
 */
async function getTrafficOverview() {
  const to = new Date();
  const from = new Date(to.getTime() - 6 * 24 * 3600 * 1000);
  const { series } = await logService.getTrafficSeries({ from, to, interval: 'day' });
  return series.map(({ date, requests, responses }) => ({ date, requests, responses }));
}

async function getProtocolDistribution() {
  const { rows } = await pool.query(`
    SELECT protocol, COUNT(*)::int AS count
    FROM apis
    GROUP BY protocol
  `);

  const total = rows.reduce((sum, r) => sum + r.count, 0) || 1;
  const colors = { REST: '#7C5CFC', GRAPHQL: '#22C55E', SOAP: '#3B82F6' };

  return rows.map((r) => ({
    name: r.protocol,
    count: r.count,
    value: Number(((r.count / total) * 100).toFixed(1)),
    color: colors[r.protocol] || '#94A3B8',
  }));
}

async function getTopApis(limit = 5) {
  const { rows } = await pool.query(
    `SELECT id, name, protocol, request_count AS requests, success_rate, average_response_time, status
     FROM apis
     ORDER BY request_count DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

async function getSystemStatus() {
  const components = await systemHealthService.getSystemHealth();
  return components.map((component) => ({
    ...component,
    name: component.name === 'Database (PostgreSQL)' ? 'PostgreSQL' : component.name,
  }));
}

module.exports = {
  getStats,
  getTrafficOverview,
  getProtocolDistribution,
  getTopApis,
  getSystemStatus,
};
