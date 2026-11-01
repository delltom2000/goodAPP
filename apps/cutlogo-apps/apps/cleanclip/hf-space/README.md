---
title: 净片 CleanClip
emoji: 🎞️
colorFrom: green
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: 视频 Logo 追踪、背景修补与 MP4 对比导出
---

# 净片 CleanClip 网页版

导入视频 → 框选 Logo 或上传样图 → 识别位置 → 修补 → 对比和下载 MP4。
支持固定角标，以及 LaMa AI 修补和 OpenCV 快速填补。

这是云端版本：素材上传至此 Hugging Face Space 的临时存储，由服务器 CPU
处理，不是在你的电脑 GPU 上运行。每个浏览器标签页使用独立会话；任务和视频
只对持有该会话的浏览器开放。不要上传敏感素材。
会话闲置约一小时后过期，后台定期清理已停止任务的文件；处理中任务保留至结束。
Space 重启可能丢失结果，完成后请及时下载。每个会话最多三段视频；服务同时处理一个任务。

视频限制：200 MB、120 秒、最长边 1920 像素。免费 CPU 上 LaMa 较慢，建议先用几秒片段，
也可选择“快速填补”。复杂背景可能涂抹或闪烁，不保证无痕修复。

原始源码和 Android 自动版：[goodAPP / CutLogo](https://github.com/delltom2000/goodAPP/tree/main/apps/cutlogo-apps)。
本 Space 不包含本地用户视频、签名密钥、任何账户令牌或安卓工具链。
原创代码沿用子项目 MIT 许可；OpenCV 与 LaMa 的许可证在 `licenses/` 目录。
