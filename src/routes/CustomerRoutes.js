const express = require('express');
const router = express.Router();
const CustomerController = require('../controllers/CustomerController');
const { verifyToken } = require('../middlewares/auth');
const { resolveTenant } = require('../middlewares/tenantResolver');

router.use(verifyToken, resolveTenant);

router.route('/')
  .get(CustomerController.getAll)
  .post(CustomerController.create);

router.route('/:id')
  .get(CustomerController.getById)
  .put(CustomerController.update)
  .delete(CustomerController.delete);

router.route('/:id/contacts')
  .get(CustomerController.getContacts)
  .post(CustomerController.addContact);

module.exports = router;
