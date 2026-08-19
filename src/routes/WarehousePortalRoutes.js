const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/WarehousePortalController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');
const { resolveTenant } = require('../middlewares/tenantResolver');

// Apply auth & tenant resolver middleware across all Warehouse Portal routes
router.use(verifyToken, resolveTenant, authorizeRoles(['WAREHOUSE', 'YARD', 'DRIVER', 'COMPANY_ADMIN', 'SUPER_ADMIN', 'CUSTOMER']));

// 1. Warehouse Overview & Dashboard
router.get('/overview', ctrl.getDashboard);
router.get('/dashboard', ctrl.getDashboard);
router.get('/notifications', ctrl.getNotifications);

// 2. Find Stock / Stock Inventory
router.get('/stock', ctrl.getStock);
router.get('/stock/:id', ctrl.getStockById);
router.post('/stock/move', ctrl.moveStock);
router.post('/stock/scan', ctrl.scanBarcode);

// 3. Receive (Inbound)
router.get('/inbound/form-options', ctrl.getInboundFormOptions);
router.get('/inbound/receipts', ctrl.getInboundReceipts);
router.post('/inbound/receive', ctrl.createInboundReceipt);
router.post('/inbound', ctrl.createInboundReceipt);

// 4. Load Lanes (Staging 1-8)
router.get('/load-lanes', ctrl.getLoadLanes);
router.post('/load-lanes', ctrl.createLoadLane);
router.patch('/load-lanes/:laneId/status', ctrl.updateLoadLaneStatus);
router.patch('/load-lanes/:laneId/assign', ctrl.assignDriverToLane);
router.post('/load-lanes/:laneId/stage-items', ctrl.stageItemsToLane);
router.post('/load-lanes/move-items', ctrl.moveLaneItems);
router.post('/load-lanes/:laneId/clear', ctrl.clearLoadLane);
router.get('/load-lanes/:laneId/manifest', ctrl.printManifest);
// 5. Dispatch Ready & Outbound
router.get('/dispatch-ready', ctrl.getDispatchReady);
router.post('/dispatch-ready/:loadId/dispatch', ctrl.dispatchLoad);

// 6. Holding Areas (SA-01 to SA-12)
router.get('/holding-areas', ctrl.getHoldingAreas);
router.post('/holding-areas/:id/move-stock', ctrl.moveHoldingAreaStock);
router.patch('/holding-areas/:id/assign', ctrl.assignHoldingAreaToLane);
router.get('/staging', ctrl.getHoldingAreas);

// 7. Movement History & Audit Logs
router.get('/movements', ctrl.getMovements);
router.get('/movement-history', ctrl.getMovements);

// 8. Warehouse & Yard Interactive Map
router.get('/map', ctrl.getYardMap);
router.get('/yard-map', ctrl.getYardMap);

// 9. Reports & Analytics (Managers Only)
router.get('/reports/overview', authorizeRoles(['WAREHOUSE', 'COMPANY_ADMIN', 'SUPER_ADMIN']), ctrl.getReportsOverview);
router.get('/reports', authorizeRoles(['WAREHOUSE', 'COMPANY_ADMIN', 'SUPER_ADMIN']), ctrl.getReportsOverview);

// 10. Labels, Tools & Spooler
router.get('/labels', ctrl.getLabels);
router.post('/labels/print', ctrl.printLabel);
router.post('/tools/barcode-scan', ctrl.scanBarcode);
router.get('/tools/spooler-queue', ctrl.getSpoolerQueue);

// 11. Safety Checklist & Pre-Start
router.get('/safety-checklists', ctrl.getSafetyChecklists);
router.post('/safety-checklists', ctrl.submitSafetyChecklist);

// 12. Staff Profile
router.get('/profile', ctrl.getStaffProfile);
router.put('/profile', ctrl.updateStaffProfile);

// 13. Shift / Time Clock (Phase C) — Yard Attendant Clock In / Out
router.get('/shift/current', ctrl.getCurrentShift);
router.post('/shift/clock-in', ctrl.clockInShift);
router.post('/shift/clock-out', ctrl.clockOutShift);
router.get('/shift/history', ctrl.getShiftHistory);

// 14. Task Management (Phase D) — Yard Attendant Task Queue & Status
router.get('/tasks', ctrl.getTasks);
router.get('/tasks/:taskId', ctrl.getTaskById);
router.patch('/tasks/:taskId/status', ctrl.updateTaskStatus);
router.put('/tasks/:taskId/status', ctrl.updateTaskStatus);
router.post('/tasks/:taskId/complete', ctrl.completeTask);

// 15. Issue Reporting
router.get('/issues', ctrl.getReportedIssues);
router.post('/issues', ctrl.reportIssue);
router.post('/report-issue', ctrl.reportIssue);
router.delete('/issues/:id', ctrl.resolveReportedIssue);

// 12.5 Shifts & Timesheets
router.post('/shift/clock-in', ctrl.clockIn);
router.post('/shift/clock-out', ctrl.clockOut);

// 13. Messages & Support
router.get('/support/dashboard', ctrl.getSupportDashboard);
router.post('/support/message', ctrl.sendMessage);
router.post('/support/ticket', ctrl.createSupportTicket);

module.exports = router;
