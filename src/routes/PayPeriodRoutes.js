const express = require('express');
const router = express.Router();
const PayPeriodController = require('../controllers/PayPeriodController');
// const auth = require('../middlewares/auth');

// Default open for testing, uncomment auth to protect routes
// router.use(auth.verifyToken);

router.route('/')
  .get(PayPeriodController.getAll)
  .post(PayPeriodController.create);

router.route('/:id')
  .get(PayPeriodController.getById)
  .put(PayPeriodController.update)
  .delete(PayPeriodController.delete);

module.exports = router;
