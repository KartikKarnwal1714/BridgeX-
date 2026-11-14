jest.mock('../src/models/logModel', () => ({ find: jest.fn() }));
jest.mock('../src/config/mongo', () => ({
  isMongoConnected: () => true,
  mongoose: {
    isValidObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
    Types: { ObjectId: class ObjectId { constructor(value) { this.value = String(value); } } },
  },
}));

const Log = require('../src/models/logModel');
const logService = require('../src/services/logService');

function docs(values) {
  const chain = {
    sort: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    select: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(values),
  };
  Log.find.mockReturnValue(chain);
  return chain;
}

describe('log cursor pagination', () => {
  beforeEach(() => Log.find.mockReset());

  it('returns no next cursor for an empty or final page', async () => {
    docs([]);
    const empty = await logService.listLogs({ cursor: '', limit: '2' });
    expect(empty.items).toEqual([]);
    expect(empty.meta.nextCursor).toBeNull();
    docs([{ _id: '000000000000000000000001', timestamp: new Date('2026-01-01T00:00:00Z') }]);
    const final = await logService.listLogs({ cursor: '', limit: '2' });
    expect(final.meta.nextCursor).toBeNull();
  });

  it('uses timestamp and ID ordering to produce stable subsequent pages with duplicate timestamps', async () => {
    const firstPage = docs([
      { _id: '000000000000000000000003', timestamp: new Date('2026-01-01T00:00:00Z') },
      { _id: '000000000000000000000002', timestamp: new Date('2026-01-01T00:00:00Z') },
      { _id: '000000000000000000000001', timestamp: new Date('2026-01-01T00:00:00Z') },
    ]);
    const first = await logService.listLogs({ cursor: '', limit: '2' });
    expect(firstPage.sort).toHaveBeenCalledWith({ timestamp: -1, _id: -1 });
    expect(first.meta.nextCursor).toBeTruthy();
    const secondQuery = docs([{ _id: '000000000000000000000001', timestamp: new Date('2026-01-01T00:00:00Z') }]);
    const second = await logService.listLogs({ cursor: first.meta.nextCursor, limit: '2' });
    expect(secondQuery.limit).toHaveBeenCalledWith(3);
    expect(second.items).toHaveLength(1);
    expect(second.meta.nextCursor).toBeNull();
  });

  it('rejects malformed cursors', async () => {
    await expect(logService.listLogs({ cursor: 'invalid' })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(Log.find).not.toHaveBeenCalled();
  });
});
