# SMCALC -- System State (Source of Truth)

## 1. Purpose

SMCALC is an engineering software for sanitary and hydraulic analysis of
wastewater systems used in industrial facilities and temporary works
(faenas).

The software has two completely different calculation worlds:

-   **Sanitary Design (Normative)** → verifies compliance with Chilean
    regulations
-   **Hydraulic Simulation (Physical)** → predicts real behavior of the
    system

They MUST NEVER be mixed.

------------------------------------------------------------------------

## 2. Calculation Worlds

### 2.1 Sanitary Design Mode

Used for project approval (SEREMI / RCA / sanitary reports)

Inputs: - Population (DS594) - Water consumption (dotación) - Recovery
coefficient - Peak factor - UEH / Hunter (optional depending on fixture
info)

Output: - Qmedio - Qmáx horario - Design flow (Qd)

Rules: - Works with Qin (design flow) - Normative compliance required -
Conservative assumptions allowed - Used to size pipes and treatment
capacity

This mode DOES NOT simulate physics.

------------------------------------------------------------------------

### 2.2 Hydraulic Simulation Mode

Used to understand real operation of the system.

Inputs: - Geometry - Elevations - Pipe roughness - Pump curve - Wet well
levels

Output: - Real operating flow (Q\*) - HGL / EGL - Pressures - System
curve - Operating point pump vs system

Rules: - Uses physical equilibrium only - No regulatory safety factors -
No peak factor - No sanitary coefficients - Only energy conservation

This mode DOES NOT validate regulations.

------------------------------------------------------------------------

## 3. Flow Definitions

Qin = Design flow (imposed by sanitary calculation)\
Q\* = Physical flow (result of hydraulic equilibrium)

Golden Rule: Hydraulic simulation solves Q\* Sanitary design imposes Qin

Never force Q\* = Qin

------------------------------------------------------------------------

## 4. System Elements

### 4.1 Gravity Network

Calculated with Manning equation

### 4.2 Wet Well (Cámara Húmeda)

Role: - Hydraulic node - Provides suction head to pump - Defines
starting water level

NOT a storage for simulation unless dynamic mode exists

### 4.3 Pump

Defined by characteristic curve H(Q)

Operating point: Intersection: Pump curve = System curve

### 4.4 Rising Main (Impulsión)

Energy equation applied:

Hsystem(Q) = Static head + friction losses + singular losses

### 4.5 Break Pressure Chamber (Cámara Rompe Presión)

Boundary condition: Pressure = atmospheric

Resets HGL

Never accumulates energy

------------------------------------------------------------------------

## 5. Air Valves

Do not modify hydraulic solution. They only validate admissibility of
negative pressure.

------------------------------------------------------------------------

## 6. What the software must NEVER do

-   Use sanitary peak factor in hydraulic simulation
-   Force pump flow to match design flow
-   Mix UEH with energy equation
-   Use population inside hydraulic solver
-   Apply regulatory criteria to physical results

------------------------------------------------------------------------

## 7. Expected Outputs

Sanitary Mode: Compliance verification

Hydraulic Mode: Operational diagnosis

They may disagree and that is correct engineering behavior.

------------------------------------------------------------------------

## 8. Engineering Philosophy

Sanitary design answers: "Is the project approvable?"

Hydraulic simulation answers: "Will the system actually work?"

Both are required. Neither replaces the other.
