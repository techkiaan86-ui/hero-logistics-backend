const express = require('express');
const router = express.Router();
const LeadController = require('../controllers/LeadController');
const { verifyToken, requireSalesAccess } = require('../middlewares/auth');

router.use(verifyToken);
router.use(requireSalesAccess);

router.route('/')
  .get(LeadController.getAll)
  .post(LeadController.create);

router.route('/:id')
  .get(LeadController.getById)
  .put(LeadController.update)
  .delete(LeadController.delete);

router.put('/:id/stage', LeadController.updateStage);
router.put('/:id/assign-rep', LeadController.assignRep);
router.post('/:id/convert-to-company', LeadController.convertToCompany);

module.exports = router;
