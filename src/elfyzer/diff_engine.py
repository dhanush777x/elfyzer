import logging

from elfyzer.analysis import analyse_elf
from elfyzer.utils import _demangle

__all__ = [
    "DiffEngine",
    "diff_elfs",
]

log = logging.getLogger("elfyzer")


def _delta_status(delta: int) -> str:
    return "unchanged" if delta == 0 else "changed"


class DiffEngine:
    def __init__(self, result_a: dict, result_b: dict,
                 name_a: str = "old", name_b: str = "new"):
        self.a = result_a
        self.b = result_b
        self.name_a = name_a
        self.name_b = name_b

    @staticmethod
    def _sym_key(s: dict) -> str:
        raw = s.get("raw_name") or s["name"]
        return _demangle(raw)

    @staticmethod
    def _aggregate(symbols: list[dict]) -> dict[str, dict]:
        agg: dict[str, dict] = {}
        for s in symbols:
            key = DiffEngine._sym_key(s)
            if key in agg:
                agg[key]["size"] += s["size"]
            else:
                agg[key] = dict(s)
                agg[key]["size"] = s["size"]
        return agg

    def get_summary_diff(self) -> dict:
        sa = self.a["summary"]
        sb = self.b["summary"]
        agg_a = self._aggregate(self.a["symbols"])
        agg_b = self._aggregate(self.b["symbols"])
        keys_a = set(agg_a)
        keys_b = set(agg_b)
        new_syms = keys_b - keys_a
        removed_syms = keys_a - keys_b
        changed = sum(1 for k in keys_a &
                      keys_b if agg_a[k]["size"] != agg_b[k]["size"])
        delta_total = sb["total_sym_size"] - sa["total_sym_size"]
        return {
            "a_name":           self.name_a,
            "b_name":           self.name_b,
            "a_total_symbols":  sa["total_symbols"],
            "b_total_symbols":  sb["total_symbols"],
            "a_total_sym_size": sa["total_sym_size"],
            "b_total_sym_size": sb["total_sym_size"],
            "delta_sym_size":   delta_total,
            "a_sections":       sa["total_sections"],
            "b_sections":       sb["total_sections"],
            "a_segments":       sa["total_segments"],
            "b_segments":       sb["total_segments"],
            "a_address_spaces": sa["address_spaces"],
            "b_address_spaces": sb["address_spaces"],
            "new_symbols":      len(new_syms),
            "removed_symbols":  len(removed_syms),
            "changed_symbols":  changed,
            "a_writable":       sa.get("writable_bytes", 0),
            "b_writable":       sb.get("writable_bytes", 0),
            "a_readonly":       sa.get("readonly_bytes", 0),
            "b_readonly":       sb.get("readonly_bytes", 0),
            "a_executable":     sa.get("executable_bytes", 0),
            "b_executable":     sb.get("executable_bytes", 0),
        }

    def get_symbol_diff(self) -> list[dict]:
        agg_a = self._aggregate(self.a["symbols"])
        agg_b = self._aggregate(self.b["symbols"])

        by_key: dict[str, dict] = {}
        for k, s in agg_a.items():
            by_key[k] = {
                "name": s["name"],
                "agg_key": k,
                "type": s.get("type", ""),
                "size_a": s["size"], "size_b": 0,
                "delta": -s["size"],
                "section_a": s.get("section", ""), "section_b": "",
                "source_file": s.get("source_file", ""),
                "object_file": s.get("object_file", ""),
                "address_a": s.get("address", 0), "address_b": 0,
                "status": "removed",
            }
        for k, s in agg_b.items():
            if k in by_key:
                entry = by_key[k]
                entry["size_b"] = s["size"]
                entry["delta"] = s["size"] - entry["size_a"]
                entry["section_b"] = s.get("section", "")
                entry["address_b"] = s.get("address", 0)
                entry["status"] = _delta_status(entry["delta"])
            else:
                by_key[k] = {
                    "name": s["name"],
                    "agg_key": k,
                    "type": s.get("type", ""),
                    "size_a": 0, "size_b": s["size"],
                    "delta": s["size"],
                    "section_a": "", "section_b": s.get("section", ""),
                    "source_file": s.get("source_file", ""),
                    "object_file": s.get("object_file", ""),
                    "address_a": 0, "address_b": s.get("address", 0),
                    "status": "new",
                }
        out = [v for v in by_key.values() if v["status"] != "unchanged"]
        out.sort(key=lambda x: abs(x["delta"]), reverse=True)
        return out

    def get_section_diff(self) -> list[dict]:
        by_name: dict[str, dict] = {}
        for sec in self.a["sections"]:
            by_name[sec["name"]] = {
                "name": sec["name"],
                "type": sec.get("type", ""),
                "size_a": sec["actual_size"], "size_b": 0,
                "delta": -sec["actual_size"],
                "vma_a": sec.get("vma", 0), "vma_b": 0,
                "status": "removed",
            }
        for sec in self.b["sections"]:
            if sec["name"] in by_name:
                entry = by_name[sec["name"]]
                entry["size_b"] = sec["actual_size"]
                entry["delta"] = sec["actual_size"] - entry["size_a"]
                entry["vma_b"] = sec.get("vma", 0)
                entry["status"] = _delta_status(entry["delta"])
            else:
                by_name[sec["name"]] = {
                    "name": sec["name"],
                    "type": sec.get("type", ""),
                    "size_a": 0, "size_b": sec["actual_size"],
                    "delta": sec["actual_size"],
                    "vma_a": 0, "vma_b": sec.get("vma", 0),
                    "status": "new",
                }
        out = [v for v in by_name.values() if v["status"] != "unchanged"]
        out.sort(key=lambda x: abs(x["delta"]), reverse=True)
        return out

    def get_source_diff(self) -> list[dict]:
        by_path: dict[str, dict] = {}
        for sf in self.a["source_files"]:
            by_path[sf["path"]] = {
                "name": sf["path"],
                "size_a": sf["total_size"], "size_b": 0,
                "delta": -sf["total_size"],
                "count_a": len(sf["symbols"]), "count_b": 0,
                "status": "removed",
            }
        for sf in self.b["source_files"]:
            if sf["path"] in by_path:
                entry = by_path[sf["path"]]
                entry["size_b"] = sf["total_size"]
                entry["delta"] = sf["total_size"] - entry["size_a"]
                entry["count_b"] = len(sf["symbols"])
                entry["status"] = _delta_status(entry["delta"])
            else:
                by_path[sf["path"]] = {
                    "name": sf["path"],
                    "size_a": 0, "size_b": sf["total_size"],
                    "delta": sf["total_size"],
                    "count_a": 0, "count_b": len(sf["symbols"]),
                    "status": "new",
                }
        out = [v for v in by_path.values() if v["status"] != "unchanged"]
        out.sort(key=lambda x: abs(x["delta"]), reverse=True)
        return out

    def get_object_diff(self) -> list[dict]:
        by_path: dict[str, dict] = {}
        for of in self.a["object_files"]:
            by_path[of["path"]] = {
                "name": of["path"],
                "size_a": of["total_size"], "size_b": 0,
                "delta": -of["total_size"],
                "count_a": len(of["symbols"]), "count_b": 0,
                "confidence": of.get("confidence", "unknown"),
                "status": "removed",
            }
        for of in self.b["object_files"]:
            if of["path"] in by_path:
                entry = by_path[of["path"]]
                entry["size_b"] = of["total_size"]
                entry["delta"] = of["total_size"] - entry["size_a"]
                entry["count_b"] = len(of["symbols"])
                entry["status"] = _delta_status(entry["delta"])
            else:
                by_path[of["path"]] = {
                    "name": of["path"],
                    "size_a": 0, "size_b": of["total_size"],
                    "delta": of["total_size"],
                    "count_a": 0, "count_b": len(of["symbols"]),
                    "confidence": of.get("confidence", "unknown"),
                    "status": "new",
                }
        out = [v for v in by_path.values() if v["status"] != "unchanged"]
        out.sort(key=lambda x: abs(x["delta"]), reverse=True)
        return out

    def get_full_diff(self) -> dict:
        return {
            "summary":      self.get_summary_diff(),
            "symbols":      self.get_symbol_diff(),
            "sections":     self.get_section_diff(),
            "source_files": self.get_source_diff(),
            "object_files": self.get_object_diff(),
        }


def diff_elfs(data_a: bytes, data_b: bytes,
              name_a: str = "old", name_b: str = "new") -> dict:
    result_a = analyse_elf(data_a)
    result_b = analyse_elf(data_b)
    engine = DiffEngine(result_a, result_b, name_a, name_b)
    diff = engine.get_full_diff()
    diff["result_a"] = result_a
    diff["result_b"] = result_b
    return diff
