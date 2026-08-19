const prisma = require('../utils/prismaClient');
const { sendSuccess, sendList, sendError } = require('../utils/apiResponse');
const { buildPrismaQuery, buildPaginationMeta } = require('../utils/queryBuilder');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

// Get all DeliveryPODs with pagination, sorting and filtering
exports.getAll = async (req, res, next) => {
  try {
    const { where, skip, take, orderBy, currentPage, pageSize } = buildPrismaQuery(req.query);
    
    if (req.tenantId) where.load = { companyId: req.tenantId };
    if (req.user && req.user.role === 'DRIVER') {
      where.driver = { userId: req.user.id };
    }

    const [data, total] = await Promise.all([
      prisma.deliveryPOD.findMany({
        where, skip, take, orderBy,
        include: {
          load: {
            include: { driver: true, customer: true }
          },
          driver: true
        }
      }),
      prisma.deliveryPOD.count({ where })
    ]);

    const meta = buildPaginationMeta(total, currentPage, pageSize, req.query.sort);
    return sendList(res, data, meta);
  } catch (error) {
    next(error);
  }
};

// Get single DeliveryPOD by ID
exports.getById = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    if (req.tenantId) where.load = { companyId: req.tenantId };
    if (req.user && req.user.role === 'DRIVER') {
      where.driver = { userId: req.user.id };
    }

    const data = await prisma.deliveryPOD.findFirst({
      where,
      include: {
        load: {
          include: { driver: true, customer: true }
        },
        driver: true
      }
    });
    
    if (!data) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'DeliveryPOD not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
};

// Create new DeliveryPOD
exports.create = async (req, res, next) => {
  try {
    const payload = { ...req.body };
    if (req.user && req.user.role === 'DRIVER') {
      const driver = await prisma.driver.findFirst({
        where: { userId: req.user.id }
      });
      if (!driver) {
        return sendError(res, {
          code: ERROR_CODES.UNAUTHORIZED_ACCESS,
          message: 'Driver profile not found'
        }, HTTP_STATUS.FORBIDDEN);
      }
      payload.driverId = driver.id;

      // Check that they are assigned to the load
      const assignedLoad = await prisma.load.findFirst({
        where: { id: payload.loadId, driverId: driver.id }
      });
      if (!assignedLoad) {
        return sendError(res, {
          code: ERROR_CODES.UNAUTHORIZED_ACCESS,
          message: 'You are not assigned to this load.'
        }, HTTP_STATUS.FORBIDDEN);
      }
    }

    const data = await prisma.deliveryPOD.create({
      data: payload,
      include: {
        load: true,
        driver: true
      }
    });
    return sendSuccess(res, data, HTTP_STATUS.CREATED);
  } catch (error) {
    next(error);
  }
};

// Update DeliveryPOD with Optimistic Concurrency check
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    
    const where = { id };
    if (req.tenantId) where.load = { companyId: req.tenantId };
    if (req.user && req.user.role === 'DRIVER') {
      where.driver = { userId: req.user.id };
    }

    // Check version if optimistic concurrency is required
    const ifMatch = req.headers['if-match'];
    if (ifMatch) {
      where.version = parseInt(ifMatch.replace(/"/g, ''), 10);
    }

    try {
      const data = await prisma.deliveryPOD.update({
        where,
        data: updateData
      });
      return sendSuccess(res, data);
    } catch (e) {
      if (e.code === 'P2025') {
        if (ifMatch) {
          return sendError(res, {
            code: ERROR_CODES.RESOURCE_CONFLICT,
            message: 'Resource was updated by another user or does not exist.'
          }, HTTP_STATUS.CONFLICT);
        }
        return sendError(res, {
          code: ERROR_CODES.NOT_FOUND,
          message: 'DeliveryPOD not found'
        }, HTTP_STATUS.NOT_FOUND);
      }
      throw e;
    }
  } catch (error) {
    next(error);
  }
};

// Delete DeliveryPOD
exports.delete = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    if (req.tenantId) where.load = { companyId: req.tenantId };
    if (req.user && req.user.role === 'DRIVER') {
      where.driver = { userId: req.user.id };
    }

    await prisma.deliveryPOD.delete({ where });
    
    // 204 No Content for successful delete
    return res.status(HTTP_STATUS.NO_CONTENT).send();
  } catch (error) {
    if (error.code === 'P2025') {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'DeliveryPOD not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    next(error);
  }
};
