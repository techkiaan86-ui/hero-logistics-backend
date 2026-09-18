const prisma = require('../utils/prismaClient');
const { sendSuccess, sendError } = require('../utils/apiResponse');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

exports.getInventory = async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId || req.user.companyId;
    if (!tenantId) {
      return sendError(res, {
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Tenant identity missing'
      }, HTTP_STATUS.UNAUTHORIZED);
    }

    // Fetch LoadItems that are explicitly assigned to a warehouse
    // AND belong to a warehouse owned by this tenant's company
    const inventory = await prisma.loadItem.findMany({
      where: {
        warehouseId: { not: null },
        warehouse: {
          branch: {
            companyId: tenantId
          }
        }
      },
      include: {
        warehouse: true
      },
      orderBy: {
        receivedDate: 'desc'
      }
    });

    return sendSuccess(res, inventory);
  } catch (error) {
    console.error('Error in getInventory:', error);
    next(error);
  }
};
