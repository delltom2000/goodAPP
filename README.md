# goodAPP

一些实用的小 App，持续更新。每个 App 放在独立目录，源码、使用说明和构建方式互不混杂。

## App 列表

| App | 平台 | 功能 | 源码与说明 | 安装包 |
| --- | --- | --- | --- | --- |
| 悬浮时钟 | Android 8.0+ | 跨应用显示时间、拖动位置、外观调整、跟随握持方向旋转 | [floating-clock](apps/floating-clock/) | [下载 1.3 APK](https://github.com/delltom2000/goodAPP/raw/refs/heads/main/apps/floating-clock/dist/FloatingClock-1.3.apk) |
| 净片 CleanClip | Android 8.0+ / 网页 | 手机离线自动查找角落 Logo、跟随位置变化并修补导出；电脑 LaMa 修补工具 | [使用说明](apps/cutlogo-apps/apps/cleanclip/README.md) · [在线体验](https://huggingface.co/spaces/dellweb3/CutLogo) | [0.4.0 自动版 APK](apps/cutlogo-apps/dist/cleanclip-0.4.0-auto.apk) |
| 币市脉搏 Crypto Pulse | Android 8.0+ / 网页 | 500 个活跃币实时行情；新币雷达用 12 个因子给出可解释评分；自选、中英切换、断网保留离线快照 | [使用说明](apps/crypto-pulse/README.md) | [下载 1.0.0 APK](https://github.com/delltom2000/goodAPP/raw/refs/heads/main/apps/crypto-pulse/dist/CryptoPulse-1.0.0.apk) · [发布页](https://github.com/delltom2000/goodAPP/releases/tag/crypto-pulse-v1.0.0) |

悬浮时钟目前为测试版本：已通过编译、签名校验和方向计算单元测试；不同手机上的实际重力旋转和后台运行行为仍需验证。安装包使用测试签名。

币市脉搏 1.0.0 的行情与评分逻辑已通过浏览器实机校验（含 390px 竖屏、断网保留数据、中英切换），安卓端构建可复现、签名校验通过；行情接口在部分网络环境需要代理，连不上时页面保留上次数据并标注离线时间。

## 目录结构

```text
goodAPP/
├── LICENSE                  # 仓库统一授权条款
├── README.md                # App 列表
└── apps/
    ├── floating-clock/      # 悬浮时钟：独立 Android 项目
    │   ├── app/             # Android 源码及资源
    │   ├── scripts/         # 构建脚本
    │   ├── tests/           # 方向计算测试
    │   ├── dist/            # 当前 APK 与 SHA-256 校验文件
    │   ├── LICENSE
    │   └── README.md        # 使用与构建说明
    ├── cutlogo-apps/        # 净片 CleanClip：手机端 + 电脑端 + 在线体验
    │   ├── apps/cleanclip/  # Android / Python / 网页源码
    │   └── dist/            # 当前 APK
    └── crypto-pulse/        # 币市脉搏：网页 + Android 壳
        ├── css/ js/ icons/  # 前端源码与 PWA 资源
        ├── android/         # 安卓壳工程与免 Gradle 构建脚本
        ├── dist/            # 当前 APK 与 SHA-256 校验文件
        ├── LICENSE
        └── README.md        # 使用、数据来源与构建说明
```

后续 App 放入 `apps/<app-name>/`，并在上面的表格中添加入口。构建方法以各 App 的 README 为准。

## Language / 语言

Floating Clock 1.3 supports **中文 / English** in its settings. The selected language is saved and applies to settings, the overlay toolbar, notifications, and the built-in license viewer.

Crypto Pulse has a persistent **EN / 中文** switch at the top right of both pages. It switches menus, tabs, table headers and score dimension names together; generated score explanations stay in Chinese for now.

## 授权

许可证：[中文](LICENSE.zh-CN) · [English](LICENSE.en)。英文为对应译文，有歧义时以中文为准。

本仓库采用自定义的 [goodAPP 非商业免费及商业另行授权许可证](LICENSE)，是源码可见项目，不采用 MIT、Apache 或 GPL 等标准开源许可证。

- 个人非商业使用、学习、修改和非商业分享免费；分发时保留许可证和相关声明。
- 出售、广告变现、商业产品集成、有偿客户交付，以及企业内部生产、经营或办公使用，须提前取得付费商业授权。
- 第三方内容和明确另有许可的部分按其对应许可证执行。
- 具体范围以 LICENSE 为准；费用、期限及授权范围通过书面商业协议另行约定。

商业授权或问题反馈请在 [Issues](https://github.com/delltom2000/goodAPP/issues) 中联系维护者。请勿在公开 Issue 中提交令牌、密钥或其他敏感信息。
