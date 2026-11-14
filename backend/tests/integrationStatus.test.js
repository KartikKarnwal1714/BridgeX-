jest.mock('../src/models/integrationModel', () => ({
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
}));

const integrationModel = require('../src/models/integrationModel');
const integrationService = require('../src/services/integrationService');
const { createIntegrationSchema, updateIntegrationSchema } = require('../src/schemas/integrationSchemas');
const validate = require('../src/middleware/validation');

describe('integration connection status', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not present a manually stored Connected status as verified', async () => {
    integrationModel.findAll.mockResolvedValue([{ id: 3, name: 'Legacy CRM', status: 'Connected' }]);

    await expect(integrationService.listIntegrations()).resolves.toEqual([
      { id: 3, name: 'Legacy CRM', status: 'Unverified' },
    ]);
  });

  it('does not allow new or updated records to claim Connected without a check', () => {
    const input = { name: 'CRM', type: 'Third Party', protocol: 'REST', endpoint: '/crm', status: 'Connected' };
    const createNext = jest.fn();
    const updateNext = jest.fn();

    validate(createIntegrationSchema)({ body: input }, {}, createNext);
    validate(updateIntegrationSchema)({ body: { status: 'Connected' } }, {}, updateNext);
    expect(createNext.mock.calls[0][0]).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(updateNext.mock.calls[0][0]).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });
});
