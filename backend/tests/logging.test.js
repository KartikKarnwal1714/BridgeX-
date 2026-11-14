jest.mock('../src/services/logService', () => ({ recordRequestLog: jest.fn().mockResolvedValue(null) }));

const requestLogger = require('../src/middleware/requestLogger');
const logService = require('../src/services/logService');

describe('structured request logging', () => {
  it('logs request fields without query credentials or authorization headers', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const output = jest.spyOn(console, 'log').mockImplementation(() => {});
    let finish;
    const req = {
      originalUrl: '/api/v1/integrations?api_key=do-not-log',
      method: 'GET',
      correlationId: 'safe-id',
      headers: { authorization: 'Bearer do-not-log' },
      user: { id: 8, role: 'DEVELOPER' },
    };
    const res = { statusCode: 200, on: (event, callback) => { if (event === 'finish') finish = callback; } };
    const next = jest.fn();
    try {
      requestLogger(req, res, next);
      finish();
      expect(next).toHaveBeenCalled();
      expect(output).toHaveBeenCalledTimes(1);
      const line = output.mock.calls[0][0];
      expect(line).toContain('"correlationId":"safe-id"');
      expect(line).not.toContain('do-not-log');
      expect(logService.recordRequestLog).toHaveBeenCalledWith(expect.objectContaining({
        metadata: { userId: 8, role: 'DEVELOPER' },
      }));
    } finally {
      output.mockRestore();
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
