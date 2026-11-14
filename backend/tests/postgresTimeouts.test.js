jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ on: jest.fn(), connect: jest.fn(), query: jest.fn() })),
}));

const { Pool } = require('pg');

describe('PostgreSQL timeout configuration', () => {
  it('passes safe environment-based timeouts to the pg Pool', () => {
    jest.isolateModules(() => require('../src/config/database'));
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
      query_timeout: 20000,
      idle_in_transaction_session_timeout: 15000,
    }));
  });
});
