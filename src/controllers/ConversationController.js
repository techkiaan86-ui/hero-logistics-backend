const prisma = require('../utils/prismaClient');
const { sendSuccess, sendList, sendError } = require('../utils/apiResponse');
const { buildPrismaQuery, buildPaginationMeta } = require('../utils/queryBuilder');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

// Get all Conversations with pagination, sorting and filtering
exports.getAll = async (req, res, next) => {
  try {
    const { where, skip, take, orderBy, currentPage, pageSize } = buildPrismaQuery(req.query);
    
    // Optional: Inject tenant scope here if applicable
    // if (req.tenantId) where.tenantId = req.tenantId;

    const [data, total] = await Promise.all([
      prisma.conversation.findMany({
        where, skip, take, orderBy,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' }
          },
          participants: {
            include: { user: true }
          }
        }
      }),
      prisma.conversation.count({ where })
    ]);

    const meta = buildPaginationMeta(total, currentPage, pageSize, req.query.sort);
    return sendList(res, data, meta);
  } catch (error) {
    next(error);
  }
};

// Single dedicated endpoint for Communication Depot / Messages menu
exports.getDepotComms = async (req, res, next) => {
  try {
    let companyId = req.tenantId || req.user?.companyId || req.user?.tenantId;
    if (!companyId) {
      const firstCompany = await prisma.company.findFirst({ select: { id: true } });
      if (firstCompany) companyId = firstCompany.id;
    }

    const companyWhere = companyId ? { companyId } : {};

    let dbConvs = await prisma.conversation.findMany({
      where: companyWhere,
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        },
        participants: {
          include: { user: true }
        }
      },
      orderBy: { updatedAt: 'desc' }
    }).catch(() => []);

    // Seed initial DB conversations if DB has 0 records
    if (dbConvs.length === 0 && companyId) {
      let defaultUser = await prisma.user.findFirst({ where: { companyId } });
      if (!defaultUser) {
        defaultUser = await prisma.user.findFirst();
      }

      if (defaultUser) {
        const c1 = await prisma.conversation.create({
          data: {
            title: 'customer@hero.com',
            type: 'DIRECT',
            companyId,
            messages: {
              create: [
                {
                  senderId: defaultUser.id,
                  content: '[ASDF] aqwsedrf 📍 Attached Location: Melbourne Depot Hub (Lat: -37.8136, Lng: 144.9631) 📎 Attachment: VID20260726121045.mp4'
                }
              ]
            }
          }
        }).catch(() => null);

        const c2 = await prisma.conversation.create({
          data: {
            title: 'Shavneel Prasad (Driver - ANSH 2)',
            type: 'DIRECT',
            companyId,
            messages: {
              create: [
                {
                  senderId: defaultUser.id,
                  content: 'asdfghj'
                }
              ]
            }
          }
        }).catch(() => null);

        const c3 = await prisma.conversation.create({
          data: {
            title: 'David Miller',
            type: 'DIRECT',
            companyId,
            messages: {
              create: [
                {
                  senderId: defaultUser.id,
                  content: 'waiting'
                },
                {
                  senderId: defaultUser.id,
                  content: 'hyyy'
                }
              ]
            }
          }
        }).catch(() => null);

        const c4 = await prisma.conversation.create({
          data: {
            title: 'Melbourne Yard Operations',
            type: 'GROUP',
            companyId,
            messages: {
              create: [
                {
                  senderId: defaultUser.id,
                  content: 'Shift handover complete for Bay 4.'
                }
              ]
            }
          }
        }).catch(() => null);

        dbConvs = await prisma.conversation.findMany({
          where: companyWhere,
          include: {
            messages: { orderBy: { createdAt: 'asc' } },
            participants: { include: { user: true } }
          },
          orderBy: { updatedAt: 'desc' }
        }).catch(() => []);
      }
    }

    const [dbDrivers, dbUsers, dbCustomers] = await Promise.all([
      prisma.driver.findMany({
        where: companyWhere,
        select: { id: true, firstName: true, lastName: true, driverCode: true, phone: true, email: true },
        orderBy: { createdAt: 'asc' }
      }).catch(() => []),
      prisma.user.findMany({
        where: companyWhere,
        select: { id: true, name: true, email: true, role: true },
        orderBy: { createdAt: 'asc' }
      }).catch(() => []),
      prisma.customer.findMany({
        where: companyWhere,
        select: { id: true, name: true, contactName: true, email: true, phone: true },
        orderBy: { name: 'asc' }
      }).catch(() => [])
    ]);

    const formattedConvs = dbConvs.map((conv, idx) => {
      const convName = conv.title || (conv.participants?.[0]?.user?.name) || `Conversation-${idx + 1}`;
      const lastMsg = conv.messages[conv.messages.length - 1];

      return {
        id: conv.id,
        name: convName,
        type: conv.type === 'GROUP' ? 'group' : 'individual',
        status: 'Active',
        statusColor: 'emerald',
        loadId: conv.loadId || 'N/A',
        time: conv.updatedAt ? new Date(conv.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now',
        unreadCount: 0,
        messages: (conv.messages || []).map(m => ({
          id: m.id,
          senderId: m.senderId,
          text: m.content,
          time: new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: m.senderId === req.user?.id ? 'outgoing' : 'incoming',
          dateGroup: new Date(m.createdAt).toLocaleDateString()
        })),
        driverInfo: {
          mobile: '0412 345 678',
          email: `${convName.toLowerCase().replace(/[^a-z0-9]/g, '')}@herologistics.com.au`,
          empId: `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
          license: 'HR Heavy Rigid'
        }
      };
    });

    return sendSuccess(res, {
      conversations: formattedConvs,
      drivers: dbDrivers,
      users: dbUsers,
      customers: dbCustomers
    });
  } catch (error) {
    next(error);
  }
};

// Get single Conversation by ID
exports.getById = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    // if (req.tenantId) where.tenantId = req.tenantId;

    const data = await prisma.conversation.findFirst({ where });
    
    if (!data) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Conversation not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
};

// Create new Conversation
exports.create = async (req, res, next) => {
  try {
    const payload = { ...req.body };
    // if (req.tenantId) payload.tenantId = req.tenantId;

    const data = await prisma.conversation.create({
      data: payload
    });
    return sendSuccess(res, data, HTTP_STATUS.CREATED);
  } catch (error) {
    next(error);
  }
};

// Update Conversation with Optimistic Concurrency check
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
      const data = await prisma.conversation.update({
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
          message: 'Conversation not found'
        }, HTTP_STATUS.NOT_FOUND);
      }
      throw e;
    }
  } catch (error) {
    next(error);
  }
};

// Delete Conversation
exports.delete = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    // if (req.tenantId) where.tenantId = req.tenantId;

    await prisma.conversation.delete({ where });
    
    // 204 No Content for successful delete
    return res.status(HTTP_STATUS.NO_CONTENT).send();
  } catch (error) {
    if (error.code === 'P2025') {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Conversation not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    next(error);
  }
};
