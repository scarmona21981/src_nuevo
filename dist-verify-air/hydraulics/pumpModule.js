"use strict";
/**
 * Pump Module - Pump Curve Analysis and Operating Point Calculation
 *
 * Implements:
 * - Pump curve interpolation (3-point and table modes)
 * - System curve calculation
 * - Operating point solver (intersection of pump and system curves)
 * - Pump curve validation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPumpCurve = createPumpCurve;
exports.createSystemCurve = createSystemCurve;
exports.findOperatingPoint = findOperatingPoint;
exports.validatePumpCurve = validatePumpCurve;
exports.generateCurvePoints = generateCurvePoints;
// ============================================================================
// PUMP CURVE INTERPOLATION
// ============================================================================
/**
 * Create an interpolated pump curve function from discrete points
 *
 * For 3-point mode: Uses quadratic fit
 * For table mode: Uses linear interpolation between points
 *
 * @param pump - Pump object with curve data
 * @returns Function that maps Q (m³/s) to H (m)
 */
function createPumpCurve(pump) {
    if (pump.curveMode === '3_POINTS') {
        return create3PointCurve(pump);
    }
    else {
        return createTableCurve(pump);
    }
}
/**
 * Create pump curve from 3 points using quadratic fit
 *
 * Fits: H = a·Q² + b·Q + c
 */
function create3PointCurve(pump) {
    const { point0, pointNom, pointMax } = pump;
    if (!point0 || !pointNom || !pointMax) {
        throw new Error('3-point pump curve requires all three points defined');
    }
    // Extract points
    const points = [point0, pointNom, pointMax];
    // Fit quadratic: H = a·Q² + b·Q + c
    // Using 3 points to solve 3 equations
    const [p0, p1, p2] = points;
    // Build matrix for quadratic fit
    // [Q0², Q0, 1] [a]   [H0]
    // [Q1², Q1, 1] [b] = [H1]
    // [Q2², Q2, 1] [c]   [H2]
    const A = [
        [p0.Q * p0.Q, p0.Q, 1],
        [p1.Q * p1.Q, p1.Q, 1],
        [p2.Q * p2.Q, p2.Q, 1]
    ];
    const B = [p0.H, p1.H, p2.H];
    // Solve using Cramer's rule
    const coeffs = solveLinearSystem3x3(A, B);
    const [a, b, c] = coeffs;
    // Return interpolation function
    return (Q) => {
        if (Q < 0)
            return c; // Shutoff head
        if (Q > p2.Q) {
            // Extrapolation beyond max point (use linear from last two points)
            const slope = (p2.H - p1.H) / (p2.Q - p1.Q);
            return p2.H + slope * (Q - p2.Q);
        }
        return a * Q * Q + b * Q + c;
    };
}
/**
 * Create pump curve from table using linear interpolation
 */
function createTableCurve(pump) {
    const { curveTable } = pump;
    if (!curveTable || curveTable.length < 3) {
        throw new Error('Table pump curve requires at least 3 points');
    }
    // Sort points by Q (ascending)
    const sortedPoints = [...curveTable].sort((a, b) => a.Q - b.Q);
    return (Q) => {
        // Find bracketing points
        if (Q <= sortedPoints[0].Q)
            return sortedPoints[0].H;
        if (Q >= sortedPoints[sortedPoints.length - 1].Q) {
            return sortedPoints[sortedPoints.length - 1].H;
        }
        // Linear interpolation
        for (let i = 0; i < sortedPoints.length - 1; i++) {
            const p1 = sortedPoints[i];
            const p2 = sortedPoints[i + 1];
            if (Q >= p1.Q && Q <= p2.Q) {
                const t = (Q - p1.Q) / (p2.Q - p1.Q);
                return p1.H + t * (p2.H - p1.H);
            }
        }
        return sortedPoints[sortedPoints.length - 1].H;
    };
}
// ============================================================================
// SYSTEM CURVE CALCULATION
// ============================================================================
/**
 * Create a system curve function
 * @param staticHead m - static head difference (z_end - z_start)
 * @param K_total lumped friction coefficient such that hf = K_total * Q^1.85 (for HW) or Q^2 (for DW)
 * @returns function mapping Q (m3/s) to H_required (m)
 */
function createSystemCurve(staticHead, K_total) {
    return (Q) => staticHead + K_total * Math.pow(Math.abs(Q), 1.85);
}
// ============================================================================
// OPERATING POINT SOLVER
// ============================================================================
/**
 * Find operating point (intersection of pump and system curves)
 *
 * Uses Robust Bisection Method to solve: F(Q) = H_pump(Q) - H_system(Q) = 0
 *
 * Improvements:
 * - Verifies existence of intersection (sign change)
 * - Automatically expands search range if needed
 * - Robust fallback for non-intersecting cases (undersized pump)
 *
 * @param pumpCurve - Pump curve function H(Q)
 * @param systemHeadFunction - Function that calculates system head required for a given Q
 * @param Q_max_initial - Initial maximum flow search range (usually Pump Qnom)
 * @returns Operating point { Q, H }
 */
function findOperatingPoint(pumpCurve, systemHeadFunction, Q_max_initial) {
    const TOLERANCE_Q = 1e-6; // 0.001 L/s precision (High precision for Head stability)
    const MAX_ITER = 100;
    let Qmin = 0;
    let Qmax = Q_max_initial;
    // Define objective function
    const F = (q) => pumpCurve(q) - systemHeadFunction(q);
    // 1. Initial Check: System Blocked?
    // If Shutoff Head < Static Head, flow is zero.
    // We assume F(0) = H_shutoff - H_static
    if (F(0) < 0) {
        return { Q: 0, H: pumpCurve(0) };
    }
    // 2. Expand Range to find Intersection
    // We need F(Qmin) > 0 and F(Qmax) < 0 for a valid intersection
    // F(0) is positive (Pump Head > Static Head)
    // We need to find a Qmax where Pump Head < System Head (F < 0)
    let expansionCount = 0;
    const MAX_EXPANSIONS = 10;
    let Fmin = F(Qmin);
    let Fmax = F(Qmax);
    // Initial check for sign change
    if (Fmin * Fmax > 0) {
        while (expansionCount < MAX_EXPANSIONS) {
            // No sign change yet, expand range
            Qmax *= 1.5;
            Fmax = F(Qmax);
            expansionCount++;
            // Check if we crossed zero
            if (Fmin * Fmax <= 0)
                break;
            // Safety break if we simply went too far (e.g. 5x initial)
            if (Qmax > 5 * Q_max_initial)
                break;
        }
    }
    // 3. Check if we found a valid bracket
    if (Fmin * Fmax > 0) {
        // Still no intersection after expansion.
        // This implies the pump is "undersized" or "runout" condition (Pump > System for all Q tested).
        // Or system curve is flat/below pump curve everywhere in sane range.
        // Return the maximum tested flow condition as "Runout".
        return { Q: Qmax, H: pumpCurve(Qmax) };
    }
    // 4. Robust Bisection Method
    let iter = 0;
    let Qmid = 0;
    while (Math.abs(Qmax - Qmin) > TOLERANCE_Q && iter < MAX_ITER) {
        Qmid = (Qmin + Qmax) / 2;
        const Fmid = F(Qmid);
        if (Fmin * Fmid <= 0) {
            // Root is in [Qmin, Qmid]
            Qmax = Qmid;
            Fmax = Fmid;
        }
        else {
            // Root is in [Qmid, Qmax]
            Qmin = Qmid;
            Fmin = Fmid;
        }
        iter++;
    }
    // Return midpoint
    const Qop = (Qmin + Qmax) / 2;
    return { Q: Qop, H: pumpCurve(Qop) };
}
// ============================================================================
// PUMP CURVE VALIDATION
// ============================================================================
/**
 * Validate pump curve data
 *
 * Checks:
 * - At least 3 points
 * - Q values strictly increasing
 * - H values strictly decreasing
 */
function validatePumpCurve(pump) {
    const errors = [];
    let points = [];
    if (pump.curveMode === '3_POINTS') {
        if (!pump.point0 || !pump.pointNom || !pump.pointMax) {
            errors.push('Curva de 3 puntos requiere todos los puntos definidos');
            return { valid: false, errors };
        }
        points = [pump.point0, pump.pointNom, pump.pointMax];
    }
    else {
        if (!pump.curveTable || pump.curveTable.length < 3) {
            errors.push('Curva de tabla requiere al menos 3 puntos');
            return { valid: false, errors };
        }
        points = pump.curveTable;
    }
    // Check minimum number of points
    if (points.length < 3) {
        errors.push('Se requieren al menos 3 puntos en la curva');
    }
    // Sort points by Q
    const sorted = [...points].sort((a, b) => a.Q - b.Q);
    // Check Q values are strictly increasing
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].Q <= sorted[i - 1].Q) {
            errors.push(`Valores de Q deben ser estrictamente crecientes (Q[${i}] = ${sorted[i].Q} <= Q[${i - 1}] = ${sorted[i - 1].Q})`);
        }
    }
    // Check H values are decreasing (typical pump curve)
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].H >= sorted[i - 1].H) {
            errors.push(`Valores de H deben ser decrecientes (H[${i}] = ${sorted[i].H} >= H[${i - 1}] = ${sorted[i - 1].H})`);
        }
    }
    // Check for negative or zero values
    for (let i = 0; i < points.length; i++) {
        if (points[i].Q < 0) {
            errors.push(`Q no puede ser negativo (punto ${i}: Q = ${points[i].Q})`);
        }
        if (points[i].H <= 0) {
            errors.push(`H debe ser positivo (punto ${i}: H = ${points[i].H})`);
        }
    }
    return {
        valid: errors.length === 0,
        errors
    };
}
// ============================================================================
// CURVE GENERATION FOR PLOTTING
// ============================================================================
/**
 * Generate points for plotting pump curve
 *
 * @param pumpCurve - Pump curve function
 * @param Q_max - Maximum Q to plot
 * @param numPoints - Number of points to generate
 * @returns Array of curve points
 */
function generateCurvePoints(pumpCurve, Q_max, numPoints = 50) {
    const points = [];
    for (let i = 0; i <= numPoints; i++) {
        const Q = (i / numPoints) * Q_max;
        const H = pumpCurve(Q);
        points.push({ Q, H });
    }
    return points;
}
// ============================================================================
// UTILITY: 3x3 LINEAR SYSTEM SOLVER
// ============================================================================
/**
 * Solve 3x3 linear system using Cramer's rule
 */
function solveLinearSystem3x3(A, B) {
    // Calculate determinant of A
    const detA = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
        A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
        A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    if (Math.abs(detA) < 1e-10) {
        throw new Error('Matriz singular - no se puede resolver el sistema');
    }
    // Solve using Cramer's rule
    const x = [];
    for (let i = 0; i < 3; i++) {
        const A_i = A.map(row => [...row]);
        A_i[0][i] = B[0];
        A_i[1][i] = B[1];
        A_i[2][i] = B[2];
        const det_i = A_i[0][0] * (A_i[1][1] * A_i[2][2] - A_i[1][2] * A_i[2][1]) -
            A_i[0][1] * (A_i[1][0] * A_i[2][2] - A_i[1][2] * A_i[2][0]) +
            A_i[0][2] * (A_i[1][0] * A_i[2][1] - A_i[1][1] * A_i[2][0]);
        x[i] = det_i / detA;
    }
    return x;
}
