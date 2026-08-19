const express = require('express');
const router = express.Router();
const SuperAdminDashboardController = require('../controllers/SuperAdminDashboardController');
const { verifyToken } = require('../middlewares/auth');

router.get('/', verifyToken, SuperAdminDashboardController.getDashboardMetrics);

module.exports = router;
