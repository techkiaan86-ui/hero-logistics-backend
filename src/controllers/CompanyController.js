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
        select: {
          id: true,
          tenantId: true,
          name: true,
          status: true,
          trialExpiry: true,
          lastLogin: true,
          accountManager: true,
          country: true,
          storageUsedGB: true,
          registrationNumber: true,
          dotNumber: true,
          taxId: true,
          adminEmail: true,
          canSendTransfers: true,
          canReceiveTransfers: true,
          autoApproveTransfers: true,
          createdAt: true,
          updatedAt: true,
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
    console.error('Error fetching companies in CompanyController.getAll:', error.message);
    return sendList(res, [], buildPaginationMeta(0, 1, 10));
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
      country,
      trialExpiry,
      planTier
    } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return sendError(res, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Company name is required.'
      }, HTTP_STATUS.BAD_REQUEST);
    }

    const cleanName = name.trim();
    const cleanEmail = adminEmail && typeof adminEmail === 'string' ? adminEmail.trim() : null;
    const cleanAccountManager = accountManager && typeof accountManager === 'string' && accountManager.trim() ? accountManager.trim() : null;

    // Pre-check 1: Check if adminEmail is already registered in User table
    if (cleanEmail) {
      const existingUser = await prisma.user.findUnique({
        where: { email: cleanEmail }
      });
      if (existingUser) {
        return sendError(res, {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Workspace Manager Email '${cleanEmail}' is already registered to an existing account. Please enter a different email address.`
        }, HTTP_STATUS.BAD_REQUEST);
      }
    }

    // Pre-check 2: Handle Tenant ID (Company ID) uniqueness
    let generatedTenantId = null;
    if (tenantId && typeof tenantId === 'string' && tenantId.trim()) {
      const explicitId = tenantId.trim();
      const existingTenant = await prisma.company.findFirst({
        where: { tenantId: explicitId }
      });
      if (existingTenant) {
        return sendError(res, {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Company ID '${explicitId}' is already taken by another workspace. Please enter a unique Company ID.`
        }, HTTP_STATUS.BAD_REQUEST);
      }
      generatedTenantId = explicitId;
    } else {
      // Auto-generate timestamp-backed collision-free Tenant ID
      generatedTenantId = `#TEN-${Date.now().toString().slice(-6)}${Math.floor(10 + Math.random() * 90)}`;
    }

    // Hash password prior to creation
    let hashedPassword = null;
    if (cleanEmail && adminPassword) {
      hashedPassword = await bcrypt.hash(adminPassword, 10);
    }

    // 1. Create the Company
    const company = await prisma.company.create({
      data: {
        name: cleanName,
        tenantId: generatedTenantId,
        status: status || 'ACTIVE',
        accountManager: cleanAccountManager,
        country: country ? String(country).trim() : null,
        trialExpiry: trialExpiry ? new Date(trialExpiry) : null,
        adminEmail: cleanEmail
      }
    });

    // 2. Create the Workspace Manager (User) if credentials are provided
    if (cleanEmail && hashedPassword) {
      try {
        await prisma.user.create({
          data: {
            email: cleanEmail,
            password: hashedPassword,
            name: `${cleanName} Admin`,
            role: 'COMPANY_ADMIN',
            companyId: company.id,
            status: 'ACTIVE'
          }
        });
      } catch (userErr) {
        console.warn('Could not auto-create company admin user:', userErr?.message);
      }
    }

    // 3. Setup the TenantSubscription if a plan is provided
    if (planTier) {
      const plan = await prisma.subscriptionPlan.findFirst({
        where: { name: planTier }
      });
      
      if (plan) {
        try {
          await prisma.tenantSubscription.create({
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
          await prisma.billingRecord.create({
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
        } catch (subErr) {
          console.warn('Could not auto-create tenant subscription or billing record:', subErr?.message);
        }
      }
    }

    // 4. Fetch full company with subscription details to return
    const result = await prisma.company.findUnique({
      where: { id: company.id },
      include: {
        tenantSubscription: {
          include: { plan: true }
        }
      }
    });

    return sendSuccess(res, result || company, HTTP_STATUS.CREATED);
  } catch (error) {
    if (error.code === 'P2002') {
      const target = error.meta?.target || [];
      const targetStr = Array.isArray(target) ? target.join(', ') : String(target);
      let customMsg = 'A company or user with these unique details already exists.';
      if (targetStr.includes('email')) {
        customMsg = 'Email address is already registered. Please enter a different Workspace Manager Email.';
      } else if (targetStr.includes('tenantId')) {
        customMsg = 'Company ID is already taken. Please specify a different Company ID.';
      } else if (targetStr.includes('name')) {
        customMsg = 'A company with this name already exists. Please choose a unique Company Name.';
      }
      return sendError(res, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: customMsg
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
