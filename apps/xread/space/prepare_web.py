"""Add Space-only UI to a copy of the web directory during a Docker build."""

import argparse
from pathlib import Path


WINDOWS_URL = (
    "https://huggingface.co/spaces/dellweb3/Translateall/resolve/main/"
    "releases/Xread-Web-2.2-Windows-x64.zip?download=true"
)

NOTICE = f"""<aside class="space-notice" aria-label="在线版文件保存说明">
        <div><strong>在线版 · 免费 CPU</strong>
          <p>上传的视频在云端处理。任务按浏览器会话隔离，结果临时保存，请及时下载。</p></div>
        <a class="space-download" href="{WINDOWS_URL}" target="_blank" rel="noopener">下载 Windows x64 版</a>
      </aside>"""

SPACE_CSS = """
.space-notice{display:flex;align-items:center;justify-content:space-between;gap:12px 24px;flex-wrap:wrap;margin:0 0 15px;padding:12px 15px;border:1px solid #ded9f2;border-radius:10px;background:#f2effc}
.space-notice strong{font-size:.9rem;color:#453872}
.space-notice p{margin:2px 0 0;line-height:1.55;color:#555060;font-size:.89rem}
.space-download{display:inline-flex;align-items:center;min-height:36px;padding:5px 11px;border:1px solid #cec4e8;border-radius:7px;background:white;color:var(--deep);font-size:.89rem;font-weight:650;text-decoration:none}
.space-download:hover{background:#f8f6ff}
"""

SPACE_MESSAGES = {
    "导入连接中断，请确认本机服务仍在运行。": "上传连接中断，请稍后重新选择文件并重试。",
    "连接本机服务失败，将自动重试。": "连接在线工作台失败，将自动重试。",
    "请保持 Xread 启动窗口运行。": "Space 可能正在启动，请稍候。",
    "载入本机任务…": "载入当前会话的任务…",
}


def prepare(web: Path) -> None:
    html, css, js = (web / name for name in ("index.html", "style.css", "app.js"))
    markup = html.read_text(encoding="utf-8-sig")
    styles = css.read_text(encoding="utf-8-sig")
    scripts = js.read_text(encoding="utf-8-sig")

    if 'class="space-notice"' not in markup:
        anchor = '<section class="import-card"'
        if markup.count(anchor) != 1:
            raise ValueError("Cannot locate the video import section in index.html")
        markup = markup.replace(anchor, NOTICE + "\n    " + anchor)
    if ".space-notice{" not in styles:
        styles += SPACE_CSS
    for local_message, space_message in SPACE_MESSAGES.items():
        scripts = scripts.replace(local_message, space_message)

    for file, content in ((html, markup), (css, styles), (js, scripts)):
        file.write_text(content, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("web", type=Path, help="Web directory copied into the Docker image")
    prepare(parser.parse_args().web)
