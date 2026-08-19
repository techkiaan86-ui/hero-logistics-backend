const express = require('express');
const router = express.Router();
const BillingRecordController = require('../controllers/BillingRecordController');
// const auth = require('../middlewares/auth');

// Default open for testing, uncomment auth to protect routes
// router.use(auth.verifyToken);

router.route('/')
  .get(BillingRecordController.getAll)
  .post(BillingRecordController.create);

router.route('/:id')
  .get(BillingRecordController.getById)
  .put(BillingRecordController.update)
  .delete(BillingRecordController.delete);

module.exports = router;
