const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');
const { sendError } = require('../utils/apiResponse');

/**
 * Resolves the Tenant Context based on API Specification 3.3
 */
exports.resolveTenant = async (req, res, next) => {
  try {
    let tenantId = null;

    // 1. If impersonation session exists in user token
    if (req.user && req.user.impersonatedTenantId) {
      tenantId = req.user.impersonatedTenantId;
    } 
    // 2. Access token claim (tenantId or companyId)
    else if (req.user && (req.user.tenantId || req.user.companyId)) {
      tenantId = req.user.tenantId || req.user.companyId;
    }
    // 3. Query string fallback for Super Admin testing
    else if (req.user && req.user.role === 'SUPER_ADMIN' && req.query.companyId) {
      tenantId = req.query.companyId;
    }

    req.tenantId = tenantId || null;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Helper to get Prisma tenant filter for queries
 */
exports.getTenantWhere = (req) => {
  if (req.tenantId) {
    return { companyId: req.tenantId };
  }
  return {};
};

/**
 * Middleware to enforce tenant isolation strictly
 */
exports.requireTenant = (req, res, next) => {
  if (!req.tenantId && req.user?.role !== 'SUPER_ADMIN') {
    return sendError(res, {
      code: ERROR_CODES.UNAUTHORIZED_ACCESS,
      message: 'Tenant context is missing. You must operate within a tenant scope.'
    }, HTTP_STATUS.FORBIDDEN);
  }
  next();
};
