"""Run the JS morphometrics (tools/morpho/measure_js.mjs) from Python."""

from __future__ import annotations

import json
import pathlib
import shutil
import subprocess

import numpy as np

REPO = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = REPO / "tools" / "morpho" / "measure_js.mjs"


def node_available() -> bool:
    return shutil.which("node") is not None and SCRIPT.exists()


def _plain(o):
    # morpho.js takes flat xyz / index arrays (typed-array layout)
    if isinstance(o, np.ndarray):
        return o.ravel().tolist()
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    raise TypeError(f"not JSON serializable: {type(o)}")


def run_js(request: dict, timeout: float = 300) -> dict:
    res = subprocess.run(
        ["node", str(SCRIPT), "-"],
        input=json.dumps(request, default=_plain),
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=str(REPO),
    )
    if res.returncode != 0:
        raise RuntimeError(f"measure_js.mjs failed: {res.stderr.strip()}")
    return json.loads(res.stdout)


def ctx_from_js(c: dict) -> dict:
    """Prepared context dumped by measure_js.mjs (dumpCtx) -> morpho.py ctx."""
    return {
        "o": c["o"],
        "S": 1.0,
        "B": np.asarray(c["B"], dtype=np.float64).reshape(-1, 3),
        "tris": np.asarray(c["tris"], dtype=np.int64).reshape(-1, 3),
        "D": {k: np.asarray(v, dtype=np.float64).reshape(-1, 3) for k, v in c["D"].items()},
        "est": c["est"],
        "shoulderY": c["shoulderY"],
        "hipsY": c["hipsY"],
        "neckY": c["neckY"],
    }
