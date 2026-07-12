import html as html_mod
import json
import logging
import os
import socket
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from elftools.common.exceptions import ELFError

from elfyzer.analysis import analyse_elf
from elfyzer.diff_engine import diff_elfs

__all__ = [
    "app",
    "HOST",
    "PORT",
    "BANNER",
    "run_server",
    "open_browser",
    "start_server",
]

log = logging.getLogger("elfyzer")

HOST = "127.0.0.1"
PORT = 8000
URL = f"http://{HOST}:{PORT}"
MAX_UPLOAD_SIZE = 500 * 1024 * 1024
VERSION = "0.2.1"

BANNER = f"elfyzer v{VERSION} - Firmware Memory Analysis Platform\nDashboard: {
    URL}"


def _load_html() -> str:
    tpl = Path(__file__).parent / "templates" / "index.html"
    return tpl.read_text(encoding="utf-8")


HTML_PAGE = _load_html()

app = FastAPI(title="elfyzer", version=VERSION)

static_dir = Path(__file__).parent / "static"
if static_dir.is_dir():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "version": VERSION}


@app.post("/upload")
async def upload(file: UploadFile = File(...)) -> JSONResponse:
    fname = file.filename or "unknown"
    log.info(f"Upload: {fname}")
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_SIZE:
        raise HTTPException(413, "File too large (max 500MB)")
    _validate_elf(raw, fname)

    try:
        result = analyse_elf(raw)
    except ELFError as e:
        raise HTTPException(422, f"ELF parse error: {e}")
    except Exception as e:
        log.exception("Unexpected error during analysis")
        raise HTTPException(500, f"Analysis failed: {e}")

    s = result["summary"]
    log.info(
        f"  → {fname}: {s['total_symbols']} syms, "
        f"{s['total_sections']} secs, {s['address_spaces']} address spaces"
    )
    return JSONResponse(content=result)


def _validate_elf(raw: bytes, fname: str) -> None:
    if not fname.lower().endswith('.elf'):
        raise HTTPException(422, f"Unsupported format: '{
                            fname}'. Only .elf files are accepted.")
    if len(raw) < 4:
        raise HTTPException(400, "File too small to be a valid ELF binary.")
    if raw[:4] != b'\x7fELF':
        raise HTTPException(
            422,
            f"Not an ELF binary (magic: {raw[:4].hex()}). "
            "Upload an ELF binary (.elf)."
        )


async def _read_upload(file: UploadFile) -> tuple[bytes, str]:
    fname = file.filename or "unknown"
    log.info(f"  Diff input: {fname}")
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_SIZE:
        raise HTTPException(413, "File too large (max 500MB)")
    _validate_elf(raw, fname)
    return raw, fname


@app.post("/diff")
async def diff(file_a: UploadFile = File(...), file_b: UploadFile = File(...)) -> JSONResponse:
    name_a = file_a.filename or "old"
    name_b = file_b.filename or "new"
    log.info(f"Diff: {name_a} ↔ {name_b}")

    try:
        raw_a, _ = await _read_upload(file_a)
        raw_b, _ = await _read_upload(file_b)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(422, f"Read error: {e}")

    try:
        result = diff_elfs(raw_a, raw_b, name_a, name_b)
    except ELFError as e:
        raise HTTPException(422, f"ELF parse error: {e}")
    except Exception as e:
        log.exception("Unexpected error during diff analysis")
        raise HTTPException(500, f"Diff analysis failed: {e}")

    s = result["summary"]
    log.info(
        f"  → {name_a} ↔ {name_b}: "
        f"{s['new_symbols']} new, {s['removed_symbols']} removed, "
        f"{s['changed_symbols']} changed, "
        f"delta={s['delta_sym_size']:+d} B"
    )
    return JSONResponse(content=result)


def _inject_preload_error(html: str, err: str) -> str:
    return html.replace(
        '<div id="dropzone"',
        '<div style="background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.2);'
        'border-radius:6px;padding:12px 16px;color:var(--red);font-size:13px;margin-bottom:16px;'
        'display:flex;gap:8px;"><strong style="flex-shrink:0;">Preload Error:</strong>'
        f'<span>{err}</span></div><div id="dropzone"',
        1,
    )


def _reject_path_traversal(path: str) -> str:
    if ".." in path.split(os.sep):
        raise HTTPException(400, "Path must not contain '..' components")
    return os.path.realpath(path)


def _read_local_elf(path: str, fname: str) -> bytes:
    """Read and validate a `.elf` file referenced by a CLI preload query param.

    Raises HTTPException on any failure; the caller decides how to present it.
    """
    if not fname.lower().endswith('.elf'):
        raise HTTPException(400, "Preload path must end with .elf")
    fpath = _reject_path_traversal(path)
    if not os.path.isfile(fpath):
        raise HTTPException(400, "Preload path is not a valid file")
    with open(fpath, "rb") as f:
        raw = f.read()
    if len(raw) > MAX_UPLOAD_SIZE:
        raise HTTPException(413, "File too large (max 500MB)")
    _validate_elf(raw, fname)
    return raw


def _inject_preload_data(html: str, payload: dict) -> str:
    script = f'<script>\nvar __PRELOAD__ = {json.dumps(payload)};\n</script>\n'
    return html.replace("</head>", script + "</head>", 1)


@app.get("/", response_class=HTMLResponse, summary="Dashboard")
async def dashboard(preload: str = None, preload_diff: str = None) -> HTMLResponse:
    html = HTML_PAGE

    try:
        if preload:
            fname = os.path.basename(preload)
            raw = _read_local_elf(preload, fname)
            log.info(f"CLI preload: {fname}")
            payload = {"type": "analyze",
                       "filename": fname, "data": analyse_elf(raw)}
            html = _inject_preload_data(html, payload)

        elif preload_diff:
            parts = preload_diff.split(",")
            if len(parts) == 2:
                name_a = os.path.basename(parts[0])
                name_b = os.path.basename(parts[1])
                raw_a = _read_local_elf(parts[0], name_a)
                raw_b = _read_local_elf(parts[1], name_b)
                log.info(f"CLI preload diff: {name_a} ↔ {name_b}")
                result = diff_elfs(raw_a, raw_b, name_a, name_b)
                payload = {"type": "diff", "nameA": name_a,
                           "nameB": name_b, "data": result}
                html = _inject_preload_data(html, payload)
    except HTTPException as he:
        log.error(f"Preload failed: {he.detail}")
        return HTMLResponse(content=html, status_code=he.status_code)
    except Exception as e:
        log.error(f"Preload failed: {e}")
        html = _inject_preload_error(html, html_mod.escape(str(e)))

    return HTMLResponse(content=html, status_code=200)


def _is_port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((host, port)) == 0


def _wait_for_server(host: str = HOST, port: int = PORT, timeout: float = 8.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _is_port_open(host, port):
            return True
        time.sleep(0.1)
    return False


def run_server() -> str:
    """Start uvicorn (blocking call). Returns the URL."""
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
    return URL


def open_browser(url: str = URL) -> None:
    webbrowser.open(url)


def start_server() -> None:
    print(BANNER)
    threading.Thread(target=lambda: webbrowser.open(URL), daemon=True).start()
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
