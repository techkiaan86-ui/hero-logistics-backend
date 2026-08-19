const prisma = require('../utils/prismaClient');
const { sendSuccess, sendList, sendError } = require('../utils/apiResponse');
const { buildPrismaQuery, buildPaginationMeta } = require('../utils/queryBuilder');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');
const LoadService = require('../services/LoadService');

// Get all Loads with pagination, sorting and filtering
exports.getAll = async (req, res, next) => {
  try {
    const { where, skip, take, orderBy, currentPage, pageSize } = buildPrismaQuery(req.query);
    
    if (req.tenantId) where.companyId = req.tenantId;
    if (req.user && req.user.role === 'DISPATCHER' && req.user.branchId && !req.user.permissions?.includes('dispatch.cross_branch.view')) {
      where.branchId = req.user.branchId;
    }
    if (req.user && req.user.role === 'DRIVER') {
      where.driver = { userId: req.user.id };
    }

    const [data, total] = await Promise.all([
      prisma.load.findMany({
        where, skip, take, orderBy,
        include: {
          driver: true,
          truck: true,
          activities: true,
          trailer: true,
          customer: true,
          stops: true,
          items: true
        }
      }),
      prisma.load.count({ where })
    ]);

    const meta = buildPaginationMeta(total, currentPage, pageSize, req.query.sort);
    return sendList(res, data, meta);
  } catch (error) {
    next(error);
  }
};

// Get single Load by ID
exports.getById = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    if (req.tenantId) where.companyId = req.tenantId;
    if (req.user && req.user.role === 'DISPATCHER' && req.user.branchId && !req.user.permissions?.includes('dispatch.cross_branch.view')) {
      where.branchId = req.user.branchId;
    }
    if (req.user && req.user.role === 'DRIVER') {
      where.driver = { userId: req.user.id };
    }

    const data = await prisma.load.findFirst({
      where,
      include: {
        driver: true,
        truck: true,
        trailer: true,
        customer: true,
        stops: true,
        items: true,
        proofPhotos: true,
        expenses: true
      }
    });
    
    if (!data) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Load not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
};

// Create new Load
exports.create = async (req, res, next) => {
  try {
    const payload = { ...req.body };
    if (req.tenantId) {
      payload.companyId = req.tenantId;
    }
    if (req.user && req.user.role === 'DISPATCHER' && req.user.branchId && !req.user.permissions?.includes('dispatch.cross_branch.view')) {
      payload.branchId = req.user.branchId;
    }
    if (req.user && req.user.role === 'DRIVER') {
      if (!req.user.permissions?.includes('driver.owner_operator_load_create')) {
        return sendError(res, {
          code: ERROR_CODES.UNAUTHORIZED_ACCESS,
          message: 'Drivers are not authorized to create loads.'
        }, HTTP_STATUS.FORBIDDEN);
      }
    }

    if (!payload.companyId) {
      const firstCompany = await prisma.company.findFirst();
      if (firstCompany) {
        payload.companyId = firstCompany.id;
      }
    }

    // Fallback/Generate loadRef
    if (!payload.loadRef) {
      payload.loadRef = `LD-${Math.floor(10000 + Math.random() * 90000)}`;
    }

    // Fallback type
    if (!payload.type) {
      payload.type = 'General Freight';
    }

    // Map status string to valid db enum
    if (payload.status) {
      if (payload.status === 'In Transit') payload.status = 'IN_TRANSIT';
      else if (payload.status === 'En Route') payload.status = 'ASSIGNED';
      else if (payload.status === 'At Pickup') payload.status = 'ASSIGNED';
      else if (payload.status === 'Planned') payload.status = 'PLANNED';
      else if (payload.status === 'On Hold') payload.status = 'ASSIGNED';
      else if (!['DRAFT', 'REQUESTED', 'PLANNED', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'].includes(payload.status)) {
        payload.status = 'PLANNED';
      }
    }

    // Map priority string to valid db enum
    if (payload.priority) {
      const pUpper = payload.priority.toUpperCase();
      if (['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(pUpper)) {
        payload.priority = pUpper;
      } else {
        payload.priority = 'LOW';
      }
    }

    // Map scheduledDate or reqDate to loadDate
    if (payload.scheduledDate && !payload.loadDate) {
      const parsedDate = new Date(payload.scheduledDate);
      payload.loadDate = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
      delete payload.scheduledDate;
    }

    // Clean up frontend only parameters that are not in schema
    delete payload.pickupLocation;
    delete payload.deliveryLocation;
    delete payload.customerName;
    delete payload.driverName;
    delete payload.vehicleId;
    delete payload.trailerId;

    const data = await prisma.load.create({
      data: payload,
      include: {
        driver: true,
        truck: true,
        customer: true
      }
    });
    return sendSuccess(res, data, HTTP_STATUS.CREATED);
  } catch (error) {
    next(error);
  }
};

// Update Load
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    // Sanitize status string if needed
    if (updateData.status) {
      if (updateData.status === 'In Transit') updateData.status = 'IN_TRANSIT';
      else if (updateData.status === 'En Route') updateData.status = 'ASSIGNED';
      else if (updateData.status === 'At Pickup') updateData.status = 'ASSIGNED';
      else if (updateData.status === 'Planned') updateData.status = 'PLANNED';
      else if (updateData.status === 'On Hold') updateData.status = 'ASSIGNED';
      else if (!['DRAFT', 'REQUESTED', 'PLANNED', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'].includes(updateData.status)) {
        updateData.status = 'PLANNED';
      }
    }

    const findWhere = { OR: [{ id }, { loadRef: id }] };
    if (req.tenantId) {
      findWhere.companyId = req.tenantId;
    }
    if (req.user && req.user.role === 'DISPATCHER' && req.user.branchId && !req.user.permissions?.includes('dispatch.cross_branch.view')) {
      findWhere.branchId = req.user.branchId;
    }
    if (req.user && req.user.role === 'DRIVER') {
      findWhere.driver = { userId: req.user.id };
    }

    let targetLoad = await prisma.load.findFirst({
      where: findWhere
    });

    if (!targetLoad) {
      if (req.tenantId) {
        return sendError(res, {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Load not found in this company context'
        }, HTTP_STATUS.NOT_FOUND);
      }
      const company = await prisma.company.findFirst();
      targetLoad = await prisma.load.create({
        data: {
          loadRef: id,
          type: updateData.type || 'General Freight',
          status: updateData.status || 'DRAFT',
          companyId: company ? company.id : undefined
        }
      });
    }

    const data = await prisma.load.update({
      where: { id: targetLoad.id },
      data: updateData
    });
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
};

// Delete Load
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const findWhere = { id };
    if (req.tenantId) {
      findWhere.companyId = req.tenantId;
    }
    if (req.user && req.user.role === 'DISPATCHER' && req.user.branchId && !req.user.permissions?.includes('dispatch.cross_branch.view')) {
      findWhere.branchId = req.user.branchId;
    }
    if (req.user && req.user.role === 'DRIVER') {
      findWhere.driver = { userId: req.user.id };
    }

    const targetLoad = await prisma.load.findFirst({
      where: findWhere
    });

    if (!targetLoad) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Load not found in this company context'
      }, HTTP_STATUS.NOT_FOUND);
    }

    await prisma.load.delete({ where: { id: targetLoad.id } });
    
    // 204 No Content for successful delete
    return res.status(HTTP_STATUS.NO_CONTENT).send();
  } catch (error) {
    if (error.code === 'P2025') {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Load not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    next(error);
  }
};

// Custom: Activate Load
exports.activate = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { assignment } = req.body;
    
    // We would pass req.tenantId if tenantResolver was providing it
    const data = await LoadService.activateLoad(id, assignment, req.tenantId);
    
    return sendSuccess(res, data, HTTP_STATUS.OK);
  } catch (error) {
    if (error.code === 'LOAD_ACTIVATION_FAILED') {
      return sendError(res, error, HTTP_STATUS.UNPROCESSABLE_ENTITY);
    }
    next(error);
  }
};

// Custom: Assign resources to Load
exports.assign = async (req, res, next) => {
  try {
    const { id } = req.params;
    const assignment = req.body;
    
    const data = await LoadService.assignResources(id, assignment, req.tenantId);
    return sendSuccess(res, data, HTTP_STATUS.OK);
  } catch (error) {
    next(error);
  }
};

// Custom: Status Transition
exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    
    if (!status) {
      return sendError(res, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Status is required' }, HTTP_STATUS.BAD_REQUEST);
    }

    const data = await LoadService.updateStatus(id, status, reason, req.tenantId);
    return sendSuccess(res, data, HTTP_STATUS.OK);
  } catch (error) {
    next(error);
  }
};
