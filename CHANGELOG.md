# Changelog

## [v24.beta] - 2026-02-22

### Added - Método de Dimensionamiento para Tramos COLECTOR

#### Modelo de Datos
- `Pipe.designOptions.collectorSizingMode`: Nuevo campo para seleccionar método de dimensionamiento
  - `"UEH_Qww"`: Usa caudal acumulado Qww desde UEH/artefactos aguas arriba (default)
  - `"POBLACION_NCH1105"`: Usa cálculo por población según NCh1105
- `Pipe.designOptions.population`: Parámetros de población (P, D, R, C)

#### Motor de Cálculo (`src/utils/designFlowCalculator.ts`)
- Implementación de fórmula Harmon: `M = 1 + 14/(4 + sqrt(P/1000))` para P >= 1000
- Tabla BSCE (Anexo A) para P < 100 (equivalente a 20 casas = 3.6 L/s)
- Interpolación lineal para 100 <= P < 1000
- Cálculo de QmdAS = (P × D × R × C) / 86400 [L/s]
- Función `getDesignFlow(edge)` centralizada para determinar caudal usado por tramo

#### UI (PropertiesPanel.tsx)
- Selector de método de dimensionamiento para tramos con rol COLECTOR_EXTERIOR
- Inputs para parámetros de población (P, D, R, C) con validación suave:
  - P > 0 (habitantes)
  - D > 0 (L/hab/d)
  - 0 < R <= 1.0 (advertencia si > 1)
  - C >= 1 (advertencia si < 1)
- Preview en tiempo real del Q calculado
- Visualización informativa de Qww acumulado

#### Tablas (RolNormativoTableView.tsx)
- Columna "Método" con badge diferenciado:
  - `MANNING`: Método hidráulico estándar
  - `POBLACION`: Método por población NCh1105 (estilo verde distintivo)
- Columnas adicionales para tramos COLECTOR:
  - Población total
  - Población tributaria
  - Método de flujo (HARMON/BSCE/INTERPOLACION)
  - Coeficiente M de Harmon

#### Compatibilidad y Migración
- Proyectos antiguos sin `designOptions`: Se asigna default `"UEH_Qww"` para COLECTOR
- No se mezclan caudales: El motor elige un único Q_used según el modo seleccionado
- Los roles INTERIOR_RAMAL y DESCARGA_HORIZ mantienen su lógica actual sin cambios

### Technical Notes

```
NCh1105 Flow Calculation Formula:
1. QmdAS = (P × D × R × C) / 86400  [L/s]
   
   Donde:
   - P = Población (habitantes)
   - D = Dotación (L/hab/día)
   - R = Coeficiente de recuperación (0-1)
   - C = Factor de capacidad (>= 1)

2. Para P >= 1000:
   M = 1 + 14/(4 + sqrt(P/1000))  [Harmon]
   Qmax = M × QmdAS

3. Para P < 100:
   Usar tabla BSCE (Anexo A)
   20 casas ≈ 3.6 L/s

4. Para 100 <= P < 1000:
   Interpolación lineal entre BSCE(20 casas) y Harmon(1000)
```
