# Dynamic Phasor Helix

**A 3D visualization of control system stability that unifies Bode, Nyquist, and time-domain analysis into a single geometric object.**

*Sanjin Redzic B.Sc.*  
*Bergen, Norway — March 2026*

---

## Motivation

The classical tools for analyzing feedback stability — Bode plots (1930s) and Nyquist plots (1940s) — are two-dimensional projections of a higher-dimensional object. The Bode plot decomposes the loop transfer function phasor into magnitude and phase, plotted separately against frequency. The Nyquist plot traces the phasor tip through the complex plane, parameterized by frequency. The step response shows amplitude against time. Each representation discards a dimension that the others retain.

This project introduces the **Dynamic Impedance Phasor Helix**: the phase portrait (state variable and its derivative) extruded along a time axis, forming a three-dimensional spiral. The helix encodes magnitude (radius), phase (rotation), damping (collapse rate), and temporal evolution simultaneously. A **stability envelope** — derived from a reference system's decay profile — provides a geometric boundary: the helix must stay inside the funnel. If it breaks through, stability margins have been exceeded and the system becomes unstable/collapses.

The key observation is that the Bode plot, Nyquist plot, and step response are all projections of this helix:

- **View from above** (time axis collapsed) → Nyquist plot: the phasor curve in the complex plane.
- **View from the side** (complex plane collapsed) → Step response envelope: amplitude vs. time.
- **Magnitude and phase read separately at each height** → Bode plot information: gain and phase vs. frequency.

The human visual system processes three-dimensional spatial relationships natively. A spiral collapsing inside a funnel communicates stability without requiring the viewer to cross-reference two separate 2D graphs or mentally track encirclement of a critical point which can be difficult.

## Contents

The repository contains four interactive visualization tools, all implementing the same underlying mathematics with different parameterizations:

| Tool | File | Domain | Parameters |
|------|------|--------|------------|
| **Bode & Nyquist** | `lfc-bode-nyquist.jsx` | Power system LFC | H, D, R, Tg, Tt, Ki |
| **LFC Helix** | `dynamic-phasor-helix.jsx` | Power system LFC | H, D, R, Tg, Tt, Ki |
| **RLC Helix** | `rlc-helix.jsx` | Series RLC circuit | L, R, C, V_step |
| **Bode (original)** | `bode-lfc.jsx` | Power system LFC | H, D, R, Tg, Tt, Ki |

All tools are React components (`.jsx`) designed to run in browser-based environments. Parameters are adjustable via interactive sliders with real-time updates.

## The Model

### Power System Load Frequency Control (LFC)

Based on the single-area model from Kundur [1], Ch. 11–12. The open-loop transfer function is:

```
L(s) = [1/R + Ki/s] · 1/(1 + s·Tg) · 1/(1 + s·Tt) · 1/(2Hs + D)
```

Where:

| Parameter | Physical meaning | Analogous to |
|-----------|-----------------|--------------|
| **H** | Inertia constant [s] — kinetic energy of rotating mass normalized to rated power | Inductance L |
| **D** | Load damping coefficient [pu] — frequency-dependent load response | Resistance R |
| **R** | Droop [pu] — governor proportional gain = 1/R | 1/Capacitance |
| **Tg** | Governor time constant [s] — servo actuator (wicket gates, steam valve) | — |
| **Tt** | Turbine time constant [s] — prime mover response (water starting time, steam path) | — |
| **Ki** | AGC integral gain — secondary frequency control | — |

### Series RLC Circuit

The transfer function for capacitor voltage step response:

```
H(s) = ωn² / (s² + 2ζωn·s + ωn²)
```

Where:

```
ωn = 1/√(LC)          Natural frequency
ζ  = (R/2)·√(C/L)     Damping ratio
σ  = -ζ·ωn            Decay rate (real part of dominant pole)
ωd = ωn·√(1 - ζ²)     Damped natural frequency
```

The mathematical structure is identical to the LFC model. Only the labels change.

## Parameter Mapping

The following analogy holds between the two domains:

| Circuit | Grid | Role |
|---------|------|------|
| L (inductance) | 2H (inertia) | Resists changes in the state variable |
| R (resistance) | D (damping) | Dissipates oscillation energy |
| 1/C (elastance) | 1/R (droop gain) | Restoring force toward equilibrium |
| Vc (capacitor voltage) | Δf (frequency deviation) | State variable |
| V_step (applied voltage) | ΔP_load (power disturbance) | Forcing function |
| dVc/dt (current through C) | dΔf/dt (ROCOF) | Rate of change |

This is not metaphorical. The differential equations are identical. The same helix describes both systems.

## The Helix Construction

1. **Simulate** the step response using 4th-order Runge-Kutta integration.
2. **Construct the phase portrait**: plot the state variable deviation against its time derivative at each time step.
3. **Extrude along time**: the phase portrait point at each instant becomes a point in 3D space (x = state deviation, y = derivative, z = time).
4. **The trajectory forms a helix**: an underdamped system spirals inward as it rises; an overdamped system descends without rotation; an unstable system spirals outward.
5. **Overlay the stability envelope**: circular cross-sections at each time step whose radii are derived from a reference system's decay profile. The helix must remain within this funnel.

## The Stability Envelope

The envelope is derived from a fixed reference system — a conventional well-damped system (H = 6s for LFC, ζ = 1/√2 for RLC). It represents the expected recovery profile of a known-good system. The current system's helix is compared against this fixed boundary:

- **Inside the envelope**: the system recovers within acceptable margins.
- **Initial overshoot beyond envelope**: expected for lower-inertia systems — not a stability problem if the helix subsequently collapses.
- **Sustained exceedance in the tail**: the system is recovering too slowly or oscillating beyond design limits.
- **Expanding helix**: the system is unstable — the spiral grows with each revolution.

The closed-loop pole locations are computed numerically via the Durand-Kerner method applied to the characteristic polynomial. The dominant pole's real part σ, damping ratio ζ, and damped natural frequency ωd are displayed alongside the helix.

## Context: The Iberian Blackout

On 28 April 2025, the Iberian Peninsula experienced a complete power blackout — the most severe in Europe in over two decades. The ENTSO-E Expert Panel Final Report (published 20 March 2026) [2] concluded that the blackout resulted from multiple interacting factors, including gaps in voltage and reactive power control, differences in voltage regulation practices, and the inability of real-time monitoring to detect the developing cascade.

At the time of the event, renewable sources accounted for 78% of electricity generation in the Iberian system, with solar alone contributing nearly 60% [3]. The majority of solar capacity used grid-following inverters providing no frequency-responsive behavior.

The helix visualization illustrates the underlying dynamics: when system inertia H is low and load damping D is eroded (as occurs when synchronous machines are replaced by inverter-based resources and DOL motors are replaced by VSDs), the helix expands beyond the stability envelope. The correction vectors arrive with incorrect phase alignment — the push arrives when the swing is returning. Constructive reinforcement of the disturbance replaces the intended damping.

The tools in this repository were developed on the same day the ENTSO-E final report was published.

## Relation to Prior Work

**2D phase portraits** are classical (Poincaré, 1880s) and appear in every dynamics textbook. Spiral sinks, sources, centers, and saddle points are well-characterized.

**3D phase portraits** exist for three-state systems (e.g., the Lorenz attractor), where three state variables are plotted against each other. These use three spatial dimensions but do not include time as an explicit axis.

**Phase portrait with time axis** has been implemented in neuroscience visualization tools (e.g., DataView, St Andrews) for displaying membrane potential dynamics as spirals. These are data visualization tools without stability envelopes or control system application.

**Phase portrait envelope control** has been explored in vehicle dynamics (Bobier, Stanford, 2012) [4] for stability boundaries in the yaw rate–sideslip plane. This is 2D with adaptive boundaries, not 3D with time.

**The specific combination presented here** — a phase portrait extruded along a time axis with a reference-derived stability envelope, applied to control system analysis, with the explicit framing as a unification of Bode/Nyquist/step-response projections — does not appear in the published literature surveyed as of March 2026.

## How to Use

The `.jsx` files are React components. They can be rendered in any React environment or in platforms that support JSX artifacts (e.g., Claude.ai).

### LFC Helix — Suggested Experiments

**Norwegian hydro grid (baseline):**
H = 3.5, D = 0.8, R = 0.05, Tg = 0.3, Tt = 1.5, Ki = 0.03, AGC on

**High-IBR grid (low inertia):**
H = 1.0, D = 0.3, R = 0.05, Tg = 0.05, Tt = 0.1, Ki = 0.05, AGC on

**Observe:** the helix expands beyond the envelope when H and D are reduced. Faster governor (Tg) and turbine (Tt) response partially compensate but cannot replace the lost inertia without coordinated control.

### RLC Helix — Verification Cases

All cases: L = 0.01 H, C = 0.001 F. Only R varies.

| Case | R [Ω] | ζ | ωn [rad/s] | Behavior |
|------|--------|---|------------|----------|
| Underdamped | 2.0 | 0.316 | 316.2 | Spiraling helix |
| Butterworth (ζ = 1/√2) | 4.472 | 0.707 | 316.2 | Matches reference envelope |
| Critically damped | 6.325 | 1.000 | 316.2 | Straight collapse, no spiral |
| Overdamped | 20.0 | 3.162 | 316.2 | Slow descent, no rotation |

## References

[1] P. Kundur, *Power System Stability and Control*, McGraw-Hill/EPRI, 1994. Chapters 11–12: Control of Active Power and Reactive Power.

[2] ENTSO-E Expert Panel, "Grid Incident in Spain and Portugal on 28 April 2025 — ICS Investigation Final Report," published 20 March 2026. Available: https://www.entsoe.eu/publications/blackout/28-april-2025-iberian-blackout/

[3] R. Bajo-Buenestado, "The Iberian Peninsula Blackout — Causes, Consequences, and Challenges Ahead," Rice University Baker Institute for Public Policy, May 2025.

[4] C. G. Bobier, "A Phase Portrait Approach to Vehicle Stabilization and Envelope Control," PhD Thesis, Stanford University, Dynamic Design Lab, 2012.

[5] H. W. Bode, "Relations between attenuation and phase in feedback amplifier design," *Bell System Technical Journal*, vol. 19, no. 3, pp. 421–454, July 1940.

[6] H. Nyquist, "Regeneration theory," *Bell System Technical Journal*, vol. 11, no. 1, pp. 126–147, January 1932.

[7] UCTE/ENTSO-E, "Operation Handbook — Policy 1: Load-Frequency Control and Performance," Appendix 1.

## License

MIT License.

This repository constitutes dated prior art for the Dynamic Phasor Helix visualization concept and the stability envelope framework.

## Author

**Sanjin Redzic B.Sc.**  
Bergen, Norway  
GitHub: [ninjas1337](https://github.com/ninjas1337)

---

*"You can't control what you can't sample."*
