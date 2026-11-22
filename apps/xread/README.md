# Xread 2.3 中文视频译制台

Xread 将 X 帖子或本地视频制作成带中文字幕的 MP4。可以保留原讲话和现场声，也可以将英文对白替换为普通话配音。[打开在线工作台](https://dellweb3-translateall.hf.space) · [下载 Windows x64 版](https://dellweb3-translateall.hf.space/download/windows)

## 选择使用方式

| | 在线 Space | Windows x64 |
| --- | --- | --- |
| 启动 | 用浏览器打开工作台 | 完整解压发布包，双击 `Start Xread.cmd` |
| 处理位置 | Hugging Face 免费 CPU，上传文件后排队 | 本机 CPU，模型随包提供 |
| 任务和结果 | 按浏览器会话隔离。切片可选 CloudBase 续存 | 默认保存在 `%LOCALAPPDATA%\Xread\Library` |

Windows 版启动后，请保留启动窗口，通过浏览器访问本机工作台。公开 X 帖子的下载需要网络，本地视频可离线制作。[打开本机工作台](http://127.0.0.1:8765/)

## 制作视频

1. 每行粘贴一个 X 帖子链接，或多选本地视频。
2. 在女声和男声两组中选一个音色，搭配朗读风格后试听。也可以使用「青禾 · 演讲」或「小满 · 甜美」直接选定组合。标准、快速两档均为 24 kHz。
3. 勾选「原声＋中文字幕」或「中文配音＋中文字幕」，可以双选。首次默认仅选原声。点「开始翻译」，到「任务与历史」查看每条任务的排队位置、阶段和进度。
4. 在字幕文稿中点击一句即可定位和校对译文。勾选两版时，原声版先完成即可下载；配音完成后，可分别下载两份 MP4，也可在「导出」中选择双音轨 MP4，供 VLC 等播放器切换音轨。独立中文和中英双语 SRT 也可导出。云端任务使用临时存储，重要文件请下载保存。

| 固定音色 | 名称 |
| --- | --- |
| 女声 | 自然女声、清亮女声、青禾女声、云舒女声、小满女声 |
| 男声 | 男声、松言男声、云舟男声 |

选好音色，再选「自然交谈」「演讲」或「甜美讲述」。所有固定音色都支持这三种朗读风格。点「试听」会播放当前音色、风格和音质对应的样音，便于用同一段话比较停顿和语气。

例如，Lauren Tan 访谈本身已有双语字幕，可直接沿用原画，打开「双语对照」校对已有字幕。没有字幕的英文视频会先生成带时间轴的英文文稿，再翻译成简体中文。[示例 X 帖子](https://x.com/NoDiscoInHere/status/2115421187044225159)

## AI 切片与 X 长帖

字幕完成后，可在「切片与推文」选择原始视频、原声字幕版或中文配音版。百炼按字幕时间码提炼观点，FFmpeg 剪辑所选视频并重排字幕。切片根据内容取 2–5 分钟，优先保留能独立讲清主张、依据和结论的片段。拆不开的内容可以保留整片。[FFmpeg 项目](https://github.com/FFmpeg/FFmpeg)

每段就绪即可预览并编辑草稿。长帖并行生成，约 1000 字是写作目标。自动选模会按复核意见重写，仍未通过时切换候补模型。失败项会显示原因，从断点继续只补写缺少的长帖。

打开「切片前和 Agent 讨论」可以先看字幕提纲和方案，用自然语言调整片数、主题和顺序。Enter 发送，Shift+Enter 换行。追问选片理由时可保留原方案。核对时间线后点「确认方案并切片」，讨论模式每片 2–5 分钟。

公开 Space 的切片功能需输入已登记的手机号。自建用户请使用自己的百炼 API Key。Windows 版可在切片界面输入 Key，或设置 `DASHSCOPE_API_KEY` 或 `XREAD_BAILIAN_KEY_FILE`。自建 HF Space 请配置运行时 Secrets `DASHSCOPE_API_KEY` 和 `XREAD_HIGHLIGHT_PHONE`。

跨设备恢复需要在 CloudBase PG 环境创建私有 `xread-checkpoints` 桶，并在服务端设置 `XREAD_CLOUDBASE_KEY`。本机也可使用 `XREAD_CLOUDBASE_KEY_FILE` 指定自己的凭据文件。勾选「云端续存」后，待备份完成再复制恢复链接。持有恢复链接即可读取对应备份。

## 源码导览

| 模块 | 用途 |
| --- | --- |
| `server.py`、`web/` | HTTP 接口、任务队列、预览与浏览器界面 |
| `media.py`、`detect_captions.py` | 获取视频、解析字幕轨、检查画面里已有的中文字幕 |
| `engine.py` | 调用 whisper.cpp 识别英文，用 CTranslate2 和 SentencePiece 完成英译中 |
| `voices.py`、`dub.py` | 普通话合成、音色选择、对齐字幕时间轴和成片导出 |
| `clips.py`、`bailian.py` | 调用百炼选片和写稿，按时间轴导出 MP4、SRT 和长帖 |
| `cloud_cache.py` | 保存并恢复 CloudBase 私有断点 |

上表中的源码位于 `Xread/`。Windows 发布包包含运行环境、FFmpeg 和所需模型，组件来源与许可见包内的 `licenses` 和 `tools` 目录。在线版单文件上限为 512 MB，单个会话同时最多有八个待处理任务。[goodAPP 源码目录](https://github.com/delltom2000/goodAPP/tree/main/apps/xread) · [Space 项目页](https://huggingface.co/spaces/dellweb3/Translateall)

在本目录使用 Docker 构建时，先把上方 Windows ZIP 下载到 `releases/Xread-Web-2.3-Windows-x64.zip`。执行 `docker build -t xread .`，然后执行 `docker run --rm -p 127.0.0.1:7860:7860 -e XREAD_SPACE_LOCAL_TEST=1 -e XREAD_CONTAINER_LOCAL=1 xread`，在浏览器访问 `http://127.0.0.1:7860`。
