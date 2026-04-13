# Inventory de tablas migradas a ResultsDock

| Componente | Tabla / Vista | Render anterior | Destino en Dock |
|---|---|---|---|
| `ResultsView` | Resultados generales por tramo (gravedad) | Overlay flotante en `Workspace.tsx` | `Resultados` |
| `PressureResultsView` | Resultados de impulsion (tablas de verificacion hidraulica) | Overlay modal full-screen en `Workspace.tsx` | `Resultados`, `Impulsion`, `Resumen` |
| `NewHydraulicCalculationTable` | Calculo hidraulico por gravedad | Modal (`modal-overlay`) en `Workspace.tsx` | `Gravedad` |
| `CameraTable` | Tabla de camaras | Ventana flotante fija y draggable en `Workspace.tsx` | `Camaras` |
| `NormativeEvaluationContent` (en `ResultsDock`) | Verificacion normativa NCh/RIDAA por tramo | Parcial y no unificada con el resto | `Verificacion` |
| `NchVerificationView` (usada por presion) | Verificacion NCh 2472 / camara humeda | Dentro de overlay de `PressureResultsView` | `Verificacion` y `Camara Humeda` (tabla unificada en dock) |
| `RolNormativoTableView` | Planilla normativa extendida (legacy) | Modal independiente (no integrado al flujo principal) | Consolidada en `Verificacion` (legacy deshabilitado del flujo principal) |
| *(nuevo en Dock)* | Tabla de bombas | No existia como tab unificada | `Bombas` |
| *(nuevo en Dock)* | Resumen ejecutivo | No existia como tab unificada | `Resumen` |
