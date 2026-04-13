"use strict";
/**
 * Air Valve Detection Module
 *
 * Logic:
 * 1) Evaluate hydraulic/geometric conditions per node.
 * 2) Decide ONE final device type per node.
 * 3) Merge close duplicates.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectAirValves = detectAirValves;
const DEFAULT_OPTIONS = {
    velocity: 0,
    lowPressureThreshold: 2,
    negativePressureThreshold: -1e-6,
    pressureEpsBar: 1e-6,
    highPressureThreshold: 6,
    nearPumpDistance: 30,
    highPointDelta: 0.1,
    atmosphericDischarge: false,
    atmosphericBoundaryChainages: [],
    boundaryExclusionDistance: 1,
    excludedNodeKinds: ['break_pressure_chamber', 'outfall'],
    nodeKindHints: []
};
const TYPE_PRIORITY = {
    TRIPLE_EFFECT: 3,
    ANTI_SURGE: 2,
    AIR_RELEASE: 1,
    TRIPLE_EFECTO_OBLIGATORIA: 3,
    TRIPLE_EFECTO_AIRE: 3,
    RECOMENDADA_INGRESO_AIRE: 1,
    EXPULSION_ANTI_GOLPE: 2,
    PREVENTIVA_PENDIENTE: 1
};
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function normalizeChainage(point, index, totalPoints, totalLength) {
    if (typeof point.chainage === 'number' && Number.isFinite(point.chainage)) {
        return clamp(point.chainage, 0, totalLength);
    }
    if (totalPoints <= 1)
        return 0;
    return (index / (totalPoints - 1)) * totalLength;
}
function toCanonicalType(type) {
    if (type === 'TRIPLE_EFFECT' || type === 'TRIPLE_EFECTO_AIRE' || type === 'TRIPLE_EFECTO_OBLIGATORIA')
        return 'TRIPLE_EFFECT';
    if (type === 'ANTI_SURGE' || type === 'EXPULSION_ANTI_GOLPE')
        return 'ANTI_SURGE';
    return 'AIR_RELEASE';
}
function evaluateConditions(node, prev, next, options) {
    const highPoint = !!prev && !!next
        ? node.elevation > prev.elevation + options.highPointDelta && node.elevation > next.elevation + options.highPointDelta
        : false;
    let slopeChangeDownstream = false;
    if (prev && next) {
        const dxUp = Math.max(node.chainage - prev.chainage, 1e-6);
        const dxDown = Math.max(next.chainage - node.chainage, 1e-6);
        const slopeUp = (node.elevation - prev.elevation) / dxUp;
        const slopeDown = (next.elevation - node.elevation) / dxDown;
        slopeChangeDownstream = slopeUp * slopeDown < 0 && Math.abs(slopeDown - slopeUp) > 0.002;
    }
    return {
        highPoint,
        lowPressure: node.pressure >= -options.pressureEpsBar && node.pressure <= options.lowPressureThreshold,
        negativePressure: node.pressure < Math.min(options.negativePressureThreshold, -options.pressureEpsBar),
        highPressure: node.pressure >= options.highPressureThreshold,
        nearPump: node.chainage < options.nearPumpDistance,
        fillingRisk: slopeChangeDownstream && options.velocity > 0.6
    };
}
function decideValveType(cond) {
    if (cond.negativePressure)
        return 'TRIPLE_EFFECT';
    if (cond.highPoint && cond.lowPressure)
        return 'TRIPLE_EFFECT';
    if (cond.highPoint)
        return 'AIR_RELEASE';
    if (cond.lowPressure && cond.fillingRisk)
        return 'TRIPLE_EFFECT';
    if (cond.nearPump && cond.highPressure)
        return 'ANTI_SURGE';
    return 'AIR_RELEASE';
}
function buildReasons(cond) {
    const reasons = [];
    if (cond.highPoint)
        reasons.push('Punto alto (posible acumulacion de aire)');
    if (cond.lowPressure && (cond.highPoint || cond.negativePressure || cond.fillingRisk)) {
        reasons.push('Presion baja en zona de riesgo -> requiere admision de aire');
    }
    if (cond.negativePressure)
        reasons.push('Riesgo de vacío/colapso');
    if (cond.nearPump && cond.highPressure)
        reasons.push('Posible golpe de ariete cerca de la bomba');
    if (cond.fillingRisk)
        reasons.push('Llenado rápido de tubería (cambio de pendiente)');
    return reasons;
}
function hasRelevantCondition(cond) {
    const lowPressureWithRisk = cond.lowPressure && (cond.highPoint || cond.negativePressure || cond.fillingRisk);
    return cond.highPoint || lowPressureWithRisk || cond.negativePressure || (cond.nearPump && cond.highPressure) || cond.fillingRisk;
}
function getPriority(type) {
    const canonical = toCanonicalType(type);
    if (canonical === 'TRIPLE_EFFECT' || canonical === 'ANTI_SURGE')
        return 'HIGH';
    return 'MEDIUM';
}
function filterRedundantRecommendations(recommendations) {
    const sorted = [...recommendations].sort((a, b) => {
        if (Math.abs(a.chainage - b.chainage) > 1e-6)
            return a.chainage - b.chainage;
        return TYPE_PRIORITY[b.type] - TYPE_PRIORITY[a.type];
    });
    const chainageTolerance = 0.5;
    const merged = [];
    sorted.forEach(rec => {
        const idx = merged.findIndex(existing => Math.abs(existing.chainage - rec.chainage) <= chainageTolerance);
        if (idx === -1) {
            const reasons = rec.reasons && rec.reasons.length > 0 ? rec.reasons : [rec.reason];
            merged.push({ ...rec, reasons, reason: reasons[0] });
            return;
        }
        const existing = merged[idx];
        const existingWeight = TYPE_PRIORITY[existing.type];
        const incomingWeight = TYPE_PRIORITY[rec.type];
        const winner = incomingWeight > existingWeight ? rec : existing;
        const winnerReasons = winner.reasons && winner.reasons.length > 0 ? winner.reasons : [winner.reason];
        const existingReasons = existing.reasons && existing.reasons.length > 0 ? existing.reasons : [existing.reason];
        const incomingReasons = rec.reasons && rec.reasons.length > 0 ? rec.reasons : [rec.reason];
        const mergedReasons = Array.from(new Set([...existingReasons, ...incomingReasons, ...winnerReasons].filter(Boolean)));
        merged[idx] = {
            ...winner,
            reasons: mergedReasons,
            reason: mergedReasons[0] || winner.reason
        };
    });
    return merged.sort((a, b) => a.chainage - b.chainage);
}
/**
 * Detects recommended air valve locations based on pressure profile.
 */
function detectAirValves(profile, totalLength, options) {
    if (!profile || profile.length === 0 || totalLength <= 0)
        return [];
    const cfg = {
        ...DEFAULT_OPTIONS,
        ...options
    };
    const atmosphericBoundaryChainages = new Set();
    if (cfg.atmosphericDischarge) {
        atmosphericBoundaryChainages.add(clamp(totalLength, 0, totalLength));
    }
    (cfg.atmosphericBoundaryChainages || []).forEach(rawChainage => {
        if (!Number.isFinite(rawChainage))
            return;
        atmosphericBoundaryChainages.add(clamp(rawChainage, 0, totalLength));
    });
    const excludedNodeKinds = new Set(cfg.excludedNodeKinds || []);
    const normalizedNodeHints = (cfg.nodeKindHints || [])
        .filter(hint => Number.isFinite(hint.chainage))
        .map(hint => ({
        chainage: clamp(hint.chainage, 0, totalLength),
        kind: hint.kind
    }));
    const inferKindFromLocation = (location) => {
        if (!location)
            return undefined;
        const normalized = location.toLowerCase();
        if (normalized.includes('break_pressure_chamber'))
            return 'break_pressure_chamber';
        if (normalized.includes('outfall'))
            return 'outfall';
        return undefined;
    };
    const isExcludedByNodeKind = (node) => {
        const hinted = normalizedNodeHints.find(hint => Math.abs(hint.chainage - node.chainage) <= cfg.boundaryExclusionDistance);
        const inferred = inferKindFromLocation(node.location);
        const resolvedKind = hinted?.kind || inferred;
        return !!resolvedKind && excludedNodeKinds.has(resolvedKind);
    };
    const isNearAtmosphericBoundary = (chainage) => {
        if (atmosphericBoundaryChainages.size === 0)
            return false;
        for (const boundaryChainage of atmosphericBoundaryChainages) {
            if (Math.abs(chainage - boundaryChainage) <= cfg.boundaryExclusionDistance)
                return true;
        }
        return false;
    };
    const points = profile
        .map((p, idx) => ({
        ...p,
        chainage: normalizeChainage(p, idx, profile.length, totalLength)
    }))
        .sort((a, b) => a.chainage - b.chainage);
    const recommendations = [];
    points.forEach((node, i) => {
        const prev = i > 0 ? points[i - 1] : undefined;
        const next = i < points.length - 1 ? points[i + 1] : undefined;
        // Do not recommend valves at atmospheric/open boundaries (e.g., CRP discharge)
        // nor immediately inside that boundary zone.
        if (isNearAtmosphericBoundary(node.chainage))
            return;
        if (isExcludedByNodeKind(node))
            return;
        const cond = evaluateConditions(node, prev, next, cfg);
        if (!hasRelevantCondition(cond))
            return;
        const type = decideValveType(cond);
        const reasons = buildReasons(cond);
        recommendations.push({
            chainage: node.chainage,
            elevation: node.elevation,
            pressure: node.pressure,
            type,
            priority: getPriority(type),
            reason: reasons[0] || 'Condición hidráulica de ventilación detectada',
            reasons
        });
    });
    return filterRedundantRecommendations(recommendations);
}
