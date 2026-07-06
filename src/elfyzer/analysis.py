import logging
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path

from elfyzer.extractor import ElfExtractor
from elfyzer.models import (
    AddressSpaceBlock,
    ObjectFileRecord,
    SectionRecord,
    SegmentRecord,
    SourceFileRecord,
    SymbolRecord,
)
from elfyzer.utils import _build_address_spaces

__all__ = [
    "AnalysisEngine",
    "analyse_elf",
]

log = logging.getLogger("elfyzer")


class AnalysisEngine:
    def __init__(
        self,
        metadata:        dict,
        sections:        list[SectionRecord],
        segments:        list[SegmentRecord],
        symbols:         list[SymbolRecord],
        address_spaces:  list[AddressSpaceBlock],
        warnings:        list[str],
    ):
        self.metadata = metadata
        self.sections = sections
        self.segments = segments
        self.symbols = symbols
        self.address_spaces = address_spaces
        self.warnings = warnings

        self._sec_syms: dict[str, list[SymbolRecord]] = defaultdict(list)
        for sym in self.symbols:
            self._sec_syms[sym.section_name].append(sym)
        self._sec_attr_sz: dict[str, int] = {
            name: sum(s.size for s in syms) for name, syms in self._sec_syms.items()
        }

        self._seg_secs: dict[int, list[SectionRecord]] = {}
        self._seg_syms: dict[int, list[SymbolRecord]] = {}
        self._seg_idx: dict[int, int] = {}
        for idx, seg in enumerate(self.segments):
            self._seg_secs[idx] = [
                s for s in self.sections if s.is_alloc and seg.vaddr <= s.vma < seg.end_vaddr]
            self._seg_syms[idx] = [s for s in self.symbols if seg.vaddr <=
                                   s.address < seg.end_vaddr]
            self._seg_idx[id(seg)] = idx

    def get_source_files(self) -> list[SourceFileRecord]:
        by_file: dict[str, SourceFileRecord] = {}
        for sym in self.symbols:
            key = sym.source_file or "__unknown__"
            if key not in by_file:
                by_file[key] = SourceFileRecord(path=key)
            rec = by_file[key]
            rec.total_size += sym.size
            rec.symbols.append({
                "name":        sym.name,
                "size":        sym.size,
                "symbol_type": sym.symbol_type,
                "section":     sym.section_name,
                "address":     sym.address,
                "attribution": sym.attribution,
            })
        result = sorted(by_file.values(),
                        key=lambda r: r.total_size, reverse=True)
        for r in result:
            r.symbols.sort(key=lambda s: s["size"], reverse=True)
        return result

    def get_object_files(self) -> list[ObjectFileRecord]:
        by_obj: dict[str, ObjectFileRecord] = {}
        for sym in self.symbols:
            src = sym.source_file or ""
            if src and src != "__unknown__":
                stem = Path(src).stem
                obj = stem + ".o"
                conf = sym.attribution
            else:
                obj = "__unknown__.o"
                conf = "unknown"
            if obj not in by_obj:
                by_obj[obj] = ObjectFileRecord(path=obj, confidence=conf)
            else:
                old = by_obj[obj].confidence
                if conf == "exact" or (conf == "inferred" and old == "unknown"):
                    by_obj[obj].confidence = conf
            rec = by_obj[obj]
            rec.total_size += sym.size
            rec.symbols.append({
                "name":        sym.name,
                "size":        sym.size,
                "symbol_type": sym.symbol_type,
                "section":     sym.section_name,
                "address":     sym.address,
            })
        result = sorted(by_obj.values(),
                        key=lambda r: r.total_size, reverse=True)
        for r in result:
            r.symbols.sort(key=lambda s: s["size"], reverse=True)
        return result

    def get_section_coverage(self) -> list[dict]:
        out = []
        for sec in sorted(self.sections, key=lambda s: s.size, reverse=True):
            seg_idx = -1
            for i, seg in enumerate(self.segments):
                if seg.segment_type == "PT_LOAD" and seg.vaddr <= sec.vma < seg.end_vaddr:
                    seg_idx = i
                    break
            syms = self._sec_syms.get(sec.name, [])
            attr_sz = self._sec_attr_sz.get(sec.name, 0)
            out.append({
                "name":              sec.name,
                "vma":               sec.vma,
                "lma":               sec.lma,
                "actual_size":       sec.size,
                "file_size":         sec.file_size,
                "is_nobits":         sec.is_nobits,
                "loaded":            sec.loaded,
                "attributed_size":   attr_sz,
                "unattributed_size": max(0, sec.size - attr_sz),
                "type":              sec.section_type,
                "flags":             sec.flags,
                "flag_w":            sec.is_writable,
                "flag_x":            sec.is_executable,
                "flag_a":            sec.is_alloc,
                "segment_index":     seg_idx,
                "symbols":           sorted(
                    [{"name": s.name, "size": s.size,
                      "address": s.address, "type": s.symbol_type}
                     for s in syms],
                    key=lambda x: x["size"], reverse=True
                ),
            })
        return out

    def get_summary(self) -> dict:
        total_sym_size = sum(s.size for s in self.symbols)
        writable_secs = [
            s for s in self.sections if s.is_alloc and s.is_writable]
        exec_secs = [
            s for s in self.sections if s.is_alloc and s.is_executable and not s.is_writable]
        readonly_secs = [
            s for s in self.sections if s.is_alloc and not s.is_writable and not s.is_executable]

        loaded_secs = [s for s in self.sections if s.is_alloc and s.loaded]
        nobits_secs = [s for s in self.sections if s.is_alloc and s.is_nobits]
        xip_secs = [
            s for s in self.sections if s.is_alloc and not s.loaded and not s.is_nobits]
        total_copy_bytes = sum(s.file_size for s in loaded_secs)
        total_zero_bytes = sum(s.size for s in nobits_secs)
        total_xip_bytes = sum(s.size for s in xip_secs)

        return {
            "arch":                 self.metadata["arch"],
            "bits":                 self.metadata["bits"],
            "endian":               self.metadata["endian"],
            "elf_type":             self.metadata["elf_type"],
            "entry":                self.metadata["entry"],
            "total_sections":       len(self.sections),
            "total_segments":       len(self.segments),
            "total_symbols":        len(self.symbols),
            "total_sym_size":       total_sym_size,
            "writable_bytes":       sum(s.size for s in writable_secs),
            "readonly_bytes":       sum(s.size for s in readonly_secs),
            "executable_bytes":     sum(s.size for s in exec_secs),
            "address_spaces":       len(self.address_spaces),
            "no_sized_symbols":     len(self.symbols) == 0,
            "total_copy_bytes":     total_copy_bytes,
            "total_zero_bytes":     total_zero_bytes,
            "total_xip_bytes":      total_xip_bytes,
        }

    def get_segments_summary(self) -> list[dict]:
        return [
            {
                "type":       sg.segment_type,
                "vaddr":      sg.vaddr,
                "paddr":      sg.paddr,
                "filesz":     sg.filesz,
                "memsz":      sg.memsz,
                "flags":      sg.flags,
                "align":      sg.align,
                "end_vaddr":  sg.end_vaddr,
                "sections":   [s.name for s in self._seg_secs.get(i, [])],
                "symbols":    sorted(
                    [{"name": s.name, "size": s.size, "type": s.symbol_type, "address": s.address}
                     for s in self._seg_syms.get(i, [])],
                    key=lambda x: x["size"], reverse=True
                )[:50],
            }
            for i, sg in enumerate(self.segments)
        ]

    def get_address_spaces(self) -> list[dict]:
        out = []
        for blk in self.address_spaces:
            sec_nodes = []
            for sec in blk.sections:
                syms_in_sec = [
                    {"name": s.name, "size": s.size, "address": s.address,
                     "type": s.symbol_type, "source_file": s.source_file,
                     "attribution": s.attribution}
                    for s in self._sec_syms.get(sec.name, [])
                ]
                syms_in_sec.sort(key=lambda x: x["size"], reverse=True)
                attr_sz = self._sec_attr_sz.get(sec.name, 0)
                sec_nodes.append({
                    "name":              sec.name,
                    "vma":               sec.vma,
                    "lma":               sec.lma,
                    "actual_size":       sec.size,
                    "file_size":         sec.file_size,
                    "is_nobits":         sec.is_nobits,
                    "loaded":            sec.loaded,
                    "attributed_size":   attr_sz,
                    "unattributed_size": max(0, sec.size - attr_sz),
                    "flags":             sec.flags,
                    "symbols":           syms_in_sec,
                })
            src_agg: dict[str, int] = defaultdict(int)
            for sym in blk.symbols:
                key = Path(
                    sym.source_file).name if sym.source_file else "unknown"
                src_agg[key] += sym.size
            top_sources = sorted(
                src_agg.items(), key=lambda x: x[1], reverse=True)[:10]
            timeline = []
            segs = sorted(blk.segments, key=lambda s: s.vaddr)
            for i, seg in enumerate(segs):
                if i > 0:
                    prev_end = segs[i-1].end_vaddr
                    gap_start = prev_end
                    gap_end = seg.vaddr
                    if gap_end > gap_start:
                        timeline.append(
                            {"kind": "gap", "start": gap_start, "end": gap_end})
                si = self._seg_idx.get(id(seg), -1)
                sec_names = [s.name for s in self._seg_secs.get(si, [])]
                timeline.append({
                    "kind": "segment", "type": seg.segment_type,
                    "start": seg.vaddr, "end": seg.end_vaddr,
                    "vaddr": seg.vaddr, "paddr": seg.paddr,
                    "filesz": seg.filesz, "memsz": seg.memsz,
                    "flags": seg.flags,
                    "sections": sec_names,
                })
            out.append({
                "start":          blk.start,
                "end":            blk.end,
                "observed_span":  blk.size,
                "used_bytes":     blk.used_bytes,
                "section_count":  len(blk.sections),
                "symbol_count":   len(blk.symbols),
                "timeline":       timeline,
                "sections":       sec_nodes,
                "top_symbols":    sorted(
                    [{"name": s.name, "size": s.size, "type": s.symbol_type,
                      "section": s.section_name, "address": s.address,
                      "source_file": s.source_file}
                     for s in blk.symbols],
                    key=lambda x: x["size"], reverse=True
                )[:50],
                "top_sources": [{"file": k, "size": v} for k, v in top_sources],
            })
        return out

    def get_flat_symbols(self) -> list[dict]:
        return sorted([
            {
                "name":        sym.name,
                "raw_name":    sym.raw_name,
                "type":        sym.symbol_type,
                "size":        sym.size,
                "address":     sym.address,
                "section":     sym.section_name,
                "source_file": sym.source_file,
                "object_file": Path(sym.source_file).stem + ".o" if sym.source_file else "",
                "attribution": sym.attribution,
            }
            for sym in self.symbols
        ], key=lambda x: x["size"], reverse=True)

    def _section_attr_view(self, predicate) -> list[dict]:
        candidates = [(sec, self._sec_attr_sz.get(sec.name, 0))
                      for sec in self.sections if predicate(sec)]
        candidates = [(sec, sz) for sec, sz in candidates if sz > 0]
        candidates.sort(key=lambda x: x[1], reverse=True)
        out = []
        total_attributed = 0
        total_section_bytes = 0
        for sec, attr_sz in candidates:
            total_attributed += attr_sz
            total_section_bytes += sec.size
            out.append({
                "name":       sec.name,
                "vma":        sec.vma,
                "size":       sec.size,
                "attributed": attr_sz,
                "flags":      sec.flags,
                "symbols":    sorted(
                    [{"name": s.name, "size": s.size, "type": s.symbol_type}
                     for s in self._sec_syms.get(sec.name, [])],
                    key=lambda x: x["size"], reverse=True
                )[:20],
            })
        return {"total": total_attributed, "total_section_bytes": total_section_bytes, "sections": out}

    def get_writable_sections(self) -> list[dict]:
        return self._section_attr_view(lambda s: s.is_alloc and s.is_writable)

    def get_readonly_sections(self) -> list[dict]:
        return self._section_attr_view(lambda s: s.is_alloc and not s.is_writable and not s.is_executable)

    def get_executable_sections(self) -> list[dict]:
        return self._section_attr_view(lambda s: s.is_alloc and s.is_executable)

    def get_largest_symbols_per_section(self) -> list[dict]:
        out = []
        for sec in sorted(self.sections, key=lambda s: s.size, reverse=True):
            syms = self._sec_syms.get(sec.name, [])
            if not syms:
                continue
            out.append({
                "name":    sec.name,
                "size":    sec.size,
                "symbols": sorted(
                    [{"name": s.name, "size": s.size, "type": s.symbol_type}
                     for s in syms],
                    key=lambda x: x["size"], reverse=True
                )[:10],
            })
        return out

    def get_largest_symbols_per_address_space(self) -> list[dict]:
        out = []
        for blk in self.address_spaces:
            if not blk.symbols:
                continue
            out.append({
                "start":   blk.start,
                "end":     blk.end,
                "size":    blk.size,
                "symbols": sorted(
                    [{"name": s.name, "size": s.size, "type": s.symbol_type,
                      "section": s.section_name}
                     for s in blk.symbols],
                    key=lambda x: x["size"], reverse=True
                )[:20],
            })
        return out


def analyse_elf(data: bytes) -> dict:

    extractor = ElfExtractor(data)

    metadata = extractor.extract_metadata()

    sections = extractor.extract_sections()

    segments = extractor.extract_segments()

    symbols, warnings = extractor.extract_symbols()

    if symbols:
        extractor.extract_dwarf_attribution(symbols)

    address_spaces = _build_address_spaces(segments, sections, symbols)

    engine = AnalysisEngine(
        metadata,
        sections,
        segments,
        symbols,
        address_spaces,
        warnings,
    )

    result = {
        "summary": engine.get_summary(),
        "warnings": warnings,
        "address_spaces": engine.get_address_spaces(),
        "sections": engine.get_section_coverage(),
        "segments": engine.get_segments_summary(),
        "symbols": engine.get_flat_symbols(),
        "source_files": [asdict(r) for r in engine.get_source_files()],
        "object_files": [asdict(r) for r in engine.get_object_files()],
        "writable_sections": engine.get_writable_sections(),
        "readonly_sections": engine.get_readonly_sections(),
        "executable_sections": engine.get_executable_sections(),
        "largest_per_section": engine.get_largest_symbols_per_section(),
        "largest_per_address_space": engine.get_largest_symbols_per_address_space(),
    }

    return result
