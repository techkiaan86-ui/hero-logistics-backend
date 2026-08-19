const prisma = require('../utils/prismaClient');
const syncMissingVehicleColumns = require('../utils/syncDbColumns');
const { sendSuccess, sendList, sendError } = require('../utils/apiResponse');
const { buildPrismaQuery, buildPaginationMeta } = require('../utils/queryBuilder');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

// Get all Customers with pagination, sorting and filtering
exports.getAll = async (req, res, next) => {
  try {
    await syncMissingVehicleColumns();
    const { where, skip, take, orderBy, currentPage, pageSize } = buildPrismaQuery(req.query);
    
    if (req.tenantId) where.companyId = req.tenantId;
    if (req.user && req.user.role === 'DISPATCHER' && req.user.branchId && !req.user.permissions?.includes('dispatch.cross_branch.view')) {
      where.branchId = req.user.branchId;
    }

    const [data, total] = await Promise.all([
      prisma.customer.findMany({
        where, skip, take, orderBy,
        include: {
          accountManager: true,
          loads: { take: 5, orderBy: { createdAt: 'desc' } },
          invoices: { take: 5, orderBy: { createdAt: 'desc' } }
        }
      }),
      prisma.customer.count({ where })
    ]);

    const meta = buildPaginationMeta(total, currentPage, pageSize, req.query.sort);
    return sendList(res, data, meta);
  } catch (error) {
    next(error);
  }
};

// Get single Customer by ID
exports.getById = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    if (req.tenantId) where.companyId = req.tenantId;
    if (req.user && req.user.role === 'DISPATCHER' && req.user.branchId && !req.user.permissions?.includes('dispatch.cross_branch.view')) {
      where.branchId = req.user.branchId;
    }

    const data = await prisma.customer.findFirst({
      where,
      include: {
        accountManager: true,
        loads: true,
        invoices: true
      }
    });
    
    if (!data) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Customer not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
};

// Create new Customer
exports.create = async (req, res, next) => {
  try {
    const payload = { ...req.body };
    if (req.tenantId && !payload.companyId) payload.companyId = req.tenantId;
    if (req.user && req.user.role === 'DISPATCHER' && req.user.branchId && !req.user.permissions?.includes('dispatch.cross_branch.view')) {
      payload.branchId = req.user.branchId;
    }

    if (!payload.companyId) {
      const firstCompany = await prisma.company.findFirst();
      if (firstCompany) {
        payload.companyId = firstCompany.id;
      }
    }

    const data = await prisma.customer.create({
      data: payload,
      include: {
        accountManager: true
      }
    });
    return sendSuccess(res, data, HTTP_STATUS.CREATED);
  } catch (error) {
    next(error);
  }
};

// Update Customer with Optimistic Concurrency check
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    
    const where = { id };
    if (req.tenantId) where.companyId = req.tenantId;
    if (req.user && req.user.role === 'DISPATCHER' && req.user.branchId && !req.user.permissions?.includes('dispatch.cross_branch.view')) {
      where.branchId = req.user.branchId;
    }

    // Check version if optimistic concurrency is required
    const ifMatch = req.headers['if-match'];
    if (ifMatch) {
      where.version = parseInt(ifMatch.replace(/"/g, ''), 10);
    }

    try {
      const data = await prisma.customer.update({
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
          message: 'Customer not found'
        }, HTTP_STATUS.NOT_FOUND);
      }
      throw e;
    }
  } catch (error) {
    next(error);
  }
};

// Delete Customer
exports.delete = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    if (req.tenantId) where.companyId = req.tenantId;
    if (req.user && req.user.role === 'DISPATCHER' && req.user.branchId && !req.user.permissions?.includes('dispatch.cross_branch.view')) {
      where.branchId = req.user.branchId;
    }

    await prisma.customer.delete({ where });
    
    // 204 No Content for successful delete
    return res.status(HTTP_STATUS.NO_CONTENT).send();
  } catch (error) {
    if (error.code === 'P2025') {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Customer not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    next(error);
  }
};

// Add contact to Customer (POST /api/v1/customers/:id/contacts)
exports.addContact = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, role, email, phone, isPrimary } = req.body;

    if (!firstName) {
      return sendError(res, { code: ERROR_CODES.VALIDATION_ERROR, message: 'First name is required' }, HTTP_STATUS.BAD_REQUEST);
    }

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      return sendError(res, { code: ERROR_CODES.NOT_FOUND, message: 'Customer not found' }, HTTP_STATUS.NOT_FOUND);
    }

    const newContact = {
      id: Date.now().toString(),
      firstName,
      lastName: lastName || '',
      role: role || 'Contact',
      email: email || 'N/A',
      phone: phone || 'N/A',
      isPrimary: !!isPrimary,
      createdAt: new Date().toISOString()
    };

    const updateData = {
      contactName: `${firstName} ${lastName || ''}`.trim(),
      email: email || customer.email,
      phone: phone || customer.phone
    };

    const updatedCustomer = await prisma.customer.update({
      where: { id },
      data: updateData
    });

    return sendSuccess(res, {
      contact: newContact,
      customer: updatedCustomer
    }, HTTP_STATUS.CREATED);
  } catch (error) {
    next(error);
  }
};

// Get contacts for Customer (GET /api/v1/customers/:id/contacts)
exports.getContacts = async (req, res, next) => {
  try {
    const { id } = req.params;
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      return sendError(res, { code: ERROR_CODES.NOT_FOUND, message: 'Customer not found' }, HTTP_STATUS.NOT_FOUND);
    }

    const contacts = [];
    if (customer.contactName || customer.email || customer.phone) {
      const parts = (customer.contactName || '').trim().split(' ');
      contacts.push({
        id: '1',
        firstName: parts[0] || 'Primary',
        lastName: parts.slice(1).join(' ') || 'Contact',
        role: 'Primary Contact',
        email: customer.email || 'N/A',
        phone: customer.phone || 'N/A',
        isPrimary: true
      });
    }

    return sendSuccess(res, contacts);
  } catch (error) {
    next(error);
  }
};
