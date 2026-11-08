#!/usr/bin/env python3
"""A small, independent folder adapter for this example's JSON snapshot envelope.

Only the minimal memory fields are interpreted. All other JSON is preserved.
This demonstrates an exchange boundary, not another server or a conformance suite.
"""

import argparse
import hashlib
import json
from pathlib import Path


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def import_snapshot(source, destination):
    snapshot = load(source)
    memories = snapshot["memories"]
    identifiers = set()
    for memory in memories:
        for field in ("identifier", "media_type", "created_at", "body"):
            if not isinstance(memory[field], str):
                raise ValueError(f"{field} must be a string")
        if memory["identifier"] in identifiers:
            raise ValueError("Duplicate exported identifier")
        identifiers.add(memory["identifier"])
    folder = Path(destination)
    folder.mkdir()  # Refuse to overwrite another store.
    files = []
    for memory in memories:
        filename = hashlib.sha256(memory["identifier"].encode()).hexdigest() + ".json"
        write(folder / filename, memory)
        files.append(filename)
    write(folder / "index.json", {"envelope": {key: value for key, value in snapshot.items() if key != "memories"}, "files": files})


def export_snapshot(source, destination):
    folder = Path(source)
    index = load(folder / "index.json")
    snapshot = index["envelope"]
    snapshot["memories"] = [load(folder / filename) for filename in index["files"]]
    write(destination, snapshot)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["import", "export"])
    parser.add_argument("source")
    parser.add_argument("destination")
    args = parser.parse_args()
    if args.operation == "import":
        import_snapshot(args.source, args.destination)
    else:
        export_snapshot(args.source, args.destination)
