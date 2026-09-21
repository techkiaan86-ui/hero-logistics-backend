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
 * Calculate Per Load Driver Pay with Route/Destination Support (Sydney, Melbourne, QLD, etc.)
 * @param {object} params
 * @param {object} [params.load] - Load object with destination/stops and optional load-specific driverPay
 * @param {number} [params.driverRate] - Driver's configured base pay rate for loads
 * @param {number} [params.ruleRate] - Dynamic route rule rate for load
 * @param {object} [params.driverRouteRates] - Map or object of route-specific driver pay rates e.g. { Sydney: 450, Melbourne: 350, QLD: 550 }
 * @returns {object}
 */
function calculatePerLoadDriverPay({ load = null, driverRate = 0, ruleRate = 0, driverRouteRates = null }) {
  let effectiveRate = 0;

  // Priority 1: Explicit load-specific driver pay entered on load object
  if (load && (load.driverPay || load.driverPayment)) {
    const explicitPay = parseFloat(load.driverPay || load.driverPayment);
    if (!isNaN(explicitPay) && explicitPay > 0) {
      effectiveRate = explicitPay;
    }
  }

  // Priority 2: Tagged note format e.g. [DRIVER_PAY:450]
  if (effectiveRate <= 0 && load && load.notes && typeof load.notes === 'string' && load.notes.includes('[DRIVER_PAY:')) {
    const match = load.notes.match(/\[DRIVER_PAY:([0-9.]+)/);
    if (match && match[1]) {
      effectiveRate = parseFloat(match[1]);
    }
  }

  // Priority 3: Destination-specific route rate for driver (Sydney, Melbourne, Queensland)
  if (effectiveRate <= 0 && load) {
    const destStr = String(load.destination || load.to || load.deliveryAddress || '').toLowerCase();
    const origStr = String(load.origin || load.from || load.pickupAddress || '').toLowerCase();
    const fullRouteStr = `${origStr} ${destStr}`;

    const routeRatesMap = driverRouteRates || (load.driverRouteRates ? load.driverRouteRates : null);

    if (routeRatesMap && typeof routeRatesMap === 'object') {
      // Priority 3a: Destination-specific match first (e.g. Queensland destination vs Sydney origin)
      for (const [routeKey, rVal] of Object.entries(routeRatesMap)) {
        if (routeKey && rVal && parseFloat(rVal) > 0) {
          if (destStr && destStr.includes(routeKey.toLowerCase())) {
            effectiveRate = parseFloat(rVal);
            break;
          }
        }
      }

      // Priority 3b: Full route string match if destination alone did not match
      if (effectiveRate <= 0) {
        for (const [routeKey, rVal] of Object.entries(routeRatesMap)) {
          if (routeKey && rVal && parseFloat(rVal) > 0) {
            if (fullRouteStr.includes(routeKey.toLowerCase())) {
              effectiveRate = parseFloat(rVal);
              break;
            }
          }
        }
      }
    }
  }

  // Priority 4: Route Rule Rate passed from load route pricing
  if (effectiveRate <= 0 && parseFloat(ruleRate) > 0) {
    effectiveRate = parseFloat(ruleRate);
  }

  // Priority 5: Driver's default base per-load pay rate
  if (effectiveRate <= 0 && parseFloat(driverRate) > 0) {
    effectiveRate = parseFloat(driverRate);
  }

  // Fallback: 0.00 (Zero hardcoded defaults such as $300)
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

  if (rawPayType.includes('km') || rawPayType.includes('kilomet')) {
    // Distance calculation path
    let dist = parseFloat(distanceKm) || 0;
    if (dist <= 0 && load) {
      dist = parseFloat(load.totalDistance || load.distance) || 0;
    }
    result = calculatePerKmDriverPay({ distanceKm: dist, perKmRate: driverRate });
  } else if (rawPayType.includes('load')) {
    // Per load calculation path
    let driverRouteRates = driver.routePayRates || driver.preferredRoutes || (load && load.driverRouteRates ? load.driverRouteRates : null);
    if (typeof driverRouteRates === 'string') {
      try { driverRouteRates = JSON.parse(driverRouteRates); } catch (e) { driverRouteRates = null; }
    }
    result = calculatePerLoadDriverPay({ load, driverRate, ruleRate: routeRuleRate, driverRouteRates });
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
