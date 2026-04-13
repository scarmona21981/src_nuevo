"use strict";
/**
 * Surge Module - Water Hammer Analysis (Golpe de Ariete)
 *
 * Implements:
 * - Activation criteria for surge analysis
 * - Pressure wave speed calculation
 * - Surge pressure calculation (Joukowsky formula)
 * - Combined pressure verification (static + surge)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldAnalyzeSurge = shouldAnalyzeSurge;
exports.calculateWaveSpeed = calculateWaveSpeed;
exports.calculateSurgePressure = calculateSurgePressure;
exports.surgePressureInBar = surgePressureInBar;
exports.analyzeSurge = analyzeSurge;
exports.getSurgeProtectionRecommendations = getSurgeProtectionRecommendations;
exports.validateWaveSpeed = validateWaveSpeed;
const G = 9.81; // m/s² - Gravitational acceleration
// ============================================================================
// SURGE ACTIVATION CRITERIA
// ============================================================================
/**
 * Determine if surge analysis should be performed
 *
 * Criteria:
 * - Pipe length > 50m AND
 * - Flow velocity > 1.2 m/s
 *
 * @param L - Pipe length (m)
 * @param V - Flow velocity (m/s)
 * @returns True if surge analysis required
 */
function shouldAnalyzeSurge(L, V) {
    const L_MIN = 50; // m
    const V_MIN = 1.2; // m/s
    return L > L_MIN && V > V_MIN;
}
// ============================================================================
// WAVE SPEED CALCULATION
// ============================================================================
/**
 * Calculate pressure wave speed in pipe
 *
 * Formula: a = sqrt(K_water / (ρ_water · (1 + (K_water/K_pipe) · (D/e))))
 *
 * Simplified approximations by material:
 * - PVC: ~400 m/s
 * - HDPE: ~350 m/s
 * - Steel: ~1000 m/s
 * - Concrete: ~1200 m/s
 *
 * @param material - Pipe material
 * @param D - Pipe diameter (mm)
 * @param thickness - Wall thickness (mm), optional
 * @returns Wave speed (m/s)
 */
function calculateWaveSpeed(material, D, thickness) {
    // Simplified material-based approximations
    // These are conservative estimates suitable for preliminary design
    const waveSpeedByMaterial = {
        'PVC': 400,
        'HDPE': 350,
        'Fierro Fundido': 1000,
        'Hormigón': 1200,
        'HCV': 900,
        'Otro': 400
    };
    // For detailed calculation with wall thickness:
    if (thickness && D > 0) {
        const K_water = 2.1e9; // Pa - Bulk modulus of water
        const rho_water = 1000; // kg/m³
        // Pipe material elastic modulus (Pa)
        const E_pipe = {
            'PVC': 3.0e9,
            'HDPE': 1.0e9,
            'Fierro Fundido': 170e9,
            'Hormigón': 30e9,
            'HCV': 170e9,
            'Otro': 3.0e9
        };
        const E = E_pipe[material] || 3.0e9;
        const D_m = D / 1000; // Convert mm to m
        const e_m = thickness / 1000; // Convert mm to m
        // Korteweg formula
        const a = Math.sqrt(K_water / (rho_water * (1 + (K_water * D_m) / (E * e_m))));
        return a;
    }
    // Default to material-based approximation
    return waveSpeedByMaterial[material] || 400;
}
// ============================================================================
// SURGE PRESSURE CALCULATION
// ============================================================================
/**
 * Calculate surge pressure using Joukowsky formula
 *
 * Formula: ΔH = a · ΔV / g
 *
 * where:
 * - a = pressure wave speed (m/s)
 * - ΔV = velocity change (m/s)
 * - g = gravitational acceleration (m/s²)
 *
 * For instant valve closure: ΔV = V (full velocity stop)
 *
 * @param a - Wave speed (m/s)
 * @param deltaV - Velocity change (m/s)
 * @returns Surge head (m)
 */
function calculateSurgePressure(a, deltaV) {
    const deltaH = (a * deltaV) / G;
    return deltaH;
}
/**
 * Convert surge head to pressure (bar)
 *
 * @param deltaH - Surge head (m)
 * @returns Surge pressure (bar)
 */
function surgePressureInBar(deltaH) {
    // 1 bar = 10.1972 m of water column
    return deltaH / 10.1972;
}
// ============================================================================
// SURGE ANALYSIS
// ============================================================================
/**
 * Perform complete surge analysis
 *
 * @param L - Pipe length (m)
 * @param V - Flow velocity (m/s)
 * @param material - Pipe material
 * @param D - Pipe diameter (mm)
 * @param P_max_static - Maximum static pressure (bar)
 * @param PN - Pipe pressure rating (bar)
 * @param thickness - Wall thickness (mm), optional
 * @returns Complete surge analysis result
 */
function analyzeSurge(L, V, material, D, P_max_static, PN, thickness) {
    // Check if analysis should be performed
    const activated = shouldAnalyzeSurge(L, V);
    if (!activated) {
        return {
            activated: false,
            L,
            V,
            waveSpeed: 0,
            deltaV: 0,
            deltaH: 0,
            P_max_static,
            P_max_total: P_max_static,
            compliant: true,
            violations: []
        };
    }
    // Calculate wave speed
    const waveSpeed = calculateWaveSpeed(material, D, thickness);
    // Assume instant closure: ΔV = V
    const deltaV = V;
    // Calculate surge head
    const deltaH = calculateSurgePressure(waveSpeed, deltaV);
    const deltaP = surgePressureInBar(deltaH);
    // Total pressure = static + surge
    const P_max_total = P_max_static + deltaP;
    // Verify against PN rating
    const violations = [];
    const compliant = P_max_total <= PN;
    if (!compliant) {
        violations.push(`Presión total (estática + golpe) excede PN: ${P_max_total.toFixed(2)} bar > ${PN} bar`);
        violations.push(`Golpe de ariete: ΔP = ${deltaP.toFixed(2)} bar (ΔH = ${deltaH.toFixed(2)} m)`);
        violations.push(`Se requiere: protección anti-golpe (válvula alivio, chimenea equilibrio, o cierre lento)`);
    }
    // Additional warnings
    if (P_max_total > PN * 0.9 && P_max_total <= PN) {
        violations.push(`Advertencia: Presión total cercana a PN: ${P_max_total.toFixed(2)} bar ≈ ${PN} bar. Considerar protección.`);
    }
    return {
        activated: true,
        L,
        V,
        waveSpeed,
        deltaV,
        deltaH,
        P_max_static,
        P_max_total,
        compliant,
        violations
    };
}
// ============================================================================
// SURGE PROTECTION RECOMMENDATIONS
// ============================================================================
/**
 * Generate recommendations for surge protection
 *
 * @param surgeResult - Surge analysis result
 * @returns Array of recommendations
 */
function getSurgeProtectionRecommendations(surgeResult) {
    if (!surgeResult.activated) {
        return [];
    }
    const recommendations = [];
    if (!surgeResult.compliant) {
        recommendations.push('CRÍTICO: Implementar protección anti-golpe de ariete:');
        recommendations.push('  - Opción 1: Válvula de alivio de presión');
        recommendations.push('  - Opción 2: Chimenea de equilibrio (si elevación lo permite)');
        recommendations.push('  - Opción 3: Sistema de cierre lento en bomba');
        recommendations.push('  - Opción 4:增加PN de tubería (actualizar a PN superior)');
    }
    else if (surgeResult.P_max_total > surgeResult.P_max_static * 1.3) {
        recommendations.push('Recomendación: Considerar protección anti-golpe preventiva');
        recommendations.push('  - Surge significativo detectado aunque dentro de PN');
        recommendations.push('  - Protección extenderá vida útil del sistema');
    }
    return recommendations;
}
// ============================================================================
// WAVE SPEED VALIDATION
// ============================================================================
/**
 * Validate calculated wave speed is reasonable
 *
 * Typical ranges:
 * - Plastic pipes: 200-500 m/s
 * - Metal pipes: 900-1200 m/s
 * - Concrete: 1000-1400 m/s
 */
function validateWaveSpeed(a, material) {
    const ranges = {
        'PVC': { min: 300, max: 500 },
        'HDPE': { min: 250, max: 450 },
        'Fierro Fundido': { min: 900, max: 1200 },
        'Hormigón': { min: 1000, max: 1400 },
        'HCV': { min: 800, max: 1100 }
    };
    const range = ranges[material] || { min: 200, max: 1400 };
    if (a < range.min || a > range.max) {
        return {
            valid: false,
            message: `Velocidad de onda fuera de rango esperado para ${material}: ${a.toFixed(0)} m/s [${range.min}-${range.max} m/s]`
        };
    }
    return {
        valid: true,
        message: `Velocidad de onda razonable: ${a.toFixed(0)} m/s`
    };
}
