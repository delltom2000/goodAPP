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

# Xread 2.2 中文视频译制台

粘贴公开 X 帖子链接，或上传一段本地英文视频，就能听原声看中文字幕，也能制作普通话配音版。直接打开工作台即可开始。[进入在线工作台](https://dellweb3-translateall.hf.space)

## 第一次使用

1. 在「X 帖子链接」中每行粘贴一条链接，或点「本地视频」一次选择多个文件。如果 Space 读取不到某条帖子，可以上传已保存的视频。
2. 先选音色和朗读风格，点「试听」比较停顿和语气。五个女声、三个男声都能搭配「自然交谈」「演讲」或「甜美讲述」，也可一键选用「青禾 · 演讲」或「小满 · 甜美」。
3. 勾选「原声＋中文字幕」或「中文配音＋中文字幕」，也可以两项都选。首次默认仅选原声。点「开始翻译」，到「任务与历史」查看每条视频的进度。
4. 在播放器中切换源视频和已就绪的成片。双选时，原声版先完成就可下载；两版完成后，也可从「导出」下载双音轨 MP4，在 VLC 等播放器中切换音轨。需要双语 SRT 时，先点「双语对照」再导出。

已有中英文字幕时，Xread 会优先复用。只有英文时，系统保留英文时间轴并翻译；缺少可用字幕时，则先识别英文对白。原画已印有中文的片段可选「原画已有中文」，避免叠加第二层文字。

## 云端会话与文件

上传的视频在 Space 的 CPU 上处理。任务按浏览器会话隔离，换浏览器或清除网站数据后可能无法再打开之前的记录。云端任务库使用临时存储，Space 重启、重建或清理时，视频、字幕和成片都可能被移除。**需要保留的成片和字幕，请在处理完成后下载。**

Space 使用免费的 CPU Basic 算力。长视频的识别、配音和转码需要排队；空间休眠后，首次打开可能需要等待启动。[Hugging Face Spaces 硬件与运行说明](https://huggingface.co/docs/hub/spaces-overview)

## Windows 本地版

要在自己的电脑上处理和保存视频，请下载 Windows x64 压缩包，完整解压后双击 `Start Xread.cmd`。浏览器会打开本机工作台，识别、翻译和配音模型随包提供。下载 X 视频需要联网，已保存的视频可以在本机离线处理。[下载 Windows x64 版](https://dellweb3-translateall.hf.space/download/windows) · [查看 goodAPP 项目源码](https://github.com/delltom2000/goodAPP/tree/main/apps/xread)
