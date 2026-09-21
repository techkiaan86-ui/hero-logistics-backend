const prisma = require('../utils/prismaClient');
const { sendSuccess, sendList, sendError } = require('../utils/apiResponse');
const { buildPrismaQuery, buildPaginationMeta } = require('../utils/queryBuilder');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

// Get all Companys with pagination, sorting and filtering
exports.getAll = async (req, res, next) => {
  try {
    const { where, skip, take, orderBy, currentPage, pageSize } = buildPrismaQuery(req.query);
    
    // Enforce tenant scoping
    const { resolveCompanyId } = require('../middlewares/tenantResolver');
    const companyId = resolveCompanyId(req);
    
    if (req.user?.role !== 'SUPER_ADMIN') {
      if (!companyId) {
        return sendList(res, [], buildPaginationMeta(0, currentPage, pageSize, req.query.sort));
      }
      where.id = companyId;
    } else if (req.query.companyId) {
      where.id = req.query.companyId;
    }

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
      planTier,
      passwordSetupType
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

    // Hash password prior to creation (or auto-generate initial temp password for EMAIL_LINK mode)
    let hashedPassword = null;
    const effectivePassword = adminPassword || (passwordSetupType === 'EMAIL_LINK' || !adminPassword ? `HeroSetup_${Date.now().toString(36)}!${Math.floor(Math.random() * 1000)}` : null);
    if (cleanEmail && effectivePassword) {
      hashedPassword = await bcrypt.hash(effectivePassword, 10);
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

    await prisma.auditLog.create({
      data: {
        action: `SYSTEM::New workspace registered: ${cleanName} (${generatedTenantId}) [PasswordMode: ${passwordSetupType || (adminPassword ? 'MANUAL' : 'EMAIL_LINK')}]`,
        operator: 'System Registration',
        companyId: company.id
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

          await prisma.auditLog.create({
            data: {
              action: `BILLING::Plan subscribed: ${plan.name} at $${plan.monthlyPrice}/mo for ${cleanName}`,
              operator: 'Billing System',
              companyId: company.id
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

// Helper: Cascade delete a company and all its relational records
async function cascadeDeleteCompany(companyId) {
  if (!companyId) return;

  // 1. Delete Load children & loads
  const loads = await prisma.load.findMany({ where: { companyId }, select: { id: true } }).catch(() => []);
  const loadIds = loads.map(l => l.id);
  if (loadIds.length > 0) {
    await prisma.loadItem?.deleteMany({ where: { loadId: { in: loadIds } } }).catch(() => {});
    await prisma.routeStop?.deleteMany({ where: { loadId: { in: loadIds } } }).catch(() => {});
    await prisma.loadExpense?.deleteMany({ where: { loadId: { in: loadIds } } }).catch(() => {});
    await prisma.loadActivity?.deleteMany({ where: { loadId: { in: loadIds } } }).catch(() => {});
    await prisma.deliveryPOD?.deleteMany({ where: { loadId: { in: loadIds } } }).catch(() => {});
    await prisma.vinScanEvent?.deleteMany({ where: { loadId: { in: loadIds } } }).catch(() => {});
    await prisma.preStartChecklist?.deleteMany({ where: { loadId: { in: loadIds } } }).catch(() => {});
    await prisma.customerInvoice?.deleteMany({ where: { loadId: { in: loadIds } } }).catch(() => {});
    await prisma.itemMovement?.deleteMany({ where: { loadId: { in: loadIds } } }).catch(() => {});
    await prisma.document?.deleteMany({ where: { loadId: { in: loadIds } } }).catch(() => {});
    await prisma.load?.deleteMany({ where: { id: { in: loadIds } } }).catch(() => {});
  }

  // 2. Delete Driver children & drivers
  const drivers = await prisma.driver.findMany({ where: { companyId }, select: { id: true, userId: true } }).catch(() => []);
  const driverIds = drivers.map(d => d.id);
  if (driverIds.length > 0) {
    await prisma.payPeriod?.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
    await prisma.timesheet?.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
    await prisma.preStartChecklist?.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
    await prisma.equipmentSwap?.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
    await prisma.driverIncident?.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
    await prisma.driverMessage?.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
    await prisma.driverAllowance?.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
    await prisma.driverDeduction?.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
    await prisma.driverLeaveRequest?.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
    await prisma.driverPayRate?.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
    await prisma.driverActivity?.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
    await prisma.performanceLog?.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
    await prisma.offlineSyncItem?.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
    await prisma.deliveryPOD?.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
    await prisma.vinScanEvent?.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
    await prisma.shift?.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
    await prisma.document?.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
    await prisma.driver?.deleteMany({ where: { id: { in: driverIds } } }).catch(() => {});
  }

  // 3. Vehicles
  await prisma.vehicle?.deleteMany({ where: { companyId } }).catch(() => {});

  // 4. Warehouse & Yard
  await prisma.stagingArea?.deleteMany({ where: { warehouse: { companyId } } }).catch(() => {});
  await prisma.loadLane?.deleteMany({ where: { warehouse: { companyId } } }).catch(() => {});
  await prisma.itemMovement?.deleteMany({ where: { warehouse: { companyId } } }).catch(() => {});
  await prisma.warehouse?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.yardTask?.deleteMany({ where: { companyId } }).catch(() => {});

  // 5. Branches, Customers, Finance & Configs
  await prisma.customerInvoice?.deleteMany({ where: { customer: { companyId } } }).catch(() => {});
  await prisma.customer?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.branch?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.billingRecord?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.tenantSubscription?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.supportTicket?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.auditLog?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.whiteLabelConfig?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.companyIntegration?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.companyFeatureOverride?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.customRole?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.loadExpense?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.payPeriod?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.timesheet?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.preStartChecklist?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.equipmentSwap?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.driverMessage?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.driverIncident?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.offlineSyncItem?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.lanePricingRule?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.vehicleTypeRate?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.workflowRule?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.notificationRule?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.notificationTemplate?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.shift?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.report?.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.conversation?.deleteMany({ where: { companyId } }).catch(() => {});

  // 6. Users belonging to this company (keep SUPER_ADMIN safe)
  const users = await prisma.user.findMany({ where: { companyId, role: { not: 'SUPER_ADMIN' } }, select: { id: true } }).catch(() => []);
  const userIds = users.map(u => u.id);
  if (userIds.length > 0) {
    await prisma.userSession?.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await prisma.apiUsageLog?.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await prisma.moduleUsageLog?.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await prisma.ticketReply?.deleteMany({ where: { authorId: { in: userIds } } }).catch(() => {});
    await prisma.conversationParticipant?.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await prisma.message?.deleteMany({ where: { senderId: { in: userIds } } }).catch(() => {});
    await prisma.shift?.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await prisma.user?.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  }

  // 7. Delete the company record
  await prisma.company.delete({ where: { id: companyId } });
}

// Delete Company with Cascade Clean-up
exports.delete = async (req, res, next) => {
  try {
    const companyId = req.params.id;
    await cascadeDeleteCompany(companyId);
    return sendSuccess(res, { message: 'Company and all associated records deleted successfully' });
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

// Clean All Test Companies & Scratch Data (Preserves Super Admin)
exports.cleanAllTestCompanies = async (req, res, next) => {
  try {
    const allCompanies = await prisma.company.findMany({ select: { id: true, name: true } }).catch(() => []);
    let deletedCount = 0;
    for (const comp of allCompanies) {
      try {
        await cascadeDeleteCompany(comp.id);
        deletedCount++;
      } catch (err) {
        console.warn(`Could not delete company ${comp.name}:`, err.message);
      }
    }
    return sendSuccess(res, { message: `Successfully deleted ${deletedCount} companies and all test data.`, deletedCount });
  } catch (error) {
    next(error);
  }
};
