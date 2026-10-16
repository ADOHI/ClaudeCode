import os
import sys

# Make `tools.teacher` importable when pytest runs from any directory
# (tools/ is a namespace package; the repo root must be on sys.path).
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
