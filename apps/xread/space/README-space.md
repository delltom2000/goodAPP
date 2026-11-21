---
title: Xread 中文视频译制台
emoji: 🎬
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
suggested_hardware: cpu-basic
short_description: 将英文视频制作成带中文字幕的原声或中文配音 MP4
---

# Xread 中文视频译制台

粘贴公开 X 帖子链接，或上传一段本地英文视频，就能听原声看中文字幕，也能制作普通话配音版。直接打开工作台即可开始。[进入在线工作台](https://dellweb3-translateall.hf.space)

## 第一次使用

1. 在「X 帖子链接」中每行粘贴一条链接，或点「本地视频」一次选择多个文件。如果 Space 读取不到某条帖子，可以上传已保存的视频。
2. 首次使用默认「原声＋中文字幕」，适合访谈和演讲。想听中文时选「中文配音」，可以先试听自然女声、清亮女声或男声。选定固定音色后，全片都用同一种声音。
3. 点「加入队列」，在「任务与历史」中查看每条视频的阶段和进度。点击字幕可跳到对应画面，也可以打开「编辑」校对译文。
4. 制作完成后可切换源视频和成片，也可下载成片 MP4。在「导出」里保存 SRT；需要中英对照时，先点「双语对照」再导出。

已有中英文字幕时，Xread 会优先复用。只有英文时，系统保留英文时间轴并翻译；缺少可用字幕时，则先识别英文对白。原画已印有中文的片段可选「原画已有中文」，避免叠加第二层文字。

## 云端会话与文件

上传的视频在 Space 的 CPU 上处理。任务按浏览器会话隔离，换浏览器或清除网站数据后可能无法再打开之前的记录。云端任务库使用临时存储，Space 重启、重建或清理时，视频、字幕和成片都可能被移除。**需要保留的成片和字幕，请在处理完成后下载。**

Space 使用免费的 CPU Basic 算力。长视频的识别、配音和转码需要排队；空间休眠后，首次打开可能需要等待启动。[Hugging Face Spaces 硬件与运行说明](https://huggingface.co/docs/hub/spaces-overview)

## Windows 本地版

要在自己的电脑上处理和保存视频，请下载 Windows x64 压缩包，完整解压后双击 `Start Xread.cmd`。浏览器会打开本机工作台，识别、翻译和配音模型随包提供。下载 X 视频需要联网，已保存的视频可以在本机离线处理。[下载 Windows x64 版](https://huggingface.co/spaces/dellweb3/Translateall/resolve/main/releases/Xread-Web-2.1-Windows-x64.zip?download=true) · [查看 goodAPP 项目源码](https://github.com/delltom2000/goodAPP/tree/main/apps/xread)
