const prisma = require('../utils/prismaClient');
const { sendSuccess, sendList, sendError } = require('../utils/apiResponse');
const { buildPrismaQuery, buildPaginationMeta } = require('../utils/queryBuilder');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

// Get all Proposals with pagination, sorting and filtering
exports.getAll = async (req, res, next) => {
  try {
    const { where, skip, take, orderBy, currentPage, pageSize } = buildPrismaQuery(req.query);
    
    // RBAC Scoping
    if (req.salesScope === 'OWN' && req.user && req.user.id) {
      where.lead = { repId: req.user.id };
    } else if (req.query.repId) {
      where.lead = { repId: req.query.repId };
    }

    const [data, total] = await Promise.all([
      prisma.proposal.findMany({
        where,
        skip,
        take,
        orderBy: orderBy.length ? orderBy : [{ createdAt: 'desc' }],
        include: {
          lead: {
            select: { id: true, companyName: true, contactName: true, email: true, phone: true, stage: true, repId: true, rep: { select: { id: true, name: true } } }
          }
        }
      }),
      prisma.proposal.count({ where })
    ]);

    const meta = buildPaginationMeta(total, currentPage, pageSize, req.query.sort);
    return sendList(res, data, meta);
  } catch (error) {
    next(error);
  }
};

// Get single Proposal by ID
exports.getById = async (req, res, next) => {
  try {
    const where = { id: req.params.id };

    const data = await prisma.proposal.findFirst({
      where,
      include: {
        lead: {
          include: { rep: { select: { id: true, name: true } } }
        }
      }
    });
    
    if (!data) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Proposal not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
};

// Create new Proposal
exports.create = async (req, res, next) => {
  try {
    const payload = { ...req.body };

    if (!payload.proposalRef) {
      payload.proposalRef = `PROP-${Math.floor(100 + Math.random() * 900)}`;
    }

    if (payload.finalValue === undefined) {
      payload.finalValue = (Number(payload.baseValue) || 0) - (Number(payload.discountAmount) || 0);
    }

    const data = await prisma.proposal.create({
      data: payload,
      include: { lead: true }
    });

    // If created in SENT status, transition lead
    if (data.status === 'SENT' && data.leadId) {
      await prisma.lead.update({
        where: { id: data.leadId },
        data: { stage: 'PROPOSAL_SENT' }
      });
    }

    // Log sales activity
    if (data.leadId) {
      await prisma.salesActivity.create({
        data: {
          leadId: data.leadId,
          title: `Proposal Created (${data.proposalRef})`,
          description: `Quote for $${data.finalValue}/mo created with validity of ${data.validityDays} days`,
          performedById: req.user?.id || null,
          timestamp: new Date()
        }
      });
    }

    return sendSuccess(res, data, HTTP_STATUS.CREATED);
  } catch (error) {
    next(error);
  }
};

// Update Proposal
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const where = { id };

    const data = await prisma.proposal.update({
      where,
      data: updateData,
      include: { lead: true }
    });

    // Synchronize Lead Stage based on proposal outcome
    if (data.leadId) {
      if (updateData.status === 'SENT') {
        await prisma.lead.update({
          where: { id: data.leadId },
          data: { stage: 'PROPOSAL_SENT' }
        });
        await prisma.salesActivity.create({
          data: {
            leadId: data.leadId,
            title: 'Proposal Dispatched',
            description: `Proposal ${data.proposalRef} sent to prospect ($${data.finalValue}/mo)`,
            performedById: req.user?.id || null,
            timestamp: new Date()
          }
        });
      } else if (updateData.status === 'ACCEPTED') {
        await prisma.lead.update({
          where: { id: data.leadId },
          data: { stage: 'WON' }
        });
        await prisma.salesActivity.create({
          data: {
            leadId: data.leadId,
            title: 'Proposal Accepted (Deal WON)',
            description: `Client agreed to terms for ${data.proposalRef} ($${data.finalValue}/mo)`,
            performedById: req.user?.id || null,
            timestamp: new Date()
          }
        });
      } else if (updateData.status === 'REJECTED') {
        await prisma.lead.update({
          where: { id: data.leadId },
          data: { stage: 'LOST' }
        });
      }
    }

    return sendSuccess(res, data);
  } catch (error) {
    if (error.code === 'P2025') {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Proposal not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    next(error);
  }
};

// Delete Proposal
exports.delete = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    await prisma.proposal.delete({ where });
    return res.status(HTTP_STATUS.NO_CONTENT).send();
  } catch (error) {
    if (error.code === 'P2025') {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Proposal not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    next(error);
  }
};
// Provision a Workspace from a Proposal
exports.provision = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tier, companyName, dotNumber, taxId, adminName, adminEmail, depotLocation } = req.body;

    const proposal = await prisma.proposal.findUnique({
      where: { id },
      include: { lead: true }
    });

    if (!proposal) {
      return sendError(res, { code: ERROR_CODES.NOT_FOUND, message: 'Proposal not found' }, HTTP_STATUS.NOT_FOUND);
    }

    const resolvedCompanyName = companyName || proposal.lead?.companyName || 'New Freight Logistics';
    const resolvedAdminEmail = adminEmail || proposal.lead?.email || `admin@${resolvedCompanyName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'company'}.com`;
    const resolvedAdminName = adminName || proposal.lead?.contactName || 'Company Administrator';

    // 1. Update proposal status
    const updatedProposal = await prisma.proposal.update({
      where: { id },
      data: { status: 'ACCEPTED' }
    });

    // 2. Update Lead if linked
    if (proposal.leadId) {
      await prisma.lead.update({
        where: { id: proposal.leadId },
        data: { stage: 'WON' }
      }).catch(e => console.warn('Could not update lead stage:', e.message));

      await prisma.salesActivity.create({
        data: {
          leadId: proposal.leadId,
          title: 'Workspace Provisioned',
          description: `Provisioned workspace for ${resolvedCompanyName} (${tier || 'Professional'} tier)`,
          performedById: req.user?.id || null,
          timestamp: new Date()
        }
      }).catch(e => console.warn('Could not log sales activity:', e.message));
    }

    // 3. Find or create company
    let targetCompany = null;
    if (proposal.leadId) {
      targetCompany = await prisma.company.findUnique({ where: { leadId: proposal.leadId } });
    }

    if (targetCompany) {
      targetCompany = await prisma.company.update({
        where: { id: targetCompany.id },
        data: {
          name: resolvedCompanyName,
          status: 'ACTIVE',
          dotNumber: dotNumber || targetCompany.dotNumber,
          taxId: taxId || targetCompany.taxId,
          adminEmail: resolvedAdminEmail
        }
      });
    } else {
      const generatedTenantCode = `#TEN-${Math.floor(1000 + Math.random() * 9000)}`;
      targetCompany = await prisma.company.create({
        data: {
          name: resolvedCompanyName,
          tenantId: generatedTenantCode,
          leadId: proposal.leadId || null,
          status: 'ACTIVE',
          dotNumber: dotNumber || null,
          taxId: taxId || null,
          adminEmail: resolvedAdminEmail,
          nicheGeneralFreight: true
        }
      });
    }

    // 4. Create or update Admin User
    const bcrypt = require('bcryptjs');
    const defaultPasswordHash = await bcrypt.hash('Welcome123!', 10);

    let adminUser = await prisma.user.findUnique({ where: { email: resolvedAdminEmail } });
    if (adminUser) {
      adminUser = await prisma.user.update({
        where: { id: adminUser.id },
        data: {
          name: resolvedAdminName,
          role: 'COMPANY_ADMIN',
          status: 'ACTIVE',
          companyId: targetCompany.id
        }
      });
    } else {
      adminUser = await prisma.user.create({
        data: {
          email: resolvedAdminEmail,
          name: resolvedAdminName,
          password: defaultPasswordHash,
          role: 'COMPANY_ADMIN',
          status: 'ACTIVE',
          companyId: targetCompany.id
        }
      });
    }

    // 5. Create or update Branch (Depot)
    const branchName = depotLocation || 'Chicago HQ Terminal';
    let branch = await prisma.branch.findFirst({
      where: { companyId: targetCompany.id, name: branchName }
    });
    if (!branch) {
      branch = await prisma.branch.create({
        data: {
          companyId: targetCompany.id,
          name: branchName,
          location: branchName
        }
      });
    }

    return sendSuccess(res, {
      proposal: updatedProposal,
      company: targetCompany,
      admin: { id: adminUser.id, name: adminUser.name, email: adminUser.email },
      branch
    }, HTTP_STATUS.CREATED);
  } catch (error) {
    console.error('Provision error:', error);
    next(error);
  }
};
