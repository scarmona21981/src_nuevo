"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PressureEngine = void 0;
exports.analyzePressureSystem = analyzePressureSystem;
const pumpRecommendation_1 = require("./pumpRecommendation");
const lossModule_1 = require("./lossModule");
const pumpModule_1 = require("./pumpModule");
const pressureModule_1 = require("./pressureModule");
const flowUnits_1 = require("./flowUnits");
const surgeModule_1 = require("./surgeModule");
const airValveModule_1 = require("./airValveModule");
const pumpHeadEngine_1 = require("./pumpHeadEngine");
// ============================================================================
// MAIN PRESSURE ENGINE CLASS
// ============================================================================
class PressureEngine {
    /**
     * Validate geometry before analysis
     */
    validateGeometry(wetWell, pump, pipe) {
        const errors = [];
        // Wet well validation
        if (wetWell.CT === undefined || wetWell.CT === null) {
            errors.push('Falta Cota de Terreno (CT) en Cámara Húmeda');
        }
        if (wetWell.CL === undefined || wetWell.CL === null) {
            errors.push('Falta Nivel de Agua (CL) en Cámara Húmeda');
        }
        if (wetWell.CR >= wetWell.CT) {
            errors.push('Radier (CR) debe estar bajo terreno (CT)');
        }
        if (wetWell.Nmin >= wetWell.Nalarm) {
            errors.push('Niveles de control mal configurados (Nmin >= Nalarm)');
        }
        if (wetWell.CL < wetWell.CR || wetWell.CL > wetWell.CT) {
            errors.push('Nivel de agua (CL) fuera de rango válido (Entre CR y CT)');
        }
        // Pump validation
        if (!pump.Qnom || pump.Qnom <= 0) {
            errors.push('Falta Caudal de Diseño (Qnom) en Bomba');
        }
        if (!pump.Hnom || pump.Hnom <= 0) {
            errors.push('Falta Altura Nominal (Hnom) en Bomba');
        }
        if (!pump.PN_usuario || pump.PN_usuario <= 0) {
            errors.push('Falta Presión Nominal (PN) en Bomba');
        }
        // Pipe validation
        if (!pipe.length || pipe.length <= 0) {
            errors.push('Falta Longitud en Tubería de Presión');
        }
        if (!pipe.diameter || pipe.diameter <= 0) {
            errors.push('Falta Diámetro en Tubería de Presión');
        }
        if (!pipe.material) {
            errors.push('Falta Material en Tubería de Presión');
        }
        if (!pipe.PN || pipe.PN <= 0) {
            errors.push('Falta Presión Nominal (PN) en Tubería');
        }
        // Check PN consistency
        if (pipe.PN < pump.PN_usuario) {
            errors.push(`PN de tubería (${pipe.PN} bar) menor que PN requerido por bomba (${pump.PN_usuario} bar)`);
        }
        return {
            valid: errors.length === 0,
            errors
        };
    }
    /**
     * Analyze complete pressure network
     */
    analyzePressureNetwork(wetWell, pump, pipe, method = 'HAZEN_WILLIAMS', destinationNode, modeArg) {
        const resolveHydraulicFlowMode = (requestedMode, targetPump) => {
            if (requestedMode === 'IMPOSED_QIN' || requestedMode === 'OPERATING_POINT_QSTAR') {
                return requestedMode;
            }
            // Legacy mode bridge
            if (requestedMode === 'DESIGN_VERIFICATION')
                return 'IMPOSED_QIN';
            if (requestedMode === 'EQUILIBRIUM')
                return 'OPERATING_POINT_QSTAR';
            if (targetPump.hydraulicFlowMode === 'IMPOSED_QIN' || targetPump.hydraulicFlowMode === 'OPERATING_POINT_QSTAR') {
                return targetPump.hydraulicFlowMode;
            }
            const hasCurveData = targetPump.curveMode === '3_POINTS'
                ? !!targetPump.point0 && !!targetPump.pointNom && !!targetPump.pointMax
                : Array.isArray(targetPump.curveTable) && targetPump.curveTable.length >= 3;
            return hasCurveData ? 'OPERATING_POINT_QSTAR' : 'IMPOSED_QIN';
        };
        const hydraulicFlowMode = resolveHydraulicFlowMode(modeArg, pump);
        // Step 1: Validate geometry
        const geomValidation = this.validateGeometry(wetWell, pump, pipe);
        if (!geomValidation.valid) {
            throw new Error(`Errores de geometría: ${geomValidation.errors.join('; ')}`);
        }
        // Step 2: Validate pump curve
        const curveValidation = (0, pumpModule_1.validatePumpCurve)(pump);
        if (!curveValidation.valid) {
            throw new Error(`Curva de bomba inválida: ${curveValidation.errors.join('; ')}`);
        }
        // Use pipe's calculation method if valid, otherwise use argument
        const calculationMethod = pipe.calculationMethod || method;
        // Convert pipe diameter from mm to m
        const D_m = pipe.diameter / 1000;
        const L = pipe.length;
        // Step 3: Create pump curve function
        const pumpCurve = (0, pumpModule_1.createPumpCurve)(pump);
        // Step 4: Calculate system parameters
        // [FIX] RELATIVE DATUM LOGIC
        // Define Hydraulic Reference (Datum) at Pump Suction
        const z_ref = Number.isFinite(wetWell.N1on) ? wetWell.N1on : wetWell.CL;
        // Relative Elevations
        const z_start_rel = 0; // By definition, suction is 0 in relative frame
        const z_end_rel = pipe.z_end - z_ref;
        const H_static = z_end_rel; // Static head is difference in relative elevations
        // Get material properties
        const C_hazen = pipe.C_hazen || (0, lossModule_1.getHazenC)(pipe.material);
        const roughness = pipe.roughness || (0, lossModule_1.getRoughness)(pipe.material);
        // [NEW] Define System Head Function for Numerical Solver
        // Calculates actual head required (Static + Friction + Minor) for a given Q
        const getSystemHead = (Q) => {
            if (Q <= 0)
                return H_static;
            let h_friction = 0;
            if (calculationMethod === 'HAZEN_WILLIAMS') {
                h_friction = (0, lossModule_1.hazenWilliamsLoss)(Q, C_hazen, D_m, L);
            }
            else {
                h_friction = (0, lossModule_1.darcyWeisbachLoss)(Q, roughness, D_m, L);
            }
            const h_singular = (0, lossModule_1.singularLosses)(Q, D_m, pipe.kFactors);
            return H_static + h_friction + h_singular;
        };
        const Qin_m3s = (0, flowUnits_1.toM3s)(wetWell.inflowRate || 0, 'L/s');
        function getPumpFlowRange(targetPump) {
            if (targetPump.curveMode === '3_POINTS') {
                if (!targetPump.point0 || !targetPump.pointNom || !targetPump.pointMax)
                    return undefined;
                const qValues = [targetPump.point0.Q, targetPump.pointNom.Q, targetPump.pointMax.Q]
                    .filter((q) => Number.isFinite(q));
                if (qValues.length < 3)
                    return undefined;
                return { min: Math.min(...qValues), max: Math.max(...qValues) };
            }
            if (!targetPump.curveTable || targetPump.curveTable.length < 2)
                return undefined;
            const sorted = [...targetPump.curveTable]
                .filter(pt => Number.isFinite(pt.Q) && Number.isFinite(pt.H))
                .sort((a, b) => a.Q - b.Q);
            if (sorted.length < 2)
                return undefined;
            return {
                min: sorted[0].Q,
                max: sorted[sorted.length - 1].Q
            };
        }
        function pumpHeadAtQNoExtrapolation(Q_m3s) {
            const range = getPumpFlowRange(pump);
            if (!range)
                return undefined;
            if (Q_m3s < range.min || Q_m3s > range.max)
                return undefined;
            return pumpCurve(Q_m3s);
        }
        function findOperatingPointNoExtrapolation(Qmin_m3s, Qmax_m3s) {
            const diff = (Q_m3s) => {
                const Hb = pumpHeadAtQNoExtrapolation(Q_m3s);
                if (Hb === undefined)
                    return undefined;
                return Hb - getSystemHead(Q_m3s);
            };
            let a = Qmin_m3s;
            let b = Qmax_m3s;
            let fa = diff(a);
            let fb = diff(b);
            if (fa === undefined || fb === undefined) {
                const qFallback = Qmin_m3s;
                return { Q: qFallback, H: pumpCurve(qFallback) };
            }
            if (Math.abs(fa) <= 1e-3)
                return { Q: a, H: pumpCurve(a) };
            if (Math.abs(fb) <= 1e-3)
                return { Q: b, H: pumpCurve(b) };
            if (fa * fb > 0) {
                const qBest = Math.abs(fa) <= Math.abs(fb) ? a : b;
                return { Q: qBest, H: pumpCurve(qBest) };
            }
            for (let iter = 0; iter < 60; iter++) {
                const m = (a + b) / 2;
                const fm = diff(m);
                if (fm === undefined)
                    break;
                if (Math.abs(fm) < 1e-3) {
                    return { Q: m, H: pumpCurve(m) };
                }
                if (fa * fm <= 0) {
                    b = m;
                    fb = fm;
                }
                else {
                    a = m;
                    fa = fm;
                }
            }
            const qStar = (a + b) / 2;
            return { Q: qStar, H: pumpCurve(qStar) };
        }
        const pumpFlowRange = getPumpFlowRange(pump);
        const Q_max_search = Math.max(pump.Qnom * 3.0, Qin_m3s * 3.0, 0.001);
        const operatingPoint = pumpFlowRange
            ? findOperatingPointNoExtrapolation(pumpFlowRange.min, pumpFlowRange.max)
            : (0, pumpModule_1.findOperatingPoint)(pumpCurve, getSystemHead, Q_max_search);
        const Q_star = operatingPoint.Q;
        const H_star = operatingPoint.H;
        const buildHydraulicsAtQ = (Q_m3s) => {
            const velocityAtQ = (0, lossModule_1.calculateVelocity)(Q_m3s, D_m);
            const hv = Math.pow(velocityAtQ, 2) / (2 * 9.81);
            const frictionAtQ = calculationMethod === 'HAZEN_WILLIAMS'
                ? (0, lossModule_1.hazenWilliamsLoss)(Q_m3s, C_hazen, D_m, L)
                : (0, lossModule_1.darcyWeisbachLoss)(Q_m3s, roughness, D_m, L);
            const minorAtQ = (0, lossModule_1.singularLosses)(Q_m3s, D_m, pipe.kFactors);
            const lossesAtQ = frictionAtQ + minorAtQ;
            return {
                Q_Ls: (0, flowUnits_1.fromM3s)(Q_m3s, 'L/s'),
                Q_Lmin: (0, flowUnits_1.fromM3s)(Q_m3s, 'L/min'),
                velocity_ms: velocityAtQ,
                hv_velocity: hv,
                h_friction: frictionAtQ,
                h_minor: minorAtQ,
                h_losses: lossesAtQ,
                H_static,
                H_required: H_static + lossesAtQ + hv
            };
        };
        const criteria = {
            TR_max_min: 30,
            Tc_min_min: 10,
            vel_min: pressureModule_1.VELOCITY_MIN_MS,
            vel_max: pressureModule_1.VELOCITY_MAX_MS,
            safetyMargin_min_pct: wetWell.safetyMarginRequirement ?? 15
        };
        const EPS_NORM = 1e-6;
        const Q_design_m3s = Qin_m3s > 0 ? Qin_m3s : Q_star;
        const hydraulicsAtDesignQ = buildHydraulicsAtQ(Q_design_m3s);
        const hydraulicsAtQstar = buildHydraulicsAtQ(Q_star);
        const H_available_at_design = pumpHeadAtQNoExtrapolation(Q_design_m3s);
        const safetyMarginAtDesign = H_available_at_design !== undefined && hydraulicsAtDesignQ.H_required > 0
            ? ((H_available_at_design / hydraulicsAtDesignQ.H_required) - 1) * 100
            : undefined;
        const wetWellVolume = (0, pressureModule_1.calculateWetWellVolume)(wetWell, wetWell.N1on - wetWell.Noff);
        const Qmedio_Ls = (0, flowUnits_1.fromM3s)(Q_design_m3s, 'L/s');
        const designChecks = {};
        designChecks['Velocidad (Qin)'] = {
            ok: (0, pressureModule_1.isVelocityWithinNormativeRange)(hydraulicsAtDesignQ.velocity_ms, criteria.vel_min, criteria.vel_max),
            value: hydraulicsAtDesignQ.velocity_ms,
            target: `${criteria.vel_min.toFixed(2)}-${criteria.vel_max.toFixed(2)} m/s (incluye límites)`
        };
        if (H_available_at_design === undefined) {
            designChecks['Bomba (Qin)'] = {
                ok: false,
                value: hydraulicsAtDesignQ.Q_Lmin,
                target: 'Qin dentro de curva de bomba'
            };
        }
        if (safetyMarginAtDesign !== undefined) {
            designChecks['Margen (Qin)'] = {
                ok: (safetyMarginAtDesign + EPS_NORM) >= criteria.safetyMargin_min_pct,
                value: safetyMarginAtDesign,
                target: `>= ${criteria.safetyMargin_min_pct}%`
            };
        }
        let tr_min;
        let volume_min_m3;
        if (wetWellVolume > 0 && Qmedio_Ls > 0) {
            tr_min = (wetWellVolume / (Qmedio_Ls / 1000)) / 60;
            volume_min_m3 = (Qmedio_Ls * 600) / 1000;
            designChecks['TR'] = {
                ok: tr_min <= criteria.TR_max_min,
                value: tr_min,
                target: `<= ${criteria.TR_max_min} min`
            };
        }
        if (wetWellVolume > 0 && hydraulicsAtDesignQ.Q_Ls > 0) {
            const tcDesign = ((4 * wetWellVolume) / (hydraulicsAtDesignQ.Q_Ls / 1000)) / 60;
            designChecks['Tc (si Q=Qin)'] = {
                ok: tcDesign >= criteria.Tc_min_min,
                value: tcDesign,
                target: `>= ${criteria.Tc_min_min} min`
            };
        }
        const operationChecks = {};
        operationChecks['Velocidad (Q*)'] = {
            ok: (0, pressureModule_1.isVelocityWithinNormativeRange)(hydraulicsAtQstar.velocity_ms, criteria.vel_min, criteria.vel_max),
            value: hydraulicsAtQstar.velocity_ms,
            target: `${criteria.vel_min.toFixed(2)}-${criteria.vel_max.toFixed(2)} m/s (incluye límites)`
        };
        let operationCycleTimeMin;
        if (wetWellVolume > 0 && hydraulicsAtQstar.Q_Ls > 0) {
            operationCycleTimeMin = ((4 * wetWellVolume) / (hydraulicsAtQstar.Q_Ls / 1000)) / 60;
            operationChecks['Tc (Q*)'] = {
                ok: operationCycleTimeMin >= criteria.Tc_min_min,
                value: operationCycleTimeMin,
                target: `>= ${criteria.Tc_min_min} min`
            };
        }
        const flowModeAnalysis = {
            design: {
                mode: 'DESIGN',
                Q_design: hydraulicsAtDesignQ,
                H_pump_at_Qin: H_available_at_design,
                safetyMargin_pct: safetyMarginAtDesign !== undefined ? parseFloat(safetyMarginAtDesign.toFixed(2)) : undefined,
                tr_min,
                volume_min_m3,
                checks: designChecks
            },
            operation: {
                mode: 'OPERATION',
                Q_star: hydraulicsAtQstar,
                Q_star_Ls: hydraulicsAtQstar.Q_Ls,
                H_star_m: H_star,
                cycleTime_min: operationCycleTimeMin,
                checks: operationChecks
            },
            meta: {
                hasPump: true,
                pumpId: pump.id
            }
        };
        // Step 5: Determine hydraulic flow used for losses/HGL
        let Q_hyd;
        let H_hyd;
        let designVerification;
        const designPumpHeadForVerification = H_available_at_design ?? 0;
        const designMarginForVerification = safetyMarginAtDesign ?? -100;
        designVerification = {
            designFlow: (0, flowUnits_1.fromM3s)(Q_design_m3s, 'L/s'),
            requiredHead: hydraulicsAtDesignQ.H_required,
            pumpHead: designPumpHeadForVerification,
            safetyMargin: parseFloat(designMarginForVerification.toFixed(2)),
            isCompliant: H_available_at_design !== undefined && (designPumpHeadForVerification + EPS_NORM) >= hydraulicsAtDesignQ.H_required,
            efficiencyStatus: 'UNKNOWN',
            operatingPoint_H: designPumpHeadForVerification,
            systemHead_H: hydraulicsAtDesignQ.H_required
        };
        if (pump.Qnom) {
            const ratio = Q_design_m3s / pump.Qnom;
            if (ratio < 0.7)
                designVerification.efficiencyStatus = 'OVERDIMENSIONED';
            else if (ratio > 1.2)
                designVerification.efficiencyStatus = 'SUBDIMENSIONED';
            else
                designVerification.efficiencyStatus = 'OPTIMAL';
        }
        if (hydraulicFlowMode === 'IMPOSED_QIN') {
            // Imposed sanitary design flow for hydraulic profile (Q = Qin).
            Q_hyd = Q_design_m3s;
            // Hydraulic profile uses pump delivered head at selected hydraulic flow.
            H_hyd = H_available_at_design ?? pumpCurve(Q_design_m3s);
        }
        else {
            // Operating-point mode (Q = Q*)
            Q_hyd = Q_star;
            H_hyd = H_star;
        }
        // Step 6: Calculate detailed losses at verification point
        // (Re-calculate for the final Q to get specific components)
        let h_friction;
        if (calculationMethod === 'HAZEN_WILLIAMS') {
            h_friction = (0, lossModule_1.hazenWilliamsLoss)(Q_hyd, C_hazen, D_m, L);
        }
        else {
            h_friction = (0, lossModule_1.darcyWeisbachLoss)(Q_hyd, roughness, D_m, L);
        }
        const h_singular = (0, lossModule_1.singularLosses)(Q_hyd, D_m, pipe.kFactors);
        // Calculate velocity
        const velocity = (0, lossModule_1.calculateVelocity)(Q_hyd, D_m);
        const velocityHead = Math.pow(velocity, 2) / (2 * 9.81);
        // Step 7: Pressure verification
        // [FIX] Use RELATIVE elevations for pressure calculation.
        // Terrain profile and inline valve elevations are stored as ABSOLUTE cotas,
        // so they must be transformed to the relative frame before solving.
        const relativeProfilePoints = pipe.profilePoints?.map(pt => ({
            ...pt,
            elevation: pt.elevation - z_ref
        }));
        const zStartTerrainRel = Number.isFinite(pipe.z_start_terreno)
            ? pipe.z_start_terreno - z_ref
            : (Number.isFinite(wetWell.CT) ? wetWell.CT - z_ref : undefined);
        const zEndTerrainRel = Number.isFinite(pipe.z_end_terreno)
            ? pipe.z_end_terreno - z_ref
            : (Number.isFinite(destinationNode?.elevation) ? (destinationNode.elevation - z_ref) : undefined);
        const relativeInlineNodes = pipe.inlineNodes?.map(node => ({
            ...node,
            elevation: node.elevation - z_ref
        }));
        // The pressure formula P = (H - z) / k works correctly when both H and z are in the same relative frame.
        const relativePressurePoints = (0, pressureModule_1.calculatePressureProfile)(H_hyd, // H is TDH (Head relative to suction)
        z_start_rel, // 0
        z_end_rel, // Relative discharge elevation
        h_friction, h_singular, L, // Total pipe length
        relativeProfilePoints, relativeInlineNodes, {
            z_start_terreno: zStartTerrainRel,
            z_end_terreno: zEndTerrainRel,
            cover_m: pipe.cover_m,
            diameter_mm: pipe.diameter,
            reference: 'axis'
        });
        // [FIX] APPLY BOUNDARY CONDITIONS (Pressure Junctions)
        if (destinationNode && relativePressurePoints.length > 0) {
            const lastPoint = relativePressurePoints[relativePressurePoints.length - 1];
            let targetEndHead;
            const isAtmosphericBoundary = destinationNode.boundaryType === 'ATMOSPHERIC' || destinationNode.boundaryType === 'PRESSURE_BREAK';
            switch (destinationNode.boundaryType) {
                case 'ATMOSPHERIC':
                case 'PRESSURE_BREAK':
                    // Free discharge / pressure-break chamber: use free-water level if provided.
                    // This keeps final pressure at 0 bar in the discharge condition.
                    targetEndHead = (destinationNode.fixedHead ?? destinationNode.elevation) - z_ref;
                    break;
                case 'FIXED_HEAD':
                    // Discharge to fixed level (e.g. Tank)
                    if (destinationNode.fixedHead !== undefined) {
                        targetEndHead = destinationNode.fixedHead - z_ref;
                    }
                    else if (destinationNode.targetPressureBar !== undefined) {
                        const axisElevationAbs = Number.isFinite(destinationNode.elevation)
                            ? destinationNode.elevation
                            : (lastPoint.elevation + z_ref);
                        targetEndHead = axisElevationAbs + (destinationNode.targetPressureBar * 10.1972) - z_ref;
                    }
                    break;
                case 'CONNECTION':
                    // Direct connection, no BC on head at this stage
                    break;
            }
            if (typeof targetEndHead === 'number' && Number.isFinite(targetEndHead)) {
                const deltaHead = targetEndHead - lastPoint.head;
                relativePressurePoints.forEach(point => {
                    point.head += deltaHead;
                    point.pressure = (point.head - point.elevation) / 10.1972;
                });
                if (isAtmosphericBoundary) {
                    const updatedLast = relativePressurePoints[relativePressurePoints.length - 1];
                    updatedLast.elevation = targetEndHead;
                    updatedLast.head = targetEndHead;
                    updatedLast.pressure = 0;
                }
            }
        }
        // [FIX] Convert back to ABSOLUTE coordinates for display
        // Pressure values remain VALID because they are differential (P_rel = P_abs)
        const pressurePoints = relativePressurePoints.map((p) => ({
            ...p,
            elevation: p.elevation + z_ref, // Convert relative Z back to Absolute Z
            head: p.head + z_ref // Convert relative HGL back to Absolute HGL
        }));
        // Generate EGL Points (HGL + v^2/2g)
        const eglPoints = pressurePoints.map((point) => ({
            ...point,
            head: point.head + velocityHead,
        }));
        // [NEW] Generate and store continuous hydraulic samples
        const h_initial_abs = H_hyd + z_ref;
        pipe.samples = (0, pressureModule_1.generateHydraulicSamples)(pipe, h_friction, h_singular, h_initial_abs);
        const isAtmosphericDischarge = !!destinationNode && (destinationNode.boundaryType === 'ATMOSPHERIC'
            || destinationNode.boundaryType === 'PRESSURE_BREAK'
            || (destinationNode.boundaryType === 'FIXED_HEAD' && destinationNode.targetPressureBar === undefined));
        const pressureVerification = (0, pressureModule_1.verifyPressureLimits)(pressurePoints, pipe.PN, {
            allowAtmosphericEndPressure: isAtmosphericDischarge,
            endPressureToleranceBar: pressureModule_1.PRESSURE_END_EPS_BAR
        });
        // Step 8: Velocity verification
        const velocityCheck = (0, pressureModule_1.verifyVelocityRange)(velocity);
        // Step 9: Flow efficiency verification
        const efficiencyCheck = (0, pressureModule_1.verifyFlowEfficiency)(Q_hyd, pump.Qnom);
        // Step 10: Surge analysis
        const surgeResult = (0, surgeModule_1.analyzeSurge)(L, velocity, pipe.material, pipe.diameter, // in mm
        pressureVerification.maxPressure, pipe.PN, pipe.thickness);
        // Step 11: Head loss verification
        const h_total = h_friction + h_singular;
        const lossCheck = (0, pressureModule_1.verifyHeadLosses)(h_total, H_static);
        // Step 12: Calculate total required head with safety margin
        const safetyMargin = 10; // 10%
        const H_required = (0, lossModule_1.calculateTotalHead)(H_static, h_friction, h_singular, safetyMargin);
        // Step 13: Compile violations and recommendations
        const violations = [];
        const recommendations = [];
        if (!pressureVerification.ok) {
            violations.push(...pressureVerification.violations);
        }
        if (!velocityCheck.ok) {
            violations.push(velocityCheck.message);
            if (velocity < (pressureModule_1.VELOCITY_MIN_MS - pressureModule_1.VELOCITY_TOLERANCE_MS)) {
                recommendations.push('Reducir diámetro de tubería para aumentar velocidad');
            }
            else {
                recommendations.push('Aumentar diámetro de tubería para reducir velocidad');
            }
        }
        if (!efficiencyCheck.ok) {
            violations.push(efficiencyCheck.message);
            if (efficiencyCheck.ratio < 0.7) {
                recommendations.push('Considerar bomba de menor capacidad nominal');
            }
            else {
                recommendations.push('Considerar bomba de mayor capacidad nominal');
            }
        }
        if (!surgeResult.compliant) {
            violations.push(...surgeResult.violations);
            recommendations.push(...(0, surgeModule_1.getSurgeProtectionRecommendations)(surgeResult));
        }
        if (!lossCheck.ok) {
            violations.push(lossCheck.message);
        }
        if (pipe.diameter < 63) {
            violations.push(`Diámetro muy pequeño: ${pipe.diameter} mm < 63 mm. Riesgo de obstrucción (mínimo sanitario).`);
            recommendations.push('Aumentar diámetro a mínimo 63 mm (75mm recomendado).');
        }
        // Determine overall status
        // If hydraulic mode imposes Qin, enforce pump-vs-system head compliance at Q_hyd.
        let status = violations.length === 0 ? 'CONFORME' : 'NO_CONFORME';
        if (hydraulicFlowMode === 'IMPOSED_QIN') {
            if (H_available_at_design === undefined) {
                status = 'NO_CONFORME';
                violations.push(`ALERTA CRÍTICA: Qin (${(0, flowUnits_1.fromM3s)(Q_design_m3s, 'L/min').toFixed(1)} L/min) está fuera del rango de la curva de bomba. No se puede verificar margen de diseño en Qin.`);
            }
            else if (!designVerification.isCompliant) {
                status = 'NO_CONFORME';
                violations.push(`ALERTA CRÍTICA: La bomba no satisface la altura requerida al caudal de diseño. Altura disponible (${designVerification.pumpHead.toFixed(2)}m) < Requerida (${designVerification.requiredHead.toFixed(2)}m). CAMBIAR BOMBA.`);
            }
            else {
                // Check against required margin
                const requiredMargin = wetWell.safetyMarginRequirement ?? 15;
                if ((designVerification.safetyMargin + EPS_NORM) < requiredMargin) {
                    // Refined label as per user request
                    violations.push(`Advertencia de Diseño (Criterio Ingenieril): Margen de seguridad (${designVerification.safetyMargin.toFixed(1)}%) es menor al ${requiredMargin}% recomendado.`);
                    status = 'NO_CONFORME';
                }
            }
        }
        // Step 14: Operational cycle verification
        // Volume útil operativo (V = Area * (N1on - Noff))
        const cycleTime = flowModeAnalysis.operation.cycleTime_min ?? (0, pressureModule_1.calculateCycleTime)(wetWellVolume, Q_star);
        const cycleVerification = (0, pressureModule_1.verifyOperationalCycle)(cycleTime);
        // Keep cycle diagnostics in operationalChecks (sanitary domain),
        // without altering hydraulic compliance status/violations.
        // [NEW] Sanitary Diagnostic
        const sanitaryDiagnostic = (0, pressureModule_1.calculateSanitaryDiagnostic)((0, lossModule_1.calculateVelocity)(Q_star, D_m), D_m, L, Q_star, pipe.agingCheck?.minFutureC);
        // Step 15: Build verification result
        const endChainage = pressurePoints.length > 0 && Number.isFinite(pressurePoints[pressurePoints.length - 1].chainage ?? Number.NaN)
            ? pressurePoints[pressurePoints.length - 1].chainage
            : L;
        const airValveProfile = (pipe.samples && pipe.samples.length > 0)
            ? pipe.samples.map(sample => ({
                location: `Muestra ${sample.x.toFixed(2)}m`,
                chainage: sample.x,
                elevation: sample.elevation,
                head: sample.hgl,
                pressure: sample.pressure
            }))
            : pressurePoints;
        const airValves = (0, airValveModule_1.detectAirValves)(airValveProfile, L, {
            velocity,
            pressureEpsBar: pressureModule_1.PRESSURE_END_EPS_BAR,
            atmosphericDischarge: isAtmosphericDischarge,
            atmosphericBoundaryChainages: isAtmosphericDischarge ? [endChainage] : []
        });
        const pipeVerification = {
            pipeId: pipe.id,
            impulsionDiameter_m: D_m,
            isAtmosphericDischarge,
            Q_operating: Q_hyd,
            H_required,
            H_static,
            h_friction,
            h_singular,
            safetyMargin,
            velocity,
            velocityCompliant: velocityCheck.ok,
            flowEfficiency: efficiencyCheck.ratio,
            flowEfficiencyCompliant: efficiencyCheck.ok,
            pressurePoints,
            eglPoints,
            maxPressure: pressureVerification.maxPressure,
            maxPressureLocation: pressureVerification.maxLocation,
            pressureCompliant: pressureVerification.ok,
            samples: pipe.samples,
            surgeAnalysis: surgeResult,
            status,
            violations,
            recommendations,
            method: calculationMethod,
            normativeReference: 'Criterios generales de diseño - Chile',
            airValves,
            sanitaryDiagnostic, // [NEW]
            nchVerification: undefined // Will be filled below
        };
        // Step 16: Detailed Operational / Normative Checks
        const operationalChecks = {
            cycleTime,
            cycleTimeCompliant: cycleVerification.cycleOk,
            startsPerHour: cycleVerification.startsPerHour,
            startsCompliant: cycleVerification.startsOk,
            sanitaryCycle: (0, pressureModule_1.calculateSanitaryCycle)(wetWellVolume, Q_star, (0, flowUnits_1.toM3s)(wetWell.inflowRate || 0, 'L/s'))
        };
        // [Unified Hydraulic State]
        const Q_medio_Ls = (wetWell.inflowRate || 0);
        const Qb_real_Ls = (0, flowUnits_1.fromM3s)(Q_star, 'L/s');
        const Q_hydraulic_used_Ls = (0, flowUnits_1.fromM3s)(Q_hyd, 'L/s');
        const Q_neto_Ls = Qb_real_Ls - Q_medio_Ls;
        const blockageError = Qb_real_Ls <= Q_medio_Ls;
        const designSafetyMargin = designVerification.safetyMargin;
        const hydraulicState = {
            hydraulicFlowMode,
            Q_medio_sanitario_Ls: Q_medio_Ls,
            Qb_real_Ls: Qb_real_Ls,
            Q_hydraulic_used_Ls,
            Q_neto_Ls: Q_neto_Ls,
            H_required_m: hydraulicsAtQstar.H_required,
            H_pump_available_m: H_star,
            H_hydraulic_used_m: H_hyd,
            margin: designSafetyMargin,
            velocity_ms: hydraulicsAtQstar.velocity_ms,
            hydraulicVelocityFlow_Ls: Q_hydraulic_used_Ls,
            impulsionDiameter_m: D_m,
            blockageError
        };
        // Complete NCh 2472 Verification [NEW]
        const nchVerification = (0, pressureModule_1.calculateNchVerification)(wetWell, pump, hydraulicState // Now using Unified HydraulicState
        );
        pipeVerification.nchVerification = nchVerification;
        pipeVerification.normativeReference = 'NCh 2472 - Plantas Elevadoras';
        // Step 16: Generate curve data for plotting
        const Q_max = Math.max(pump.Qnom * 1.5, Q_star * 1.3, Q_hyd * 1.3);
        const pumpCurvePoints = (0, pumpModule_1.generateCurvePoints)(pumpCurve, Q_max, 50);
        // Use the same getSystemHead function to generate plot points
        const systemCurvePoints = (0, pumpModule_1.generateCurvePoints)(getSystemHead, Q_max, 50);
        // Step 17: Calculate Detailed Pump Head (Hb) using EnergyBalanceSolver
        const headSolver = new pumpHeadEngine_1.EnergyBalanceSolver();
        const pumpHeadResult = headSolver.computeRequiredPumpHead({
            z1: wetWell.CL,
            z3: pipe.z_end,
            flow: Q_hyd,
            method: calculationMethod,
            sections: [{
                    length: pipe.length,
                    internalDiameter: D_m,
                    roughness: calculationMethod === 'HAZEN_WILLIAMS' ? C_hazen : roughness,
                    fittings: pipe.kFactors.map((k, i) => ({
                        id: `fitting-${i}`,
                        type: k.description || 'Desconocido',
                        count: 1,
                        k: k.K
                    }))
                }]
        });
        // Add context data
        pumpHeadResult.z1 = wetWell.CL;
        pumpHeadResult.z3 = pipe.z_end;
        // Step 18: Calculate pump recommendation
        const pumpRecommendation = (0, pumpRecommendation_1.calculateRecommendedPump)(Q_hyd, H_static, h_friction, h_singular);
        // Add diagnosis if pump operating point is known
        if (pump.Qnom && pump.Hnom) {
            pumpRecommendation.diagnosis = (0, pumpRecommendation_1.diagnosePumpPerformance)(Q_hyd, H_hyd, pumpRecommendation);
        }
        // Step 19: Build complete results
        const results = {
            operatingPoint: {
                Q: Q_star,
                H: H_star,
                efficiency: undefined
            },
            hydraulicFlowMode,
            flowModeAnalysis,
            pumpCurve: pumpCurvePoints,
            systemCurve: systemCurvePoints,
            verifications: {
                [pipe.id]: pipeVerification
            },
            summary: {
                totalPipes: 1,
                compliant: status === 'CONFORME' ? 1 : 0,
                nonCompliant: status === 'NO_CONFORME' ? 1 : 0,
                method: calculationMethod
            },
            operationalChecks,
            pumpHeadResult,
            pumpRecommendation,
            designVerification,
            nchVerification,
            hydraulicState, // Final unified results
            wetWell,
            pump
        };
        return results;
    }
}
exports.PressureEngine = PressureEngine;
// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================
/**
 * Quick analysis with default parameters
 */
function analyzePressureSystem(wetWell, pump, pipe, method = 'HAZEN_WILLIAMS', mode) {
    const engine = new PressureEngine();
    return engine.analyzePressureNetwork(wetWell, pump, pipe, method, undefined, mode);
}
