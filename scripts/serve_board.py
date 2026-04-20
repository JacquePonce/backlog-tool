#!/usr/bin/env python3
"""
Serve the backlog folder over HTTP and open the hub (index.html) in your default browser.

Use this when you want a real browser tab (a normal webpage), not the in-editor preview.

Usage:
  cd troy-beta/backlog && .venv/bin/python scripts/serve_board.py

Optional: BACKLOG_PORT=9000 .venv/bin/python scripts/serve_board.py
"""

from __future__ import annotations

import os
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BACKLOG_DIR = Path(__file__).resolve().parent.parent
DEFAULT_PORT = int(os.environ.get("BACKLOG_PORT", "8765"))


class BoardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BACKLOG_DIR), **kwargs)

    def _redirect_root(self) -> bool:
        if self.path.split("?", 1)[0].rstrip("/") in ("", "/"):
            self.send_response(302)
            self.send_header("Location", "/index.html")
            self.end_headers()
            return True
        return False

    def do_GET(self) -> None:
        if self._redirect_root():
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if self._redirect_root():
            return
        super().do_HEAD()

    def log_message(self, format: str, *args) -> None:
        line = format % args if args else format
        print(f"[serve] {line}")


def main() -> None:
    class ReuseAddrServer(ThreadingHTTPServer):
        allow_reuse_address = True

    host = "127.0.0.1"
    httpd = None
    port = None
    for candidate in range(DEFAULT_PORT, DEFAULT_PORT + 30):
        try:
            httpd = ReuseAddrServer((host, candidate), BoardHandler)
            port = candidate
            break
        except OSError:
            continue
    if httpd is None or port is None:
        raise SystemExit(
            f"No free port between {DEFAULT_PORT} and {DEFAULT_PORT + 29}. "
            "Set BACKLOG_PORT or stop another server using this range."
        )

    base = f"http://{host}:{port}"
    hub_url = f"{base}/index.html"
    with httpd:
        threading.Timer(0.35, lambda: webbrowser.open(hub_url)).start()
        print(f"Serving backlog at {base}/")
        print(f"  → Hub: {hub_url}")
        print(f"  → Board: {base}/board.html   Daily focus: {base}/focus.html")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
