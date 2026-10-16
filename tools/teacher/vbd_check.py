"""Cross-check of the Newton teacher against newton 1.7 SolverVBD (CPU).

Same proxy volume, same Stable Neo-Hookean energy (newton's VBD kernel uses
mu_NH = mu, lam_NH = lam_Lame + mu, alpha = 1 + mu / lam_NH, like snh.py),
same per-tet materials and lumped masses, chest wall / rim kinematic, gravity
g0 on the authored shape as rest shape (forward problem, no ligaments: VBD
has no tension-only springs). VBD is a dynamic solver, so it is driven to
quasi-static equilibrium by kinetic damping; its state is then scored with
the teacher's own residual ||grad E|| / ||f_gravity||.

    python -m tools.teacher.vbd_check --bind web/.cache/changli.bind.json --preset changli
"""

import argparse
import json
import time

import numpy as np

from .bake import load_config
from .bind import BindExport
from .cases import default_loads
from .fem import Model, newton
from .model import gravity_dir, materials
from .volume import build_from_bind


def run(bind, cfg, steps=1000, dt=0.05, iterations=10, damping=0.95, every=250, log=print):
    import newton as nt
    import warp as wp
    wp.config.quiet = True
    wp.set_device('cpu')

    vol, _ = build_from_bind(bind, cfg['volume'])
    mu, lam, rho = materials(vol, cfg)
    model = Model(vol, mu, lam, rho, None)
    model.set_rest(vol.X)
    gdir = gravity_dir(bind.frame, cfg)
    model.set_loads(**default_loads(cfg, gdir))
    f_ref = float(np.linalg.norm(model.f_ext.ravel()[model.free_dof]))
    t = time.time()
    x_ref, info = newton(model, vol.X.copy(), f_ref=f_ref)
    t_newton = time.time() - t
    log(f'newton: residual {info["residual"]:.2e} in {info["iterations"]} iterations, {t_newton:.1f}s')

    # Units: S = 1, tissue mu = 1, rho = 1 -> gravity acceleration = g0.
    g0 = cfg['dials']['gravity']
    b = nt.ModelBuilder(gravity=tuple(float(v) for v in g0 * gdir))
    m = model.lumped_mass()
    m[vol.fixed] = 0.0  # kinematic
    b.add_particles(pos=[tuple(p) for p in vol.X], vel=[(0.0, 0.0, 0.0)] * len(vol.X), mass=m.tolist())
    for (i, j, k, l), mu_t, lam_t in zip(vol.tets, mu, lam):
        b.add_tetrahedron(int(i), int(j), int(k), int(l), k_mu=float(mu_t), k_lambda=float(lam_t - mu_t), k_damp=0.0)
    b.color()
    sim = b.finalize(device='cpu')
    s0, s1 = sim.state(), sim.state()
    ctrl = sim.control()
    solver = nt.solvers.SolverVBD(sim, iterations=iterations)
    hist = []
    t = time.time()
    for n in range(1, steps + 1):
        s0.clear_forces()
        solver.step(s0, s1, ctrl, None, dt)
        s0, s1 = s1, s0
        s0.particle_qd.assign(s0.particle_qd.numpy() * damping)
        if n % every == 0 or n == steps:
            q = s0.particle_q.numpy().astype(float)
            r = float(np.linalg.norm(model.gradient(q).ravel()[model.free_dof]) / f_ref)
            d = float(np.linalg.norm(q - x_ref, axis=1).max())
            drift = float(np.linalg.norm(q[vol.fixed] - vol.X[vol.fixed], axis=1).max())
            hist.append({'step': n, 'residual': r, 'max_diff_to_newton_S': d, 'fixed_drift_S': drift, 'seconds': time.time() - t})
            log(f'vbd step {n}: residual {r:.2e}, max |x_vbd - x_newton| {d:.2e} S, fixed drift {drift:.1e}, {time.time() - t:.1f}s')
    sag = float(np.linalg.norm(x_ref - vol.X, axis=1).max())
    return {'newton': {'residual': info['residual'], 'iterations': info['iterations'], 'seconds': t_newton, 'max_sag_S': sag},
            'vbd': hist, 'dt': dt, 'iterations': iterations, 'damping': damping}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--bind', required=True)
    ap.add_argument('--preset')
    ap.add_argument('--config')
    ap.add_argument('--steps', type=int, default=1000)
    ap.add_argument('--dt', type=float, default=0.05)
    ap.add_argument('--out', help='write the result JSON here')
    a = ap.parse_args(argv)
    res = run(BindExport.load(a.bind), load_config(a.preset, a.config), steps=a.steps, dt=a.dt)
    if a.out:
        with open(a.out, 'w') as f:
            json.dump(res, f, indent=1)


if __name__ == '__main__':
    main()
