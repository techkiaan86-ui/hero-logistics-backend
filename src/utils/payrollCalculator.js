const prisma = require('./prismaClient');

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
    
    // Total KMs estimation: 650 km per completed trip, or from odometer
    totalKmDriven = completedLoadsCount * 650;
    if (activeLoadsCount > 0) {
      totalKmDriven += activeLoadsCount * 250;
    }
  } catch (err) {
    console.warn('Could not fetch driver loads for pay calculation:', err?.message);
  }

  // 3. Dynamic Calculation based on payType
  let basePay = 0;
  let loadAllowance = 0;
  let distanceAllow = 0;
  const otherAllowance = 0;
  const bonuses = 0;

  const normalizedType = payType.toLowerCase();

  if (normalizedType.includes('load')) {
    // === PER LOAD ===
    const ratePerLoad = rawRate > 0 ? rawRate : 250.00;
    // If completed loads exist, use completed. If driver has active loads during period, include them.
    const effectiveLoads = Math.max(completedLoadsCount + activeLoadsCount, 1);
    loadAllowance = Math.round(effectiveLoads * ratePerLoad * 100) / 100;
    basePay = loadAllowance;
  } else if (normalizedType.includes('km') || normalizedType.includes('kilometre')) {
    // === PER KM ===
    const ratePerKm = rawRate > 0 ? rawRate : 0.85;
    const effectiveKm = Math.max(totalKmDriven, 850);
    distanceAllow = Math.round(effectiveKm * ratePerKm * 100) / 100;
    basePay = distanceAllow;
  } else {
    // === HOURLY (Default) ===
    const hourlyRate = rawRate > 0 ? rawRate : 35.00;
    // If timesheet has recorded hours use them, else fallback to standard 38-40 hr fortnight / active work
    const effectiveHours = hoursWorked > 0 ? hoursWorked : (completedLoadsCount > 0 ? completedLoadsCount * 8 : 40);
    basePay = Math.round(effectiveHours * hourlyRate * 100) / 100;
  }

  // 4. Compute Totals & Statutory Deductions
  const grossEarnings = Math.round((basePay + (loadAllowance > 0 && normalizedType.includes('hourly') ? loadAllowance : 0) + (distanceAllow > 0 && normalizedType.includes('hourly') ? distanceAllow : 0) + otherAllowance + bonuses) * 100) / 100;
  const paygTax = Math.round(grossEarnings * 0.15 * 100) / 100;
  const superAmount = Math.round(grossEarnings * 0.11 * 100) / 100;
  const totalDeductions = Math.round((paygTax + superAmount) * 100) / 100;
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
