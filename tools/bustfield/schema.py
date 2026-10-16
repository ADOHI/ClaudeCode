"""Validate params JSON against docs/params.schema.json.

A dependency-free validator for the subset of JSON Schema (2020-12) that the
params schema uses: type, properties, required, additionalProperties,
patternProperties, propertyNames, items, minItems / maxItems, enum, const,
minimum / maximum, exclusiveMinimum / exclusiveMaximum, oneOf, local $ref.
Unknown keywords raise, so the schema cannot silently use something this
validator ignores. If the `jsonschema` package is installed the tests also
cross-check against it.

CLI: python -m bustfield.schema params.json [...]
"""

import json
import math
import pathlib
import re
import sys

SCHEMA_PATH = pathlib.Path(__file__).resolve().parents[2] / "docs" / "params.schema.json"

_ANNOTATIONS = {"$schema", "$id", "title", "description", "default", "$defs", "$comment"}
_KNOWN = _ANNOTATIONS | {
    "type", "properties", "required", "additionalProperties", "patternProperties", "propertyNames",
    "items", "minItems", "maxItems", "enum", "const", "minimum", "maximum", "exclusiveMinimum",
    "exclusiveMaximum", "oneOf", "$ref", "pattern",
}


def load_schema():
    with open(SCHEMA_PATH, encoding="utf-8") as f:
        return json.load(f)


def _is_type(v, t):
    if t == "object":
        return isinstance(v, dict)
    if t == "array":
        return isinstance(v, list)
    if t == "string":
        return isinstance(v, str)
    if t == "boolean":
        return isinstance(v, bool)
    if t == "integer":
        return isinstance(v, int) and not isinstance(v, bool)
    if t == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    if t == "null":
        return v is None
    raise ValueError(f"unsupported type {t}")


def _resolve(root, ref):
    if not ref.startswith("#/"):
        raise ValueError(f"only local $ref supported: {ref}")
    node = root
    for part in ref[2:].split("/"):
        node = node[part]
    return node


def errors(value, schema=None, root=None, path="$"):
    """List of error strings (empty => valid)."""
    if schema is None:
        schema = root = load_schema()
    root = schema if root is None else root
    unknown = set(schema) - _KNOWN
    if unknown:
        raise ValueError(f"schema uses unsupported keywords {sorted(unknown)} at {path}")
    out = []
    if "$ref" in schema:
        out += errors(value, _resolve(root, schema["$ref"]), root, path)
    if "type" in schema:
        types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(_is_type(value, t) for t in types):
            return out + [f"{path}: expected {'/'.join(types)}, got {type(value).__name__}"]
    if "const" in schema and value != schema["const"]:
        out.append(f"{path}: expected {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        out.append(f"{path}: {value!r} not in {schema['enum']}")
    if _is_type(value, "number"):
        if "minimum" in schema and value < schema["minimum"]:
            out.append(f"{path}: {value} < minimum {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            out.append(f"{path}: {value} > maximum {schema['maximum']}")
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            out.append(f"{path}: {value} <= exclusiveMinimum {schema['exclusiveMinimum']}")
        if "exclusiveMaximum" in schema and value >= schema["exclusiveMaximum"]:
            out.append(f"{path}: {value} >= exclusiveMaximum {schema['exclusiveMaximum']}")
    if isinstance(value, str) and "pattern" in schema and not re.search(schema["pattern"], value):
        out.append(f"{path}: {value!r} does not match {schema['pattern']}")
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            out.append(f"{path}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            out.append(f"{path}: more than {schema['maxItems']} items")
        if "items" in schema:
            for i, v in enumerate(value):
                out += errors(v, schema["items"], root, f"{path}[{i}]")
    if isinstance(value, dict):
        for k in schema.get("required", []):
            if k not in value:
                out.append(f"{path}: missing required '{k}'")
        props = schema.get("properties", {})
        pats = schema.get("patternProperties", {})
        for k, v in value.items():
            if "propertyNames" in schema:
                out += errors(k, schema["propertyNames"], root, f"{path}.<{k}>")
            matched = False
            if k in props:
                matched = True
                out += errors(v, props[k], root, f"{path}.{k}")
            for pat, sub in pats.items():
                if re.search(pat, k):
                    matched = True
                    out += errors(v, sub, root, f"{path}.{k}")
            if not matched and "additionalProperties" in schema:
                ap = schema["additionalProperties"]
                if ap is False:
                    out.append(f"{path}: unexpected key '{k}'")
                elif isinstance(ap, dict):
                    out += errors(v, ap, root, f"{path}.{k}")
    if "oneOf" in schema:
        results = [errors(value, s, root, path) for s in schema["oneOf"]]
        ok = sum(1 for r in results if not r)
        if ok != 1:
            best = min(results, key=len)
            out.append(f"{path}: matches {ok} of oneOf (closest: {'; '.join(best) or 'n/a'})")
    return out


def validate(params):
    """Raise ValueError listing every schema violation."""
    errs = errors(params)
    if errs:
        raise ValueError("params do not match docs/params.schema.json:\n  " + "\n  ".join(errs))
    return True


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    bad = 0
    for p in argv:
        with open(p, encoding="utf-8") as f:
            errs = errors(json.load(f))
        print(f"{p}: {'ok' if not errs else 'INVALID'}")
        for e in errs:
            print("  " + e)
        bad += bool(errs)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
