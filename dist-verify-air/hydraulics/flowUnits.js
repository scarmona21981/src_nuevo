"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toM3s = toM3s;
exports.fromM3s = fromM3s;
const LITERS_PER_CUBIC_METER = 1000;
const MINUTES_PER_HOUR = 60;
function toM3s(value, unit) {
    if (!Number.isFinite(value))
        return 0;
    switch (unit) {
        case 'm3/s':
            return value;
        case 'L/s':
            return value / LITERS_PER_CUBIC_METER;
        case 'L/min':
            return value / (LITERS_PER_CUBIC_METER * MINUTES_PER_HOUR);
        default:
            return value;
    }
}
function fromM3s(value, unit) {
    if (!Number.isFinite(value))
        return 0;
    switch (unit) {
        case 'm3/s':
            return value;
        case 'L/s':
            return value * LITERS_PER_CUBIC_METER;
        case 'L/min':
            return value * LITERS_PER_CUBIC_METER * MINUTES_PER_HOUR;
        default:
            return value;
    }
}
