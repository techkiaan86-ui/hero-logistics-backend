const prisma = require('../utils/prismaClient');
const { sendSuccess, sendList, sendError } = require('../utils/apiResponse');
const { buildPrismaQuery, buildPaginationMeta } = require('../utils/queryBuilder');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

// Get all DemoBookings with pagination, sorting and filtering
exports.getAll = async (req, res, next) => {
  try {
    const { where, skip, take, orderBy, currentPage, pageSize } = buildPrismaQuery(req.query);
    
    // RBAC Scoping
    if (req.salesScope === 'OWN' && req.user && req.user.id) {
      where.OR = [
        { presenterId: req.user.id },
        { lead: { repId: req.user.id } }
      ];
    } else if (req.query.repId) {
      where.OR = [
        { presenterId: req.query.repId },
        { lead: { repId: req.query.repId } }
      ];
    }

    const [data, total] = await Promise.all([
      prisma.demoBooking.findMany({
        where,
        skip,
        take,
        orderBy: orderBy.length ? orderBy : [{ scheduledAt: 'desc' }],
        include: {
          lead: {
            select: { id: true, companyName: true, contactName: true, email: true, phone: true, stage: true, repId: true, rep: { select: { id: true, name: true } } }
          },
          presenter: {
            select: { id: true, name: true, email: true }
          }
        }
      }),
      prisma.demoBooking.count({ where })
    ]);

    const meta = buildPaginationMeta(total, currentPage, pageSize, req.query.sort);
    return sendList(res, data, meta);
  } catch (error) {
    next(error);
  }
};

// Get single DemoBooking by ID
exports.getById = async (req, res, next) => {
  try {
    const where = { id: req.params.id };

    const data = await prisma.demoBooking.findFirst({
      where,
      include: {
        lead: true,
        presenter: { select: { id: true, name: true, email: true } }
      }
    });
    
    if (!data) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'DemoBooking not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
};

// Create new DemoBooking
exports.create = async (req, res, next) => {
  try {
    const payload = { ...req.body };

    // Set presenter if missing
    if (!payload.presenterId) {
      payload.presenterId = req.user?.id;
    }

    // Verify presenter exists
    let validPresenter = false;
    if (payload.presenterId && payload.presenterId.length === 36) {
      const userExists = await prisma.user.findUnique({
        where: { id: payload.presenterId }
      });
      if (userExists) validPresenter = true;
    }

    if (!validPresenter) {
      const defaultRep = await prisma.user.findFirst({
        where: { role: 'SALES' }
      }) || await prisma.user.findFirst();
      
      if (defaultRep) {
        payload.presenterId = defaultRep.id;
      }
    }

    const data = await prisma.demoBooking.create({
      data: payload,
      include: {
        lead: true,
        presenter: { select: { id: true, name: true, email: true } }
      }
    });

    // Update lead stage to DEMO_BOOKED if currently earlier in pipeline
    if (data.leadId) {
      await prisma.lead.update({
        where: { id: data.leadId },
        data: { stage: 'DEMO_BOOKED' }
      });

      // Audit activity
      await prisma.salesActivity.create({
        data: {
          leadId: data.leadId,
          title: 'Demo Scheduled',
          description: `Live software walkthrough scheduled for ${new Date(data.scheduledAt).toLocaleDateString()}`,
          performedById: req.user?.id || data.presenterId,
          timestamp: new Date()
        }
      });
    }

    return sendSuccess(res, data, HTTP_STATUS.CREATED);
  } catch (error) {
    next(error);
  }
};

// Update DemoBooking
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const where = { id };

    const data = await prisma.demoBooking.update({
      where,
      data: updateData,
      include: {
        lead: true,
        presenter: { select: { id: true, name: true, email: true } }
      }
    });

    // If marked completed, update lead stage to DEMO_COMPLETED
    if (updateData.status === 'COMPLETED' && data.leadId) {
      await prisma.lead.update({
        where: { id: data.leadId },
        data: { stage: 'DEMO_COMPLETED' }
      });

      await prisma.salesActivity.create({
        data: {
          leadId: data.leadId,
          title: 'Demo Completed',
          description: `Product demonstration successfully completed. Notes: ${data.feedback || 'Walkthrough completed.'}`,
          performedById: req.user?.id || data.presenterId,
          timestamp: new Date()
        }
      });
    }

    return sendSuccess(res, data);
  } catch (error) {
    if (error.code === 'P2025') {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'DemoBooking not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    next(error);
  }
};

// Delete DemoBooking
exports.delete = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    await prisma.demoBooking.delete({ where });
    return res.status(HTTP_STATUS.NO_CONTENT).send();
  } catch (error) {
    if (error.code === 'P2025') {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'DemoBooking not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    next(error);
  }
};
