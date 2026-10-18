"""Python mirror on its own: same invariants as web/test/morpho.test.js."""

import re

import numpy as np

from morpho.morpho import BANDS, METRICS, MORPHO_DEFAULTS, measure_bust, score_bands, select_triangles
from morpho.synth_torso import synth_torso

FLOORS = {"tiltDeg": 20, "upperSlopeDeg": 20, "divergenceDeg": 20, "turnDeg": 20, "upperConvexity": 0.2, "lowerConvexity": 0.2}


def measure(s, **kw):
    return measure_bust(s["frame"], [{"pos": s["pos"], "tris": s["index"]}], s["apex"], **kw)


def test_resolution_coarse_vs_fine_within_2_percent():
    coarse = measure(synth_torso(h=0.02, bUp=0.12, bLo=0.19))["sides"][0]
    fine = measure(synth_torso(h=0.005, bUp=0.12, bLo=0.19))["sides"][0]
    assert coarse["ok"] and fine["ok"]
    for k, *_ in METRICS:
        a, b = coarse[k], fine[k]
        floor = fine["baseHeight"] if k == "imfY" else FLOORS.get(k, 0)
        rel = abs(a - b) / max(abs(a), abs(b), floor)
        assert rel < 0.02, f"{k}: {a} vs {b} ({rel:.2%})"


def test_symmetric_cap_is_50_50():
    r = measure(synth_torso(h=0.01, flatChest=True, bUp=0.15, bLo=0.15, aLat=0.15, aMed=0.15))
    for m in r["sides"]:
        assert m["ok"], m["flags"]
        assert abs(m["upperPoleFrac"] - 0.5) < 0.005
        assert abs(m["tiltDeg"]) < 0.3 and abs(m["divergenceDeg"]) < 0.3


def test_fuller_lower_pole_tilts_up():
    t = [measure(synth_torso(h=0.01, bUp=0.15, bLo=b))["mean"]["tiltDeg"] for b in (0.13, 0.16, 0.19)]
    assert t[0] < t[1] < t[2]


def test_hole_is_flagged():
    s = synth_torso(h=0.02)
    tri = s["index"].reshape(-1, 3)
    c = s["pos"][tri].mean(axis=1)
    keep = ~((np.abs(c[:, 0] - 0.27) < 0.08) & (c[:, 1] > 0.15) & (c[:, 1] < 0.24))
    back = s["pos"].copy()
    back[:, 2] = -0.4
    pos = np.concatenate([s["pos"], back])
    index = np.concatenate([tri[keep].ravel(), s["index"] + len(s["pos"])])
    r = measure({**s, "pos": pos, "index": index})
    assert "hole" in r["sides"][0]["flags"] and not r["sides"][0]["ok"]
    assert r["sides"][1]["ok"]


def test_band_score():
    inside = {"upperPoleFrac": 0.45, "tiltDeg": 20, "upperConvexity": -0.01, "lowerConvexity": 0.05, "imfY": 0.1}
    s0 = score_bands(inside, BANDS["natural"], reference={"imfY": 0.12})
    assert s0["distance"] == 0 and s0["inside"]
    s1 = score_bands({**inside, "tiltDeg": 30}, BANDS["natural"])
    assert abs(s1["per"]["tiltDeg"]["d"] - 0.5) < 1e-12 and "imfRise" in s1["missing"]


def test_flagged_side_and_reference_are_not_scored():
    r = measure(synth_torso(h=0.02, P=0.01))
    invalid = r["sides"][0]
    assert not invalid["ok"]
    assert score_bands(invalid, BANDS["natural"])["distance"] is None
    valid = {"ok": True, "upperPoleFrac": 0.45, "tiltDeg": 20, "imfY": 0.1}
    result = score_bands(valid, BANDS["natural"], reference={"ok": False, "imfY": 0.12})
    assert "imfRise" in result["missing"]


def test_select_triangles():
    index = np.array([0, 1, 2, 1, 2, 3, 2, 3, 4, 3, 4, 5])
    groups = [
        {"start": 0, "count": 6, "material": "UP_Skin"},
        {"start": 0, "count": 6, "material": "UP_Skin (Outline)"},
        {"start": 6, "count": 3, "material": "Hair_Back"},
        {"start": 9, "count": 3, "material": "UP"},
    ]
    assert select_triangles(index, 6, groups, include=re.compile("skin", re.I)).tolist() == [0, 1, 2, 1, 2, 3]
    assert select_triangles(index, 6, groups, exclude=re.compile("hair", re.I)).tolist() == [0, 1, 2, 1, 2, 3, 3, 4, 5]


def test_defaults_match_js():
    import json
    import subprocess

    from morpho.jsbridge import REPO, node_available

    if not node_available():
        return
    js = json.loads(
        subprocess.run(
            ["node", "-e", "import('./web/src/core/morpho.js').then(m => console.log(JSON.stringify({d: m.MORPHO_DEFAULTS, b: m.BANDS})))"],
            capture_output=True, text=True, cwd=str(REPO), check=True,
        ).stdout
    )
    assert js["d"] == json.loads(json.dumps(MORPHO_DEFAULTS))
    for name, band in BANDS.items():
        assert js["b"][name]["metrics"] == band["metrics"]
