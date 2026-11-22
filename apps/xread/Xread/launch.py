"""Start the Windows local service and open its workbench."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener
import webbrowser


ROOT = Path(__file__).resolve().parent
DEFAULT_HOME = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Xread"
CLIENT = build_opener(ProxyHandler({}))


def healthy(url):
    try:
        with CLIENT.open(url + "/api/health", timeout=1) as response:
            return json.loads(response.read(1024)).get("app") == "Xread"
    except (URLError, ValueError, OSError, AttributeError):
        return False


def start_service(url, port, log):
    if healthy(url):
        return
    log.parent.mkdir(parents=True, exist_ok=True)
    python = ROOT / "runtime" / "python.exe"
    with log.open("ab") as output:
        process = subprocess.Popen(
            [str(python), "-B", "-X", "utf8", str(ROOT / "server.py"), "--port", str(port)],
            cwd=ROOT, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if healthy(url):
            return
        if process.poll() is not None:
            break
        time.sleep(.25)
    raise RuntimeError(f"本机服务启动失败。请查看启动日志。\n{log}")


def open_workbench(url):
    locations = [
        ("ProgramFiles(x86)", "Microsoft/Edge/Application/msedge.exe"),
        ("ProgramFiles", "Microsoft/Edge/Application/msedge.exe"),
        ("ProgramFiles", "Google/Chrome/Application/chrome.exe"),
        ("LOCALAPPDATA", "Google/Chrome/Application/chrome.exe"),
    ]
    for env, relative in locations:
        location = os.environ.get(env)
        if not location:
            continue
        browser = Path(location) / relative
        if browser.is_file():
            try:
                subprocess.Popen([str(browser), f"--app={url}"], cwd=ROOT)
                return
            except OSError:
                continue
    if not webbrowser.open(url):
        raise RuntimeError("本机服务已启动，但 Windows 无法打开工作台窗口。")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--key-file", type=Path)
    parser.add_argument("--check", action="store_true", help="Start the service without opening any window.")
    args = parser.parse_args()
    if (args.key_file and args.key_file.is_file()
            and not (os.environ.get("DASHSCOPE_API_KEY") or os.environ.get("XREAD_BAILIAN_KEY_FILE"))):
        os.environ["XREAD_BAILIAN_KEY_FILE"] = str(args.key_file)
    url = f"http://127.0.0.1:{args.port}"
    app_data = Path(os.environ["XREAD_LIBRARY"]).parent if os.environ.get("XREAD_LIBRARY") else DEFAULT_HOME
    log = app_data / "Logs" / "launcher.log"
    try:
        start_service(url, args.port, log)
        if not args.check:
            open_workbench(url)
    except (RuntimeError, OSError) as exc:
        if args.check:
            raise SystemExit(str(exc)) from None
        ctypes.windll.user32.MessageBoxW(None, str(exc), "Xread 启动", 0x10)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
