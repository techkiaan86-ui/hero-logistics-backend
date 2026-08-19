const prisma = require('../utils/prismaClient');
const { sendSuccess, sendList, sendError } = require('../utils/apiResponse');
const { buildPrismaQuery, buildPaginationMeta } = require('../utils/queryBuilder');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

// Get all PreStartChecklists with pagination, sorting and filtering
exports.getAll = async (req, res, next) => {
  try {
    const { where, skip, take, orderBy, currentPage, pageSize } = buildPrismaQuery(req.query);
    
    if (req.tenantId) where.companyId = req.tenantId;
    if (req.user && req.user.role === 'DRIVER') {
      where.driver = { userId: req.user.id };
    }

    const [data, total] = await Promise.all([
      prisma.preStartChecklist.findMany({
        where, skip, take, orderBy,
        include: {
          driver: true,
          load: true
        }
      }),
      prisma.preStartChecklist.count({ where })
    ]);

    const meta = buildPaginationMeta(total, currentPage, pageSize, req.query.sort);
    return sendList(res, data, meta);
  } catch (error) {
    next(error);
  }
};

// Get single PreStartChecklist by ID
exports.getById = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    if (req.tenantId) where.companyId = req.tenantId;
    if (req.user && req.user.role === 'DRIVER') {
      where.driver = { userId: req.user.id };
    }

    const data = await prisma.preStartChecklist.findFirst({
      where,
      include: {
        driver: true,
        load: true
      }
    });
    
    if (!data) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'PreStartChecklist not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
};

// Create new PreStartChecklist
exports.create = async (req, res, next) => {
  try {
    const payload = { ...req.body };
    if (req.tenantId && !payload.companyId) payload.companyId = req.tenantId;
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
    }

    const data = await prisma.preStartChecklist.create({
      data: payload,
      include: {
        driver: true,
        load: true
      }
    });
    return sendSuccess(res, data, HTTP_STATUS.CREATED);
  } catch (error) {
    next(error);
  }
};

// Update PreStartChecklist with Optimistic Concurrency check
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    
    const where = { id };
    if (req.tenantId) where.companyId = req.tenantId;
    if (req.user && req.user.role === 'DRIVER') {
      where.driver = { userId: req.user.id };
    }

    // Check version if optimistic concurrency is required
    const ifMatch = req.headers['if-match'];
    if (ifMatch) {
      where.version = parseInt(ifMatch.replace(/"/g, ''), 10);
    }

    try {
      const data = await prisma.preStartChecklist.update({
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
          message: 'PreStartChecklist not found'
        }, HTTP_STATUS.NOT_FOUND);
      }
      throw e;
    }
  } catch (error) {
    next(error);
  }
};

// Delete PreStartChecklist
exports.delete = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    if (req.tenantId) where.companyId = req.tenantId;
    if (req.user && req.user.role === 'DRIVER') {
      where.driver = { userId: req.user.id };
    }

    await prisma.preStartChecklist.delete({ where });
    
    // 204 No Content for successful delete
    return res.status(HTTP_STATUS.NO_CONTENT).send();
  } catch (error) {
    if (error.code === 'P2025') {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'PreStartChecklist not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    next(error);
  }
};
