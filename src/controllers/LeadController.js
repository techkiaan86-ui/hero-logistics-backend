const prisma = require('../utils/prismaClient');
const bcrypt = require('bcryptjs');
const { sendSuccess, sendList, sendError } = require('../utils/apiResponse');
const { buildPrismaQuery, buildPaginationMeta } = require('../utils/queryBuilder');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

// Valid Stage Definitions
const VALID_STAGES = [
  'NEW_LEAD',
  'CONTACTED',
  'DEMO_BOOKED',
  'DEMO_COMPLETED',
  'TRIAL_STARTED',
  'PROPOSAL_SENT',
  'NEGOTIATING',
  'WON',
  'LOST'
];

// Get all Leads with pagination, sorting, filtering and RBAC scoping
exports.getAll = async (req, res, next) => {
  try {
    const { where, skip, take, orderBy, currentPage, pageSize } = buildPrismaQuery(req.query);
    
    // RBAC Data Scoping
    if (req.salesScope === 'OWN' && req.user && req.user.id) {
      where.repId = req.user.id;
    } else if (req.query.repId) {
      if (req.query.repId === 'unassigned') {
        where.repId = null;
      } else {
        where.repId = req.query.repId;
      }
    }

    const [data, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          rep: {
            select: { id: true, name: true, email: true, role: true }
          },
          demos: {
            orderBy: { scheduledAt: 'desc' }
          },
          proposals: {
            orderBy: { createdAt: 'desc' }
          },
          tasks: {
            orderBy: { dueDate: 'asc' }
          },
          activities: {
            orderBy: { timestamp: 'desc' },
            take: 10
          }
        }
      }),
      prisma.lead.count({ where })
    ]);

    const meta = buildPaginationMeta(total, currentPage, pageSize, req.query.sort);
    return sendList(res, data, meta);
  } catch (error) {
    next(error);
  }
};

// Get single Lead by ID with relations
exports.getById = async (req, res, next) => {
  try {
    const where = { id: req.params.id };

    // Scoping check for SALES_REP
    if (req.salesScope === 'OWN' && req.user && req.user.id) {
      where.repId = req.user.id;
    }

    const data = await prisma.lead.findFirst({
      where,
      include: {
        rep: {
          select: { id: true, name: true, email: true, role: true }
        },
        demos: {
          orderBy: { scheduledAt: 'desc' }
        },
        proposals: {
          orderBy: { createdAt: 'desc' }
        },
        tasks: {
          orderBy: { dueDate: 'asc' }
        },
        activities: {
          orderBy: { timestamp: 'desc' }
        }
      }
    });
    
    if (!data) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Lead not found or access denied.'
      }, HTTP_STATUS.NOT_FOUND);
    }
    
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
};

// Helper to safely check if a user ID is a valid foreign key in the database
const resolveValidUserId = async (id) => {
  if (!id || typeof id !== 'string' || id.length !== 36) return null;
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    return user ? user.id : null;
  } catch {
    return null;
  }
};

// Create new Lead
exports.create = async (req, res, next) => {
  try {
    const payload = { ...req.body };

    // Auto-assign rep if valid
    if (payload.repId) {
      payload.repId = await resolveValidUserId(payload.repId);
    } else if (req.user && req.user.role === 'SALES') {
      payload.repId = await resolveValidUserId(req.user.id);
    }

    const data = await prisma.lead.create({
      data: payload,
      include: {
        rep: { select: { id: true, name: true, email: true } }
      }
    });

    const actorId = await resolveValidUserId(req.user?.id);

    // Create initial Sales Activity audit record
    await prisma.salesActivity.create({
      data: {
        leadId: data.id,
        title: 'Lead Created',
        description: `Lead intake registered for ${data.companyName} (${data.transportNiche || 'General Freight'})`,
        performedById: actorId,
        timestamp: new Date()
      }
    });

    return sendSuccess(res, data, HTTP_STATUS.CREATED);
  } catch (error) {
    next(error);
  }
};

// Update Lead details
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const where = { id };

    // Scope protection
    if (req.salesScope === 'OWN' && req.user && req.user.id) {
      where.repId = req.user.id;
    }

    // Don't allow direct rep reassignment via general update if not authorized
    if (updateData.repId && req.salesScope === 'OWN') {
      delete updateData.repId;
    }

    const data = await prisma.lead.update({
      where,
      data: updateData,
      include: {
        rep: { select: { id: true, name: true, email: true } }
      }
    });

    // Log update activity
    const updateActorId = await resolveValidUserId(req.user?.id);
    await prisma.salesActivity.create({
      data: {
        leadId: data.id,
        title: 'Lead Profile Updated',
        description: `Lead details modified for ${data.companyName}`,
        performedById: updateActorId,
        timestamp: new Date()
      }
    });

    return sendSuccess(res, data);
  } catch (error) {
    if (error.code === 'P2025') {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Lead not found or unauthorized.'
      }, HTTP_STATUS.NOT_FOUND);
    }
    next(error);
  }
};

// Update Pipeline Stage with Transition Validation
exports.updateStage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { stage, reason, notes } = req.body;

    if (!stage || !VALID_STAGES.includes(stage)) {
      return sendError(res, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}`
      }, HTTP_STATUS.BAD_REQUEST);
    }

    const where = { id };
    if (req.salesScope === 'OWN' && req.user && req.user.id) {
      where.repId = req.user.id;
    }

    const lead = await prisma.lead.findFirst({ where });
    if (!lead) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Lead not found or access denied.'
      }, HTTP_STATUS.NOT_FOUND);
    }

    const oldStage = lead.stage;
    const updatePayload = { stage };
    if (notes) {
      updatePayload.painPoints = notes;
    }

    const updatedLead = await prisma.lead.update({
      where: { id },
      data: updatePayload,
      include: {
        rep: { select: { id: true, name: true, email: true } }
      }
    });

    const stageActorId = await resolveValidUserId(req.user?.id);

    // Log stage transition in SalesActivity
    await prisma.salesActivity.create({
      data: {
        leadId: id,
        title: `Stage Changed: ${oldStage} -> ${stage}`,
        description: reason || `Pipeline stage transitioned to ${stage}`,
        performedById: stageActorId,
        timestamp: new Date()
      }
    });

    return sendSuccess(res, updatedLead);
  } catch (error) {
    next(error);
  }
};

// Assign / Reassign Sales Rep (Authorized Full Access / Super Admin only)
exports.assignRep = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { repId } = req.body;

    // Check authorization: SALES_REP cannot reassign leads
    if (req.salesScope === 'OWN') {
      return sendError(res, {
        code: ERROR_CODES.UNAUTHORIZED_ACCESS,
        message: 'Only Sales Full Access or Super Admin can assign/reassign Sales Reps.'
      }, HTTP_STATUS.FORBIDDEN);
    }

    let repName = 'Unassigned';
    let validRepId = null;
    if (repId) {
      const repUser = await prisma.user.findUnique({
        where: { id: repId }
      });
      if (!repUser) {
        return sendError(res, {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Selected Sales Representative user was not found.'
        }, HTTP_STATUS.NOT_FOUND);
      }
      repName = repUser.name || repUser.email;
      validRepId = repUser.id;
    }

    const updatedLead = await prisma.lead.update({
      where: { id },
      data: { repId: validRepId },
      include: {
        rep: { select: { id: true, name: true, email: true } }
      }
    });

    const assignActorId = await resolveValidUserId(req.user?.id);

    // Audit assignment
    await prisma.salesActivity.create({
      data: {
        leadId: id,
        title: 'Sales Rep Assigned',
        description: `Lead assigned to ${repName}`,
        performedById: assignActorId,
        timestamp: new Date()
      }
    });

    return sendSuccess(res, updatedLead);
  } catch (error) {
    next(error);
  }
};

// Delete Lead
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Delete related records first to avoid foreign key constraint errors
    await prisma.$transaction([
      prisma.demoBooking.deleteMany({ where: { leadId: id } }),
      prisma.proposal.deleteMany({ where: { leadId: id } }),
      prisma.followUpTask.deleteMany({ where: { leadId: id } }),
      prisma.salesActivity.deleteMany({ where: { leadId: id } }),
      prisma.lead.delete({ where: { id } })
    ]);
    
    return res.status(HTTP_STATUS.NO_CONTENT).send();
  } catch (error) {
    if (error.code === 'P2025') {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Lead not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    next(error);
  }
};

// Convert Lead to Company tenant (Provisioning)
exports.convertToCompany = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { selectedPlan = 'Professional', companyName, adminName, adminEmail } = req.body;

    const lead = await prisma.lead.findUnique({
      where: { id }
    });

    if (!lead) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Lead not found'
      }, HTTP_STATUS.NOT_FOUND);
    }

    // Default password for newly provisioned company admin
    const passwordHash = await bcrypt.hash('123456', 10);

    // Find the subscription plan
    let plan = await prisma.subscriptionPlan.findFirst({
      where: { name: selectedPlan }
    });

    if (!plan) {
      plan = await prisma.subscriptionPlan.findFirst();
    }

    const finalCompanyName = companyName || lead.companyName;
    const finalAdminEmail = adminEmail || lead.email;
    const finalAdminName = adminName || lead.contactName;

    // 1. Create Company Tenant
    const company = await prisma.company.create({
      data: {
        name: finalCompanyName,
        status: 'ACTIVE',
        leadId: lead.id,
        nicheCarCarrying: lead.transportNiche?.includes('Car Carrying') || false,
        nicheGeneralFreight: !lead.transportNiche?.includes('Car Carrying'),
        defaultNiche: lead.transportNiche || 'General Freight',
        adminEmail: finalAdminEmail,
        tenantId: `#TEN-${Math.floor(100 + Math.random() * 900)}`
      }
    });

    // 2. Create User (COMPANY_ADMIN)
    const adminUser = await prisma.user.create({
      data: {
        email: finalAdminEmail,
        password: passwordHash,
        name: finalAdminName,
        role: 'COMPANY_ADMIN',
        status: 'ACTIVE',
        companyId: company.id,
        phone: lead.phone
      }
    });

    // 3. Create TenantSubscription
    if (plan) {
      await prisma.tenantSubscription.create({
        data: {
          subId: `SUB-${Math.floor(1000 + Math.random() * 9000)}`,
          companyId: company.id,
          planId: plan.id,
          status: 'ACTIVE',
          amount: plan.monthlyPrice,
          nextRenewal: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });
    }

    // 4. Update Lead to WON and log company reference
    const updatedLead = await prisma.lead.update({
      where: { id: lead.id },
      data: {
        stage: 'WON',
        painPoints: `Converted to Company: ${company.name} (Admin ID: ${adminUser.id}, Tenant: ${company.tenantId})`
      }
    });

    const convertActorId = await resolveValidUserId(req.user?.id || lead.repId);

    // 5. Create a Sales Activity
    await prisma.salesActivity.create({
      data: {
        leadId: lead.id,
        title: 'Lead Converted to Company',
        description: `Successfully created Company: ${company.name} (${company.tenantId}) and Admin User: ${adminUser.email}`,
        performedById: convertActorId,
        timestamp: new Date()
      }
    });

    return sendSuccess(res, {
      lead: updatedLead,
      company,
      adminUser
    });

  } catch (error) {
    next(error);
  }
};
