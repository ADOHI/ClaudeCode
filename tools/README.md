# Bake-time tools (Python)

Offline tools that generate and check bust shapes. Their output (parameter JSON for the field in
`web/src/core/field.js`) is what the viewer, the Blender port and the Unity importer all consume.

Input: bind-space mesh exports in the `bust-bind/1` format, produced from the viewer:

```bash
cd web && npm run dev &
node scripts/export-bind.mjs /models/Changli/Changli.pmx .cache/changli.bind.json
```

Setup:

```bash
python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt
```

`bust-bind/1`: JSON with `frame` (body frame: origin/left/up/forward/S/hipsY/neckY), `params`
(field parameters used at export), `bonePositions` (bind space), and `meshes[]` with base64
little-endian `positions` / `normals` (Float32, bind space), `index` (Uint32 triangle list or null),
`mask` (Float32 skin-weight mask or null), and `bindMatrix` (column-major local->bind).
