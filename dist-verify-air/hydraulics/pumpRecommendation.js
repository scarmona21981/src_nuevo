"use strict";
/**
 * Pump Recommendation Module - Intelligent Pump Sizing for Sanitary Systems
 *
 * Implements hydraulic design assistant that:
 * - Recommends optimal pump specifications (Q_BEP, H_BEP)
 * - Classifies system type based on friction characteristics
 * - Diagnoses current pump performance vs requirements
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateRecommendedPump = calculateRecommendedPump;
exports.diagnosePumpPerformance = diagnosePumpPerformance;
// ============================================================================
// CORE ALGORITHM: PUMP RECOMMENDATION
// ============================================================================
/**
 * Calculate recommended pump specifications based on system requirements
 *
 * Hydraulic Criteria:
 * - Q_BEP ≈ Q_design (operate near BEP for efficiency)
 * - H_BEP = H_req × 1.12 (12% safety margin for aging/variation)
 *
 * @param Q_design - Design flow rate (m³/s)
 * @param H_static - Static head difference (m)
 * @param h_friction - Friction losses (m)
 * @param h_minor - Minor losses (m)
 * @returns Pump recommendation with diagnostic info
 */
function calculateRecommendedPump(Q_design, H_static, h_friction, h_minor) {
    // 1. Calculate total required head
    const H_req = H_static + h_friction + h_minor;
    // 2. Apply safety factor for BEP head (12% standard for sanitary)
    const H_BEP = H_req * 1.12;
    // 3. Recommended BEP flow equals design flow
    const Q_BEP = Q_design;
    // 4. Classify system and suggest pump type
    const frictionRatio = h_friction / H_req;
    const systemType = classifyPumpSystem(frictionRatio);
    const pumpType = getPumpTypeSuggestion(systemType);
    return {
        Q_BEP,
        H_BEP,
        H_req,
        systemType,
        pumpType,
        frictionRatio
    };
}
// ============================================================================
// SYSTEM CLASSIFICATION
// ============================================================================
/**
 * Classify pump system based on friction ratio
 *
 * R = h_friction / H_req
 *
 * - R < 0.2:  Static-dominated → High head, low flow pump
 * - 0.2 ≤ R ≤ 0.6: Mixed → Standard centrifugal pump
 * - R > 0.6:  Friction-dominated → High efficiency flow pump
 */
function classifyPumpSystem(frictionRatio) {
    if (frictionRatio < 0.2) {
        return 'high_head_low_flow';
    }
    else if (frictionRatio <= 0.6) {
        return 'standard';
    }
    else {
        return 'high_efficiency_flow';
    }
}
/**
 * Get human-readable pump type suggestion
 */
function getPumpTypeSuggestion(systemType) {
    switch (systemType) {
        case 'high_head_low_flow':
            return 'Bomba de alta carga – bajo caudal';
        case 'standard':
            return 'Bomba centrífuga estándar';
        case 'high_efficiency_flow':
            return 'Bomba de alta eficiencia para caudal';
        default:
            return 'Bomba centrífuga';
    }
}
// ============================================================================
// PUMP PERFORMANCE DIAGNOSIS
// ============================================================================
/**
 * Diagnose current pump performance vs system requirements
 *
 * Indices:
 * - I_Q = Q_oper / Q_BEP  (flow efficiency index)
 * - I_H = H_oper / H_req  (head adequacy index)
 *
 * @param Q_oper - Operating flow (m³/s)
 * @param H_oper - Operating head (m)
 * @param recommendation - Recommended pump specs
 * @returns Diagnostic with performance indices and messages
 */
function diagnosePumpPerformance(Q_oper, H_oper, recommendation) {
    const I_Q = Q_oper / recommendation.Q_BEP;
    const I_H = H_oper / recommendation.H_req;
    const messages = [];
    let needsReplacement = false;
    // Flow index analysis
    if (I_Q > 1.3) {
        messages.push('⚠️ La bomba es demasiado grande para el caudal requerido.');
        messages.push('Opera fuera de su rango eficiente (sobrecarga).');
        needsReplacement = true;
    }
    else if (I_Q < 0.7) {
        messages.push('⚠️ La bomba es demasiado pequeña para el caudal requerido.');
        messages.push('No puede entregar el caudal de diseño.');
        needsReplacement = true;
    }
    else if (I_Q >= 0.8 && I_Q <= 1.2) {
        messages.push('✓ Caudal operativo dentro del rango óptimo (80-120% BEP).');
    }
    // Head index analysis
    if (I_H < 0.9) {
        messages.push('⚠️ La bomba no alcanza la altura requerida.');
        messages.push('El sistema no funcionará correctamente.');
        needsReplacement = true;
    }
    else if (I_H > 1.4) {
        messages.push('⚠️ Exceso de energía entregada.');
        messages.push('Riesgo de cavitación y desgaste prematuro.');
        needsReplacement = true;
    }
    else if (I_H >= 1.0 && I_H <= 1.2) {
        messages.push('✓ Altura operativa adecuada con margen de seguridad.');
    }
    // Overall recommendation
    if (needsReplacement) {
        messages.push('');
        messages.push('🔴 Se recomienda reemplazar la bomba antes de modificar la tubería.');
    }
    else if (messages.length === 0) {
        messages.push('✓ La bomba opera en condiciones aceptables.');
    }
    return {
        I_Q,
        I_H,
        messages,
        needsReplacement
    };
}
