from dataclasses import dataclass, field
from typing import Literal

__all__ = [
    "SymbolRecord",
    "SectionRecord",
    "SegmentRecord",
    "AddressSpaceBlock",
    "SourceFileRecord",
    "ObjectFileRecord",
    "Attribution",
]

Attribution = Literal["exact", "inferred", "unknown"]


@dataclass
class SymbolRecord:
    name:             str
    raw_name:         str
    symbol_type:      str
    size:             int
    address:          int
    section_name:     str
    source_file:      str = ""
    object_file:      str = ""
    compile_unit:     str = ""
    attribution:      Attribution = "unknown"


@dataclass
class SectionRecord:
    name:              str
    vma:               int
    lma:               int
    size:              int
    section_type:      str
    flags:             str
    flags_int:         int = 0
    attributed_size:   int = 0
    symbols:           list[SymbolRecord] = field(default_factory=list)
    segment_index:     int = -1
    file_size:         int = 0

    @property
    def is_nobits(self) -> bool:
        return self.section_type == 'SHT_NOBITS'

    @property
    def loaded(self) -> bool:
        return self.vma != self.lma and self.file_size > 0

    @property
    def unattributed_size(self) -> int:
        return max(0, self.size - self.attributed_size)

    @property
    def is_alloc(self) -> bool:
        return 'A' in self.flags

    @property
    def is_writable(self) -> bool:
        return 'W' in self.flags

    @property
    def is_executable(self) -> bool:
        return 'X' in self.flags


@dataclass
class SegmentRecord:
    segment_type:     str
    vaddr:            int
    paddr:            int
    filesz:           int
    memsz:            int
    flags:            str
    align:            int
    sections:         list[SectionRecord] = field(default_factory=list)
    symbols:          list[SymbolRecord] = field(default_factory=list)

    @property
    def end_vaddr(self) -> int:
        return self.vaddr + self.memsz


@dataclass
class AddressSpaceBlock:
    start:            int
    end:              int
    segments:         list[SegmentRecord] = field(default_factory=list)
    sections:         list[SectionRecord] = field(default_factory=list)
    symbols:          list[SymbolRecord] = field(default_factory=list)

    @property
    def size(self) -> int:
        return self.end - self.start

    @property
    def used_bytes(self) -> int:
        total = 0
        for s in self.sections:
            if s.is_alloc:
                s_start = max(s.vma, self.start)
                s_end = min(s.vma + s.size, self.end)
                total += max(0, s_end - s_start)
        return total


@dataclass
class SourceFileRecord:
    path:        str
    total_size:  int = 0
    symbols:     list[dict] = field(default_factory=list)


@dataclass
class ObjectFileRecord:
    path:        str
    total_size:  int = 0
    symbols:     list[dict] = field(default_factory=list)
    confidence:  Attribution = "unknown"
