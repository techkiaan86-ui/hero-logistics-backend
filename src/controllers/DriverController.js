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

    const lType = payload.licenceType || payload.licenseType || payload.LicenceType || null;
    const lNum = payload.licenceNumber || payload.licenseNumber || payload.LicenceNumber || null;

    const driverData = {
      firstName: payload.firstName || payload.FirstName || null,
      lastName: payload.lastName || payload.LastName || null,
      phone: payload.phone || payload.PhoneNumber || null,
      email: inputEmail,
      avatarUrl: cleanAvatarUrl(rawAvatar),
      driverCode: inputCode,
      licenseType: lType,
      licenseNumber: lNum,
      status: validStatus,
      role: payload.role || payload.driverRole || 'Driver',
      category: payload.category || payload.driverCategory || null,
      shift: payload.shift || null,
      notes: payload.notes || null,
      address: payload.address || payload.StreetAddress || null,
      companyId: effectiveCompanyId,
      branchId: branchIdVal
    };

    if (payload.dob || payload.DateofBirth) {
      const d = new Date(payload.dob || payload.DateofBirth);
      if (!isNaN(d.getTime())) {
        driverData.dob = d;
        driverData.joiningDate = d;
      }
    }

    if (payload.employmentType || payload.EmploymentType) {
      const e = String(payload.employmentType || payload.EmploymentType).toUpperCase().replace(/\s+/g, '_');
      if (['FULL_TIME', 'PART_TIME', 'CASUAL', 'CONTRACTOR'].includes(e)) {
        driverData.employmentType = e;
      }
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

  if (rawPayload.gender !== undefined || rawPayload.Gender !== undefined) data.gender = rawPayload.gender || rawPayload.Gender || null;
  if (rawPayload.nationality !== undefined || rawPayload.Nationality !== undefined) data.nationality = rawPayload.nationality || rawPayload.Nationality || null;
  if (rawPayload.emergencyContact !== undefined || rawPayload.EmergencyContactName !== undefined) {
    const name = rawPayload.EmergencyContactName || '';
    const num = rawPayload.EmergencyContactNumber || '';
    data.emergencyContact = rawPayload.emergencyContact || `${name} ${num}`.trim() || null;
  }
  if (rawPayload.address !== undefined || rawPayload.ResidentialAddress !== undefined) {
    data.address = rawPayload.address || rawPayload.ResidentialAddress || null;
  }
  if (rawPayload.city !== undefined || rawPayload.City !== undefined) data.city = rawPayload.city || rawPayload.City || null;
  if (rawPayload.state !== undefined || rawPayload.State !== undefined) data.state = rawPayload.state || rawPayload.State || null;
  if (rawPayload.postalCode !== undefined || rawPayload.PostalCode !== undefined) data.postalCode = rawPayload.postalCode || rawPayload.PostalCode || null;

  const lType = rawPayload.licenseType || rawPayload.licenceType || rawPayload.LicenceType;
  if (lType !== undefined) data.licenseType = lType;

  const lNum = rawPayload.licenseNumber || rawPayload.licenceNumber || rawPayload.LicenceNumber;
  if (lNum !== undefined) data.licenseNumber = lNum;

  const lState = rawPayload.licenseState || rawPayload.licenceState || rawPayload.LicenceState;
  if (lState !== undefined) data.licenseState = lState;

  const lClass = rawPayload.licenseClass || rawPayload.licenceClass || rawPayload.LicenceClass;
  if (lClass !== undefined) data.licenseClass = lClass;

  if (rawPayload.licenseIssueDate || rawPayload.IssueDate) {
    const d = new Date(rawPayload.licenseIssueDate || rawPayload.IssueDate);
    if (!isNaN(d.getTime())) data.licenseIssueDate = d;
  }

  if (rawPayload.licenseExpiry || rawPayload.ExpiryDate) {
    const d = new Date(rawPayload.licenseExpiry || rawPayload.ExpiryDate);
    if (!isNaN(d.getTime())) data.licenseExpiry = d;
  }

  if (rawPayload.status) {
    const s = String(rawPayload.status).toUpperCase().replace(/\s+/g, '_');
    if (['ON_DUTY', 'OFF_DUTY', 'ON_LEAVE', 'UNAVAILABLE', 'AVAILABLE'].includes(s)) {
      data.status = s;
    }
  }

  if (rawPayload.employmentType || rawPayload.EmploymentType) {
    const e = String(rawPayload.employmentType || rawPayload.EmploymentType).toUpperCase().replace(/\s+/g, '_');
    if (['FULL_TIME', 'PART_TIME', 'CASUAL', 'CONTRACTOR'].includes(e)) {
      data.employmentType = e;
    }
  }

  if (rawPayload.role !== undefined || rawPayload.DriverRole !== undefined) data.role = rawPayload.role || rawPayload.DriverRole || null;
  if (rawPayload.category !== undefined || rawPayload.DriverCategory !== undefined) data.category = rawPayload.category || rawPayload.DriverCategory || null;
  if (rawPayload.shift !== undefined || rawPayload.Shift !== undefined) data.shift = rawPayload.shift || rawPayload.Shift || null;
  if (rawPayload.notes !== undefined) data.notes = rawPayload.notes;
  if (rawPayload.branchId !== undefined) data.branchId = rawPayload.branchId;

  if (rawPayload.payType !== undefined || rawPayload.PayType !== undefined) data.payType = rawPayload.payType || rawPayload.PayType || null;
  if (rawPayload.payRate !== undefined || rawPayload.PayRate !== undefined) {
    const pr = parseFloat(rawPayload.payRate || rawPayload.PayRate);
    data.payRate = !isNaN(pr) ? pr : null;
  }
  if (rawPayload.bankName !== undefined || rawPayload.BankName !== undefined) data.bankName = rawPayload.bankName || rawPayload.BankName || null;
  if (rawPayload.accountNumber !== undefined || rawPayload.AccountNumber !== undefined) data.accountNumber = rawPayload.accountNumber || rawPayload.AccountNumber || null;
  if (rawPayload.routingNumber !== undefined || rawPayload.BSBRouting !== undefined) data.routingNumber = rawPayload.routingNumber || rawPayload.BSBRouting || null;
  if (rawPayload.taxNumber !== undefined || rawPayload.TaxNumber !== undefined) data.taxNumber = rawPayload.taxNumber || rawPayload.TaxNumber || null;
  if (rawPayload.superFund !== undefined || rawPayload.SuperannuationFund !== undefined) data.superFund = rawPayload.superFund || rawPayload.SuperannuationFund || null;

  if (rawPayload.preferredVehicle !== undefined || rawPayload.PreferredVehicle !== undefined) data.preferredVehicle = rawPayload.preferredVehicle || rawPayload.PreferredVehicle || null;
  if (rawPayload.preferredRoutes !== undefined || rawPayload.PreferredRoutes !== undefined) data.preferredRoutes = rawPayload.preferredRoutes || rawPayload.PreferredRoutes || null;
  if (rawPayload.preferredRegions !== undefined || rawPayload.PreferredRegions !== undefined) data.preferredRegions = rawPayload.preferredRegions || rawPayload.PreferredRegions || null;
  if (rawPayload.maxDistPerTripKm !== undefined || rawPayload.MaximumDistancePerTripKM !== undefined) {
    const md = parseInt(rawPayload.maxDistPerTripKm || rawPayload.MaximumDistancePerTripKM, 10);
    data.maxDistPerTripKm = !isNaN(md) ? md : null;
  }
  if (rawPayload.dgCertified !== undefined || rawPayload.DangerousGoodsCertified !== undefined) {
    data.dgCertified = rawPayload.dgCertified === true || rawPayload.DangerousGoodsCertified === 'Yes';
  }
  if (rawPayload.hvCertified !== undefined || rawPayload.HeavyVehicleCertified !== undefined) {
    data.hvCertified = rawPayload.hvCertified === true || rawPayload.HeavyVehicleCertified === 'Yes';
  }

  if (rawPayload.dob || rawPayload.DateofBirth) {
    const d = new Date(rawPayload.dob || rawPayload.DateofBirth);
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

    // Check for duplicate driverCode and email before updating
    if (updateData.driverCode) {
      const duplicateCode = await prisma.driver.findFirst({
        where: { driverCode: updateData.driverCode, NOT: { id } }
      });
      if (duplicateCode) {
        delete updateData.driverCode;
      }
    }

    if (updateData.email) {
      const duplicateEmail = await prisma.driver.findFirst({
        where: { email: updateData.email, NOT: { id } }
      });
      if (duplicateEmail) {
        delete updateData.email;
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
        // Fallback retry without conflicting unique fields
        delete updateData.driverCode;
        delete updateData.email;
        try {
          const fallbackData = await prisma.driver.update({
            where,
            data: updateData
          });
          return sendSuccess(res, fallbackData);
        } catch (retryErr) {
          const target = Array.isArray(e.meta?.target) ? e.meta.target.join(', ') : (e.meta?.target || 'field');
          return sendError(res, {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: `A driver with this ${target} already exists.`
          }, HTTP_STATUS.BAD_REQUEST);
        }
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
