# 雅思一本通 · studyen

面向中文用户的 IELTS Academic 备考原型，包含本地网页和安卓离线 App，共用一套题库与训练逻辑。当前版本 **0.2.1**；现有页面和安卓桌面名称仍显示「渐进 IELTS」。

[下载安卓体验包](https://github.com/delltom2000/goodAPP/raw/refs/heads/main/apps/studyen/dist/downloads/jianjin-ielts-debug.apk) · [SHA-256 校验](dist/downloads/SHA256.txt) · [返回 App 列表](../../README.md)

## 已实现的功能

| 模块 | 当前能力 |
| --- | --- |
| 基础与考点 | 时态、主谓一致、连接关系、阅读定位和听力干扰信息 |
| 专项训练 | 选择、判断、填空、推断、标题和观点题；写作草稿、口语准备笔记 |
| 错题本 | 自动收录错误；再次答对后移出待复习列表 |
| 自动组卷 | 12 / 30 / 60 题；按最近错误考点加权，优先未做题并减少题干重复 |
| 全科流程 | 听力 40、阅读 40、写作 2、口语 3，共 85 项的限时流程练习 |
| 学习报告 | 本机作答正确率、薄弱考点和练习历史；不伪造雅思总分 |
| 自由导航 | 做题途中可浏览其他页面，再通过「继续作答」返回；限时练习继续计时 |

## 题库数量与质量

当前总计 **10,000 条训练题 / 任务**：阅读 4,000、听力 3,500、语法 1,500、写作 500、口语 500。

其中 24 条为原型种子题、9,964 条为规则生成变式、12 条为独立编写的阅读题。同一材料中的多个小题分别计数。**这不是 10,000 道实考试题，也不是经过教师逐题审核或雅思难度校准的题库。**

题型参考官方公开备考资料；近一年公开回忆记录只作为话题线索。题库不收录 Cambridge 付费书籍全文。详细来源、题型字段及审核计划见 [题库说明](docs/QUESTION_BANK.md)。

## 运行网页

需要 Python 3.10+，不需要 npm 安装或前端构建。从仓库根目录运行：

```sh
cd apps/studyen
python -m http.server 4173 --bind 127.0.0.1 --directory dist
```

浏览器打开 **http://localhost:4173**。Windows 也可双击 `start-local.cmd`。请通过 HTTP 打开，直接双击 HTML 文件可能无法加载 JSON 题库。此地址只供运行服务的电脑访问；手机应安装 APK。

本项目默认本地运行。本次 GitHub 发布保存源码和安装包，没有另外部署公网网站。

## 安卓安装

1. 将上方 APK 下载后传到安卓手机，按手机提示安装。
2. 支持 Android 8.0+，建议使用更新过的 Android System WebView。
3. App 内置网页与题库，无需连接电脑，不需要 Google 登录；英语朗读需要系统安装可用的英语 TTS 语音。
4. 当前 APK 使用测试签名，适合体验；尚未进行真机安装、语音和不同厂商兼容性验证。

此包与之前的 0.2.0 使用同一调试签名，可覆盖升级。自行在另一台电脑重新构建会生成不同测试密钥，通常不能直接覆盖已安装的官方仓库体验包。构建方法及签名说明见 [安卓构建](docs/ANDROID.md)。

## 数据与已知限制

- 作答、目标、错题和草稿保存在当前浏览器或 App 的本地存储中；两端暂不互相同步。
- 切换站内页面可保留当前练习；刷新页面、关闭网页或结束 App 进程后，未交卷试卷暂不恢复。
- 听力为合成语音；阅读仍以短篇训练材料为主。全科流程暂不具备正式三篇阅读结构或分科锁定计时。
- 写作与口语不自动评分、不录音；当前统计不能用于可靠预测 IELTS Band。
- 清除浏览器站点数据或 App 数据会删除学习记录。尚无账号、云同步、支付或后台管理。

## 开发与验证

需要 Node.js 18+ 运行测试；题库生成器需要 Python 3.10+。

```sh
python -X utf8 scripts/generate-bank.py
node scripts/test-engine.cjs
node scripts/test-navigation.cjs
node --check dist/app.js
node --check dist/upgrade.js
node --check dist/exam-engine.js
```

已检查题库数量与标识、答案结构、100 套组卷、全科配比、导航切换及进度保留；APK 已编译并通过 v2 签名校验。程序检查不能替代题目教学审校和真机验证。

## 目录

```text
studyen/
├── README.md                 # 使用入口与当前边界
├── CHANGELOG.md              # 版本记录
├── LICENSE*                  # 与 goodAPP 仓库一致的许可
├── docs/                    # 题库、架构和安卓构建说明
├── dist/                    # 可直接服务的网页源码
│   ├── data/                # 共享材料去重后的题库
│   └── downloads/           # APK、下载状态和 SHA-256
├── android/                 # Java WebView + 原生 TTS 工程
├── scripts/                 # 生成器、回归测试和构建工具
└── start-local.cmd          # Windows 本地启动入口
```

## 授权

遵循仓库的 [goodAPP 非商业免费及商业另行授权许可证](LICENSE)，属于源码可见项目，不宣称采用 MIT / Apache / GPL 开源许可。个人非商业使用按许可证免费；商业用途需另行取得授权。第三方工具、Android SDK 和参考资料各自的许可不因本项目而改变。

本项目不是 IELTS 官方产品，未获 IELTS 或 Cambridge 官方背书。问题反馈请到 [仓库 Issues](https://github.com/delltom2000/goodAPP/issues)，注明 `studyen` 和版本，不要提交令牌、签名私钥或个人学习数据。
