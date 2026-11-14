const express = require('express');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validation');
const { registerSchema, loginSchema } = require('../schemas/authSchemas');

const router = express.Router();

// Resource-shaped: a session / a registration is created with POST, the current session is read with GET.
router.post('/registrations', validate(registerSchema), authController.register);
router.post('/sessions', validate(loginSchema), authController.login);
router.get('/sessions/current', authenticate, authController.me);

// DEPRECATED verb-style aliases (unchanged behaviour) kept for existing clients.
router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);
router.get('/me', authenticate, authController.me);

module.exports = router;
