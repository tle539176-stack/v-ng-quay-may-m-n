"""LAN server for the SECI wheel.

Every visitor is served on its own thread, so a phone that pauses while
buffering the race music can no longer freeze the page for everyone else
(the single-threaded serve-lan.ps1 did). Byte ranges are supported because
iPhone Safari will not play audio from a server without them.

    python serve-lan.py            # http://<this machine's IP>:8767/
    python serve-lan.py 8767 --host 127.0.0.1

The wheel and horse race pages save their data here, so it survives a cleared
browser and is the same on every device: GET/POST /api/data/<app> reads and
writes du-lieu/<app>.json, and older copies are kept in du-lieu/sao-luu/.
"""
import argparse
import datetime
import http.server
import json
import os
import re
import shutil
import socket
import threading
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "du-lieu")
BACKUP_DIR = os.path.join(DATA_DIR, "sao-luu")
# dua-ngua: the horse race. vong-quay: a backup copy of the original wheel's
# data, uploaded by the horse race page when both run in the same browser.
DATA_APPS = {"dua-ngua", "vong-quay"}
MAX_BODY = 40 * 1024 * 1024          # member photos travel inside the JSON
BACKUP_EVERY = 5 * 60                 # seconds between automatic backups
KEEP_BACKUPS = 60
_data_lock = threading.Lock()
_last_backup = {}


def data_file(app):
    return os.path.join(DATA_DIR, f"{app}.json")


def read_record(app):
    try:
        with open(data_file(app), "r", encoding="utf-8") as source:
            return json.load(source)
    except (OSError, ValueError):
        return None


def backup(app, force=False):
    """Copy the current file aside before it is overwritten."""
    current = data_file(app)
    if not os.path.isfile(current):
        return
    now = time.time()
    if not force and now - _last_backup.get(app, 0) < BACKUP_EVERY:
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(current, os.path.join(BACKUP_DIR, f"{app}-{stamp}.json"))
    _last_backup[app] = now
    copies = sorted(name for name in os.listdir(BACKUP_DIR) if name.startswith(f"{app}-"))
    for name in copies[:-KEEP_BACKUPS]:
        try:
            os.remove(os.path.join(BACKUP_DIR, name))
        except OSError:
            pass


def write_record(app, record):
    os.makedirs(DATA_DIR, exist_ok=True)
    target = data_file(app)
    temporary = f"{target}.tmp"
    with open(temporary, "w", encoding="utf-8") as sink:
        json.dump(record, sink, ensure_ascii=False)
        sink.flush()
        os.fsync(sink.fileno())
    os.replace(temporary, target)        # never leaves a half-written file
TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self._range_left = None
        super().__init__(*args, directory=ROOT, **kwargs)

    def guess_type(self, path):
        return TYPES.get(os.path.splitext(path)[1].lower(), "application/octet-stream")

    def list_directory(self, path):
        self.send_error(404, "Khong tim thay tep.")
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def send_head(self):
        self._range_left = None
        header = self.headers.get("Range")
        path = self.translate_path(self.path)
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", (header or "").strip())
        if not match or not os.path.isfile(path) or match.group(0) == "bytes=-":
            return super().send_head()
        size = os.path.getsize(path)
        first, last = match.groups()
        if first:
            start = int(first)
            end = min(int(last), size - 1) if last else size - 1
        else:
            start = max(0, size - int(last))
            end = size - 1
        if start >= size or end < start:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        source = open(path, "rb")
        source.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._range_left = end - start + 1
        return source

    def copyfile(self, source, outputfile):
        left = self._range_left
        if left is None:
            return super().copyfile(source, outputfile)
        while left > 0:
            chunk = source.read(min(65536, left))
            if not chunk:
                break
            outputfile.write(chunk)
            left -= len(chunk)

    def log_message(self, format, *args):
        print(f"{self.client_address[0]}  {format % args}")

    # ---------- data API ----------
    def _api_app(self):
        match = re.fullmatch(r"/api/data/([a-z0-9-]+)", self.path.split("?", 1)[0])
        return match.group(1) if match and match.group(1) in DATA_APPS else None

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/"):
            app = self._api_app()
            if not app:
                return self._send_json(404, {"error": "Khong co du lieu nay."})
            with _data_lock:
                record = read_record(app)
            return self._send_json(200, record or {"version": 0, "savedAt": 0, "data": None})
        return super().do_GET()

    def do_POST(self):
        app = self._api_app()
        if not app:
            return self._send_json(404, {"error": "Khong co du lieu nay."})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return self._send_json(413, {"error": "Du lieu qua lon hoac rong."})
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            data = payload["data"]
            base = int(payload.get("baseVersion") or 0)
            if not isinstance(data, dict) or not isinstance(data.get("teams"), list):
                raise ValueError("teams")
        except (ValueError, KeyError, TypeError, UnicodeDecodeError):
            return self._send_json(400, {"error": "Du lieu khong hop le."})
        with _data_lock:
            current = read_record(app) or {"version": 0}
            # Another device saved first: hand its copy back instead of overwriting it.
            if int(current.get("version") or 0) != base:
                return self._send_json(409, current)
            # A browser that never synced before may replace what is here: keep a copy first.
            backup(app, force=app not in _last_backup or payload.get("reason") == "initial")
            record = {
                "version": base + 1,
                "savedAt": int(time.time() * 1000),
                "data": data,
            }
            write_record(app, record)
        return self._send_json(200, {"version": record["version"], "savedAt": record["savedAt"]})


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Browsers drop speculative and media connections all the time.
        pass


def lan_address():
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("10.255.255.255", 1))
        return probe.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        probe.close()


def main():
    parser = argparse.ArgumentParser(description="SECI wheel LAN server")
    parser.add_argument("port", nargs="?", type=int, default=8767)
    parser.add_argument("--host", default="0.0.0.0")
    options = parser.parse_args()
    server = Server((options.host, options.port), Handler)
    address = lan_address() if options.host == "0.0.0.0" else options.host
    print("SECI dang chay. Gui link nay cho moi nguoi (cung mang noi bo):")
    print(f"  Dua ngua      : http://{address}:{options.port}/dua-ngua.html")
    print(f"  Ban Trung Thu : http://{address}:{options.port}/trung-thu.html")
    print(f"  Ban thuong    : http://{address}:{options.port}/")
    # Relative on purpose: a Vietnamese folder name may not print on every console.
    print("Du lieu tu luu vao: du-lieu\\vong-quay.json va du-lieu\\dua-ngua.json")
    print("Ban cu duoc sao luu trong: du-lieu\\sao-luu")
    print("Giu cua so nay mo trong suot buoi hop. Nhan Ctrl+C de tat.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
