"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DESIGN_METHOD_OPTIONS = exports.DESIGN_METHOD_LABELS = exports.PIPE_ROLE_METHOD_LABELS = exports.PIPE_ROLE_LABELS = exports.PIPE_ROLE_OPTIONS = exports.DESCARGA_HORIZ_VERIFICATION_SHORT_LABELS = exports.DESCARGA_HORIZ_VERIFICATION_METHOD_LABELS = exports.DESCARGA_HORIZ_VERIFICATION_METHOD_OPTIONS = void 0;
exports.getDefaultVerificationMethodForDescarga = getDefaultVerificationMethodForDescarga;
exports.resolveDescargaHorizVerificationMethod = resolveDescargaHorizVerificationMethod;
exports.resolveEffectivePipeRole = resolveEffectivePipeRole;
exports.resolveEffectiveTopologyRegime = resolveEffectiveTopologyRegime;
exports.resolveEffectiveTopologyRole = resolveEffectiveTopologyRole;
exports.isPipeRole = isPipeRole;
exports.normalizePipeRole = normalizePipeRole;
exports.mapLegacyPipeTypeToRole = mapLegacyPipeTypeToRole;
exports.inferPipeRoleFromNodeTypes = inferPipeRoleFromNodeTypes;
exports.getDefaultDesignMethodForRole = getDefaultDesignMethodForRole;
exports.resolveDesignMethod = resolveDesignMethod;
exports.getDesignMethodLabel = getDesignMethodLabel;
exports.isDesignMethod = isDesignMethod;
exports.DESCARGA_HORIZ_VERIFICATION_METHOD_OPTIONS = ['A3_TABLA', 'B25_MANNING'];
exports.DESCARGA_HORIZ_VERIFICATION_METHOD_LABELS = {
    A3_TABLA: 'Anexo A – Tabla A.3 (recomendado)',
    B25_MANNING: 'Anexo B – B.2.5 (Manning)'
};
exports.DESCARGA_HORIZ_VERIFICATION_SHORT_LABELS = {
    A3_TABLA: 'A3_TABLA',
    B25_MANNING: 'B25_MANNING'
};
function getDefaultVerificationMethodForDescarga() {
    return 'A3_TABLA';
}
function resolveDescargaHorizVerificationMethod(pipe) {
    return pipe?.verificationMethod ?? 'A3_TABLA';
}
exports.PIPE_ROLE_OPTIONS = [
    'INTERIOR_RAMAL',
    'DESCARGA_HORIZ',
    'COLECTOR_EXTERIOR'
];
exports.PIPE_ROLE_LABELS = {
    INTERIOR_RAMAL: 'INTERIOR_RAMAL',
    DESCARGA_HORIZ: 'DESCARGA_HORIZ',
    COLECTOR_EXTERIOR: 'COLECTOR_EXTERIOR'
};
exports.PIPE_ROLE_METHOD_LABELS = {
    INTERIOR_RAMAL: 'UEH (NCh3371 Anexo A)',
    DESCARGA_HORIZ: 'Manning (NCh3371 Anexo B.2.5)',
    COLECTOR_EXTERIOR: 'Manning (NCh1105)'
};
exports.DESIGN_METHOD_LABELS = {
    NCH3371_A: 'NCh3371 · Anexo A (Tabla 3)',
    NCH3371_B: 'NCh3371 · Anexo B.2.5 (Manning)'
};
exports.DESIGN_METHOD_OPTIONS = [
    { value: 'AUTO', label: 'AUTO' },
    { value: 'NCH3371_B', label: 'Anexo B (B.2.5 / Manning)' },
    { value: 'NCH3371_A', label: 'Anexo A (Tabla 3)' }
];
function resolveEffectivePipeRole(pipe) {
    if (!pipe)
        return 'DESCARGA_HORIZ';
    return (pipe.effective?.pipeRole ??
        pipe.auto?.pipeRole ??
        pipe.pipeRole ??
        'DESCARGA_HORIZ');
}
function resolveEffectiveTopologyRegime(pipe) {
    if (!pipe)
        return 'NCH3371';
    return (pipe.effective?.topologyRegime ??
        pipe.auto?.topologyRegime ??
        'NCH3371');
}
function resolveEffectiveTopologyRole(pipe) {
    if (!pipe)
        return 'RAMAL_CONEXION';
    return (pipe.effective?.topologyRole ??
        pipe.auto?.topologyRole ??
        'RAMAL_CONEXION');
}
function isPipeRole(value) {
    return value === 'INTERIOR_RAMAL' || value === 'DESCARGA_HORIZ' || value === 'COLECTOR_EXTERIOR';
}
function normalizePipeRole(value) {
    if (isPipeRole(value))
        return value;
    if (typeof value === 'string') {
        const trimmed = value.trim().toUpperCase();
        if (isPipeRole(trimmed))
            return trimmed;
        if (trimmed === 'INTERIOR' || trimmed === 'RAMAL_INTERIOR')
            return 'INTERIOR_RAMAL';
        if (trimmed === 'DESCARGA' || trimmed === 'HORIZONTAL')
            return 'DESCARGA_HORIZ';
        if (trimmed === 'COLECTOR' || trimmed === 'EXTERIOR')
            return 'COLECTOR_EXTERIOR';
    }
    return undefined;
}
function mapLegacyPipeTypeToRole(pipeType) {
    if (typeof pipeType !== 'string')
        return undefined;
    const normalized = pipeType.toLowerCase();
    if (normalized.includes('colector') || normalized.includes('public')) {
        return 'COLECTOR_EXTERIOR';
    }
    if (normalized.includes('domiciliario')) {
        return 'INTERIOR_RAMAL';
    }
    return undefined;
}
function inferPipeRoleFromNodeTypes(startChamberType, endChamberType) {
    if (startChamberType === 'Domiciliaria' && endChamberType === 'Domiciliaria') {
        return 'INTERIOR_RAMAL';
    }
    if (startChamberType === 'Pública' && endChamberType === 'Pública') {
        return 'COLECTOR_EXTERIOR';
    }
    if ((startChamberType === 'Domiciliaria' && endChamberType === 'Pública')
        || (startChamberType === 'Pública' && endChamberType === 'Domiciliaria')) {
        return 'DESCARGA_HORIZ';
    }
    return 'DESCARGA_HORIZ';
}
function getDefaultDesignMethodForRole(pipeRole) {
    switch (pipeRole) {
        case 'DESCARGA_HORIZ':
            return 'NCH3371_B';
        case 'INTERIOR_RAMAL':
        case 'COLECTOR_EXTERIOR':
        default:
            return null;
    }
}
function resolveDesignMethod(pipe, pipeRole) {
    if (pipe?.designMethod) {
        return pipe.designMethod;
    }
    return getDefaultDesignMethodForRole(pipeRole);
}
function getDesignMethodLabel(method) {
    if (!method)
        return 'N/D';
    return exports.DESIGN_METHOD_LABELS[method];
}
function isDesignMethod(value) {
    return value === 'NCH3371_A' || value === 'NCH3371_B';
}
