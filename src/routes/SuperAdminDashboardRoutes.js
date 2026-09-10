const express = require('express');
const router = express.Router();
const SuperAdminDashboardController = require('../controllers/SuperAdminDashboardController');
const { verifyToken } = require('../middlewares/auth');

router.get('/', verifyToken, SuperAdminDashboardController.getDashboardMetrics);
router.get('/system-analytics', verifyToken, SuperAdminDashboardController.getDashboardMetrics);
router.get('/analytics', verifyToken, SuperAdminDashboardController.getDashboardMetrics);
router.get('/dashboard', verifyToken, SuperAdminDashboardController.getDashboardMetrics);

module.exports = router;
