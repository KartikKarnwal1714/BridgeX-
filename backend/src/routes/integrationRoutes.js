const express = require('express');
const integrationController = require('../controllers/integrationController');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validation');
const { createIntegrationSchema, updateIntegrationSchema, replaceIntegrationSchema, graphqlRequestSchema, soapRequestSchema } = require('../schemas/integrationSchemas');
const idempotency = require('../middleware/idempotency');

const router = express.Router();

router.use(authenticate);

router.get('/', authorize('SUPER_ADMIN', 'DEVELOPER', 'SUPPORT'), integrationController.list);
router.get('/:id', authorize('SUPER_ADMIN', 'DEVELOPER', 'SUPPORT'), integrationController.getOne);
router.post(
  '/',
  authorize('SUPER_ADMIN', 'DEVELOPER'),
  validate(createIntegrationSchema),
  idempotency('POST:/api/v1/integrations'),
  integrationController.create
);
router.put(
  '/:id',
  authorize('SUPER_ADMIN'),
  validate(replaceIntegrationSchema),
  integrationController.update
);
router.patch('/:id', authorize('SUPER_ADMIN'), validate(updateIntegrationSchema), integrationController.update);
router.delete('/:id', authorize('SUPER_ADMIN'), integrationController.remove);

// Sub-resources (nouns, not verbs).
// A verification is a real connection check; creating one records the result on the integration.
router.post('/:id/verifications', authorize('SUPER_ADMIN', 'DEVELOPER'), integrationController.verify);
// Operations discovered from a SOAP integration's WSDL.
router.get('/:id/operations', authorize('SUPER_ADMIN', 'DEVELOPER', 'SUPPORT'), integrationController.operations);
// Protocol endpoints of an integration: GraphQL forwarding and SOAP calls.
router.post('/:id/graphql', authorize('SUPER_ADMIN', 'DEVELOPER'), validate(graphqlRequestSchema), integrationController.graphql);
router.post('/:id/soap', authorize('SUPER_ADMIN', 'DEVELOPER'), validate(soapRequestSchema), integrationController.soap);

module.exports = router;
