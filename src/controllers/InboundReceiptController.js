const prisma = require('../utils/prismaClient');
const { sendSuccess, sendList, sendError } = require('../utils/apiResponse');
const { buildPrismaQuery, buildPaginationMeta } = require('../utils/queryBuilder');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

// Get all InboundReceipts with pagination, sorting and filtering
exports.getAll = async (req, res, next) => {
  try {
    const { where, skip, take, orderBy, currentPage, pageSize } = buildPrismaQuery(req.query);
    
    // Optional: Inject tenant scope here if applicable
    // if (req.tenantId) where.tenantId = req.tenantId;

    const [data, total] = await Promise.all([
      prisma.inboundReceipt.findMany({
        where, skip, take, orderBy
      }),
      prisma.inboundReceipt.count({ where })
    ]);

    const meta = buildPaginationMeta(total, currentPage, pageSize, req.query.sort);
    return sendList(res, data, meta);
  } catch (error) {
    next(error);
  }
};

// Get single InboundReceipt by ID
exports.getById = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    // if (req.tenantId) where.tenantId = req.tenantId;

    const data = await prisma.inboundReceipt.findFirst({ where });
    
    if (!data) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'InboundReceipt not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
};

// Create new InboundReceipt
exports.create = async (req, res, next) => {
  try {
    const {
      receiptNumber, receiptNo,
      supplierName, supplier,
      referenceNote,
      transportType,
      driverName,
      vehicleDetails, vehicleRef,
      receivingDepot,
      zone, row, bay,
      items = [],
      status = 'Completed'
    } = req.body;

    const targetReceiptNo = receiptNumber || receiptNo || `GR-${Math.floor(1000 + Math.random() * 9000)}`;
    const targetSupplier = supplierName || supplier || 'ABC Motors';
    const targetVehicle = vehicleDetails || vehicleRef || 'TRK-101 / TRL-309';

    // Get default warehouse
    let defaultWh = await prisma.warehouse.findFirst();
    if (!defaultWh) {
      const comp = await prisma.company.findFirst();
      const br = await prisma.branch.findFirst();
      defaultWh = await prisma.warehouse.create({
        data: {
          code: 'WH-001',
          name: receivingDepot || 'Sydney Depot Main Yard',
          branchId: br?.id || (await prisma.branch.create({ data: { name: 'Main Hub', companyId: comp.id } })).id
        }
      });
    }

    const data = await prisma.inboundReceipt.create({
      data: {
        receiptNo: targetReceiptNo,
        supplier: targetSupplier,
        referenceNote: referenceNote || 'DEL-887654',
        transportType: transportType || 'Truck',
        driverName: driverName || 'John Smith',
        vehicleRef: targetVehicle,
        status,
        warehouseId: defaultWh.id,
        receivingDate: new Date()
      }
    });

    return sendSuccess(res, data, HTTP_STATUS.CREATED);
  } catch (error) {
    next(error);
  }
};

// Update InboundReceipt with Optimistic Concurrency check
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    
    const where = { id };
    // if (req.tenantId) where.tenantId = req.tenantId;

    // Check version if optimistic concurrency is required
    const ifMatch = req.headers['if-match'];
    if (ifMatch) {
      where.version = parseInt(ifMatch.replace(/"/g, ''), 10);
    }

    try {
      const data = await prisma.inboundReceipt.update({
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
          message: 'InboundReceipt not found'
        }, HTTP_STATUS.NOT_FOUND);
      }
      throw e;
    }
  } catch (error) {
    next(error);
  }
};

// Delete InboundReceipt
exports.delete = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    // if (req.tenantId) where.tenantId = req.tenantId;

    await prisma.inboundReceipt.delete({ where });
    
    // 204 No Content for successful delete
    return res.status(HTTP_STATUS.NO_CONTENT).send();
  } catch (error) {
    if (error.code === 'P2025') {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'InboundReceipt not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    next(error);
  }
};
