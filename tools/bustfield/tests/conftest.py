import os
import pathlib
import sys

# The bake machine is shared: keep BLAS single-threaded in tests (the solves
# are small; oversubscription only slows everyone down).
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")

import pytest  # noqa: E402

TOOLS = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).resolve().parent
for p in (TOOLS, HERE):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from helpers import CHANGLI, JOINTS  # noqa: E402

from bustfield.field import build_body_frame  # noqa: E402


@pytest.fixture(scope="session")
def frame():
    return build_body_frame(**JOINTS)


@pytest.fixture(scope="session")
def changli():
    from bustfield.bind import Bind

    return Bind.load(CHANGLI)
