# Xread 2.1 中文视频译制台

Xread 将公开 X 帖子中的英文视频或本地视频制作成带中文字幕的 MP4。可以保留原讲话和现场声，也可以将英文对白替换为普通话配音。[打开在线工作台](https://dellweb3-translateall.hf.space) · [下载 Windows x64 版](https://huggingface.co/spaces/dellweb3/Translateall/resolve/main/releases/Xread-Web-2.1-Windows-x64.zip?download=true)

## 选择使用方式

| | 在线 Space | Windows x64 |
| --- | --- | --- |
| 启动 | 用浏览器打开工作台 | 完整解压发布包，双击 `Start Xread.cmd` |
| 处理位置 | Hugging Face 免费 CPU，上传文件后排队 | 本机 CPU，模型随包提供 |
| 任务和结果 | 按浏览器会话隔离，使用临时存储，完成后请下载 | 默认保存在 `%LOCALAPPDATA%\Xread\Library` |

Windows 版启动后，请保留启动窗口，通过浏览器访问本机工作台。公开 X 帖子的下载需要网络，本地视频可离线制作。[打开本机工作台](http://127.0.0.1:8765/)

## 制作视频

1. 每行粘贴一个 X 帖子链接，或多选本地视频，加入批量队列。「任务与历史」中会显示每条任务的排队位置、阶段和进度。
2. 选择「原声＋中文字幕」即可保留原音轨。选择「中文配音」时，可先试听，再选全片固定的自然女声、清亮女声或男声。标准档和快速档均为 24 kHz。
3. 在字幕文稿中点击一句即可跳到对应位置，打开「编辑」可校对中文。修改后重新生成成片，或直接导出独立字幕文件。
4. 下载成片 MP4，也可以导出中文字幕或中英双语 SRT。云端库可能在重启、重建或清理后失效，重要文件请下载保存。

例如，Lauren Tan 访谈本身已有双语字幕，可直接沿用原画，打开「双语对照」校对已有字幕。没有字幕的英文视频会先生成带时间轴的英文文稿，再翻译成简体中文。[示例 X 帖子](https://x.com/NoDiscoInHere/status/2115421187044225159)

## 源码导览

| 模块 | 用途 |
| --- | --- |
| `server.py`、`web/` | HTTP 接口、任务队列、预览与浏览器界面 |
| `media.py`、`detect_captions.py` | 获取视频、解析字幕轨、检查画面里已有的中文字幕 |
| `engine.py` | 调用 whisper.cpp 识别英文，用 CTranslate2 和 SentencePiece 完成英译中 |
| `voices.py`、`dub.py` | 普通话合成、音色选择、对齐字幕时间轴和成片导出 |

上表中的源码位于 `Xread/`。Windows 发布包包含运行环境、FFmpeg 和所需模型，组件来源与许可见包内的 `licenses` 和 `tools` 目录。在线版单文件上限为 512 MB，单个会话同时最多有八个待处理任务。[goodAPP 源码目录](https://github.com/delltom2000/goodAPP/tree/main/apps/xread) · [Space 项目页](https://huggingface.co/spaces/dellweb3/Translateall)

在本目录使用 Docker 构建时，先把上方 Windows ZIP 下载到 `releases/Xread-Web-2.1-Windows-x64.zip`。执行 `docker build -t xread .`，然后执行 `docker run --rm -p 127.0.0.1:7860:7860 -e XREAD_SPACE_LOCAL_TEST=1 -e XREAD_CONTAINER_LOCAL=1 xread`，在浏览器访问 `http://127.0.0.1:7860`。
