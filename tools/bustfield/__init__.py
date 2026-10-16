"""bustfield: Python port of the bind-space bust field (web/src/core/field.js)
plus the bake-time tools that produce its params:

  field / kelvinlet / vec / validate  exact ports (parity-tested against JS)
  distill                             teacher samples -> Kelvinlet dictionary fit
  profile_fit                         artist sagittal profile -> amplitudes
  schema                              params JSON schema check (docs/params.schema.json)
"""

from .field import (  # noqa: F401
    DEFAULT_PARAMS,
    TARGETS,
    BustField,
    build_body_frame,
    clone_params,
    from_body,
    slider_to_weights,
    to_body,
)
