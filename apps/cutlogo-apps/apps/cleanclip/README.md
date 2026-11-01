> Android 手机独立自动版请看 [0.4.0 使用说明](ANDROID-OFFLINE.md)，安装 [自动版 APK](../../dist/cleanclip-0.4.0-auto.apk)。导入视频后点击“自动查找 Logo 并消除”即可，下面是电脑本地网站及旧客户端说明。

## 在线网页版

[Hugging Face / CutLogo](https://huggingface.co/spaces/dellweb3/CutLogo) · [直接打开](https://dellweb3-cutlogo.hf.space)。云端使用 Space CPU 处理，素材会临时上传；按浏览器标签页隔离会话，闲置约一小时后过期并定期清理，完成后请及时下载。LaMa 在 CPU 上较慢，建议先用短片段；支持快速填补。网页操作仍为框选或导入样图后自动跟踪，手机 APK 的主按钮支持无样图自动检测。

部署源码在 `hf-space/`。运行 `python hf-space/package_space.py` 生成 `build/hf-space/`，只将该目录中运行必需的文件上传到 Docker Space。`python hf-space/test_hosted.py` 验证会话、任务和媒体隔离；部署使用现有 CPU 配置，不请求付费硬件。

# 净片本地网站

直接访问 http://127.0.0.1:8765/ ，无需连接码、登录或账号。使用本机 GPU 处理，视频不上传第三方。

双击 `打开净片.cmd` 可启动并打开网站；命令行可运行 `python server.py --host 127.0.0.1`。仅本机访问，不开放局域网或公网。

默认保留视频完整时长。当前样片按用户选择保留前 15.25 秒，裁去品牌片尾，移动 Logo 和左上角 AI 生成角标均已修补。输出保留音轨，不覆盖原片。

操作：导入视频 → 框选 Logo → 识别位置 → 检查选区 → 修补 → 播放与下载。固定角标可以另选区域一起处理。默认不裁片尾，结束时间仅在用户主动修改时缩短。

## 依赖与构建

本机验证：Python 3.11、OpenCV 4.9.0、NumPy 1.26.3、PyTorch 2.1.0+cu121、FFmpeg、RTX 3050 8 GB。

新环境需自行安装对应 GPU 的 PyTorch，以及 `numpy<2`、`opencv-python`，确保 ffmpeg 与 ffprobe 在 PATH。运行 `python download_model.py` 下载约 206 MB 的 LaMa TorchScript 模型，脚本验证已记录的 SHA-256。

Android 本机构建：`python build_android.py`，使用父仓库 `.toolchain` 中已安装的 JDK 17 与 Android SDK。构建脚本需要父仓库开发签名。当前是开发签名测试 APK，尚未上架。

源码：`core.py` 为识别与修补，`server.py` 为本地 HTTP API，`web/` 为无框架网页，`android/` 为原生连接页与 WebView 文件选择/保存实现。

## 隐私与限制

- 默认只监听本机，不连接云服务。当前用户明确选择本机/USB 模式。
- 视频、样图与结果保存在 `runtime/`，不自动删除；用户用完可自行清理。源码包排除这些文件、连接码和模型。
- 媒体与 API 仅允许本机同源访问，不要求连接码。该服务不是面向公网的多用户服务。
- 一次处理一个任务；最多 120 秒、200 MB、最长边 1920 px。保留导出范围内音频，重新编码为 AAC。
- 使用你有权编辑的素材。原视频从不覆盖。

## 第三方

LaMa 模型与项目：https://github.com/advimman/lama ，Apache 2.0；TorchScript 分发来自 https://github.com/enesmsahin/simple-lama-inpainting/releases/tag/v0.1.0 。对应许可证保存在 `licenses/`。模型摘要：`7ba7aa7ac37a4d41fdbbeba3a2af7ead18058552997e3a3cd1a3b2210c9e6b4c`。

本项目原创代码按父仓库 MIT 许可证提供；第三方软件、模型遵守各自许可证。没有将用户视频提交到 GitHub 或公开托管。

## 0.2 网页更新

工作台视觉升级；新增固定角标选区，可与移动 Logo 同时修补；新增同步播放对比。样片默认固定角标区域为 12,12,78,34（原视频像素坐标），可自行替换选框。

## Android 0.2.0（无连接码）

安装 `dist/cleanclip-0.2.0-preview.apk`，支持 Android 8.0 及以上；建议更新 Android System WebView。新版启动直接打开工作台，没有账号、连接码或地址输入。

1. 电脑打开净片本地网站并保持服务运行。
2. 手机通过 USB 连接，开启 USB 调试并允许本机。
3. 在本目录运行 `connect-usb.ps1`，然后启动 APP。

APP 是电脑服务的客户端，视频修复使用电脑 GPU，不能在手机上独立离线修复。使用原有开发签名，可覆盖安装此前同包名版本。本次完成编译、签名与包信息检查，真机导入、播放和保存由用户人工验收。
