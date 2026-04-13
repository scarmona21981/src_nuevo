"use strict";
/**
 * Pump Head (Hb) Calculation Engine
 *
 * Implements the Extended Bernoulli Equation for Pumping Systems:
 * Hb = (Z3 - Z1) + V3²/2g + Σhf + Σhm
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnergyBalanceSolver = void 0;
const lossModule_1 = require("./lossModule");
// Constants
const G = 9.81;
class EnergyBalanceSolver {
    /**
     * Compute the Total Dynamic Head (Hb) required for the system
     * @param input System geometry and hydraulic data
     */
    computeRequiredPumpHead(input) {
        const { z1, z3, flow, method, sections } = input;
        const warnings = [];
        // 1. Static Head
        const staticHead = z3 - z1;
        if (staticHead < 0) {
            warnings.push(`Static head is negative (${staticHead.toFixed(2)} m). Gravity flow might be possible.`);
        }
        let totalFrictionLoss = 0;
        let totalMinorLoss = 0;
        const sectionResults = [];
        // 2. Losses per section
        sections.forEach((section, index) => {
            const { length, internalDiameter, roughness, fittings } = section;
            // Velocity
            const velocity = (0, lossModule_1.calculateVelocity)(flow, internalDiameter);
            // Friction Loss
            let hf = 0;
            let reynolds = 0;
            if (method === 'HAZEN_WILLIAMS') {
                // roughness is C-Hazen
                hf = (0, lossModule_1.hazenWilliamsLoss)(flow, roughness, internalDiameter, length);
            }
            else {
                const kinematicViscosity = 1.004e-6; // Water at 20°C
                reynolds = (velocity * internalDiameter) / kinematicViscosity;
                hf = (0, lossModule_1.darcyWeisbachLoss)(flow, roughness, internalDiameter, length);
            }
            // Minor Losses
            const expandedKFittings = fittings.flatMap(fit => {
                const count = Math.max(0, Math.floor(fit.count || 0));
                return Array.from({ length: count }, () => ({ description: fit.type, K: fit.k }));
            });
            const hm = (0, lossModule_1.singularLosses)(flow, internalDiameter, expandedKFittings);
            totalFrictionLoss += hf;
            totalMinorLoss += hm;
            sectionResults.push({
                diameter: internalDiameter,
                length,
                velocity,
                frictionLoss: hf,
                minorLoss: hm,
                reynolds: method === 'DARCY_WEISBACH' ? reynolds : undefined
            });
        });
        // 3. Velocity Head at Discharge
        // Uses the parameters of the LAST section (assuming discharge is at the end of the last pipe)
        let velocityHead = 0;
        if (sections.length > 0) {
            const lastV = sectionResults[sectionResults.length - 1].velocity;
            // V3²/2g
            velocityHead = Math.pow(lastV, 2) / (2 * G);
        }
        // 4. Total Head
        const Hb = staticHead + totalFrictionLoss + totalMinorLoss + velocityHead;
        return {
            Hb,
            staticHead,
            frictionLoss: totalFrictionLoss,
            minorLoss: totalMinorLoss,
            velocityHead,
            sections: sectionResults,
            warnings
        };
    }
}
exports.EnergyBalanceSolver = EnergyBalanceSolver;
