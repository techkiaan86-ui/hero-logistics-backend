const prisma = require('../utils/prismaClient');
const { sendSuccess, sendList, sendError } = require('../utils/apiResponse');
const { buildPrismaQuery, buildPaginationMeta } = require('../utils/queryBuilder');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

// Get all Workflow Rules
exports.getAll = async (req, res, next) => {
  try {
    const { where, skip, take, orderBy, currentPage, pageSize } = buildPrismaQuery(req.query);

    const [data, total] = await Promise.all([
      prisma.workflowRule.findMany({
        where, skip, take, orderBy: orderBy.length ? orderBy : [{ createdAt: 'desc' }],
        include: {
          company: { select: { name: true } }
        }
      }),
      prisma.workflowRule.count({ where })
    ]);

    const meta = buildPaginationMeta(total, currentPage, pageSize, req.query.sort);
    return sendList(res, data, meta);
  } catch (error) {
    next(error);
  }
};

// Get single Workflow Rule by ID
exports.getById = async (req, res, next) => {
  try {
    const data = await prisma.workflowRule.findFirst({
      where: { id: req.params.id }
    });

    if (!data) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Workflow rule not found'
      }, HTTP_STATUS.NOT_FOUND);
    }

    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
};

// Create new Workflow Rule
exports.create = async (req, res, next) => {
  try {
    const { name, desc, description, category, trigger, action, status, createdBy } = req.body;

    if (!name) {
      return sendError(res, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Rule name is required'
      }, HTTP_STATUS.BAD_REQUEST);
    }

    let companyId = req.body.companyId;
    if (!companyId) {
      const comp = await prisma.company.findFirst();
      if (comp) companyId = comp.id;
    }

    const data = await prisma.workflowRule.create({
      data: {
        name: name.trim(),
        description: desc || description || 'Automated workflow rule',
        category: category || 'Invoice Automation',
        trigger: trigger || 'Load Status: Delivered',
        action: action || 'Create Invoice & Notify Accounts',
        status: status || 'Active',
        createdBy: createdBy || 'Sarah Mitchell',
        ...(companyId && { companyId })
      }
    });

    return sendSuccess(res, data, HTTP_STATUS.CREATED);
  } catch (error) {
    next(error);
  }
};

// Update Workflow Rule
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, desc, description, category, trigger, action, status } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (desc !== undefined || description !== undefined) {
      updateData.description = desc || description;
    }
    if (category !== undefined) updateData.category = category;
    if (trigger !== undefined) updateData.trigger = trigger;
    if (action !== undefined) updateData.action = action;
    if (status !== undefined) updateData.status = status;

    try {
      const data = await prisma.workflowRule.update({
        where: { id },
        data: updateData
      });
      return sendSuccess(res, data);
    } catch (e) {
      if (e.code === 'P2025') {
        return sendError(res, {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workflow rule not found'
        }, HTTP_STATUS.NOT_FOUND);
      }
      throw e;
    }
  } catch (error) {
    next(error);
  }
};

// Delete Workflow Rule
exports.delete = async (req, res, next) => {
  try {
    await prisma.workflowRule.delete({
      where: { id: req.params.id }
    });
    return res.status(HTTP_STATUS.NO_CONTENT).send();
  } catch (error) {
    if (error.code === 'P2025') {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Workflow rule not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    next(error);
  }
};
