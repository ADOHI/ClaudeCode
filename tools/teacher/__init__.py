"""Teacher A: quasi-static hyperelastic bake of bust target displacements.

Pipeline (docs/research/decision-v2.md section 3(a)):

    bust-bind/1 export --> height-map proxy volume (volume.py)
        --> inverse rest shape under default gravity (inverse.py)
        --> load cases from <= 8 physics dials (cases.py, solver.py)
        --> teacher samples (P, U, weights, kind) + vibration modes (export.py, modal.py)

Everything internal works in the body frame of the export, scaled by S
(shoulder width), with the tissue shear modulus as the stress unit.
"""

FORMAT = 'bust-teacher/1'
