const express = require('express');
const systemHealthController = require('../controllers/systemHealthController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
// Detailed operational info is limited to staff roles.
router.use(authorize('SUPER_ADMIN', 'DEVELOPER', 'SUPPORT'));

router.get('/', systemHealthController.status);
router.get('/alerts', systemHealthController.alerts);
router.get('/circuit-breakers', systemHealthController.circuitBreakers);
router.delete('/circuit-breakers/:key', authorize('SUPER_ADMIN'), systemHealthController.resetCircuitBreaker);

module.exports = router;
