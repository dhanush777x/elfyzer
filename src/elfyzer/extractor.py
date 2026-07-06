import bisect
import logging
import struct
from io import BytesIO

from elftools.elf.elffile import ELFFile
from elftools.elf.sections import SymbolTableSection

from elfyzer.models import SymbolRecord, SectionRecord, SegmentRecord
from elfyzer.utils import _demangle, _fmt_flags, _fmt_seg_flags, ARCH_MAP

__all__ = ["ElfExtractor"]

log = logging.getLogger("elfyzer")


class ElfExtractor:
    DW_OP_addr = 0x03

    def __init__(self, data: bytes):
        self._stream = BytesIO(data)
        self._elf = ELFFile(self._stream)

    def extract_metadata(self) -> dict:
        h = self._elf.header
        return {
            "arch":       ARCH_MAP.get(h['e_machine'], h['e_machine']),
            "bits":       self._elf.elfclass,
            "endian":     "little" if self._elf.little_endian else "big",
            "elf_type":   h['e_type'],
            "entry":      h['e_entry'],
            "num_sections": self._elf.num_sections(),
            "num_segments": self._elf.num_segments(),
        }

    def extract_sections(self) -> list[SectionRecord]:
        records = []
        for sec in self._elf.iter_sections():
            name = sec.name
            if not name:
                continue
            sh_type = sec['sh_type']
            sh_size = sec['sh_size']
            is_nobits = (sh_type == 'SHT_NOBITS')
            records.append(SectionRecord(
                name=name,
                vma=sec['sh_addr'],
                lma=sec['sh_addr'],
                size=sh_size,
                file_size=0 if is_nobits else sh_size,
                section_type=sh_type,
                flags=_fmt_flags(sec['sh_flags']),
                flags_int=sec['sh_flags'],
            ))
        for seg in self._elf.iter_segments():
            if seg['p_type'] != 'PT_LOAD':
                continue
            seg_vaddr = seg['p_vaddr']
            seg_paddr = seg['p_paddr']
            seg_end = seg_vaddr + seg['p_memsz']
            lma_delta = seg_paddr - seg_vaddr
            for rec in records:
                if rec.vma >= seg_vaddr and rec.vma < seg_end:
                    rec.lma = rec.vma + lma_delta
                    if rec.is_nobits:
                        rec.lma = rec.vma
        return records

    def extract_segments(self) -> list[SegmentRecord]:
        records = []
        for seg in self._elf.iter_segments():
            records.append(SegmentRecord(
                segment_type=seg['p_type'],
                vaddr=seg['p_vaddr'],
                paddr=seg['p_paddr'],
                filesz=seg['p_filesz'],
                memsz=seg['p_memsz'],
                flags=_fmt_seg_flags(seg['p_flags']),
                align=seg['p_align'],
            ))
        return records

    def extract_symbols(self) -> tuple[list[SymbolRecord], list[str]]:
        warnings = []
        symbols = []
        sym_sec = self._elf.get_section_by_name('.symtab')

        if sym_sec is None:
            warnings.append(
                "No .symtab section - binary is stripped. "
                "Symbol-level analysis unavailable. "
                "Recompile without -s / --strip-all."
            )
            log.warning("  .symtab absent - stripped binary")
            return symbols, warnings

        if not isinstance(sym_sec, SymbolTableSection):
            warnings.append(".symtab exists but is not a SymbolTableSection.")
            return symbols, warnings

        log.info(f"  .symtab: {sym_sec.num_symbols()} raw entries")

        for sym in sym_sec.iter_symbols():
            raw_name = sym.name
            if not raw_name:
                continue
            st_info = sym.entry['st_info']
            sym_type = st_info['type']
            size = sym['st_size']
            address = sym['st_value']
            shndx = sym['st_shndx']

            if sym_type not in ('STT_OBJECT', 'STT_FUNC', 'STT_NOTYPE', 'STT_GNU_IFUNC'):
                continue
            if size <= 0:
                continue
            if shndx in ('SHN_UNDEF', 'SHN_ABS', 'SHN_COMMON'):
                continue

            demangled = _demangle(raw_name)
            section_name = ""
            try:
                idx = int(shndx)
                target = self._elf.get_section(idx)
                if target:
                    section_name = target.name
            except (ValueError, TypeError):
                pass

            symbols.append(SymbolRecord(
                name=demangled,
                raw_name=raw_name,
                symbol_type=sym_type,
                size=size,
                address=address,
                section_name=section_name,
            ))

        log.info(f"  Retained {len(symbols)} sized symbols")
        return symbols, warnings

    def extract_dwarf_attribution(self, symbols: list[SymbolRecord]) -> None:
        if not self._elf.has_dwarf_info():
            log.info("  No DWARF info present - skipping source attribution")
            return

        log.info("  DWARF info present - extracting source attribution")
        dwarf = self._elf.get_dwarf_info()
        total = len(symbols)

        die_matched = self._attribution_die_walk(dwarf, symbols)
        log.info(f"  Phase 1 - DIE exact match: {die_matched}/{total}")

        line_matched = self._attribution_debug_line(dwarf, symbols)
        log.info(f"  Phase 2 - .debug_line:      {line_matched} additional")

        cu_matched = self._attribution_cu_ranges(dwarf, symbols)
        log.info(f"  Phase 3 - CU ranges:        {cu_matched} additional")

        unknown = sum(1 for s in symbols if s.attribution == "unknown")
        if unknown:
            log.info(f"  Total unattributed: {unknown}/{total}")

    def _attribution_die_walk(self, dwarf, symbols) -> int:
        addr_to_src: dict[int, tuple[str, str]] = {}
        endian = '<' if self._elf.little_endian else '>'
        addr_size = self._elf.elfclass // 8

        for cu in dwarf.iter_CUs():
            try:
                cu_die = cu.get_top_DIE()
            except Exception:
                continue

            cu_name, cu_compdir = "", ""
            try:
                if 'DW_AT_name' in cu_die.attributes:
                    v = cu_die.attributes['DW_AT_name'].value
                    cu_name = v.decode(
                        'utf-8', errors='replace') if isinstance(v, bytes) else v
                if 'DW_AT_comp_dir' in cu_die.attributes:
                    v = cu_die.attributes['DW_AT_comp_dir'].value
                    cu_compdir = v.decode(
                        'utf-8', errors='replace') if isinstance(v, bytes) else v
            except Exception:
                pass

            full_cu = cu_name
            if cu_compdir and cu_name and not cu_name.startswith('/'):
                full_cu = cu_compdir.rstrip('/') + '/' + cu_name

            try:
                for die in cu.iter_DIEs():
                    if die.tag not in ('DW_TAG_variable',
                                       'DW_TAG_subprogram',
                                       'DW_TAG_formal_parameter'):
                        continue
                    try:
                        addr = None
                        if 'DW_AT_low_pc' in die.attributes:
                            addr = die.attributes['DW_AT_low_pc'].value
                        elif 'DW_AT_location' in die.attributes:
                            loc_val = die.attributes['DW_AT_location'].value
                            addr = self._parse_location_addr(
                                loc_val, endian, addr_size)

                        if addr is not None and addr not in addr_to_src:
                            addr_to_src[addr] = (full_cu, cu_name)
                    except Exception:
                        continue
            except Exception:
                continue

        matched = 0
        for sym in symbols:
            src = addr_to_src.get(sym.address)
            if src is None:
                src = addr_to_src.get(sym.address & ~1)
            if src is not None:
                sym.source_file, sym.compile_unit = src
                sym.attribution = "exact"
                matched += 1
        return matched

    @staticmethod
    def _parse_location_addr(loc_val, endian, addr_size):
        if not isinstance(loc_val, bytes):
            return None
        if not loc_val or loc_val[0] != ElfExtractor.DW_OP_addr:
            return None
        raw = loc_val[1:1 + addr_size]
        if len(raw) < addr_size:
            return None
        if addr_size == 8:
            fmt = '<Q' if endian == '<' else '>Q'
        else:
            fmt = '<I' if endian == '<' else '>I'
        return struct.unpack(fmt, raw)[0]

    def _attribution_debug_line(self, dwarf, symbols) -> int:
        unmatched = [s for s in symbols if s.attribution == "unknown"]
        if not unmatched:
            return 0

        entries = self._collect_line_entries(dwarf)
        if not entries:
            return 0

        addrs = [e[0] for e in entries]
        files = [e[1] for e in entries]

        matched = 0
        for sym in unmatched:
            # ARM Thumb: sym address has LSB set, line prog addresses do not
            addr = sym.address & ~1
            idx = bisect.bisect_right(addrs, addr) - 1
            if idx >= 0:
                sym.source_file = files[idx]
                sym.compile_unit = ""
                sym.attribution = "inferred"
                matched += 1
        return matched

    def _collect_line_entries(self, dwarf) -> list[tuple[int, str]]:
        entries: list[tuple[int, str]] = []

        for cu in dwarf.iter_CUs():
            lineprog = None
            try:
                lineprog = dwarf.line_program_for_CU(cu)
            except Exception:
                continue
            if lineprog is None:
                continue

            try:
                lineprog.execute()
            except Exception:
                pass

            header = getattr(lineprog, 'header', None)
            if header is None:
                continue

            dirs = list(getattr(header, 'include_directories', []) or [])
            dirs = [d.decode('utf-8', errors='replace') if isinstance(d, bytes) else (d or "")
                    for d in dirs]

            raw_files = list(getattr(header, 'file_entry', []) or
                             getattr(header, 'file_names', []) or [])
            file_table = []
            for fe in raw_files:
                if isinstance(fe, tuple):
                    fname, dir_idx = fe[0], fe[1]
                else:
                    fname = getattr(fe, 'name', str(fe))
                    dir_idx = getattr(fe, 'dir_idx', 0)
                if isinstance(fname, bytes):
                    fname = fname.decode('utf-8', errors='replace')
                if isinstance(dir_idx, int) and 0 <= dir_idx < len(dirs):
                    full = dirs[dir_idx].rstrip('/') + '/' + fname
                else:
                    full = fname
                file_table.append(full)

            try:
                for entry in lineprog.get_entries():
                    if entry.state is None or entry.state.end_sequence:
                        continue
                    addr = entry.state.address
                    if addr is None:
                        continue
                    fidx = entry.state.file - 1
                    if 0 <= fidx < len(file_table):
                        entries.append((addr, file_table[fidx]))
            except Exception:
                continue

        if entries:
            entries.sort(key=lambda x: x[0])
            deduped = [entries[0]]
            for a, f in entries[1:]:
                if a != deduped[-1][0]:
                    deduped.append((a, f))
            return deduped
        return entries

    def _attribution_cu_ranges(self, dwarf, symbols) -> int:
        cu_ranges = []
        for cu in dwarf.iter_CUs():
            try:
                cu_die = cu.get_top_DIE()
                lo_attr = cu_die.attributes.get('DW_AT_low_pc')
                hi_attr = cu_die.attributes.get('DW_AT_high_pc')
                if lo_attr is None or hi_attr is None:
                    continue
                lo = lo_attr.value
                hi = hi_attr.value
                if hasattr(hi_attr, 'form') and hi_attr.form != 'DW_FORM_addr':
                    hi = lo + hi
                cu_name = cu_die.attributes.get('DW_AT_name')
                label = cu_name.value.decode(
                    'utf-8', errors='replace') if cu_name else ""
                if isinstance(label, bytes):
                    label = label.decode('utf-8', errors='replace')
                cu_ranges.append((lo, hi, label))
            except Exception:
                continue

        matched = 0
        for sym in symbols:
            if sym.attribution != "unknown":
                continue
            addr = sym.address & ~1
            for lo, hi, label in cu_ranges:
                if lo <= addr < hi:
                    sym.source_file = label
                    sym.compile_unit = label
                    sym.attribution = "inferred"
                    matched += 1
                    break
        return matched
