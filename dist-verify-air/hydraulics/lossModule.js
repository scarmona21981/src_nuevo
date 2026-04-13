"use strict";
/**
 * Loss Module - Hydraulic Head Loss Calculations
 *
 * Implements:
 * - Hazen-Williams formula for friction losses
 * - Darcy-Weisbach formula for friction losses
 * - Singular (minor) losses calculation
 * - Velocity calculations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STANDARD_K_FACTORS = void 0;
exports.hazenWilliamsLoss = hazenWilliamsLoss;
exports.getHazenC = getHazenC;
exports.darcyWeisbachLoss = darcyWeisbachLoss;
exports.getRoughness = getRoughness;
exports.singularLosses = singularLosses;
exports.calculateVelocity = calculateVelocity;
exports.calculateTotalHead = calculateTotalHead;
exports.verifyVelocity = verifyVelocity;
// ============================================================================
// CONSTANTS
// ============================================================================
const G = 9.81; // m/s² - Gravitational acceleration
// Default Hazen-Williams coefficients by material
const HAZEN_C_DEFAULTS = {
    'PVC': 150,
    'HDPE': 140,
    'Fierro Fundido': 100,
    'Hormigón': 120,
    'HCV': 110,
    'Otro': 120
};
// Default absolute roughness (mm) for Darcy-Weisbach
const ROUGHNESS_DEFAULTS = {
    'PVC': 0.0015,
    'HDPE': 0.0015,
    'Fierro Fundido': 0.26,
    'Hormigón': 0.3,
    'HCV': 0.15,
    'Otro': 0.15
};
// ============================================================================
// HAZEN-WILLIAMS CALCULATION
// ============================================================================
/**
 * Calculate friction head loss using Hazen-Williams formula
 *
 * Formula: hf = 10.67 · L · Q^1.852 / (C^1.852 · D^4.87)
 *
 * @param Q - Flow rate (m³/s)
 * @param C - Hazen-Williams coefficient (dimensionless)
 * @param D - Pipe diameter (m)
 * @param L - Pipe length (m)
 * @returns Head loss (m)
 */
function hazenWilliamsLoss(Q, C, D, L) {
    if (Q <= 0 || D <= 0 || L <= 0 || C <= 0)
        return 0;
    const hf = 10.67 * L * Math.pow(Q, 1.852) / (Math.pow(C, 1.852) * Math.pow(D, 4.87));
    return hf;
}
/**
 * Get default Hazen-Williams coefficient for a material
 */
function getHazenC(material) {
    return HAZEN_C_DEFAULTS[material] || 120;
}
// ============================================================================
// DARCY-WEISBACH CALCULATION
// ============================================================================
/**
 * Calculate Darcy friction factor using Colebrook-White equation
 * (Iterative solution with Swamee-Jain initial guess)
 *
 * @param Re - Reynolds number (dimensionless)
 * @param relativeRoughness - ε/D (dimensionless)
 * @returns Friction factor f (dimensionless)
 */
function calculateFrictionFactor(Re, relativeRoughness) {
    // For laminar flow
    if (Re < 2300) {
        return 64 / Re;
    }
    // For turbulent flow, use Swamee-Jain approximation (accurate within 1%)
    // f = 0.25 / [log10(ε/(3.7D) + 5.74/Re^0.9)]²
    const term1 = relativeRoughness / 3.7;
    const term2 = 5.74 / Math.pow(Re, 0.9);
    const f = 0.25 / Math.pow(Math.log10(term1 + term2), 2);
    return f;
}
/**
 * Calculate friction head loss using Darcy-Weisbach formula
 *
 * Formula: hf = f · (L/D) · v² / (2g)
 *
 * @param Q - Flow rate (m³/s)
 * @param roughness - Absolute roughness (mm)
 * @param D - Pipe diameter (m)
 * @param L - Pipe length (m)
 * @returns Head loss (m)
 */
function darcyWeisbachLoss(Q, roughness, D, L) {
    if (Q <= 0 || D <= 0 || L <= 0)
        return 0;
    // Calculate velocity
    const A = Math.PI * Math.pow(D, 2) / 4; // m²
    const v = Q / A; // m/s
    // Calculate Reynolds number
    const nu = 1.004e-6; // m²/s - Kinematic viscosity of water at 20°C
    const Re = (v * D) / nu;
    // Convert roughness to relative roughness
    const roughnessM = roughness / 1000; // Convert mm to m
    const relativeRoughness = roughnessM / D;
    // Calculate friction factor
    const f = calculateFrictionFactor(Re, relativeRoughness);
    // Calculate head loss
    const hf = f * (L / D) * Math.pow(v, 2) / (2 * G);
    return hf;
}
/**
 * Get default absolute roughness for a material (mm)
 */
function getRoughness(material) {
    return ROUGHNESS_DEFAULTS[material] || 0.15;
}
// ============================================================================
// SINGULAR (MINOR) LOSSES
// ============================================================================
/**
 * Calculate singular (minor) head losses
 *
 * Formula: hs = Σ(K · v² / 2g)
 *
 * @param Q - Flow rate (m³/s)
 * @param D - Pipe diameter (m)
 * @param kFactors - Array of loss coefficients
 * @returns Total singular head loss (m)
 */
function singularLosses(Q, D, kFactors) {
    if (Q <= 0 || D <= 0)
        return 0;
    // Calculate velocity
    const v = calculateVelocity(Q, D);
    // Sum all K factors
    const K_total = kFactors.reduce((sum, k) => sum + k.K, 0);
    // Calculate head loss
    const hs = K_total * Math.pow(v, 2) / (2 * G);
    return hs;
}
/**
 * Standard K factors for common fittings
 */
exports.STANDARD_K_FACTORS = {
    'Válvula de Retención': 2.5,
    'Codo 90°': 0.9,
    'Codo 45°': 0.4,
    'Te (flujo recto)': 0.6,
    'Te (flujo derivado)': 1.8,
    'Válvula de Compuerta (abierta)': 0.2,
    'Válvula de Mariposa': 0.5,
    'Entrada (borde vivo)': 0.5,
    'Entrada (redondeada)': 0.04,
    'Salida': 1.0,
    'Reducción': 0.5,
    'Ampliación': 0.8
};
// ============================================================================
// VELOCITY CALCULATION
// ============================================================================
/**
 * Calculate flow velocity in a pipe
 *
 * @param Q - Flow rate (m³/s)
 * @param D - Pipe diameter (m)
 * @returns Velocity (m/s)
 */
function calculateVelocity(Q, D) {
    if (Q <= 0 || D <= 0)
        return 0;
    const A = Math.PI * Math.pow(D, 2) / 4; // m²
    const v = Q / A;
    return v;
}
// ============================================================================
// TOTAL HEAD CALCULATION
// ============================================================================
/**
 * Calculate total required head including safety margin
 *
 * @param H_static - Static head (elevation difference) (m)
 * @param h_friction - Friction losses (m)
 * @param h_singular - Singular losses (m)
 * @param safetyMargin - Safety margin percentage (default 10%)
 * @returns Total required head (m)
 */
function calculateTotalHead(H_static, h_friction, h_singular, safetyMargin = 10) {
    const H_base = H_static + h_friction + h_singular;
    const H_req = H_base * (1 + safetyMargin / 100);
    return H_req;
}
// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================
/**
 * Verify velocity is within acceptable range
 *
 * @param v - Velocity (m/s)
 * @returns Validation result
 */
function verifyVelocity(v) {
    const V_MIN = 0.6; // m/s
    const V_MAX = 2.5; // m/s
    if (v < V_MIN) {
        return {
            ok: false,
            message: `Velocidad muy baja (${v.toFixed(2)} m/s < ${V_MIN} m/s). Riesgo de sedimentación.`
        };
    }
    if (v > V_MAX) {
        return {
            ok: false,
            message: `Velocidad muy alta (${v.toFixed(2)} m/s > ${V_MAX} m/s). Riesgo de erosión.`
        };
    }
    return {
        ok: true,
        message: `Velocidad adecuada: ${v.toFixed(2)} m/s`
    };
}
