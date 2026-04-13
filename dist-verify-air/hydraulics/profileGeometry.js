"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PIPE_COVER_M = void 0;
exports.resolvePipeCoverMeters = resolvePipeCoverMeters;
exports.resolveOutsideDiameterMeters = resolveOutsideDiameterMeters;
exports.buildTerrainPolyline = buildTerrainPolyline;
exports.interpolateTerrainFromPolyline = interpolateTerrainFromPolyline;
exports.interpolatePipeElevationFromTerrain = interpolatePipeElevationFromTerrain;
exports.DEFAULT_PIPE_COVER_M = 1.0;
const CHAINAGE_EPS = 1e-6;
function finiteOrUndefined(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function finiteOr(value, fallback) {
    const parsed = finiteOrUndefined(value);
    return parsed ?? fallback;
}
function clamp(value, min, max) {
    if (!Number.isFinite(value))
        return min;
    return Math.max(min, Math.min(max, value));
}
function resolvePipeCoverMeters(value) {
    if (Number.isFinite(value) && value >= 0)
        return value;
    return exports.DEFAULT_PIPE_COVER_M;
}
function resolveOutsideDiameterMeters(diameter_mm, outsideDiameter_m) {
    if (Number.isFinite(outsideDiameter_m) && outsideDiameter_m > 0) {
        return outsideDiameter_m;
    }
    if (Number.isFinite(diameter_mm) && diameter_mm > 0) {
        return diameter_mm / 1000;
    }
    return 0;
}
function buildTerrainPolyline(options) {
    const length = Math.max(0, finiteOr(options.length, 0));
    const startTerrain = finiteOr(options.zStartTerrain, finiteOr(options.zStartApprox, 0));
    const endTerrain = finiteOr(options.zEndTerrain, finiteOr(options.zEndApprox, startTerrain));
    const points = [
        { chainage: 0, elevation: startTerrain },
        ...((options.profilePoints || [])
            .map(point => ({
            chainage: clamp(finiteOr(point?.chainage, 0), 0, length),
            elevation: finiteOr(point?.elevation, Number.NaN),
            id: point?.id
        }))
            .filter(point => Number.isFinite(point.elevation))),
        { chainage: length, elevation: endTerrain }
    ]
        .sort((a, b) => a.chainage - b.chainage);
    const deduped = [];
    points.forEach(point => {
        const last = deduped[deduped.length - 1];
        if (last && Math.abs(last.chainage - point.chainage) <= CHAINAGE_EPS) {
            deduped[deduped.length - 1] = point;
            return;
        }
        deduped.push(point);
    });
    if (deduped.length === 0) {
        return [{ chainage: 0, elevation: startTerrain }];
    }
    return deduped;
}
function interpolateTerrainFromPolyline(chainage, polyline, length) {
    if (!polyline || polyline.length === 0)
        return 0;
    const maxX = Math.max(0, finiteOr(length, 0));
    const x = clamp(finiteOr(chainage, 0), 0, maxX);
    if (x <= polyline[0].chainage)
        return polyline[0].elevation;
    if (x >= polyline[polyline.length - 1].chainage)
        return polyline[polyline.length - 1].elevation;
    for (let index = 0; index < polyline.length - 1; index += 1) {
        const from = polyline[index];
        const to = polyline[index + 1];
        if (x < from.chainage || x > to.chainage)
            continue;
        const span = to.chainage - from.chainage;
        if (span <= CHAINAGE_EPS)
            return to.elevation;
        const ratio = (x - from.chainage) / span;
        return from.elevation + ratio * (to.elevation - from.elevation);
    }
    return polyline[polyline.length - 1].elevation;
}
function interpolatePipeElevationFromTerrain(chainage, options) {
    const length = Math.max(0, finiteOr(options.length, 0));
    const polyline = buildTerrainPolyline(options);
    const terrainElevation = interpolateTerrainFromPolyline(chainage, polyline, length);
    const cover = resolvePipeCoverMeters(finiteOrUndefined(options.cover_m));
    const od_m = resolveOutsideDiameterMeters(finiteOrUndefined(options.diameter_mm), finiteOrUndefined(options.outsideDiameter_m));
    const isInvert = options.reference === 'invert';
    const offset = cover + (isInvert ? od_m : (od_m / 2));
    return terrainElevation - offset;
}
