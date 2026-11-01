# goodAPP

一些实用的小 App，持续更新。每个 App 放在独立目录，源码、使用说明和构建方式互不混杂。

## App 列表

| App | 平台 | 功能 | 源码与说明 | 安装包 |
| --- | --- | --- | --- | --- |
| 悬浮时钟 | Android 8.0+ | 跨应用显示时间、拖动位置、外观调整、跟随握持方向旋转 | [floating-clock](apps/floating-clock/) | [下载 1.2 APK](https://github.com/delltom2000/goodAPP/raw/refs/heads/main/apps/floating-clock/dist/FloatingClock-1.2.apk) |

悬浮时钟目前为测试版本：已通过编译、签名校验和方向计算单元测试；不同手机上的实际重力旋转和后台运行行为仍需验证。安装包使用测试签名。

## 目录结构

```text
goodAPP/
├── LICENSE                  # 仓库统一授权条款
├── README.md                # App 列表
└── apps/
    └── floating-clock/      # 悬浮时钟独立 Android 项目
        ├── app/            # Android 源码及资源
        ├── scripts/        # 构建脚本
        ├── tests/          # 方向计算测试
        ├── dist/           # 当前 APK 与 SHA-256 校验文件
        ├── LICENSE
        └── README.md       # 使用与构建说明
```

后续 App 放入 `apps/<app-name>/`，并在上面的表格中添加入口。构建方法以各 App 的 README 为准。

## 授权

本仓库采用自定义的 [goodAPP 非商业免费及商业另行授权许可证](LICENSE)，是源码可见项目，不采用 MIT、Apache 或 GPL 等标准开源许可证。

- 个人非商业使用、学习、修改和非商业分享免费；分发时保留许可证和相关声明。
- 出售、广告变现、商业产品集成、有偿客户交付，以及企业内部生产、经营或办公使用，须提前取得付费商业授权。
- 第三方内容和明确另有许可的部分按其对应许可证执行。
- 具体范围以 LICENSE 为准；费用、期限及授权范围通过书面商业协议另行约定。

商业授权或问题反馈请在 [Issues](https://github.com/delltom2000/goodAPP/issues) 中联系维护者。请勿在公开 Issue 中提交令牌、密钥或其他敏感信息。
