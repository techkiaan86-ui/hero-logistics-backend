const prisma = require('../utils/prismaClient');
const { sendSuccess, sendList, sendError } = require('../utils/apiResponse');
const { buildPrismaQuery, buildPaginationMeta } = require('../utils/queryBuilder');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

// Get all Companys with pagination, sorting and filtering
exports.getAll = async (req, res, next) => {
  try {
    const { where, skip, take, orderBy, currentPage, pageSize } = buildPrismaQuery(req.query);
    
    // Optional: Inject tenant scope here if applicable
    // if (req.tenantId) where.tenantId = req.tenantId;

    const [data, total] = await Promise.all([
      prisma.company.findMany({
        where, skip, take, orderBy,
        include: {
          _count: {
            select: {
              users: true,
              drivers: true,
              vehicles: true,
              branches: true,
              loads: true
            }
          },
          tenantSubscription: {
            include: {
              plan: true
            }
          }
        }
      }),
      prisma.company.count({ where })
    ]);

    const meta = buildPaginationMeta(total, currentPage, pageSize, req.query.sort);
    return sendList(res, data, meta);
  } catch (error) {
    next(error);
  }
};

// Get single Company by ID
exports.getById = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    // if (req.tenantId) where.tenantId = req.tenantId;

    const data = await prisma.company.findFirst({ where });
    
    if (!data) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Company not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
};

const bcrypt = require('bcryptjs');

// Create new Company
exports.create = async (req, res, next) => {
  try {
    const {
      name,
      tenantId,
      adminEmail,
      adminPassword,
      status,
      accountManager,
      trialExpiry,
      planTier
    } = req.body;

    // Use a transaction to ensure all related records are created safely
      const data = await prisma.$transaction(async (tx) => {
      // 1. Create the Company
      const generatedTenantId = tenantId || `#TEN-${Math.floor(1000 + Math.random() * 9000)}`;
      
      const company = await tx.company.create({
        data: {
          name,
          tenantId: generatedTenantId,
          status: status || 'ACTIVE',
          accountManager: accountManager || null,
          trialExpiry: trialExpiry ? new Date(trialExpiry) : null,
          adminEmail
        }
      });

      // 2. Create the Workspace Manager (User) if credentials are provided
      if (adminEmail && adminPassword) {
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        await tx.user.create({
          data: {
            email: adminEmail,
            password: hashedPassword,
            name: 'Workspace Manager',
            role: 'COMPANY_ADMIN',
            companyId: company.id,
            status: 'ACTIVE'
          }
        });
      }

      // 3. Setup the TenantSubscription if a plan is provided
      if (planTier) {
        // Find the subscription plan
        const plan = await tx.subscriptionPlan.findFirst({
          where: { name: planTier }
        });
        
        if (plan) {
          await tx.tenantSubscription.create({
            data: {
              subId: `SUB-${Date.now()}`,
              companyId: company.id,
              planId: plan.id,
              status: 'ACTIVE',
              amount: plan.monthlyPrice,
              nextRenewal: new Date(new Date().setMonth(new Date().getMonth() + 1))
            }
          });

          // Auto-generate initial Billing Record (Invoice)
          await tx.billingRecord.create({
            data: {
              invoiceNumber: `INV-${Date.now()}`,
              amount: plan.monthlyPrice,
              status: 'PAID', // Set initial invoice to PAID for MRR/Revenue metrics
              planTierSnapshot: plan.name,
              companyId: company.id,
              periodStart: new Date(),
              periodEnd: new Date(new Date().setMonth(new Date().getMonth() + 1)),
              dueDate: new Date(new Date().setDate(new Date().getDate() + 7))
            }
          });
        }
      }

      return company;
    });

    return sendSuccess(res, data, HTTP_STATUS.CREATED);
  } catch (error) {
    if (error.code === 'P2002') {
      return sendError(res, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'A company or user with these unique details already exists.'
      }, HTTP_STATUS.BAD_REQUEST);
    }
    next(error);
  }
};

// Update Company with Optimistic Concurrency check
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
      const data = await prisma.company.update({
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
          message: 'Company not found'
        }, HTTP_STATUS.NOT_FOUND);
      }
      throw e;
    }
  } catch (error) {
    next(error);
  }
};

// Delete Company
exports.delete = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    // if (req.tenantId) where.tenantId = req.tenantId;

    await prisma.company.delete({ where });
    
    // 204 No Content for successful delete
    return res.status(HTTP_STATUS.NO_CONTENT).send();
  } catch (error) {
    if (error.code === 'P2025') {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Company not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    next(error);
  }
};
