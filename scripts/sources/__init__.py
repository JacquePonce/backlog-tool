"""Per-source adapters that turn MCP-staged JSON under ``ingest/last_*.json`` into
board items consumed by ``scripts/daily_refresh.py``.

Each source module exposes ``load_items(ingest_dir: Path) -> list[dict]`` returning
a list of items that match the ``items.yaml`` schema (stable ``id``, ``title``,
``front``, ``status``, ``priority``, ``sources``, optional ``description`` /
``people`` / ``dates``).
"""
