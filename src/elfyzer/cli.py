from elfyzer.server import (
    HOST, PORT, BANNER,
    run_server, open_browser, _wait_for_server, start_server
)
import argparse
import sys
import threading
from urllib.parse import quote
import logging

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)

__all__ = ["main"]


def main():
    parser = argparse.ArgumentParser(
        prog="elfyzer",
        description="Firmware Memory Analysis Platform",
    )
    sub = parser.add_subparsers(dest="command")

    analyze_cmd = sub.add_parser(
        "analyze", help="Analyze an ELF binary and open dashboard")
    analyze_cmd.add_argument("elf", help="Path to .elf file")

    diff_cmd = sub.add_parser("diff", help="Compare two ELF binaries")
    diff_cmd.add_argument("elf_a", help="Baseline .elf file (old)")
    diff_cmd.add_argument("elf_b", help="Comparison .elf file (new)")

    args = parser.parse_args()

    if args.command == "analyze":
        url = f"http://{HOST}:{PORT}/?preload={quote(args.elf, safe='')}"
        _start_with_url(url)
    elif args.command == "diff":
        url = (f"http://{HOST}:{PORT}/?preload_diff="
               f"{quote(args.elf_a, safe='')},{quote(args.elf_b, safe='')}")
        _start_with_url(url)
    else:
        from elfyzer.server import start_server
        start_server()


def _start_with_url(url: str):
    print(BANNER)
    server_thread = threading.Thread(
        target=run_server, daemon=True,
    )
    server_thread.start()

    if _wait_for_server():
        open_browser(url)
    else:
        print("[ERROR] Server failed to start", file=sys.stderr)
        sys.exit(1)

    try:
        server_thread.join()
    except KeyboardInterrupt:
        pass
