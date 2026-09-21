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

  try {
    const loads = await prisma.load.findMany({
      where: {
        driverId: driver.id,
        createdAt: { gte: start, lte: end }
      },
      select: { id: true, status: true, truck: { select: { odometerKm: true } } }
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

  // 3. Dynamic Calculation based on payType using decoupled driverPayCalculator
  let basePay = 0;
  let loadAllowance = 0;
  let distanceAllow = 0;
  const otherAllowance = 0;
  const bonuses = 0;

  const normalizedType = payType.toLowerCase();

  if (normalizedType.includes('load')) {
    // === PER LOAD ===
    const effectiveLoads = completedLoadsCount + activeLoadsCount;
    const calc = calculatePerLoadDriverPay({ driverRate: rawRate });
    loadAllowance = Math.round(effectiveLoads * calc.grossPay * 100) / 100;
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

  // 4. Compute Totals, PAYG Tax Withholding & Employer Superannuation Contribution
  const grossEarnings = Math.round((basePay + (loadAllowance > 0 && normalizedType.includes('hourly') ? loadAllowance : 0) + (distanceAllow > 0 && normalizedType.includes('hourly') ? distanceAllow : 0) + otherAllowance + bonuses) * 100) / 100;
  
  // PAYG Tax Withholding
  const paygTax = Math.round(grossEarnings * 0.15 * 100) / 100;
  
  // Superannuation Guarantee Contribution (11.5%)
  const superAmount = Math.round(grossEarnings * 0.115 * 100) / 100;
  
  // Total Deductions
  const totalDeductions = Math.round(paygTax * 100) / 100;
  
  // Net Pay = Gross Earnings - Total Deductions
  const netPay = Math.round((grossEarnings - totalDeductions) * 100) / 100;

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
      paygTax: `$${paygTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      superAmount: `$${superAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      totalDeductions: `$${totalDeductions.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      netPay: `$${netPay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
  };
}

module.exports = {
  calculateDriverPay
};
