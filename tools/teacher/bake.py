"""Teacher A bake: bust-bind/1 -> teacher samples for every target + modes.

    python -m tools.teacher.bake --bind web/.cache/changli.bind.json \
        --preset changli --out web/.cache/teacher/changli

Writes <out>/<target>.npz, <out>/modes.npz and <out>/meta.json
(format: tools/teacher/README.md).
"""

import argparse
import json
import os
import sys
import time

import numpy as np

from . import FORMAT
from .bind import BindExport
from .cases import (DEFAULT_CONFIG, DIAL_NAMES, PRESETS, case_loads, check_dials, default_loads, merge,
                    prescribed_tissue_volume)
from .fem import newton
from .inverse import inverse_rest
from .modal import describe, modes, physical
from .model import build_model, gravity_dir
from .samples import KINDS, SampleSet
from .volume import MATERIAL_NAMES, build_from_bind


def _edges(X, tets):
    a = X[tets[:, 0]]
    return np.stack([X[tets[:, k]] - a for k in (1, 2, 3)], axis=2)


def solve_case(model, x_def, name, cfg, vol, gdir, log=None):
    """Equilibrium of target `name`, by load continuation from the default
    equilibrium. Returns x and per-step Newton infos."""
    steps = cfg['solver']['steps']
    x = x_def.copy()
    infos = []
    for k in range(1, steps + 1):
        model.set_loads(**case_loads(name, cfg, vol, gdir, alpha=k / steps))
        x, info = newton(model, x, tol=cfg['solver']['tol'], maxit=cfg['solver']['maxit'])
        infos.append(info)
        if log:
            log(f'    step {k}/{steps}: newton {info["iterations"]}, residual {info["residual"]:.2e}, min det F {info["min_det"]:.3f}')
    return x, infos


def bake(bind, cfg, out_dir=None, targets=None, with_modes=True, log=print):
    t_all = time.time()
    cpu_all = time.process_time()
    check_dials(cfg['dials'])
    stats = {'format': FORMAT, 'dials': cfg['dials'], 'config': cfg, 'cases': {}, 'timing': {}}
    t = time.time()
    vol, info = build_from_bind(bind, cfg['volume'])
    model = build_model(vol, cfg)
    gdir = gravity_dir(bind.frame, cfg)
    mat_count = {MATERIAL_NAMES[k]: int((vol.material == k).sum()) for k in MATERIAL_NAMES}
    stats['volume'] = {
        'nodes': vol.n_nodes, 'tets': int(len(vol.tets)), 'fixed_nodes': int(vol.fixed.sum()),
        'tets_per_side': {'left': int((vol.tet_centroids()[:, 0] >= 0).sum()), 'right': int((vol.tet_centroids()[:, 0] < 0).sum())},
        'materials': mat_count, 'ligaments': int(len(model.lig['nodes'])), 'cell': cfg['volume']['cell'],
        'layers': cfg['volume']['layers'], 'footprint': vol.footprint, 'gravityDirBody': gdir.tolist(),
        'min_tet_volume_S3': float(np.linalg.det(_edges(vol.X, vol.tets)).min() / 6),
    }
    stats['timing']['volume_s'] = time.time() - t
    log(f'volume: {vol.n_nodes} nodes, {len(vol.tets)} tets {mat_count}, {vol.fixed.sum()} fixed')

    # Inverse rest shape: the authored shape is the equilibrium under g0.
    X_auth = vol.X.copy()
    sv = cfg['solver']
    Xr, x_def, inv = inverse_rest(model, X_auth, default_loads(cfg, gdir), tol=sv['inverseTol'],
                                  maxit=sv['inverseMaxit'], solver=sv, log=log)
    inv['error_max_percent_S'] = 100 * inv['error_max_S']
    inv['rest_shift_max_S'] = float(np.linalg.norm(Xr - X_auth, axis=1).max())
    stats['inverse'] = {k: v for k, v in inv.items()}
    stats['timing']['inverse_s'] = inv['seconds']
    log(f'inverse rest: error {inv["error_max_S"]:.2e} S after {inv["iterations"]} iterations, '
        f'max rest shift {inv["rest_shift_max_S"]:.4f} S ({inv["seconds"]:.1f}s)')

    samples = SampleSet(bind, vol, cfg)
    P_bind = samples.P_bind()
    counts = {k: int((samples.kind == v).sum()) for k, v in KINDS.items()}
    stats['samples'] = counts
    log(f'samples: {counts}')
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    V_def = model.tissue_volume(x_def)
    Dinv_def = np.linalg.inv(_edges(x_def, vol.tets))
    for name in targets or list(cfg['cases']):
        t = time.time()
        log(f'{name}:')
        x, infos = solve_case(model, x_def, name, cfg, vol, gdir, log=log)
        U_nodes = x - x_def
        J_map = np.linalg.det(_edges(x, vol.tets) @ Dinv_def)  # F of the delivered map x_def -> x
        presc = prescribed_tissue_volume(cfg, name, vol, model.V_rest)
        meas = model.tissue_volume(x) / V_def
        U_s = samples.field_body(U_nodes)
        last = infos[-1]
        cs = {
            'residual': last['residual'], 'residual_abs': last['residual_abs'],
            'residual_steps': [i['residual'] for i in infos], 'newton_iterations': sum(i['iterations'] for i in infos),
            'converged': all(i['converged'] for i in infos),
            'min_det_F_elastic': last['min_det'], 'min_det_F_map': float(J_map.min()),
            'tets_det_le_0': int((J_map <= 0).sum()),
            'tissue_volume_ratio': meas, 'prescribed_volume_ratio': presc,
            'volume_error_percent': 100 * (meas / presc - 1),
            'max_displacement_S': float(np.linalg.norm(U_nodes, axis=1).max()),
            'max_skin_displacement_S': float(np.linalg.norm(U_s[samples.kind == KINDS['skin']], axis=1).max()) if counts['skin'] else 0.0,
            'seconds': time.time() - t,
        }
        stats['cases'][name] = cs
        log(f'  residual {cs["residual"]:.2e}, min det F {cs["min_det_F_map"]:.3f}, tissue volume x{meas:.4f} '
            f'(prescribed x{presc:.4f}, {cs["volume_error_percent"]:+.2f}%), max |U| {cs["max_displacement_S"]:.4f} S, {cs["seconds"]:.1f}s')
        if out_dir:
            np.savez_compressed(
                os.path.join(out_dir, f'{name}.npz'), format=FORMAT, target=name, dials=json.dumps(cfg['dials']),
                kinds=json.dumps(KINDS), P=P_bind, U=samples.to_bind(U_s), w=samples.w, kind=samples.kind,
                vid=samples.vid, mesh=samples.mesh, side=samples.side, parent=samples.parent,
                P_body=samples.P_body, U_body=U_s)
    model.set_loads(**default_loads(cfg, gdir))

    if with_modes:
        t = time.time()
        mc = cfg['modes']
        md = modes(model, x_def, count=mc['count'])
        omega, T0 = physical(md, cfg['dials']['gravity'], mc['metersPerS'])
        desc = describe(md, vol)
        shape_body = np.stack([samples.field_body(p) for p in md['phi']])  # per unit mass-normalized coordinate
        skin = samples.kind == KINDS['skin']
        ref = skin if skin.any() else np.ones(len(samples), bool)
        c = mc['shapeAmplitude'] / np.linalg.norm(shape_body[:, ref], axis=2).max(axis=1)
        shape_unit = shape_body * c[:, None, None]
        gamma_body = md['gamma_hat'] / c[:, None]
        R = bind.frame.R
        stats['modes'] = {
            'omega_hat': md['omega_hat'].tolist(), 'omega_rad_s': omega.tolist(), 'freq_hz': (omega / (2 * np.pi)).tolist(),
            'T0_s': T0, 'metersPerS': mc['metersPerS'], 'stable': md['stable'],
            'mass_fraction_body': md['mass_fraction'].tolist(), 'describe': desc, 'seconds': time.time() - t,
        }
        log('modes: ' + ', '.join(f'{f:.2f} Hz ({d["axis"]}, sym {d["symmetry"]:+.2f})'
                                  for f, d in zip(stats['modes']['freq_hz'], desc)))
        if out_dir:
            np.savez_compressed(
                os.path.join(out_dir, 'modes.npz'), format=FORMAT, kinds=json.dumps(KINDS), P=P_bind, kind=samples.kind,
                vid=samples.vid, mesh=samples.mesh, w=samples.w, omega=omega, freq_hz=omega / (2 * np.pi),
                omega_hat=md['omega_hat'], damping=np.full(len(omega), mc['damping']),
                shape=np.stack([samples.to_bind(s) for s in shape_unit]), shape_body=shape_unit,
                gamma_body=gamma_body, gamma_bind=gamma_body @ R, mass_fraction_body=md['mass_fraction'],
                phi_mass_normalized_body=shape_body)

    stats['timing']['total_s'] = time.time() - t_all
    stats['timing']['cpu_s'] = time.process_time() - cpu_all  # all threads of this process
    log(f'total {stats["timing"]["total_s"]:.1f}s wall, {stats["timing"]["cpu_s"]:.1f}s CPU')
    if out_dir:
        meta = dict(stats)
        meta['frame'] = bind.frame.to_json()
        meta['params'] = {k: bind.params[k] for k in ('anchor', 'depth', 'window', 'midline', 'midlineLock') if k in bind.params}
        meta['targets'] = list(stats['cases'])
        meta['files'] = [f'{n}.npz' for n in stats['cases']] + (['modes.npz'] if with_modes else [])
        meta['kinds'] = KINDS
        with open(os.path.join(out_dir, 'meta.json'), 'w') as f:
            json.dump(meta, f, indent=1, default=_json_default)
    return stats


def _json_default(o):
    if isinstance(o, np.generic):
        return o.item()
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(type(o))


def load_config(preset=None, config_path=None, dials_json=None):
    cfg = merge(DEFAULT_CONFIG, PRESETS.get(preset, {}) if preset else {})
    if config_path:
        with open(config_path) as f:
            cfg = merge(cfg, json.load(f))
    if dials_json:
        cfg = merge(cfg, {'dials': json.loads(dials_json)})
    return cfg


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--bind', required=True, help='bust-bind/1 JSON')
    ap.add_argument('--out', required=True, help='output directory')
    ap.add_argument('--preset', choices=sorted(PRESETS), help='model-specific material groups')
    ap.add_argument('--config', help='JSON merged over the defaults (any subset of DEFAULT_CONFIG)')
    ap.add_argument('--dials', help=f'JSON object overriding dials {DIAL_NAMES}')
    ap.add_argument('--targets', help='comma-separated subset of targets')
    ap.add_argument('--no-modes', action='store_true')
    a = ap.parse_args(argv)
    cfg = load_config(a.preset, a.config, a.dials)
    bind = BindExport.load(a.bind)
    stats = bake(bind, cfg, a.out, targets=a.targets.split(',') if a.targets else None, with_modes=not a.no_modes)
    bad = [n for n, c in stats['cases'].items() if c['tets_det_le_0'] or not c['converged']]
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
