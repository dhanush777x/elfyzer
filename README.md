<div align="center">
  <img src="assets/elfyzer_logo.png" alt="elfyzer logo" width="200"/>
  <h1>elfyzer</h1>
  <p><b>An interactive platform to analyze, visualize, and compare embedded ELF binaries and their memory layout.</b></p>
</div>

<div align="center">
elfyzer presents an address-space-centric view of firmware memory. It derives all statistics purely from standard ELF metadata: section headers, program headers, symbol tables, and DWARF debug info. No heuristics, no region guessing.
</div>
<br>
<div align="center">
  <img src="assets/elfyzer_dashboard.png" alt="elfyzer dashboard preview" width="800"/>
</div>

## Features

**Address Space Visualization** - ELF segments are merged into contiguous address space cards. Each card shows the section timeline with VMA gaps, per-section symbol lists, and memory map treemap/sunburst charts.

**Three-Phase DWARF Attribution** - Symbols are attributed to source files through DIE exact matching, `.debug_line` address correlation, and CU range fallback. Each symbol has an attribution confidence level (`exact`, `inferred`, `unknown`).

**Section Categorization** - Allocatable sections are split into three mutually exclusive views by their ELF flags:
- **Writable** (`W`) - data sections
- **Read-Only** - alloc sections with neither `W` nor `X`
- **Executable** (`X`) - code sections

**Symbol Table** - Paginated, searchable, sortable (name/section/type/size/address), with type filtering and CSV/JSON export.

**Binary Diff** - Compare two ELF builds side-by-side. Detects new, removed, and changed symbols with size deltas. Drill down by symbols, sections, source files, or object files.

**Program Segments** - PT_LOAD and other segment types with expandable detail showing mapped sections and largest symbols.

**Copy / Zero / XIP Detection** - Sections where VMA ≠ LMA are flagged as loaded (copy). NOBITS sections are zeroed (BSS). Sections with VMA == LMA and non-zero file size are in-place (XIP).

**Memory Map Charts** - Interactive ECharts treemap and sunburst visualizations of address space usage.

---

## Quick Start

### Install

```bash
git clone https://github.com/dhanush777x/elfyzer.git
cd elfyzer
pip install .
# or with C++ symbol demangling:
pip install ".[demangle]"
```

The `elfyzer` command is then available on your PATH. For an editable install (source changes take effect immediately), use `pip install -e .` instead.

### Usage

```bash
# Start the web dashboard (upload an ELF manually)
elfyzer

# Analyze an ELF and open the dashboard pre-loaded
elfyzer analyze firmware.elf

# Compare two ELF builds
elfyzer diff firmware_v1.elf firmware_v2.elf
```

The dashboard opens at `http://127.0.0.1:8000`.

---

## Dashboard

| View | Description |
|------|-------------|
| **Overview** | Architecture, entry point, address space cards, memory map chart, top 20 symbols |
| **Symbols** | Full symbol table with search, type filter, sort, pagination, CSV/JSON export |
| **Writable Sections** | All writable (`W`) allocatable sections with attributed symbol sizes |
| **Read-Only Sections** | Allocatable sections with neither `W` nor `X` flags |
| **Executable Sections** | All executable (`X`) allocatable sections |
| **Source Files** | DWARF-based source-level symbol attribution |
| **Object Files** | Object file attribution derived from source paths |
| **Segments** | Program header table with expandable detail |
| **Diff** | Side-by-side ELF build comparison |

---

## Architecture

```
elfyzer/
├── cli.py              # CLI entry point (argparse)
├── server.py           # FastAPI application, upload/diff endpoints, preload
├── extractor.py        # ElfExtractor - raw ELF parsing via pyelftools
├── analysis.py         # AnalysisEngine - attribution, categorization, aggregation
├── diff_engine.py      # DiffEngine - symbol/section/source/object comparison
├── models.py           # Dataclasses: SymbolRecord, SectionRecord, etc.
├── utils.py            # Architecture map, demangling, flag formatting
├── static/
│   ├── styles.css      # Glassmorphic dark theme design system
│   └── js/
│       ├── state.js    # Global state, view switching, error boundary
│       ├── views.js    # All render functions (overview, symbols, sections, etc.)
│       ├── diff.js     # Diff upload, rendering, filtering
│       ├── chart.js    # ECharts treemap/sunburst
│       ├── main.js     # DOM event delegation
│       └── helpers.js  # fmtB, escapeHtml, debounce, type badge
└── templates/
    └── index.html      # Single-page application shell
```

### Attribution Pipeline

1. **Phase 1 - DIE Walk**: Walks DWARF compilation unit DIEs, extracts addresses from `DW_AT_low_pc` and `DW_AT_location`, assigns source file via exact address match.
2. **Phase 2 - `.debug_line`**: Unmatched symbols are correlated against the line number program matrix using bisect-based address lookup.
3. **Phase 3 - CU Ranges**: Remaining symbols are matched to compilation unit address ranges as a final fallback.

Symbols that cannot be attributed through any phase are marked `unknown`.

---

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Web dashboard (supports `?preload=` and `?preload_diff=` query params) |
| `/health` | GET | Health check (`{"status": "ok"}`) |
| `/upload` | POST | Upload a single `.elf` file for analysis |
| `/diff` | POST | Upload two `.elf` files (`file_a`, `file_b`) for comparison |

All upload endpoints reject files larger than 500 MB and validate both magic bytes and `.elf` extension.

---

## Requirements

- Python 3.9+
- `fastapi`, `uvicorn`, `pyelftools`, `python-multipart`
- Optional: `cxxfilt` for C++ symbol demangling
- A browser (tested on Brave)
- No JavaScript build step - the frontend is vanilla JS loaded directly from static files.

---

## Development

See [Contributing](#contributing) for setup instructions.

The server runs on `127.0.0.1:8000`. Static file changes (JS, CSS, HTML) require a server restart.

---

## Limitations

- Requires a `.symtab` section (unstripped binaries). Stripped binaries show section-level data only.
- DWARF attribution depends on debug info being present in the ELF (compile with `-g`).
- Section-level diff uses name-based matching (sections must have the same name across builds).
- Symbol-level diff uses demangled name aggregation - symbols with identical demangled names are grouped, and their sizes are summed before comparison.

---

## Contributing

Contributions are welcome! Open an issue or submit a pull request on GitHub.

To set up a development environment:

```bash
git clone https://github.com/dhanush777x/elfyzer.git
cd elfyzer
pip install -e ".[demangle]"
```

---

## License

[MIT](LICENSE)
