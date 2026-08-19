const prisma = require('../utils/prismaClient');
const { sendSuccess, sendList, sendError } = require('../utils/apiResponse');
const { buildPrismaQuery, buildPaginationMeta } = require('../utils/queryBuilder');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

exports.getAll = async (req, res, next) => {
  try {
    const { where, skip, take, orderBy, currentPage, pageSize } = buildPrismaQuery(req.query);
    if (req.query.driverId) where.driverId = req.query.driverId;
    if (req.query.category && req.query.category !== 'All Activities') where.category = req.query.category;
    const [data, total] = await Promise.all([
      prisma.driverActivity.findMany({ where, skip, take, orderBy: orderBy || { createdAt: 'desc' } }),
      prisma.driverActivity.count({ where })
    ]);
    return sendList(res, data, buildPaginationMeta(total, currentPage, pageSize));
  } catch (error) { next(error); }
};

exports.getById = async (req, res, next) => {
  try {
    const data = await prisma.driverActivity.findFirst({ where: { id: req.params.id } });
    if (!data) return sendError(res, { code: ERROR_CODES.NOT_FOUND, message: 'Activity record not found' }, HTTP_STATUS.NOT_FOUND);
    return sendSuccess(res, data);
  } catch (error) { next(error); }
};

exports.create = async (req, res, next) => {
  try {
    const { driverId, title, category, status, description, performedBy, time, date } = req.body;
    if (!driverId) return sendError(res, { code: 'VALIDATION_ERROR', message: 'driverId is required' }, 400);
    const data = await prisma.driverActivity.create({
      data: {
        driverId,
        title: title || 'Manual Note Logged',
        category: category || 'Assignments',
        status: status || 'Verified',
        description: description || '',
        performedBy: performedBy || 'Fleet Admin User',
        time: time || 'Just Now',
        date: date || new Date().toISOString().split('T')[0]
      }
    });
    return sendSuccess(res, data, HTTP_STATUS.CREATED);
  } catch (error) { next(error); }
};

exports.update = async (req, res, next) => {
  try {
    try {
      const data = await prisma.driverActivity.update({ where: { id: req.params.id }, data: req.body });
      return sendSuccess(res, data);
    } catch (e) {
      if (e.code === 'P2025') return sendError(res, { code: ERROR_CODES.NOT_FOUND, message: 'Activity record not found' }, HTTP_STATUS.NOT_FOUND);
      throw e;
    }
  } catch (error) { next(error); }
};

exports.delete = async (req, res, next) => {
  try {
    await prisma.driverActivity.delete({ where: { id: req.params.id } });
    return res.status(HTTP_STATUS.NO_CONTENT).send();
  } catch (error) {
    if (error.code === 'P2025') return sendError(res, { code: ERROR_CODES.NOT_FOUND, message: 'Activity record not found' }, HTTP_STATUS.NOT_FOUND);
    next(error);
  }
};
