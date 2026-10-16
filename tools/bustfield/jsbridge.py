"""Call the JS field (web/scripts/eval-field.mjs) from Python.

The JS field is the reference implementation the viewer, the Blender port and
the Unity importer are checked against; this bridge lets the Python tools prove
that the params they emit mean the same thing there (parity / round trip).
"""

import json
import pathlib
import shutil
import subprocess

import numpy as np

REPO = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = REPO / "web" / "scripts" / "eval-field.mjs"


def node_available():
    return shutil.which("node") is not None and SCRIPT.exists()


def _plain(o):
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    raise TypeError(f"not JSON serializable: {type(o)}")


def eval_js(request, timeout=300):
    """Run eval-field.mjs with `request` (dict, see the script header)."""
    res = subprocess.run(
        ["node", str(SCRIPT), "-"],
        input=json.dumps(request, default=_plain),
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=str(REPO / "web"),
    )
    if res.returncode != 0:
        raise RuntimeError(f"eval-field.mjs failed: {res.stderr.strip()}")
    return json.loads(res.stdout)


def compare_with_js(frame, params, points, targets=None, jacobian=True):
    """Max abs difference (absolute units) between the Python and JS fields."""
    from .field import BustField

    req = {"frame": frame, "params": params, "points": np.asarray(points), "jacobian": jacobian, "weight": True}
    if targets is not None:
        req["targets"] = list(targets)
    js = eval_js(req)
    f = BustField(frame, params)
    P = np.asarray(points, dtype=float)
    err = {"delta": 0.0, "jacobian": 0.0, "weight": 0.0}
    for t in js["targets"]:
        err["delta"] = max(err["delta"], float(np.abs(f.delta(t, P) - np.array(js["delta"][t])).max()))
        if jacobian:
            Jpy = f.jacobian(t, P).reshape(-1, 9)
            err["jacobian"] = max(err["jacobian"], float(np.abs(Jpy - np.array(js["jacobian"][t])).max()))
    err["weight"] = float(np.abs(f.weight(P) - np.array(js["weight"])).max())
    err["S"] = f.S
    return err
