const prisma = require('./prismaClient');
const {
  calculateHourlyDriverPay,
  calculatePerKmDriverPay,
  calculatePerLoadDriverPay
} = require('./driverPayCalculator');

/**
 * Calculate dynamic earnings and deductions for a driver based on:
 * - payType: "Hourly" | "Per Load" | "Per Km"
 * - payRate: number ($/hr, $/load, or $/km)
 * - Time period (startDate, endDate)
 */
async function calculateDriverPay({ driver, startDate, endDate, companyId }) {
  if (!driver) return null;

  const payType = (driver.payType || 'Hourly').trim();
  const rawRate = parseFloat(driver.payRate) || 0;
  const normalizedType = payType.toLowerCase();

  const start = startDate ? new Date(startDate) : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();

  // 1. Fetch Timesheets in date range for this driver
  let workMinutes = 0;
  try {
    const timesheets = await prisma.timesheet.findMany({
      where: {
        driverId: driver.id,
        createdAt: { gte: start, lte: end }
      },
      select: { workMinutes: true, totalMinutes: true, status: true }
    });
    workMinutes = timesheets.reduce((acc, t) => acc + (t.workMinutes || t.totalMinutes || 0), 0);
  } catch (err) {
    console.warn('Could not fetch driver timesheets for pay calculation:', err?.message);
  }
  const hoursWorked = Math.round((workMinutes / 60) * 100) / 100;

  // 2. Fetch Loads in date range for this driver
  let completedLoadsCount = 0;
  let activeLoadsCount = 0;
  let totalKmDriven = 0;
  let loads = [];

  try {
    loads = await prisma.load.findMany({
      where: {
        driverId: driver.id,
        createdAt: { gte: start, lte: end }
      },
      select: { id: true, status: true, notes: true, destination: true, deliveryLocation: true, truck: { select: { odometerKm: true } } }
    });

    completedLoadsCount = loads.filter(l => ['DELIVERED', 'COMPLETED', 'CLOSED'].includes(l.status)).length;
    activeLoadsCount = loads.filter(l => ['IN_TRANSIT', 'ASSIGNED', 'DISPATCHED'].includes(l.status)).length;
    
    // Total KMs driven from loads
    totalKmDriven = completedLoadsCount * 650;
    if (activeLoadsCount > 0) {
      totalKmDriven += activeLoadsCount * 250;
    }
  } catch (err) {
    console.warn('Could not fetch driver loads for pay calculation:', err?.message);
  }

  // Parse load pay schedule if present
  let scheduleRates = {};
  if (driver?.loadPaySchedule) {
    try {
      const parsed = typeof driver.loadPaySchedule === 'string' ? JSON.parse(driver.loadPaySchedule) : driver.loadPaySchedule;
      if (Array.isArray(parsed)) {
        parsed.forEach(item => {
          if (item.isSelected !== false && item.amount) {
            const destKey = (item.deliveryLocation || '').trim().toLowerCase();
            if (destKey) scheduleRates[destKey] = parseFloat(item.amount);
          }
        });
      }
    } catch (e) {}
  }

  let basePay = 0;
  let loadAllowance = 0;
  let distanceAllow = 0;
  let otherAllowance = 0;
  let bonuses = 0;

  if (normalizedType.includes('load')) {
    // === PER LOAD ===
    // Only count loads that have been DELIVERED / COMPLETED. In-transit and assigned loads are NOT counted until delivered.
    const targetLoads = loads.filter(l => ['DELIVERED', 'COMPLETED', 'CLOSED'].includes(l.status));
    targetLoads.forEach(ld => {
      let loadAmt = 0;
      if (ld.notes && typeof ld.notes === 'string' && ld.notes.includes('[DRIVER_PAY:')) {
        const m = ld.notes.match(/\[DRIVER_PAY:([0-9.]+)/);
        if (m && m[1]) loadAmt = parseFloat(m[1]);
      }
      if (loadAmt <= 0 && (ld.destination || ld.deliveryLocation)) {
        const dKey = String(ld.destination || ld.deliveryLocation || '').trim().toLowerCase();
        for (const [k, v] of Object.entries(scheduleRates)) {
          if (dKey.includes(k) || k.includes(dKey)) {
            loadAmt = v;
            break;
          }
        }
      }
      if (loadAmt <= 0 && rawRate > 0) {
        loadAmt = rawRate;
      }
      totalLoadAmount += loadAmt;
    });
    loadAllowance = Math.round(totalLoadAmount * 100) / 100;
    basePay = loadAllowance;
  } else if (normalizedType.includes('km') || normalizedType.includes('kilometre')) {
    // === PER KM ===
    const calc = calculatePerKmDriverPay({ distanceKm: totalKmDriven, perKmRate: rawRate });
    distanceAllow = calc.grossPay;
    basePay = distanceAllow;
  } else {
    // === HOURLY (Default) ===
    const calc = calculateHourlyDriverPay({ hoursWorked, hourlyRate: rawRate });
    basePay = calc.grossPay;
  }

  // 4. Compute Totals: Gross Earnings = Net Pay (No Tax or Deductions)
  const grossEarnings = Math.round((basePay + (loadAllowance > 0 && normalizedType.includes('hourly') ? loadAllowance : 0) + (distanceAllow > 0 && normalizedType.includes('hourly') ? distanceAllow : 0) + otherAllowance + bonuses) * 100) / 100;
  
  // No tax or deduction deductions - Driver receives 100% of earned amount
  const paygTax = 0;
  const superAmount = 0;
  const totalDeductions = 0;
  const netPay = grossEarnings;

  return {
    payType,
    payRate: rawRate,
    units: {
      hoursWorked,
      completedLoadsCount,
      activeLoadsCount,
      totalKmDriven
    },
    basePay,
    loadAllowance,
    distanceAllow,
    otherAllowance,
    bonuses,
    grossEarnings,
    paygTax,
    superAmount,
    employerSuperContribution: superAmount,
    totalDeductions,
    netPay,
    formatted: {
      basePay: `$${basePay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      loadAllowance: `$${loadAllowance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      distanceAllowance: `$${distanceAllow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      grossEarnings: `$${grossEarnings.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      paygTax: '$0.00',
      superAmount: '$0.00',
      totalDeductions: '$0.00',
      netPay: `$${netPay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
  };
}

module.exports = {
  calculateDriverPay
};
