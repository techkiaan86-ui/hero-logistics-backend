const prisma = require('../utils/prismaClient');
const { sendSuccess, sendList, sendError } = require('../utils/apiResponse');
const { buildPrismaQuery, buildPaginationMeta } = require('../utils/queryBuilder');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

// Get all Branches with pagination, sorting and filtering — scoped by tenant
exports.getAll = async (req, res, next) => {
  try {
    const { where, skip, take, orderBy, currentPage, pageSize } = buildPrismaQuery(req.query);

    // Tenant isolation: only return branches belonging to this company
    if (req.tenantId) where.companyId = req.tenantId;

    const [data, total] = await Promise.all([
      prisma.branch.findMany({
        where, skip, take, orderBy,
        include: {
          _count: {
            select: { drivers: true, warehouses: true, assets: true, users: true, loads: true }
          }
        }
      }),
      prisma.branch.count({ where })
    ]);

    const meta = buildPaginationMeta(total, currentPage, pageSize, req.query.sort);
    return sendList(res, data, meta);
  } catch (error) {
    next(error);
  }
};

// Get single Branch by ID — scoped by tenant
exports.getById = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    if (req.tenantId) where.companyId = req.tenantId;

    const data = await prisma.branch.findFirst({
      where,
      include: {
        drivers: true,
        warehouses: true,
        assets: true,
        users: { select: { id: true, name: true, email: true, role: true, status: true } },
        _count: { select: { loads: true, vehicles: true } }
      }
    });

    if (!data) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Branch not found'
      }, HTTP_STATUS.NOT_FOUND);
    }

    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
};

// Create new Branch — always scoped to tenant
exports.create = async (req, res, next) => {
  try {
    const payload = { ...req.body };

    // Always use the authenticated tenant's companyId — never trust client-provided companyId
    if (req.tenantId) {
      payload.companyId = req.tenantId;
    } else if (!payload.companyId) {
      // Dev/SUPER_ADMIN fallback
      const firstCompany = await prisma.company.findFirst();
      if (firstCompany) {
        payload.companyId = firstCompany.id;
      }
    }

    if (!payload.companyId) {
      return sendError(res, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Company context is required to create a branch.'
      }, HTTP_STATUS.BAD_REQUEST);
    }

    const data = await prisma.branch.create({
      data: {
        name: payload.name || payload.branchName || 'New Branch',
        location: payload.location || payload.address || payload.state || null,
        companyId: payload.companyId
      }
    });
    return sendSuccess(res, data, HTTP_STATUS.CREATED);
  } catch (error) {
    next(error);
  }
};

// Update Branch — with tenant ownership check
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, location, branchName, address, state } = req.body;

    // Verify branch belongs to this tenant before updating
    const whereCheck = { id };
    if (req.tenantId) whereCheck.companyId = req.tenantId;

    const existing = await prisma.branch.findFirst({ where: whereCheck });
    if (!existing) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Branch not found or access denied'
      }, HTTP_STATUS.NOT_FOUND);
    }

    try {
      const data = await prisma.branch.update({
        where: { id },
        data: {
          name: name || branchName || undefined,
          location: location || address || state || undefined
        }
      });
      return sendSuccess(res, data);
    } catch (e) {
      throw e;
    }
  } catch (error) {
    next(error);
  }
};

// Delete Branch — with tenant ownership check and safe cleanup of all linked resources
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify branch belongs to this tenant before deleting
    const whereCheck = { id };
    if (req.tenantId) whereCheck.companyId = req.tenantId;
    const existing = await prisma.branch.findFirst({ where: whereCheck });
    if (!existing) {
      // Not found or not owned by this tenant — return 204 silently
      return res.status(HTTP_STATUS.NO_CONTENT).send();
    }

    // Safe cleanup: null-out all foreign keys pointing to this branch
    await Promise.allSettled([
      prisma.driver.updateMany({ where: { branchId: id }, data: { branchId: null } }),
      prisma.warehouse.updateMany({ where: { branchId: id }, data: { branchId: null } }),
      prisma.asset.updateMany({ where: { branchId: id }, data: { branchId: null } }),
      prisma.user.updateMany({ where: { branchId: id }, data: { branchId: null } }),
      prisma.vehicle.updateMany({ where: { branchId: id }, data: { branchId: null } }),
      prisma.customer.updateMany({ where: { branchId: id }, data: { branchId: null } }),
    ]);

    await prisma.branch.delete({ where: { id } });
    // 204 No Content for successful delete
    return res.status(HTTP_STATUS.NO_CONTENT).send();
  } catch (error) {
    try {
      await prisma.$executeRawUnsafe(`SET FOREIGN_KEY_CHECKS=1`);
    } catch (e) {}

    if (error.code === 'P2025') {
      return res.status(HTTP_STATUS.NO_CONTENT).send();
    }
    next(error);
  }
};
