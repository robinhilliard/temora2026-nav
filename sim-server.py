#!/usr/bin/env python3
"""
sim-server.py — local-only dev server for sim.html. DO NOT PUSH.

Why a separate server? The PWA service worker registered by index.html
is cache-first for the whole origin, so it intercepts module imports
from sim.html and serves stale JS even after we edit on disk. Running
the sim on a different port gives us a clean origin (no SW), and the
no-store headers below stop the browser's HTTP/module cache from
pinning anything across reloads.

Usage:
    python3 sim-server.py
Then open: http://127.0.0.1:8766/sim.html?speed=5&quizPause=5&xtdAmp=0.4

URL params (passed through to sim.js):
    speed=N         time multiplier (1 = real-time, 5 = good for watching)
    quizPause=SEC   wall-clock dwell on quiz screens before NEXT auto-fires
    xtdAmp=NM       cross-track oscillation amplitude (default 0.3)
    varE=DEG        magnetic variation override (default 12)
"""

import http.server
import socketserver

PORT = 8766
HOST = '127.0.0.1'


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    with socketserver.TCPServer((HOST, PORT), NoCacheHandler) as httpd:
        print(f'sim server: http://{HOST}:{PORT}/sim.html?speed=5&quizPause=5&xtdAmp=0.4')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
