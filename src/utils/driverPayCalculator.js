/**
 * Driver Pay Calculator Utility
 * Supports 3 separate, testable calculation paths:
 * 1. Hourly: Hours Worked × Hourly Rate
 * 2. Per Kilometer: Actual Load Distance × Driver KM Rate
 * 3. Per Load: Load-specific driver payment based on driver payRate or applicable route rule.
 * 
 * Rates come from configuration/database records with zero hardcoded defaults ($300, $60/hr, etc.).
 */

/**
 * Calculate Hourly Driver Pay
 * @param {object} params
 * @param {number} params.hoursWorked
 * @param {number} params.hourlyRate
 * @returns {object}
 */
function calculateHourlyDriverPay({ hoursWorked = 0, hourlyRate = 0 }) {
  const hours = Math.max(0, parseFloat(hoursWorked) || 0);
  const rate = Math.max(0, parseFloat(hourlyRate) || 0);
  const grossPay = Math.round(hours * rate * 100) / 100;

  return {
    payType: 'Hourly',
    units: hours,
    unitLabel: 'Hours',
    rate,
    grossPay,
    formattedGross: `$${grossPay.toFixed(2)}`
  };
}

/**
 * Calculate Per Kilometer Driver Pay
 * @param {object} params
 * @param {number} params.distanceKm
 * @param {number} params.perKmRate
 * @returns {object}
 */
function calculatePerKmDriverPay({ distanceKm = 0, perKmRate = 0 }) {
  const dist = Math.max(0, parseFloat(distanceKm) || 0);
  const rate = Math.max(0, parseFloat(perKmRate) || 0);
  const grossPay = Math.round(dist * rate * 100) / 100;

  return {
    payType: 'Per Kilometer',
    units: dist,
    unitLabel: 'Kilometers',
    rate,
    grossPay,
    formattedGross: `$${grossPay.toFixed(2)}`
  };
}

/**
 * Calculate Per Load Driver Pay
 * @param {object} params
 * @param {object} [params.load] - Load object with optional load-specific driver payment
 * @param {number} [params.driverRate] - Driver's configured pay rate for loads
 * @param {number} [params.ruleRate] - Dynamic route rule rate for load
 * @returns {object}
 */
function calculatePerLoadDriverPay({ load = null, driverRate = 0, ruleRate = 0 }) {
  // Check rate priority: explicit driver rate -> route rule rate -> load-specific note/field
  let effectiveRate = 0;

  const dRate = parseFloat(driverRate) || 0;
  const rRate = parseFloat(ruleRate) || 0;

  if (dRate > 0) {
    effectiveRate = dRate;
  } else if (rRate > 0) {
    effectiveRate = rRate;
  } else if (load) {
    if (load.driverPayment && !isNaN(parseFloat(load.driverPayment))) {
      effectiveRate = parseFloat(load.driverPayment);
    } else if (load.notes && typeof load.notes === 'string' && load.notes.includes('[DRIVER_PAY:')) {
      const match = load.notes.match(/\[DRIVER_PAY:([0-9.]+)/);
      if (match && match[1]) {
        effectiveRate = parseFloat(match[1]);
      }
    }
  }

  const grossPay = Math.round(effectiveRate * 100) / 100;

  return {
    payType: 'Per Load',
    units: 1,
    unitLabel: 'Load',
    rate: grossPay,
    grossPay,
    formattedGross: `$${grossPay.toFixed(2)}`
  };
}

/**
 * Master Driver Payment Calculator for a given Load and Driver
 * @param {object} params
 * @param {object} params.driver - Driver DB record
 * @param {object} [params.load] - Load DB record
 * @param {number} [params.distanceKm] - Load distance in km
 * @param {number} [params.hoursWorked] - Hours worked on load
 * @param {number} [params.routeRuleRate] - Applicable route pricing rule for load
 * @returns {object} Full earnings & tax breakdown
 */
function calculateDriverPayForLoad({ driver, load = null, distanceKm = 0, hoursWorked = 0, routeRuleRate = 0 }) {
  if (!driver) {
    return {
      payType: 'Unknown',
      grossPay: 0,
      paygTax: 0,
      superContribution: 0,
      netPay: 0,
      formattedGross: '$0.00'
    };
  }

  const rawPayType = String(driver.payType || 'Hourly').trim().toLowerCase();
  const driverRate = parseFloat(driver.payRate) || 0;

  let result;

  if (rawPayType.includes('km') || rawPayType.includes('kilometre')) {
    // Distance calculation path
    let dist = parseFloat(distanceKm) || 0;
    if (dist <= 0 && load) {
      dist = parseFloat(load.totalDistance || load.distance) || 0;
    }
    result = calculatePerKmDriverPay({ distanceKm: dist, perKmRate: driverRate });
  } else if (rawPayType.includes('load')) {
    // Per load calculation path
    result = calculatePerLoadDriverPay({ load, driverRate, ruleRate: routeRuleRate });
  } else {
    // Hourly calculation path (default)
    let hrs = parseFloat(hoursWorked) || 0;
    if (hrs <= 0 && load && load.estimatedHours) {
      hrs = parseFloat(load.estimatedHours) || 0;
    }
    result = calculateHourlyDriverPay({ hoursWorked: hrs, hourlyRate: driverRate });
  }

  const grossPay = result.grossPay;
  const paygTax = Math.round(grossPay * 0.15 * 100) / 100;
  const superContribution = Math.round(grossPay * 0.115 * 100) / 100;
  const totalDeductions = paygTax;
  const netPay = Math.round((grossPay - totalDeductions) * 100) / 100;

  return {
    ...result,
    paygTax,
    superContribution,
    totalDeductions,
    netPay,
    formatted: {
      grossPay: `$${grossPay.toFixed(2)}`,
      paygTax: `$${paygTax.toFixed(2)}`,
      superContribution: `$${superContribution.toFixed(2)}`,
      totalDeductions: `$${totalDeductions.toFixed(2)}`,
      netPay: `$${netPay.toFixed(2)}`
    }
  };
}

module.exports = {
  calculateHourlyDriverPay,
  calculatePerKmDriverPay,
  calculatePerLoadDriverPay,
  calculateDriverPayForLoad
};
