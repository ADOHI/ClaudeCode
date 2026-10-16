import os
import pathlib
import sys

# Shared bake machine: keep BLAS single-threaded (tiny solves only).
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")

TOOLS = pathlib.Path(__file__).resolve().parents[2]
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

REPO = TOOLS.parent
CHANGLI = REPO / "web" / ".cache" / "changli.bind.json"
