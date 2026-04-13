"use strict";
/**
 * Pressure Module - Pressure Verification and Analysis
 *
 * Implements:
 * - Pressure calculation at points along the system
 * - Pressure limit verification against PN rating
 * - Negative pressure detection
 * - Velocity range validation
 * - Flow efficiency verification
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VELOCITY_EPS_MS = exports.EPS_MARGIN_PCT = exports.EPS_SUBMERGENCE_M = exports.EPS_COUNT = exports.EPS_VOLUME_M3 = exports.EPS_TIME_MIN = exports.VELOCITY_TOLERANCE_MS = exports.VELOCITY_MAX_MS = exports.VELOCITY_MIN_MS = exports.PRESSURE_END_EPS_BAR = void 0;
exports.calculatePressure = calculatePressure;
exports.calculatePressureProfile = calculatePressureProfile;
exports.verifyPressureLimits = verifyPressureLimits;
exports.evaluateEndPressureStatus = evaluateEndPressureStatus;
exports.calculateHeadDistributionPct = calculateHeadDistributionPct;
exports.shouldWarnHighLosses = shouldWarnHighLosses;
exports.calculateBepFlowRatio = calculateBepFlowRatio;
exports.shouldRecommendSmallerPumpByBep = shouldRecommendSmallerPumpByBep;
exports.isVelocityWithinNormativeRange = isVelocityWithinNormativeRange;
exports.verifyVelocityRange = verifyVelocityRange;
exports.verifyFlowEfficiency = verifyFlowEfficiency;
exports.calculateOptimalWetWellLevels = calculateOptimalWetWellLevels;
exports.optimizeWetWellForRetention = optimizeWetWellForRetention;
exports.optimizePipeDiameter = optimizePipeDiameter;
exports.calculateSanitaryCycle = calculateSanitaryCycle;
exports.calculateCycleTime = calculateCycleTime;
exports.verifyOperationalCycle = verifyOperationalCycle;
exports.verifyHeadLosses = verifyHeadLosses;
exports.interpolatePipeElevation = interpolatePipeElevation;
exports.calculateSanitaryDiagnostic = calculateSanitaryDiagnostic;
exports.generateHydraulicSamples = generateHydraulicSamples;
exports.calculateWetWellVolume = calculateWetWellVolume;
exports.calculateNchVerification = calculateNchVerification;
const lossModule_1 = require("./lossModule");
const pumpModule_1 = require("./pumpModule");
const profileGeometry_1 = require("./profileGeometry");
const G = 9.81; // m/s² - Gravitational acceleration
// ============================================================================
// PRESSURE CALCULATIONS
// ============================================================================
/**
 * Calculate pressure at a point
 *
 * Formula: P = (H - z) · ρ · g / 100000
 * where:
 * - H = total head (m)
 * - z = elevation (m)
 * - Result in bar (1 bar = 100000 Pa)
 *
 * Simplified: P (bar) = (H - z) / 10.2
 *
 * @param H - Total head (m)
 * @param z - Elevation (m)
 * @returns Pressure (bar)
 */
function evaluatePressureStatus(head, elevation) {
    const pressureHead = head - elevation;
    if (pressureHead < 0)
        return 'Zona con ingreso de aire';
    if (pressureHead < 0.5)
        return 'Zona inestable';
    return 'Normal';
}
function calculatePressure(H, z) {
    // P (bar) = ρgh / 100000 = (H - z) / 10.2
    // More accurate: 1 bar = 10.1972 m of water column
    const P = (H - z) / 10.1972;
    return P;
}
/**
 * Calculate pressure at multiple points along a pressure pipe
 *
 * @param H_pump - Pump discharge head (m)
 * @param z_pump - Pump elevation (m)
 * @param z_end - Pipe end elevation (m)
 * @param h_friction - Friction loss (m)
 * @param h_singular - Singular losses (m)
 * @param length - Total pipe length (m)
 * @param profilePoints - Optional intermediate terrain points
 * @returns Array of pressure points
 */
function calculatePressureProfile(H_pump, z_pump, z_end, h_friction, h_singular, length, profilePoints, inlineNodes, profileOptions) {
    const points = [];
    const chainageEps = 1e-6;
    const round3 = (value) => Math.round(value * 1000) / 1000;
    const clampChainage = (value) => Math.max(0, Math.min(length, value));
    const effectiveLength = length > 0 ? length : 1;
    const terrainPolyline = (0, profileGeometry_1.buildTerrainPolyline)({
        length,
        zStartApprox: z_pump,
        zEndApprox: z_end,
        zStartTerrain: profileOptions?.z_start_terreno,
        zEndTerrain: profileOptions?.z_end_terreno,
        profilePoints
    });
    const getPipeElevation = (chainage) => (0, profileGeometry_1.interpolatePipeElevationFromTerrain)(chainage, {
        length,
        zStartApprox: z_pump,
        zEndApprox: z_end,
        zStartTerrain: profileOptions?.z_start_terreno,
        zEndTerrain: profileOptions?.z_end_terreno,
        cover_m: profileOptions?.cover_m,
        diameter_mm: profileOptions?.diameter_mm,
        outsideDiameter_m: profileOptions?.outsideDiameter_m,
        profilePoints: terrainPolyline,
        reference: profileOptions?.reference || 'axis'
    });
    // Point 1: Pump discharge (at chainage 0) - Always first
    const startPipeElevation = getPipeElevation(0);
    points.push({
        location: 'Descarga Bomba',
        chainage: 0,
        elevation: startPipeElevation,
        head: H_pump,
        pressure: calculatePressure(H_pump, startPipeElevation),
        status: evaluatePressureStatus(H_pump, startPipeElevation)
    });
    const startHeadAfterSingular = H_pump - h_singular;
    // Add point exactly after singular losses
    points.push({
        location: 'Después Singulares',
        chainage: 0,
        elevation: startPipeElevation,
        head: startHeadAfterSingular,
        pressure: calculatePressure(startHeadAfterSingular, startPipeElevation),
        status: evaluatePressureStatus(startHeadAfterSingular, startPipeElevation)
    });
    const events = [];
    // Intermediate terrain key points (sorted and deduplicated)
    terrainPolyline.forEach((pt, i) => {
        if (pt.chainage <= 0 || pt.chainage >= length)
            return;
        events.push({
            chainage: pt.chainage,
            elevation: getPipeElevation(pt.chainage),
            label: pt.id ? `Perfil ${pt.id}` : `Perfil ${i}`,
            isAirValve: false
        });
    });
    // End point is always evaluated
    events.push({ chainage: length, elevation: getPipeElevation(length), label: 'Fin de Tubería', isAirValve: false });
    // Ensure exact points at each installed air valve (robust interpolation insertion)
    if (inlineNodes) {
        inlineNodes.forEach(node => {
            if (!Number.isFinite(node.chainage))
                return;
            const valveChainage = clampChainage(node.chainage);
            const valveLabel = `${node.id || 'Ventosa'} (${node.airValveType})`;
            const existing = events.find(ev => Math.abs(ev.chainage - valveChainage) < chainageEps);
            if (existing) {
                existing.isAirValve = true;
                if (!existing.label.includes(node.id || 'Ventosa')) {
                    existing.label = `${existing.label} / ${valveLabel}`;
                }
                return;
            }
            events.push({
                chainage: valveChainage,
                elevation: getPipeElevation(valveChainage),
                label: valveLabel,
                isAirValve: true
            });
        });
    }
    // Sort by chainage
    events.sort((a, b) => a.chainage - b.chainage);
    // Sequential friction losses (normal hydraulic solve, without local valve clamp yet)
    let currentH = startHeadAfterSingular;
    let lastX = 0;
    // Process all events in order
    events.forEach(ev => {
        const deltaX = Math.max(0, ev.chainage - lastX);
        const loss = (deltaX / effectiveLength) * h_friction;
        const hgl = currentH - loss;
        const statusText = evaluatePressureStatus(hgl, ev.elevation);
        points.push({
            location: ev.label,
            chainage: ev.chainage,
            elevation: ev.elevation,
            head: hgl,
            pressure: calculatePressure(hgl, ev.elevation),
            status: statusText
        });
        // Update head and chainage for next segment
        currentH = hgl;
        lastX = ev.chainage;
    });
    // Final clamp at installed air valve locations only
    if (inlineNodes && inlineNodes.length > 0) {
        const byX = new Map();
        points.forEach(pt => {
            if (typeof pt.chainage === 'number' && Number.isFinite(pt.chainage)) {
                byX.set(round3(pt.chainage), pt);
            }
        });
        const valveChainages = new Set();
        inlineNodes.forEach(v => {
            if (Number.isFinite(v.chainage)) {
                valveChainages.add(round3(clampChainage(v.chainage)));
            }
        });
        valveChainages.forEach(xKey => {
            const pt = byX.get(xKey);
            if (!pt)
                return;
            if (pt.pressure < 0) {
                pt.pressure = 0;
                pt.head = pt.elevation;
                pt.status = 'Ingreso de aire (ventosa activa)';
            }
        });
    }
    return points.sort((a, b) => (a.chainage || 0) - (b.chainage || 0));
}
// ============================================================================
// PRESSURE VERIFICATION
// ============================================================================
/**
 * Verify pressure limits at all points
 *
 * Checks:
 * - No pressure exceeds PN rating
 * - No negative pressures (cavitation risk)
 *
 * @param pressurePoints - Array of pressure points
 * @param PN - Pipe pressure rating (bar)
 * @returns Verification result
 */
function verifyPressureLimits(pressurePoints, PN, options) {
    const violations = [];
    let maxPressure = -Infinity;
    let maxLocation = '';
    const allowAtmosphericEnd = options?.allowAtmosphericEndPressure ?? false;
    const epsBar = options?.endPressureToleranceBar ?? 1e-6;
    const lowPressureThreshold = options?.lowPressureWarningBar ?? 0.5;
    for (let i = 0; i < pressurePoints.length; i++) {
        const point = pressurePoints[i];
        const isEndPoint = i === pressurePoints.length - 1;
        const isAtmosphericEndPoint = allowAtmosphericEnd && isEndPoint;
        // Track maximum pressure
        if (point.pressure > maxPressure) {
            maxPressure = point.pressure;
            maxLocation = point.location;
        }
        // Check for overpressure
        if (point.pressure > PN) {
            violations.push(`Presión excede PN en ${point.location}: ${point.pressure.toFixed(2)} bar > ${PN} bar`);
        }
        // End atmospheric discharge is expected around 0 barg.
        // Only flag as critical if pressure is truly negative below tolerance.
        if (isAtmosphericEndPoint) {
            if (point.pressure < -epsBar) {
                violations.push(`Presión negativa en ${point.location}: ${point.pressure.toFixed(2)} bar (riesgo de cavitación)`);
            }
            continue;
        }
        // Check for negative pressure (cavitation risk)
        if (point.pressure < -epsBar) {
            violations.push(`Presión negativa en ${point.location}: ${point.pressure.toFixed(2)} bar (riesgo de cavitación)`);
        }
        // Check for very low positive pressure
        if (point.pressure >= -epsBar && point.pressure < lowPressureThreshold) {
            violations.push(`Presión muy baja en ${point.location}: ${point.pressure.toFixed(2)} bar (riesgo de ingreso de aire)`);
        }
    }
    return {
        ok: violations.length === 0,
        violations,
        maxPressure,
        maxLocation
    };
}
exports.PRESSURE_END_EPS_BAR = 1e-6;
function evaluateEndPressureStatus(pressureEndBar, atmosphericDischarge, epsBar = exports.PRESSURE_END_EPS_BAR, lowPressureThresholdBar = 0.5) {
    if (!Number.isFinite(pressureEndBar)) {
        return { status: 'warning', message: 'Presión final no disponible.' };
    }
    if (atmosphericDischarge) {
        if (pressureEndBar < -epsBar) {
            return {
                status: 'critical',
                message: `Presión negativa: riesgo de ingreso de aire/cavitación (P_end=${pressureEndBar.toFixed(2)} bar).`
            };
        }
        return {
            status: 'ok',
            message: 'Descarga a atmósfera: P ≈ 0 bar (esperado).'
        };
    }
    if (pressureEndBar < -epsBar) {
        return {
            status: 'critical',
            message: `Presión negativa: riesgo de ingreso de aire/cavitación (P_end=${pressureEndBar.toFixed(2)} bar).`
        };
    }
    if (pressureEndBar < lowPressureThresholdBar) {
        return {
            status: 'warning',
            message: `Presión muy baja en descarga: ${pressureEndBar.toFixed(2)} bar.`
        };
    }
    return { status: 'ok', message: 'Presión final en rango aceptable.' };
}
function calculateHeadDistributionPct(hStatic, hFriction, hMinor, hTotal) {
    if (!Number.isFinite(hStatic) || !Number.isFinite(hFriction) || !Number.isFinite(hMinor) || !Number.isFinite(hTotal)) {
        return null;
    }
    if (hTotal <= 0)
        return null;
    const losses = hFriction + hMinor;
    return {
        staticPct: (hStatic / hTotal) * 100,
        lossesPct: (losses / hTotal) * 100
    };
}
function shouldWarnHighLosses(lossesPct, thresholdPct = 50) {
    if (!Number.isFinite(lossesPct))
        return false;
    return lossesPct >= thresholdPct;
}
function calculateBepFlowRatio(Qstar, QBep) {
    if (!Number.isFinite(Qstar) || !Number.isFinite(QBep) || QBep <= 0)
        return null;
    return Qstar / QBep;
}
function shouldRecommendSmallerPumpByBep(qRatioToBep, minRecommendedRatio = 0.7) {
    if (!Number.isFinite(qRatioToBep ?? Number.NaN))
        return false;
    return qRatioToBep < minRecommendedRatio;
}
// ============================================================================
// VELOCITY VERIFICATION
// ============================================================================
exports.VELOCITY_MIN_MS = 0.6;
exports.VELOCITY_MAX_MS = 3.0;
exports.VELOCITY_TOLERANCE_MS = 1e-6;
exports.EPS_TIME_MIN = 1e-9;
exports.EPS_VOLUME_M3 = 1e-9;
exports.EPS_COUNT = 1e-9;
exports.EPS_SUBMERGENCE_M = 1e-9;
exports.EPS_MARGIN_PCT = 1e-9;
exports.VELOCITY_EPS_MS = 1e-9;
function isVelocityWithinNormativeRange(v, vMin = exports.VELOCITY_MIN_MS, vMax = exports.VELOCITY_MAX_MS, tolerance = exports.VELOCITY_TOLERANCE_MS) {
    if (!Number.isFinite(v))
        return false;
    return v >= (vMin - tolerance) && v <= (vMax + tolerance);
}
/**
 * Verify velocity is within acceptable range for pressure pipes
 *
 * Range: 0.6 - 3.0 m/s
 *
 * @param v - Velocity (m/s)
 * @returns Verification result
 */
function verifyVelocityRange(v) {
    const V_MIN = exports.VELOCITY_MIN_MS;
    const V_MAX = exports.VELOCITY_MAX_MS;
    const eps = exports.VELOCITY_TOLERANCE_MS;
    if (v < (V_MIN - eps)) {
        return {
            ok: false,
            message: `Velocidad: ${v.toFixed(2)} m/s (no cumple: < ${V_MIN.toFixed(2)} m/s)`
        };
    }
    if (v > (V_MAX + eps)) {
        return {
            ok: false,
            message: `Velocidad: ${v.toFixed(2)} m/s (no cumple: > ${V_MAX.toFixed(2)} m/s)`
        };
    }
    return {
        ok: true,
        message: `Velocidad: ${v.toFixed(2)} m/s (cumple ${V_MIN.toFixed(2)}–${V_MAX.toFixed(2)} m/s)`
    };
}
// ============================================================================
// FLOW EFFICIENCY VERIFICATION
// ============================================================================
/**
 * Verify pump is operating within efficient range
 *
 * Recommended: 0.7 ≤ Q_operating/Q_nominal ≤ 1.2
 *
 * @param Q_operating - Operating flow rate (m³/s)
 * @param Q_nominal - Pump nominal flow rate (m³/s)
 * @returns Verification result
 */
function verifyFlowEfficiency(Q_operating, Q_nominal) {
    const ratio = Q_operating / Q_nominal;
    const RATIO_MIN = 0.7;
    const RATIO_MAX = 1.2;
    if (ratio < RATIO_MIN) {
        return {
            ok: false,
            ratio,
            message: `Bomba operando bajo punto nominal: ${(ratio * 100).toFixed(1)}% < ${RATIO_MIN * 100}%. Eficiencia reducida.`
        };
    }
    if (ratio > RATIO_MAX) {
        return {
            ok: false,
            ratio,
            message: `Bomba operando sobre punto nominal: ${(ratio * 100).toFixed(1)}% > ${RATIO_MAX * 100}%. Riesgo de sobrecarga.`
        };
    }
    return {
        ok: true,
        ratio,
        message: `Bomba operando en rango eficiente: ${(ratio * 100).toFixed(1)}% del nominal`
    };
}
// ============================================================================
// VOLUME OPTIMIZATION
// ============================================================================
/**
 * Calculate optimal wet well levels based on target cycle time
 *
 * Formula: V_util = t_cycle * (Q_pump - Q_in)
 *
 * @param targetTime - Target cycle time (minutes)
 * @param Q_pump - Pump flow rate (l/s)
 * @param Q_in - Inflow rate (l/s)
 * @param area - Wet well surface area (m²)
 * @param currentNoff - Current OFF level (m)
 * @param currentNmin - Current MIN level (m) (Validation only)
 * @param maxDepth - Maximum depth available (m) (Validation only)
 * @returns { optimalVolume: number, calculatedNon: number, message: string }
 */
function calculateOptimalWetWellLevels(targetTime, Q_pump_lps, Q_in_lps, area, currentNoff) {
    // Safety checks
    if (Q_pump_lps <= Q_in_lps) {
        return {
            optimalVolume: 0,
            calculatedNon: currentNoff,
            message: 'Imposible optimizar: Caudal de bomba menor o igual al afluente.',
            success: false
        };
    }
    if (area <= 0) {
        return {
            optimalVolume: 0,
            calculatedNon: currentNoff,
            message: 'Error: Área de cámara no válida.',
            success: false
        };
    }
    // Convert flows to m³/s
    const Q_pump = Q_pump_lps / 1000;
    const Q_in = Q_in_lps / 1000;
    // Target cycle time in seconds
    const t_cycle_sec = targetTime * 60;
    // Formula: V_util = (t_cycle * Q_in * (Q_pump - Q_in)) / Q_pump
    // Simplified approximation often used: V = T * Q_pump / 4 (for worst case Q_in = Q_pump/2)
    // But let's use the explicit formulation derived from:
    // T = V/Qin + V/(Qout-Qin) -> T = V * Qout / (Qin * (Qout-Qin))
    // V = T * Qin * (Qout - Qin) / Qout
    // Note: User formula in prompt was simplified: t_pump = V / (Qp - Qin). 
    // If user wants t_pump = 10 min, then V = 10 * (Qp - Qin).
    // Let's stick to the prompt's explicit request: "t desired = pump time".
    // "t deseado = 10 min (600 s) -> Tiempo de bombeo".
    // User Formula: V_util = t_pump * (Q_pump - Q_in)
    const V_required = (targetTime * 60) * (Q_pump - Q_in);
    // Calculate height difference required
    const deltaH = V_required / area;
    const calculatedNon = currentNoff + deltaH;
    return {
        optimalVolume: parseFloat(V_required.toFixed(3)),
        calculatedNon: parseFloat(calculatedNon.toFixed(3)),
        message: `Optimización exitosa: Altura útil calculada ${deltaH.toFixed(2)}m para ${targetTime} min de bombeo.`,
        success: true
    };
}
/**
 * NEW: Optimize Wet Well Volume based on NCh 2472 Retention Time (30 min)
 */
function optimizeWetWellForRetention(wetWell, area, Qb_m3s) {
    // 1. Operational Constraints
    const Q_medio_lps = wetWell.inflowRate || 0;
    const Q_medio_m3s = Q_medio_lps / 1000;
    const Qb_eff_m3s = Qb_m3s; // Use the passed value
    // Use default values if not provided
    const minRun = wetWell.minPumpingTime || 0;
    const maxStarts = wetWell.maxStartsPerHour || 6;
    const Tc_min_from_starts = maxStarts > 0 ? 60 / maxStarts : 10;
    const Tc_min = Math.max(minRun, Tc_min_from_starts);
    if (Q_medio_lps <= 0) {
        return { success: false, message: 'Caudal afluente (Q medio) no definido o inválido.' };
    }
    // 2. Volume Calculations (NCh 2472:2021)
    // V_min_normativo = Qmedio * 600s
    const V_min_normativo = Q_medio_m3s * 600;
    // V_max_permitido = Qmedio * 1800s
    const V_max_sanitario = Q_medio_m3s * 1800;
    // V_min_operative = (Qb * Tc_min) / 4 (standard formula for max cycle freq)
    // converted minutes to seconds: TC_min_sec = Tc_min * 60
    const V_min_operative = (Qb_eff_m3s * Tc_min * 60) / 4;
    // 3. Choice Logic: Force compliance with V_min and check V_max
    let V_optimo = Math.max(V_min_operative, V_min_normativo);
    let isForcedMin = V_optimo === V_min_normativo && V_min_normativo > V_min_operative;
    if (V_optimo > V_max_sanitario) {
        return {
            success: false,
            message: `Incompatible: Frecuencia de arranque exige volumen (${V_optimo.toFixed(2)}m³) mayor al máximo sanitario permitido (${V_max_sanitario.toFixed(2)}m³).`
        };
    }
    const H_util = V_optimo / area;
    if (H_util < 0.1) {
        return { success: false, message: `⚠ Altura útil $N_{off} - N_{min}$ resultante ${H_util.toFixed(2)}m es insuficiente (< 0.1m).` };
    }
    // 4. Update Levels
    const Nmin = wetWell.CR + 0.5;
    const Noff = Nmin + H_util;
    const N1on = Noff + 0.5;
    if (N1on > wetWell.CT) {
        return { success: false, message: `⚠ Rebase: El nivel calculado (${N1on.toFixed(2)}m) supera la cota de terreno (${wetWell.CT.toFixed(2)}m).` };
    }
    let message = isForcedMin
        ? `Volumen ajustado al mínimo normativo (10 min Q medio): $V_{util}$ = ${V_optimo.toFixed(2)}m³.`
        : `Optimización Integral: $V_{util}$ ajustado a ${V_optimo.toFixed(2)}m³ (${H_util.toFixed(2)}m). Cumple TR ≤ 30 min y Tc ≥ ${Tc_min.toFixed(0)} min.`;
    return {
        success: true,
        message,
        calculatedN1on: parseFloat(N1on.toFixed(3)),
        calculatedNmin: parseFloat(Nmin.toFixed(3)),
        calculatedNoff: parseFloat(Noff.toFixed(3))
    };
}
/**
 * NEW: Optimize Pipe Diameter (Smallest commercial size that complies)
 */
function optimizePipeDiameter(pipe, pump, wetWell, junctions) {
    const commercialDiameters = [50, 63, 75, 90, 110, 125, 140, 160, 180, 200];
    const Q_design_lps = wetWell.inflowRate || 0;
    const Q_design_m3s = Q_design_lps / 1000;
    if (Q_design_lps <= 0) {
        return { success: false, message: 'Caudal de diseño (Qin) no definido en la cámara.' };
    }
    // elevations
    const z_start = wetWell.Nmin;
    const destJunction = junctions.find(j => j.id === pipe.endNodeId);
    const z_end = destJunction?.elevation || 0;
    const H_static = z_end - z_start;
    const pumpCurve = (0, pumpModule_1.createPumpCurve)(pump);
    const C = (0, lossModule_1.getHazenC)(pipe.material || 'PVC');
    let bestD = -1;
    let bestVelocity = 0;
    let bestMargin = 0;
    for (const d_mm of commercialDiameters) {
        const D_m = d_mm / 1000;
        const v = (0, lossModule_1.calculateVelocity)(Q_design_m3s, D_m);
        if (!isVelocityWithinNormativeRange(v))
            continue;
        const hf = (0, lossModule_1.hazenWilliamsLoss)(Q_design_m3s, C, D_m, pipe.length);
        const hs = (0, lossModule_1.singularLosses)(Q_design_m3s, D_m, pipe.kFactors || []);
        const H_req = H_static + hf + hs;
        const H_pump = pumpCurve(Q_design_m3s);
        if (H_pump <= H_req)
            continue;
        const margin = ((H_pump - H_req) / H_req) * 100;
        if (margin < 15)
            continue;
        const P_max = H_req / 10.2;
        const PN = pipe.PN || 10;
        if (P_max > PN)
            continue;
        // Selection criteria: First one that complies
        bestD = d_mm;
        bestVelocity = v;
        bestMargin = margin;
        break;
    }
    if (bestD > 0) {
        return {
            success: true,
            message: `✔ Diámetro optimizado: ${bestD} mm\nVelocidad: ${bestVelocity.toFixed(2)} m/s\nMargen: ${bestMargin.toFixed(1)}%\nCumple criterios hidráulicos y sanitarios`,
            optimizedDiameter: bestD,
            velocity: bestVelocity,
            margin: bestMargin
        };
    }
    return { success: false, message: 'No existe diámetro comercial que cumpla criterios con la bomba actual.' };
}
/**
 * Calculate pump cycle time based on wet well volume and flow
 *
 * Sanitary Model:
 * fillTime = usefulVolume / inflow
 * emptyTime = usefulVolume / (Q_pump - inflow)
 * cycleTime = 60 * (fillTime + emptyTime) // converted to minutes
 *
 * @param usefulVolume - Volume between Noff and N1on (m³)
 * @param Q_pump - Pump flow rate (m³/s)
 * @param Q_inflow - Average inflow rate (m³/s)
 * @returns Cycle time results (minutes)
 */
function calculateSanitaryCycle(usefulVolume, Q_pump, Q_inflow) {
    if (Q_pump <= Q_inflow) {
        return {
            fillTime: Infinity,
            emptyTime: Infinity,
            cycleTime: Infinity,
            cyclesPerHour: 0,
            status: 'IMPOSSIBLE'
        };
    }
    const fillTime = Q_inflow > 0 ? usefulVolume / Q_inflow : Infinity; // seconds
    const emptyTime = usefulVolume / (Q_pump - Q_inflow); // seconds
    // Cycle Time = t_fill + t_empty
    // If fillTime is infinite (0 inflow), cycle is infinite.
    const cycleTimeSec = (fillTime === Infinity) ? Infinity : (fillTime + emptyTime);
    // Cycles per hour = 3600 / cycleTimeSec
    const cyclesPerHour = (cycleTimeSec > 0 && cycleTimeSec !== Infinity) ? 3600 / cycleTimeSec : 0;
    return {
        fillTime: (fillTime === Infinity) ? Infinity : fillTime / 60, // minutes
        emptyTime: emptyTime / 60, // minutes
        cycleTime: (cycleTimeSec === Infinity) ? Infinity : cycleTimeSec / 60, // minutes
        cyclesPerHour,
        status: (fillTime === Infinity || cycleTimeSec === Infinity) ? 'INFINITE' : 'OK'
    };
}
function calculateCycleTime(wetWellVolume, Q_operating) {
    if (Q_operating <= 0)
        return 0;
    // Cycle time = fill time + pump time
    // Simplified legacy fallback
    const cycleTimeSec = wetWellVolume / Q_operating;
    const cycleTimeMin = cycleTimeSec / 60;
    return cycleTimeMin;
}
/**
 * Verify pump cycle time and starts per hour
 *
 * Recommended:
 * - 5 ≤ cycle time ≤ 30 minutes
 * - starts per hour ≤ 10
 *
 * @param cycleTime - Pump cycle time (minutes)
 * @returns Verification result
 */
function verifyOperationalCycle(cycleTime) {
    const messages = [];
    const CYCLE_MIN = 5; // minutes
    const CYCLE_MAX = 30; // minutes
    const MAX_STARTS = 10; // starts per hour
    const cycleOk = cycleTime >= CYCLE_MIN && cycleTime <= CYCLE_MAX;
    const startsPerHour = cycleTime > 0 ? 60 / cycleTime : 0;
    const startsOk = startsPerHour <= MAX_STARTS;
    if (!cycleOk) {
        if (cycleTime < CYCLE_MIN) {
            messages.push(`Tiempo de ciclo muy corto: ${cycleTime.toFixed(1)} min < ${CYCLE_MIN} min. Muchas partidas, desgaste prematuro.`);
        }
        else {
            messages.push(`Tiempo de ciclo muy largo: ${cycleTime.toFixed(1)} min > ${CYCLE_MAX} min. Ajustar volumen de cámara.`);
        }
    }
    if (!startsOk) {
        messages.push(`Partidas por hora excesivas: ${startsPerHour.toFixed(1)} > ${MAX_STARTS}. Reducir frecuencia.`);
    }
    if (cycleOk && startsOk) {
        messages.push(`Ciclo operacional adecuado: ${cycleTime.toFixed(1)} min (${startsPerHour.toFixed(1)} partidas/h)`);
    }
    return {
        cycleOk,
        startsOk,
        startsPerHour,
        messages
    };
}
// ============================================================================
// PRESSURE LOSS VALIDATION
// ============================================================================
/**
 * Verify total head losses are reasonable
 *
 * Warning if losses exceed 30% of HMT total
 *
 * @param h_total - Total losses (friction + singular) (m)
 * @param H_static - Static head (m)
 * @returns Validation result
 */
function verifyHeadLosses(h_total, H_static) {
    const HMT_total = H_static + h_total;
    if (!Number.isFinite(HMT_total) || HMT_total <= 0) {
        return {
            ok: true,
            message: 'Distribución de pérdidas no disponible (HMT total no válida).'
        };
    }
    const lossRatio = h_total / HMT_total;
    const staticRatio = H_static / HMT_total;
    if (lossRatio > 0.5) {
        return {
            ok: false,
            message: `Pérdidas altas: ${(lossRatio * 100).toFixed(1)}% de la HMT total. Distribución HMT: Estática ${(staticRatio * 100).toFixed(1)}%, Pérdidas ${(lossRatio * 100).toFixed(1)}%. Considerar mayor diámetro o menor rugosidad.`
        };
    }
    if (lossRatio > 0.3) {
        return {
            ok: true,
            message: `Pérdidas aceptables pero altas: ${(lossRatio * 100).toFixed(1)}% de la HMT total. Distribución HMT: Estática ${(staticRatio * 100).toFixed(1)}%, Pérdidas ${(lossRatio * 100).toFixed(1)}%.`
        };
    }
    return {
        ok: true,
        message: `Pérdidas razonables: ${(lossRatio * 100).toFixed(1)}% de la HMT total. Distribución HMT: Estática ${(staticRatio * 100).toFixed(1)}%, Pérdidas ${(lossRatio * 100).toFixed(1)}%.`
    };
}
// ============================================================================
// CONTINUOUS HYDRAULIC SAMPLING
// ============================================================================
/**
 * Interpolate pipe elevation at a given chainage
 */
function interpolatePipeElevation(chainage, length, z_start, z_end, profilePoints, options) {
    return (0, profileGeometry_1.interpolatePipeElevationFromTerrain)(chainage, {
        length,
        zStartApprox: z_start,
        zEndApprox: z_end,
        zStartTerrain: options?.z_start_terreno,
        zEndTerrain: options?.z_end_terreno,
        cover_m: options?.cover_m,
        diameter_mm: options?.diameter_mm,
        outsideDiameter_m: options?.outsideDiameter_m,
        profilePoints,
        reference: options?.reference || 'axis'
    });
}
function calculateSanitaryDiagnostic(velocity, diameter, // m
length, // m
flow, // m3/s
agingC) {
    const volume = (Math.PI * Math.pow(diameter, 2) / 4) * length;
    const retentionTime = flow > 0 ? (volume / flow) / 60 : 0; // minutes
    return {
        velocityCompliant: isVelocityWithinNormativeRange(velocity),
        sedimentationRisk: velocity < (exports.VELOCITY_MIN_MS - exports.VELOCITY_TOLERANCE_MS),
        retentionTimeMinutes: retentionTime,
        septicRisk: retentionTime > 30,
        agingCheckPassed: true // Default if not provided
    };
}
/**
 * Helper to detect if a chainage is a local maximum (cumbre)
 */
function isLocalMaximum(chainage, pipe) {
    const eps = 0.5; // 0.5m interval for detection
    const profileOptions = {
        z_start_terreno: pipe.z_start_terreno,
        z_end_terreno: pipe.z_end_terreno,
        cover_m: pipe.cover_m,
        diameter_mm: pipe.diameter,
        reference: 'axis'
    };
    const zLeft = interpolatePipeElevation(Math.max(0, chainage - eps), pipe.length, pipe.z_start, pipe.z_end, pipe.profilePoints, profileOptions);
    const zCenter = interpolatePipeElevation(chainage, pipe.length, pipe.z_start, pipe.z_end, pipe.profilePoints, profileOptions);
    const zRight = interpolatePipeElevation(Math.min(pipe.length, chainage + eps), pipe.length, pipe.z_start, pipe.z_end, pipe.profilePoints, profileOptions);
    // A cumbre exists if the point is strictly higher than its neighbors
    return zCenter > zLeft && zCenter > zRight;
}
/**
 * Generate continuous hydraulic samples along a pipe
 */
function generateHydraulicSamples(pipe, h_friction, h_singular, H_initial) {
    const samples = [];
    const N = Math.max(50, Math.ceil(pipe.length));
    const step = pipe.length / N;
    const valves = (pipe.inlineNodes || [])
        .filter(v => Number.isFinite(v.chainage))
        .sort((a, b) => a.chainage - b.chainage);
    const round3 = (value) => Math.round(value * 1000) / 1000;
    const clampChainage = (value) => Math.max(0, Math.min(pipe.length, value));
    const H_start = H_initial - h_singular;
    const profileOptions = {
        z_start_terreno: pipe.z_start_terreno,
        z_end_terreno: pipe.z_end_terreno,
        cover_m: (0, profileGeometry_1.resolvePipeCoverMeters)(pipe.cover_m),
        diameter_mm: pipe.diameter,
        reference: 'axis'
    };
    for (let i = 0; i <= N; i++) {
        const x = Math.min(i * step, pipe.length);
        const H_loss = pipe.length > 0 ? (x / pipe.length) * h_friction : 0;
        const hgl = H_start - H_loss;
        const elevation = interpolatePipeElevation(x, pipe.length, pipe.z_start, pipe.z_end, pipe.profilePoints, profileOptions);
        samples.push({
            x,
            hgl,
            elevation,
            pressure: calculatePressure(hgl, elevation)
        });
    }
    // Ensure exact sample points where inline air valves exist
    const valveChainages = Array.from(new Set(valves.map(v => round3(clampChainage(v.chainage)))));
    valveChainages.forEach(chainage => {
        const hasPoint = samples.some(sample => Math.abs(sample.x - chainage) < 1e-6);
        if (hasPoint)
            return;
        const H_loss = pipe.length > 0 ? (chainage / pipe.length) * h_friction : 0;
        const hgl = H_start - H_loss;
        const elevation = interpolatePipeElevation(chainage, pipe.length, pipe.z_start, pipe.z_end, pipe.profilePoints, profileOptions);
        samples.push({
            x: chainage,
            hgl,
            elevation,
            pressure: calculatePressure(hgl, elevation)
        });
    });
    samples.sort((a, b) => a.x - b.x);
    // Recompute normal pressures before valve clamp
    samples.forEach(sample => {
        sample.pressure = calculatePressure(sample.hgl, sample.elevation);
    });
    const sampleByX = new Map();
    samples.forEach(sample => sampleByX.set(round3(sample.x), sample));
    const valvesByChainage = new Map();
    valves.forEach(valve => {
        const key = round3(clampChainage(valve.chainage));
        const list = valvesByChainage.get(key) || [];
        list.push(valve);
        valvesByChainage.set(key, list);
    });
    // Apply air-valve clamp at the very end of hydraulic solve (local effect)
    valvesByChainage.forEach((group, key) => {
        const sample = sampleByX.get(key);
        if (!sample)
            return;
        const rawPressure = calculatePressure(sample.hgl, sample.elevation);
        const isIntake = rawPressure < 0;
        if (isIntake) {
            sample.pressure = 0;
            sample.hgl = sample.elevation;
            group.forEach(valve => {
                valve.elevation = sample.elevation;
                valve.hydraulicState = 'air_intake';
            });
            return;
        }
        const localMax = isLocalMaximum(sample.x, pipe);
        group.forEach(valve => {
            valve.elevation = sample.elevation;
            valve.hydraulicState = localMax ? 'air_release' : 'pressurized';
        });
    });
    return samples;
}
/**
 * Complete NCh 2472 Verification logic
 */
/**
 * Centralized Wet Well Volume Calculation
 * Uses geometryType and corresponding dimensions (circular, square, rectangular)
 *
 * @param wetWell - The WetWell object
 * @param height - Delta height for volume calculation (m)
 * @returns Volume (m³)
 */
function calculateWetWellVolume(wetWell, height) {
    // Default to 'circular' if not set, or infer from legacy fields
    const type = wetWell.geometryType || (wetWell.width && wetWell.length ? 'rectangular' : 'circular');
    switch (type) {
        case 'rectangular':
            return (wetWell.width || 0) * (wetWell.length || 0) * height;
        case 'square':
            const side = wetWell.side || 0;
            return side * side * height;
        case 'circular':
        default:
            const D = wetWell.diameter || 0;
            return (Math.PI * Math.pow(D, 2) / 4) * height;
    }
}
function calculateNchVerification(wetWell, pump, hydraulicState) {
    const Q_medio_sanitario = hydraulicState.Q_medio_sanitario_Ls;
    const Q_neto = hydraulicState.Q_neto_Ls;
    const Q_med_m3s = Q_medio_sanitario > 0 ? (Q_medio_sanitario / 1000) : Number.NaN;
    const Q_neto_m3s = Q_neto > 0 ? (Q_neto / 1000) : Number.NaN;
    const V_total = calculateWetWellVolume(wetWell, wetWell.CT - wetWell.CR);
    const H_util_sanitary = Math.abs(wetWell.Noff - wetWell.Nmin);
    const V_util_sanitary = calculateWetWellVolume(wetWell, H_util_sanitary);
    const hasUsefulVolumeData = Number.isFinite(V_util_sanitary) && V_util_sanitary >= 0;
    const retentionTimeMin = (hasUsefulVolumeData && Number.isFinite(Q_med_m3s))
        ? (V_util_sanitary / Q_med_m3s) / 60
        : Number.NaN;
    const cycleTimeMin = (hasUsefulVolumeData && Number.isFinite(Q_neto_m3s))
        ? (V_util_sanitary / Q_neto_m3s) / 60
        : Number.NaN;
    // Criterio normativo adoptado por compatibilidad del software:
    // volumen minimo equivalente a 10 min con Q medio (enfoque conservador).
    // Nota: V=t*Q/4 se usa como referencia operativa en otros contextos.
    const V_min_normativo = Q_medio_sanitario > 0 ? (Q_medio_sanitario * 600) / 1000 : Number.NaN;
    const V_max_permitido = Q_medio_sanitario > 0 ? (Q_medio_sanitario * 1800) / 1000 : 0;
    const qVelocityLs = Number.isFinite(hydraulicState.hydraulicVelocityFlow_Ls ?? Number.NaN)
        ? hydraulicState.hydraulicVelocityFlow_Ls
        : hydraulicState.Q_hydraulic_used_Ls;
    const impulsionDiameter_m = hydraulicState.impulsionDiameter_m;
    const canEvaluateVelocity = Number.isFinite(qVelocityLs)
        && qVelocityLs > 0
        && Number.isFinite(impulsionDiameter_m ?? Number.NaN)
        && impulsionDiameter_m > 0;
    let velocityCurrent = Number.NaN;
    if (canEvaluateVelocity) {
        const area = Math.PI * Math.pow(impulsionDiameter_m, 2) / 4;
        velocityCurrent = (qVelocityLs / 1000) / area;
    }
    else if (Number.isFinite(hydraulicState.velocity_ms)) {
        velocityCurrent = hydraulicState.velocity_ms;
    }
    const configuredSubmergenceRequirement = Number(wetWell.submergenceRequirement
        ?? wetWell.minimumSubmergence
        ?? wetWell.minSubmergence
        ?? 0.5);
    const submergenceRequirement = Number.isFinite(configuredSubmergenceRequirement) && configuredSubmergenceRequirement > 0
        ? configuredSubmergenceRequirement
        : 0.5;
    const submergence = Number.isFinite(wetWell.Nmin) && Number.isFinite(wetWell.CR)
        ? wetWell.Nmin - wetWell.CR
        : Number.NaN;
    const reqMargin = Number.isFinite(wetWell.safetyMarginRequirement ?? Number.NaN)
        ? wetWell.safetyMarginRequirement
        : 15;
    const pumpCountCandidate = pump.pumpCount ?? wetWell.numPumps;
    const nPumps = Number.isFinite(pumpCountCandidate ?? Number.NaN)
        ? Number(pumpCountCandidate)
        : Number.NaN;
    const toSeverity = (status, type) => {
        if (status === 'FAIL')
            return type === 'normative' ? 'ERROR' : 'WARNING';
        if (status === 'NA' || status === 'WARN')
            return 'WARNING';
        return 'INFO';
    };
    const checks = [];
    const pushCheck = (check) => {
        checks.push({
            ...check,
            severity: toSeverity(check.status, check.type)
        });
    };
    const traceValue = (value) => (Number.isFinite(value) ? value : 'NA');
    const trTrace = {
        formula: 'TR = V_util / Q_medio',
        description: 'Tiempo de retencion calculado con volumen util y caudal medio.',
        inputs: {
            V_util_m3: traceValue(V_util_sanitary),
            Q_medio_Ls: traceValue(Q_medio_sanitario)
        },
        result: traceValue(retentionTimeMin)
    };
    const tcTrace = {
        formula: 'Tc = V_util / Q_bomba',
        description: 'Tiempo de ciclo equivalente usando volumen util y caudal de bombeo.',
        inputs: {
            V_util_m3: traceValue(V_util_sanitary),
            Q_bomba_Ls: traceValue(Q_neto)
        },
        result: traceValue(cycleTimeMin)
    };
    const usefulVolumeTrace = {
        formula: 'V_min = Q_medio * 600 / 1000',
        description: 'Volumen util minimo adoptado para 10 minutos de retencion.',
        inputs: {
            Q_medio_Ls: traceValue(Q_medio_sanitario)
        },
        result: traceValue(V_min_normativo)
    };
    const velocityTrace = {
        formula: 'V = Q / A',
        description: 'Velocidad en impulsion con caudal operativo y diametro interno.',
        inputs: {
            Q_operacion_Ls: traceValue(qVelocityLs),
            D_impulsion_m: traceValue(impulsionDiameter_m ?? Number.NaN)
        },
        result: traceValue(velocityCurrent)
    };
    const redundancyTrace = {
        formula: 'n >= 2',
        description: 'Verificacion de redundancia minima de bombas instaladas.',
        inputs: {
            nPumps: traceValue(nPumps)
        },
        result: traceValue(nPumps)
    };
    const submergenceTrace = {
        formula: 'Submergencia >= diámetro impulsor',
        description: 'Chequeo de sumergencia minima contra requerimiento de diseno.',
        inputs: {
            submergence_m: traceValue(submergence),
            required_m: traceValue(submergenceRequirement)
        },
        result: traceValue(submergence)
    };
    const marginTrace = {
        formula: 'Margin >= requerido',
        description: 'Chequeo de margen hidraulico disponible versus minimo requerido.',
        inputs: {
            margin_pct: traceValue(hydraulicState.margin),
            required_pct: traceValue(reqMargin)
        },
        result: traceValue(hydraulicState.margin)
    };
    // 1) TR <= 30 min (NCh 2472 5.1)
    if (!hasUsefulVolumeData || !Number.isFinite(Q_med_m3s)) {
        pushCheck({
            id: 'NCH2472_TR_MAX_30',
            label: 'Tiempo de retención (TR)',
            message: 'No evaluable: falta volumen útil y/o caudal medio.',
            measuredValue: Number.isFinite(retentionTimeMin) ? retentionTimeMin : undefined,
            limitValue: 30,
            unit: 'min',
            status: 'NA',
            clause: '5.1',
            type: 'normative',
            trace: trTrace
        });
    }
    else {
        const trPass = (retentionTimeMin + exports.EPS_TIME_MIN) <= 30;
        pushCheck({
            id: 'NCH2472_TR_MAX_30',
            label: 'Tiempo de retención (TR)',
            message: trPass
                ? `Cumple: TR=${retentionTimeMin.toFixed(1)} min <= 30 min.`
                : `No cumple: TR=${retentionTimeMin.toFixed(1)} min > 30 min.`,
            measuredValue: retentionTimeMin,
            limitValue: 30,
            unit: 'min',
            status: trPass ? 'PASS' : 'FAIL',
            clause: '5.1',
            type: 'normative',
            trace: trTrace
        });
    }
    // 2) Tc >= 10 min de operación continua (NCh 2472 5.1)
    if (!hasUsefulVolumeData || !Number.isFinite(Q_neto)) {
        pushCheck({
            id: 'NCH2472_TC_MIN_10',
            label: 'Tiempo mínimo de ciclo (Tc)',
            message: 'No evaluable: falta volumen útil y/o caudal neto de bombeo.',
            measuredValue: Number.isFinite(cycleTimeMin) ? cycleTimeMin : undefined,
            limitValue: 10,
            unit: 'min',
            status: 'NA',
            clause: '5.1',
            type: 'normative',
            trace: tcTrace
        });
    }
    else if (Q_neto <= 0) {
        pushCheck({
            id: 'NCH2472_TC_MIN_10',
            label: 'Tiempo mínimo de ciclo (Tc)',
            message: 'No cumple: Q neto <= 0, la bomba no supera el caudal afluente.',
            measuredValue: Number.isFinite(cycleTimeMin) ? cycleTimeMin : undefined,
            limitValue: 10,
            unit: 'min',
            status: 'FAIL',
            clause: '5.1',
            type: 'normative',
            trace: tcTrace
        });
    }
    else {
        const tcPass = (cycleTimeMin + exports.EPS_TIME_MIN) >= 10;
        pushCheck({
            id: 'NCH2472_TC_MIN_10',
            label: 'Tiempo mínimo de ciclo (Tc)',
            message: tcPass
                ? `Cumple: Tc=${cycleTimeMin.toFixed(1)} min >= 10 min.`
                : `No cumple: Tc=${cycleTimeMin.toFixed(1)} min < 10 min.`,
            measuredValue: cycleTimeMin,
            limitValue: 10,
            unit: 'min',
            status: tcPass ? 'PASS' : 'FAIL',
            clause: '5.1',
            type: 'normative',
            trace: tcTrace
        });
    }
    // 3) V util >= V minimo normativo adoptado (10 min con Q medio) (NCh 2472 5.1)
    if (!hasUsefulVolumeData || !Number.isFinite(V_min_normativo)) {
        pushCheck({
            id: 'NCH2472_USEFUL_VOLUME_MIN',
            label: 'Volumen útil normativo',
            message: 'No evaluable: falta volumen útil y/o Q medio para criterio de 10 min (conservador).',
            measuredValue: Number.isFinite(V_util_sanitary) ? V_util_sanitary : undefined,
            limitValue: Number.isFinite(V_min_normativo) ? V_min_normativo : undefined,
            unit: 'm3',
            status: 'NA',
            clause: '5.1',
            type: 'normative',
            trace: usefulVolumeTrace
        });
    }
    else {
        const volumePass = (V_util_sanitary + exports.EPS_VOLUME_M3) >= V_min_normativo;
        pushCheck({
            id: 'NCH2472_USEFUL_VOLUME_MIN',
            label: 'Volumen útil normativo',
            message: volumePass
                ? `Cumple criterio adoptado (10 min, conservador): V útil=${V_util_sanitary.toFixed(2)} m3 >= ${V_min_normativo.toFixed(2)} m3.`
                : `No cumple criterio adoptado (10 min, conservador): V útil=${V_util_sanitary.toFixed(2)} m3 < ${V_min_normativo.toFixed(2)} m3.`,
            measuredValue: V_util_sanitary,
            limitValue: V_min_normativo,
            unit: 'm3',
            status: volumePass ? 'PASS' : 'FAIL',
            clause: '5.1',
            type: 'normative',
            trace: usefulVolumeTrace
        });
    }
    // 4) Velocidad en impulsión 0.6 - 3.0 m/s (NCh 2472 8)
    if (!canEvaluateVelocity) {
        pushCheck({
            id: 'NCH2472_IMPULSION_VELOCITY_RANGE',
            label: 'Velocidad en impulsión',
            message: 'No evaluable: faltan Q de operación y/o diámetro interior para V=Q/A.',
            measuredValue: Number.isFinite(velocityCurrent) ? velocityCurrent : undefined,
            limitValue: '0.60-3.00',
            unit: 'm/s',
            status: 'NA',
            clause: '8',
            type: 'normative',
            trace: velocityTrace
        });
    }
    else {
        const velocityPass = isVelocityWithinNormativeRange(velocityCurrent);
        pushCheck({
            id: 'NCH2472_IMPULSION_VELOCITY_RANGE',
            label: 'Velocidad en impulsión',
            message: velocityPass
                ? `Cumple: V=${velocityCurrent.toFixed(2)} m/s en rango 0.60-3.00 m/s.`
                : `No cumple: V=${velocityCurrent.toFixed(2)} m/s fuera del rango 0.60-3.00 m/s.`,
            measuredValue: velocityCurrent,
            limitValue: '0.60-3.00',
            unit: 'm/s',
            status: velocityPass ? 'PASS' : 'FAIL',
            clause: '8',
            type: 'normative',
            trace: velocityTrace
        });
    }
    // 5) Redundancia mínima: pumpCount >= 2 (NCh 2472 5.5)
    if (!Number.isFinite(nPumps)) {
        pushCheck({
            id: 'NCH2472_MIN_PUMP_COUNT_2',
            label: 'Redundancia mínima de bombas',
            message: 'No evaluable: no se informó cantidad de bombas.',
            measuredValue: undefined,
            limitValue: 2,
            unit: 'bombas',
            status: 'NA',
            clause: '5.5',
            type: 'normative',
            trace: redundancyTrace
        });
    }
    else {
        const redundancyPass = (nPumps + exports.EPS_COUNT) >= 2;
        pushCheck({
            id: 'NCH2472_MIN_PUMP_COUNT_2',
            label: 'Redundancia mínima de bombas',
            message: redundancyPass
                ? `Cumple: ${Math.round(nPumps)} bombas instaladas (>= 2).`
                : `No cumple: ${Math.round(nPumps)} bomba instalada (< 2).`,
            measuredValue: nPumps,
            limitValue: 2,
            unit: 'bombas',
            status: redundancyPass ? 'PASS' : 'FAIL',
            clause: '5.5',
            type: 'normative',
            trace: redundancyTrace
        });
    }
    // 6) Sumergencia mínima (criterio de diseño interno)
    if (!Number.isFinite(submergence)) {
        pushCheck({
            id: 'NCH2472_SUBMERGENCE_MIN',
            label: 'Sumergencia mínima (criterio de diseño)',
            message: 'Criterio de diseño: no hay datos suficientes para evaluar sumergencia.',
            measuredValue: undefined,
            limitValue: submergenceRequirement,
            unit: 'm',
            status: 'WARN',
            type: 'design_criterion',
            trace: submergenceTrace
        });
    }
    else {
        const submergencePass = (submergence + exports.EPS_SUBMERGENCE_M) >= submergenceRequirement;
        pushCheck({
            id: 'NCH2472_SUBMERGENCE_MIN',
            label: 'Sumergencia mínima (criterio de diseño)',
            message: submergencePass
                ? `Criterio de diseño cumplido: ${submergence.toFixed(2)} m >= ${submergenceRequirement.toFixed(2)} m.`
                : `Criterio de diseño no cumplido: ${submergence.toFixed(2)} m < ${submergenceRequirement.toFixed(2)} m.`,
            measuredValue: submergence,
            limitValue: submergenceRequirement,
            unit: 'm',
            status: submergencePass ? 'PASS' : 'FAIL',
            type: 'design_criterion',
            trace: submergenceTrace
        });
    }
    // 7) Margen de seguridad (criterio interno)
    if (!Number.isFinite(hydraulicState.margin) || !Number.isFinite(reqMargin)) {
        pushCheck({
            id: 'NCH2472_INTERNAL_MARGIN',
            label: 'Margen de seguridad (criterio interno)',
            message: 'Criterio interno: no hay datos suficientes para evaluar margen.',
            measuredValue: Number.isFinite(hydraulicState.margin) ? hydraulicState.margin : undefined,
            limitValue: reqMargin,
            unit: '%',
            status: 'WARN',
            type: 'design_criterion',
            trace: marginTrace
        });
    }
    else {
        const marginPass = (hydraulicState.margin + exports.EPS_MARGIN_PCT) >= reqMargin;
        pushCheck({
            id: 'NCH2472_INTERNAL_MARGIN',
            label: 'Margen de seguridad (criterio interno)',
            message: marginPass
                ? `Criterio interno cumplido: ${hydraulicState.margin.toFixed(1)}% >= ${reqMargin.toFixed(1)}%.`
                : `Criterio interno no cumplido: ${hydraulicState.margin.toFixed(1)}% < ${reqMargin.toFixed(1)}%.`,
            measuredValue: hydraulicState.margin,
            limitValue: reqMargin,
            unit: '%',
            status: marginPass ? 'PASS' : 'FAIL',
            type: 'design_criterion',
            trace: marginTrace
        });
    }
    const checkById = (id) => checks.find(check => check.id === id);
    const trCheck = checkById('NCH2472_TR_MAX_30');
    const tcCheck = checkById('NCH2472_TC_MIN_10');
    const volumeCheck = checkById('NCH2472_USEFUL_VOLUME_MIN');
    const velocityCheck = checkById('NCH2472_IMPULSION_VELOCITY_RANGE');
    const redundancyCheck = checkById('NCH2472_MIN_PUMP_COUNT_2');
    const submergenceCheck = checkById('NCH2472_SUBMERGENCE_MIN');
    const marginCheck = checkById('NCH2472_INTERNAL_MARGIN');
    const normativeChecks = [trCheck, tcCheck, volumeCheck, velocityCheck, redundancyCheck];
    const designChecks = [submergenceCheck, marginCheck];
    // Fail-closed: NA en checks normativos se considera no conforme.
    const normativeFailed = normativeChecks.some(check => check.status === 'FAIL' || check.status === 'NA');
    const normativeWarn = normativeChecks.some(check => check.status === 'WARN');
    const designFailed = designChecks.some(check => check.status === 'FAIL');
    let overallStatus = 'COMPLIANT';
    if (normativeFailed || !!hydraulicState.blockageError) {
        overallStatus = 'NON_COMPLIANT';
    }
    else if (designFailed || normativeWarn) {
        overallStatus = 'PARTIAL';
    }
    const retentionStatus = trCheck.status === 'PASS'
        ? 'OK'
        : (trCheck.status === 'FAIL' ? 'ERROR' : 'WARNING');
    const cycleStatus = tcCheck.status === 'PASS'
        ? 'OK'
        : (tcCheck.status === 'FAIL' ? 'ERROR' : 'WARNING');
    const redundancyCurrentLabel = Number.isFinite(nPumps)
        ? `${Math.round(nPumps)} bombas`
        : 'Sin dato';
    return {
        retentionTime: { value: retentionTimeMin, status: retentionStatus, message: trCheck.message },
        cycleTime: { value: cycleTimeMin, status: cycleStatus, message: tcCheck.message },
        redundancy: {
            current: redundancyCurrentLabel,
            compliant: redundancyCheck.status === 'PASS',
            message: redundancyCheck.message
        },
        usefulVolume: {
            current: V_util_sanitary,
            minimalRequired: Number.isFinite(V_min_normativo) ? V_min_normativo : 0,
            maxAllowed: V_max_permitido,
            compliant: volumeCheck.status === 'PASS',
            message: volumeCheck.message
        },
        submergence: {
            current: Number.isFinite(submergence) ? submergence : 0,
            minimalRequired: submergenceRequirement,
            compliant: submergenceCheck.status !== 'FAIL',
            message: submergenceCheck.message
        },
        velocity: {
            current: Number.isFinite(velocityCurrent) ? velocityCurrent : 0,
            compliant: velocityCheck.status === 'PASS',
            message: velocityCheck.message
        },
        pumpMargin: {
            current: Number.isFinite(hydraulicState.margin) ? hydraulicState.margin : 0,
            required: reqMargin,
            compliant: marginCheck.status !== 'FAIL',
            message: marginCheck.message
        },
        totalGeometricVolume: V_total,
        qUsed: Q_medio_sanitario,
        overallStatus,
        complianceChecklist: {
            retention: trCheck.status === 'PASS',
            cycle: tcCheck.status === 'PASS',
            redundancy: redundancyCheck.status === 'PASS',
            volume: volumeCheck.status === 'PASS',
            velocity: velocityCheck.status === 'PASS',
            margin: marginCheck.status !== 'FAIL',
            submergence: submergenceCheck.status !== 'FAIL'
        },
        checks
    };
}
function statisticalFormat(val) {
    return val.toFixed(2);
}
