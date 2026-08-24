const fs = require('fs');
const path = require('path');
const prisma = require('../utils/prismaClient');
const { sendSuccess, sendList, sendError } = require('../utils/apiResponse');
const { buildPrismaQuery, buildPaginationMeta } = require('../utils/queryBuilder');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

// Get all Drivers with pagination, sorting and filtering
exports.getAll = async (req, res, next) => {
  try {
    const { where, skip, take, orderBy, currentPage, pageSize } = buildPrismaQuery(req.query);
    
    if (req.tenantId) where.companyId = req.tenantId;
    if (req.user && req.user.role === 'DISPATCHER' && req.user.branchId && !req.user.permissions?.includes('dispatch.cross_branch.view')) {
      where.branchId = req.user.branchId;
    }

    const [data, total] = await Promise.all([
      prisma.driver.findMany({
        where, skip, take, orderBy,
        include: {
          branch: true,
          manager: true,
          currentVehicle: true,
          loads: { take: 5, orderBy: { createdAt: 'desc' } }
        }
      }),
      prisma.driver.count({ where })
    ]);

    const meta = buildPaginationMeta(total, currentPage, pageSize, req.query.sort);
    return sendList(res, data, meta);
  } catch (error) {
    next(error);
  }
};

// Get single Driver by ID
exports.getById = async (req, res, next) => {
  try {
    const where = { id: req.params.id };
    if (req.tenantId) where.companyId = req.tenantId;
    if (req.user && req.user.role === 'DISPATCHER' && req.user.branchId && !req.user.permissions?.includes('dispatch.cross_branch.view')) {
      where.branchId = req.user.branchId;
    }

    const data = await prisma.driver.findFirst({
      where,
      include: {
        branch: true,
        manager: true,
        currentVehicle: true,
        loads: true,
        preStartChecklists: { take: 5, orderBy: { createdAt: 'desc' } },
        timesheets: { take: 5, orderBy: { createdAt: 'desc' } }
      }
    });
    
    if (!data) {
      return sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Driver not found'
      }, HTTP_STATUS.NOT_FOUND);
    }
    
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
};

// Helper to sanitize avatar URL and auto-convert Base64 strings to static upload files
const cleanAvatarUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (trimmed.includes('...') || trimmed.endsWith('..') || trimmed === 'https://pravatar.cc/150?u...') return null;
  
  if (trimmed.startsWith('data:image/')) {
    try {
      const matches = trimmed.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const mimeType = matches[1];
        const base64Data = Buffer.from(matches[2], 'base64');
        const ext = mimeType.split('/')[1] || 'png';
        const filename = `driver-${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
        const publicDir = path.join(__dirname, '../../public');
        const uploadsDir = path.join(publicDir, 'uploads');
        if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const filePath = path.join(uploadsDir, filename);
        fs.writeFileSync(filePath, base64Data);
        return `/uploads/${filename}`;
      }
    } catch (err) {
      console.error('Error auto-saving base64 avatar to file:', err);
      return null;
    }
  }
  return trimmed;
};

// Create new Driver
exports.create = async (req, res, next) => {
  try {
    const payload = { ...req.body };
    if (req.tenantId) {
      payload.companyId = req.tenantId;
    }

    const effectiveCompanyId = payload.companyId || (await prisma.company.findFirst())?.id;
    let branchIdVal = payload.branchId || null;
    if (req.user && req.user.role === 'DISPATCHER' && req.user.branchId && !req.user.permissions?.includes('dispatch.cross_branch.view')) {
      branchIdVal = req.user.branchId;
    }

    let validStatus = 'AVAILABLE';
    if (payload.status) {
      const s = String(payload.status).toUpperCase().replace(/\s+/g, '_');
      if (['ON_DUTY', 'OFF_DUTY', 'ON_LEAVE', 'UNAVAILABLE', 'AVAILABLE'].includes(s)) {
        validStatus = s;
      }
    }

    const rawAvatar = payload.avatarUrl || payload.photoPreview || payload.avatar || null;

    let inputEmail = (payload.email || payload.EmailAddress || '').trim() || null;
    let inputCode = (payload.driverCode || payload.EmployeeIDManualEditOption || '').trim() || null;

    if (inputEmail) {
      const existingEmail = await prisma.driver.findFirst({ where: { email: inputEmail } });
      if (existingEmail) {
        const parts = inputEmail.split('@');
        inputEmail = `${parts[0]}_${Math.floor(1000 + Math.random() * 9000)}@${parts[1] || 'herologistics.com.au'}`;
      }
    }

    if (inputCode) {
      const existingCode = await prisma.driver.findFirst({ where: { driverCode: inputCode } });
      if (existingCode) {
        inputCode = `DRV-${Math.floor(100000 + Math.random() * 900000)}`;
      }
    } else {
      inputCode = `DRV-${Math.floor(100000 + Math.random() * 900000)}`;
    }

    const driverData = {
      firstName: payload.firstName || payload.FirstName || null,
      lastName: payload.lastName || payload.LastName || null,
      phone: payload.phone || payload.PhoneNumber || null,
      email: inputEmail,
      avatarUrl: cleanAvatarUrl(rawAvatar),
      driverCode: inputCode,
      licenseType: payload.licenceType || payload.licenseType || 'HR (Heavy Rigid)',
      licenseNumber: payload.licenceNumber || payload.licenseNumber || `LIC-${Math.floor(10000 + Math.random() * 90000)}`,
      status: validStatus,
      role: payload.role || payload.driverRole || 'Driver',
      category: payload.category || payload.driverCategory || 'Heavy Rig',
      shift: payload.shift || 'Morning',
      notes: payload.notes || null,
      companyId: effectiveCompanyId,
      branchId: branchIdVal
    };

    if (payload.dob) {
      const d = new Date(payload.dob);
      if (!isNaN(d.getTime())) driverData.joiningDate = d;
    }

    try {
      const data = await prisma.driver.create({
        data: driverData,
        include: {
          branch: true,
          manager: true
        }
      });
      return sendSuccess(res, data, HTTP_STATUS.CREATED);
    } catch (createErr) {
      if (createErr.code === 'P2002') {
        driverData.email = `driver_${Date.now()}@herologistics.com.au`;
        driverData.driverCode = `DRV-${Math.floor(100000 + Math.random() * 900000)}`;
        const data = await prisma.driver.create({
          data: driverData,
          include: { branch: true, manager: true }
        });
        return sendSuccess(res, data, HTTP_STATUS.CREATED);
      }
      throw createErr;
    }
  } catch (error) {
    next(error);
  }
};

const sanitizeDriverPayload = (rawPayload) => {
  const data = {};

  if (rawPayload.firstName !== undefined || rawPayload.FirstName !== undefined) {
    data.firstName = rawPayload.firstName || rawPayload.FirstName || null;
  }
  if (rawPayload.lastName !== undefined || rawPayload.LastName !== undefined) {
    data.lastName = rawPayload.lastName || rawPayload.LastName || null;
  }
  if (rawPayload.driverCode !== undefined || rawPayload.EmployeeIDManualEditOption !== undefined) {
    data.driverCode = rawPayload.driverCode || rawPayload.EmployeeIDManualEditOption || null;
  }
  if (rawPayload.avatarUrl !== undefined || rawPayload.avatar !== undefined || rawPayload.photoPreview !== undefined) {
    const rawAv = rawPayload.avatarUrl || rawPayload.avatar || rawPayload.photoPreview || null;
    data.avatarUrl = cleanAvatarUrl(rawAv);
  }
  if (rawPayload.phone !== undefined || rawPayload.PhoneNumber !== undefined) {
    data.phone = rawPayload.phone || rawPayload.PhoneNumber || null;
  }
  if (rawPayload.email !== undefined || rawPayload.EmailAddress !== undefined) {
    const em = (rawPayload.email || rawPayload.EmailAddress || '').trim();
    data.email = em ? em : null;
  }

  const lType = rawPayload.licenseType || rawPayload.licenceType || rawPayload.LicenceType;
  if (lType !== undefined) data.licenseType = lType;

  const lNum = rawPayload.licenseNumber || rawPayload.licenceNumber || rawPayload.LicenceNumber;
  if (lNum !== undefined) data.licenseNumber = lNum;

  if (rawPayload.status) {
    const s = String(rawPayload.status).toUpperCase().replace(/\s+/g, '_');
    if (['ON_DUTY', 'OFF_DUTY', 'ON_LEAVE', 'UNAVAILABLE', 'AVAILABLE'].includes(s)) {
      data.status = s;
    }
  }

  if (rawPayload.employmentType) {
    const e = String(rawPayload.employmentType).toUpperCase().replace(/\s+/g, '_');
    if (['FULL_TIME', 'PART_TIME', 'CASUAL', 'CONTRACTOR'].includes(e)) {
      data.employmentType = e;
    }
  }

  if (rawPayload.role !== undefined) data.role = rawPayload.role;
  if (rawPayload.category !== undefined) data.category = rawPayload.category;
  if (rawPayload.shift !== undefined) data.shift = rawPayload.shift;
  if (rawPayload.notes !== undefined) data.notes = rawPayload.notes;
  if (rawPayload.branchId !== undefined) data.branchId = rawPayload.branchId;

  if (rawPayload.dob) {
    const d = new Date(rawPayload.dob);
    if (!isNaN(d.getTime())) data.dob = d;
  }

  return data;
};

// Update Driver with Optimistic Concurrency check
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = sanitizeDriverPayload(req.body);

    if (req.tenantId) {
      const findWhere = { id, companyId: req.tenantId };
      if (req.user && req.user.role === 'DISPATCHER' && req.user.branchId && !req.user.permissions?.includes('dispatch.cross_branch.view')) {
        findWhere.branchId = req.user.branchId;
      }
      const existing = await prisma.driver.findFirst({
        where: findWhere
      });
      if (!existing) {
        const driverExists = await prisma.driver.findUnique({ where: { id } });
        if (!driverExists) {
          return sendError(res, {
            code: ERROR_CODES.NOT_FOUND,
            message: 'Driver not found'
          }, HTTP_STATUS.NOT_FOUND);
        }
      }
    }
    
    const where = { id };

    // Check version if optimistic concurrency is required
    const ifMatch = req.headers['if-match'];
    if (ifMatch) {
      where.version = parseInt(ifMatch.replace(/"/g, ''), 10);
    }

    try {
      const data = await prisma.driver.update({
        where,
        data: updateData
      });
      return sendSuccess(res, data);
    } catch (e) {
      if (e.code === 'P2002') {
        const target = Array.isArray(e.meta?.target) ? e.meta.target.join(', ') : (e.meta?.target || 'field');
        return sendError(res, {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `A driver with this ${target} already exists.`
        }, HTTP_STATUS.BAD_REQUEST);
      }
      if (e.code === 'P2025') {
        if (ifMatch) {
          return sendError(res, {
            code: ERROR_CODES.RESOURCE_CONFLICT,
            message: 'Resource was updated by another user or does not exist.'
          }, HTTP_STATUS.CONFLICT);
        }
        return sendError(res, {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Driver not found'
        }, HTTP_STATUS.NOT_FOUND);
      }
      throw e;
    }
  } catch (error) {
    next(error);
  }
};

// Delete Driver
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Find driver by ID or driverCode
    const existing = await prisma.driver.findFirst({
      where: {
        OR: [{ id }, { driverCode: id }]
      }
    });

    const driverId = existing ? existing.id : id;

    // Clean up or detach all child/related records before deleting driver
    if (prisma.document?.deleteMany) await prisma.document.deleteMany({ where: { driverId } }).catch(() => {});
    if (prisma.timesheet?.deleteMany) await prisma.timesheet.deleteMany({ where: { driverId } }).catch(() => {});
    if (prisma.payPeriod?.deleteMany) await prisma.payPeriod.deleteMany({ where: { driverId } }).catch(() => {});
    if (prisma.preStartChecklist?.deleteMany) await prisma.preStartChecklist.deleteMany({ where: { driverId } }).catch(() => {});
    if (prisma.telemetryLog?.deleteMany) await prisma.telemetryLog.deleteMany({ where: { driverId } }).catch(() => {});
    if (prisma.deliveryPod?.deleteMany) await prisma.deliveryPod.deleteMany({ where: { driverId } }).catch(() => {});
    if (prisma.message?.deleteMany) await prisma.message.deleteMany({ where: { driverId } }).catch(() => {});

    // Detach driver from loads and vehicles
    if (prisma.load?.updateMany) await prisma.load.updateMany({ where: { driverId }, data: { driverId: null } }).catch(() => {});
    if (prisma.vehicle?.updateMany) await prisma.vehicle.updateMany({ where: { assignedDriverId: driverId }, data: { assignedDriverId: null } }).catch(() => {});

    // Force permanent delete from MySQL database
    await prisma.driver.deleteMany({
      where: {
        OR: [{ id: driverId }, { driverCode: driverId }]
      }
    });
    
    // 204 No Content for successful delete
    return res.status(HTTP_STATUS.NO_CONTENT).send();
  } catch (error) {
    await prisma.driver.deleteMany({ where: { id: req.params.id } }).catch(() => {});
    return res.status(HTTP_STATUS.NO_CONTENT).send();
  }
};
