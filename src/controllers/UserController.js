const bcrypt = require('bcryptjs');
const prisma = require('../utils/prismaClient');
const { sendSuccess, sendList, sendError } = require('../utils/apiResponse');
const { buildPrismaQuery, buildPaginationMeta } = require('../utils/queryBuilder');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

const PLATFORM_ROLES = [
  'SUPER_ADMIN', 'PLATFORM_OWNER', 'PLATFORM_ADMIN', 'SALES',
  'ONBOARDING', 'SUPPORT_AGENT', 'PLATFORM_FINANCE', 'TECHNICAL_SUPPORT', 'AUDITOR'
];

const TENANT_ROLES = [
  'COMPANY_ADMIN', 'DISPATCHER', 'DRIVER', 'WAREHOUSE', 'YARD', 'ACCOUNTS', 'CUSTOMER', 'USER'
];

// Helper to map UI role string to DB Role enum
const mapRoleEnum = (roleStr) => {
  if (!roleStr) return 'COMPANY_ADMIN';
  const rUpper = String(roleStr).toUpperCase().trim().replace(/\s+/g, '_');
  const validRoles = [
    'SUPER_ADMIN', 'PLATFORM_OWNER', 'PLATFORM_ADMIN', 'SALES',
    'ONBOARDING', 'SUPPORT_AGENT', 'PLATFORM_FINANCE', 'TECHNICAL_SUPPORT', 'AUDITOR',
    'COMPANY_ADMIN', 'DISPATCHER', 'DRIVER', 'WAREHOUSE', 'YARD', 'ACCOUNTS', 'CUSTOMER', 'USER'
  ];
  if (validRoles.includes(rUpper)) return rUpper;
  if (rUpper === 'ADMIN') return 'COMPANY_ADMIN';
  if (rUpper === 'DISPATCH_MANAGER') return 'DISPATCHER';
  if (rUpper === 'WAREHOUSE_MANAGER') return 'WAREHOUSE';
  if (rUpper === 'CUSTOMER_USER') return 'CUSTOMER';
  return 'COMPANY_ADMIN';
};

// Helper to map UI status string to DB UserStatus enum
const mapStatusEnum = (statusStr) => {
  if (!statusStr) return 'ACTIVE';
  const sUpper = String(statusStr).toUpperCase().trim();
  if (sUpper === 'ACTIVE') return 'ACTIVE';
  if (sUpper === 'INACTIVE' || sUpper === 'SUSPENDED') return 'SUSPENDED';
  if (sUpper === 'PENDING') return 'PENDING';
  return 'ACTIVE';
};

// Get all Users with pagination, sorting and filtering
exports.getAll = async (req, res, next) => {
  try {
    const { where, skip, take, orderBy, currentPage, pageSize } = buildPrismaQuery(req.query);

    if (req.tenantId) {
      where.companyId = req.tenantId;
    }

    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where, skip, take, orderBy,
        include: {
          company: { select: { id: true, name: true } }
        }
      }),
      prisma.user.count({ where })
    ]);

    const meta = buildPaginationMeta(total, currentPage, pageSize, req.query.sort);
    return sendList(res, data, meta);
  } catch (error) {
    next(error);
  }
};

// Get single User by ID
exports.getById = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    if (req.tenantId) {
      where.companyId = req.tenantId;
    }

    const data = await prisma.user.findFirst({ where });
    
    if (!data) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'User not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
};

// Create new User
exports.create = async (req, res, next) => {
  try {
    const { name, email, password, role, phone, status } = req.body;

    if (!email) {
      return sendError(res, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Email address is required'
      }, HTTP_STATUS.BAD_REQUEST);
    }

    const roleEnum = mapRoleEnum(role);
    const statusEnum = mapStatusEnum(status);
    const rawPassword = password || 'HeroPass@123';
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    let companyId = req.body.companyId;
    if (req.tenantId) {
      if (PLATFORM_ROLES.includes(roleEnum)) {
        return sendError(res, {
          code: ERROR_CODES.UNAUTHORIZED_ACCESS,
          message: 'You cannot create platform staff users.'
        }, HTTP_STATUS.FORBIDDEN);
      }
      companyId = req.tenantId;
    } else if (PLATFORM_ROLES.includes(roleEnum)) {
      companyId = null;
    } else if (TENANT_ROLES.includes(roleEnum)) {
      if (!companyId) {
        const comp = await prisma.company.findFirst();
        if (comp) {
          companyId = comp.id;
        } else {
          return sendError(res, {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Company context (companyId) is required for tenant users.'
          }, HTTP_STATUS.BAD_REQUEST);
        }
      }
    }

    const userCount = await prisma.user.count();
    const userCode = `US-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

    const data = await prisma.user.create({
      data: {
        email: email.trim().toLowerCase(),
        name: name ? name.trim() : 'New System User',
        password: hashedPassword,
        role: roleEnum,
        phone: phone ? phone.trim() : null,
        status: statusEnum,
        userCode,
        companyId: companyId || null
      },
      include: {
        company: { select: { id: true, name: true } }
      }
    });

    if (data && data.password) {
      delete data.password;
    }

    return sendSuccess(res, data, HTTP_STATUS.CREATED);
  } catch (error) {
    if (error.code === 'P2002') {
      return sendError(res, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'A user with this email address already exists.'
      }, HTTP_STATUS.BAD_REQUEST);
    }
    next(error);
  }
};

// Update User
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, password, role, phone, status, companyId } = req.body;

    if (req.tenantId) {
      const existingUser = await prisma.user.findFirst({
        where: { id, companyId: req.tenantId }
      });
      if (!existingUser) {
        return sendError(res, {
          code: ERROR_CODES.NOT_FOUND,
          message: 'User not found in this company context'
        }, HTTP_STATUS.NOT_FOUND);
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (email !== undefined) updateData.email = email.trim().toLowerCase();
    if (phone !== undefined) updateData.phone = phone ? phone.trim() : null;
    if (status !== undefined) updateData.status = mapStatusEnum(status);
    
    let roleEnum = undefined;
    if (role !== undefined) {
      roleEnum = mapRoleEnum(role);
      if (req.tenantId && PLATFORM_ROLES.includes(roleEnum)) {
        return sendError(res, {
          code: ERROR_CODES.UNAUTHORIZED_ACCESS,
          message: 'You cannot assign platform staff roles.'
        }, HTTP_STATUS.FORBIDDEN);
      }
      updateData.role = roleEnum;
    }

    if (roleEnum !== undefined || companyId !== undefined) {
      let currentRole = roleEnum;
      if (!currentRole) {
        const userRec = await prisma.user.findUnique({ where: { id } });
        currentRole = userRec?.role;
      }
      
      if (PLATFORM_ROLES.includes(currentRole)) {
        updateData.companyId = null;
      } else {
        if (req.tenantId) {
          updateData.companyId = req.tenantId;
        } else if (companyId !== undefined) {
          updateData.companyId = companyId || null;
        }
      }
    }

    if (password && password.trim().length > 0) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    try {
      const data = await prisma.user.update({
        where: { id },
        data: updateData,
        include: {
          company: { select: { id: true, name: true } }
        }
      });
      return sendSuccess(res, data);
    } catch (e) {
      if (e.code === 'P2025') {
        return sendError(res, {
          code: ERROR_CODES.NOT_FOUND,
          message: 'User not found'
        }, HTTP_STATUS.NOT_FOUND);
      }
      if (e.code === 'P2002') {
        return sendError(res, {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'A user with this email address already exists.'
        }, HTTP_STATUS.BAD_REQUEST);
      }
      throw e;
    }
  } catch (error) {
    next(error);
  }
};

// Delete User
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.tenantId) {
      const existingUser = await prisma.user.findFirst({
        where: { id, companyId: req.tenantId }
      });
      if (!existingUser) {
        return sendError(res, {
          code: ERROR_CODES.NOT_FOUND,
          message: 'User not found in this company context'
        }, HTTP_STATUS.NOT_FOUND);
      }
    }

    const where = { id };
    
    // Clean up safe dependent records
    await prisma.userSession.deleteMany({ where: { userId: id } });
    await prisma.shift.deleteMany({ where: { userId: id } });
    
    // Disconnect optional relations
    await prisma.driver.updateMany({ where: { userId: id }, data: { userId: null } });

    await prisma.user.delete({ where });
    return res.status(HTTP_STATUS.NO_CONTENT).send();
  } catch (error) {
    if (error.code === 'P2003') {
      return sendError(res, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Cannot delete user because they have associated records (e.g. support tickets, messages, or reports). Please suspend the user instead.'
      }, HTTP_STATUS.BAD_REQUEST);
    }
    if (error.code === 'P2025') {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'User not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    next(error);
  }
};

