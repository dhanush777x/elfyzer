from elfyzer.models import SectionRecord, SegmentRecord, SymbolRecord, AddressSpaceBlock

__all__ = [
    "ARCH_MAP",
    "_demangle",
    "_fmt_flags",
    "_fmt_seg_flags",
    "_build_address_spaces",
]


ARCH_MAP = {
    'EM_ARM':     'ARM',
    'EM_AARCH64': 'AArch64',
    'EM_386':     'x86',
    'EM_X86_64':  'x86-64',
    'EM_RISCV':   'RISC-V',
    'EM_MIPS':    'MIPS',
    'EM_PPC':     'PowerPC',
    'EM_PPC64':   'PowerPC64',
    'EM_XTENSA':  'Xtensa',
    'EM_NDS32':   'NDS32',
    'EM_ARC':     'ARC',
    'EM_AVR':     'AVR',
    'EM_MSP430':  'MSP430',
}

try:
    import pycxxfilt
except ImportError:
    pycxxfilt = None


def _demangle(name: str) -> str:
    if not pycxxfilt or not name:
        return name
    try:
        result = pycxxfilt.demangle(name)
        return result if result else name
    except Exception:
        return name


def _fmt_flags(flags_int: int) -> str:
    parts = []
    if flags_int & 0x1:
        parts.append("W")
    if flags_int & 0x2:
        parts.append("A")
    if flags_int & 0x4:
        parts.append("X")
    return "".join(parts) if parts else "-"


def _fmt_seg_flags(flags_int: int) -> str:
    parts = []
    if flags_int & 0x4:
        parts.append("R")
    if flags_int & 0x2:
        parts.append("W")
    if flags_int & 0x1:
        parts.append("X")
    return "".join(parts) if parts else "-"


def _build_address_spaces(
    segments: list[SegmentRecord],
    sections: list[SectionRecord],
    symbols:  list[SymbolRecord],
) -> list[AddressSpaceBlock]:
    load_segs = sorted(
        [s for s in segments if s.segment_type == "PT_LOAD"],
        key=lambda s: s.vaddr,
    )
    merged_groups = []
    for seg in load_segs:
        if not merged_groups:
            merged_groups.append([seg])
        else:
            last_group = merged_groups[-1]
            last_seg = last_group[-1]
            if seg.vaddr <= last_seg.end_vaddr:
                last_group.append(seg)
            else:
                merged_groups.append([seg])
    blocks = []
    for group in merged_groups:
        start = min(s.vaddr for s in group)
        end = max(s.end_vaddr for s in group)
        block_segs = list(group)
        block_secs = []
        block_syms = []
        for sec in sections:
            if sec.is_alloc and sec.vma < end and (sec.vma + sec.size) > start:
                block_secs.append(sec)
        for sym in symbols:
            if start <= sym.address < end:
                block_syms.append(sym)
        blocks.append(AddressSpaceBlock(
            start=start, end=end,
            segments=block_segs,
            sections=block_secs,
            symbols=block_syms,
        ))
    return blocks
