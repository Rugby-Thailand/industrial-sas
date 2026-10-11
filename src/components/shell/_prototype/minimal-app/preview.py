"""Local-only static HTML preview, with the real app's route shapes."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent


class PreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/" or path.startswith(("/finished-goods", "/master-data/storage-layouts")):
            self.path = "/index.html"
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    print("Main design preview: http://localhost:3199/finished-goods/scan", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 3199), PreviewHandler).serve_forever()
