const prisma = require('../utils/prismaClient');
const { sendSuccess, sendList, sendError } = require('../utils/apiResponse');
const { buildPrismaQuery, buildPaginationMeta } = require('../utils/queryBuilder');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

// Get all SupportTickets with pagination, sorting and filtering
exports.getAll = async (req, res, next) => {
  try {
    const { where, skip, take, orderBy, currentPage, pageSize } = buildPrismaQuery(req.query);
    
    if (req.tenantId) where.companyId = req.tenantId;

    const [data, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where, skip, take, orderBy,
        include: {
          assignedAgent: true,
          company: true,
          replies: { take: 5, orderBy: { createdAt: 'asc' } }
        }
      }),
      prisma.supportTicket.count({ where })
    ]);

    const meta = buildPaginationMeta(total, currentPage, pageSize, req.query.sort);
    return sendList(res, data, meta);
  } catch (error) {
    next(error);
  }
};

// Get single SupportTicket by ID
exports.getById = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    if (req.tenantId) where.companyId = req.tenantId;

    const data = await prisma.supportTicket.findFirst({
      where,
      include: {
        assignedAgent: true,
        company: true,
        replies: { include: { author: true }, orderBy: { createdAt: 'asc' } }
      }
    });
    
    if (!data) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'SupportTicket not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
};

// Create new SupportTicket
exports.create = async (req, res, next) => {
  try {
    const payload = { ...req.body };
    if (req.tenantId && !payload.companyId) payload.companyId = req.tenantId;

    if (payload.description) {
      payload.message = payload.description;
      delete payload.description;
    }

    if (!payload.companyId) {
      const company = await prisma.company.findFirst();
      if (company) {
        payload.companyId = company.id;
      }
    }

    const data = await prisma.supportTicket.create({
      data: payload,
      include: {
        assignedAgent: true,
        company: true
      }
    });
    return sendSuccess(res, data, HTTP_STATUS.CREATED);
  } catch (error) {
    next(error);
  }
};

// Update SupportTicket with Optimistic Concurrency check
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
      const data = await prisma.supportTicket.update({
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
          message: 'SupportTicket not found'
        }, HTTP_STATUS.NOT_FOUND);
      }
      throw e;
    }
  } catch (error) {
    next(error);
  }
};

// Delete SupportTicket
exports.delete = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    // if (req.tenantId) where.tenantId = req.tenantId;

    await prisma.supportTicket.delete({ where });
    
    // 204 No Content for successful delete
    return res.status(HTTP_STATUS.NO_CONTENT).send();
  } catch (error) {
    if (error.code === 'P2025') {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'SupportTicket not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    next(error);
  }
};

// Add reply to SupportTicket
exports.addReply = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { message, text } = req.body;
    const replyText = message || text;

    if (!replyText) {
      return sendError(res, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Message text is required' }, HTTP_STATUS.BAD_REQUEST);
    }

    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) {
      return sendError(res, { code: ERROR_CODES.NOT_FOUND, message: 'SupportTicket not found' }, HTTP_STATUS.NOT_FOUND);
    }

    let user = req.user ? await prisma.user.findUnique({ where: { id: req.user.id } }) : null;
    if (!user) {
      user = await prisma.user.findFirst();
    }

    const reply = await prisma.ticketReply.create({
      data: {
        message: replyText,
        ticketId: id,
        authorId: user.id
      },
      include: { author: { select: { id: true, name: true, email: true, role: true } } }
    });

    return sendSuccess(res, reply, HTTP_STATUS.CREATED);
  } catch (error) {
    next(error);
  }
};
