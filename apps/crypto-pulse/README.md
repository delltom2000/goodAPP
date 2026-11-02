# 币市脉搏 · Crypto Pulse

加密行情与新币雷达，网页版 + 安卓 App 两个入口，共用同一套前端与自选库。

不接钱包、不交易、不需要账号，只做行情聚合和可解释的项目评分。

## 两个页面

| 页面 | 内容 |
| --- | --- |
| **市场脉搏** `index.html` | 按成交额筛出的活跃 TOP 500 个 USDT 交易对，实时价格、24h 涨跌幅、成交额、区间位置；支持搜索、排序、自选、点开查详情 |
| **新币雷达** `newcoins.html` | 最近 90 天上链的项目，多所取并集；A / B / C / D 评级 + 12 个可解释因子评分；自选面板带实时补价 |

两页顶部互相切换，自选库互通。

## 功能要点

- **实时行情**：REST 5 秒快照打底，Binance WebSocket 推送覆盖价格与涨跌幅；主站连不上时按 `data-api.binance.vision` → `api1` ～ `api4` 顺序回退。
- **竖屏可用**：手机宽度下自动收成 5 列（币名 / 价格 / 涨跌幅 / 成交额 / 涨跌额），上线天数改为行内角标，不横向滚动。
- **自选**：主站顶栏「自选」、新币页左侧标签都能进；不在当前池里的币（如 BTC、SOL）会按需单独补查价格，不会只显示币名。
- **中英切换**：右上角 `EN / 中文` 常驻，菜单、分页、表头、币种详情维度名一起切；已生成的评分说明长句保持中文原文。
- **可解释评分**：点开任意新币能看到每一分是怎么来的——12 个因子的得分、满分、结论和风险标记，不是一个黑箱总分。
- **离线优先**：同步失败不清空，保留上一次成功的数据并在状态条标出「离线数据 · 21:42」；从不显示「刚刚」这类相对时间。
- **省流量**：前台 5 分钟同步一次，后台 30 分钟；切回前台立即补一次。

## 下载与安装

**网页版（免安装，手机浏览器直接打开）**：https://crypto-pulse-87453.app.workbuddy.host/?sharecode=HBNRIO22TM

**安卓 App**：[下载 CryptoPulse 1.0.0 APK](https://github.com/delltom2000/goodAPP/raw/refs/heads/main/apps/crypto-pulse/dist/CryptoPulse-1.0.0.apk) · SHA-256 见 [dist/SHA256.txt](dist/SHA256.txt) · 备用：[发布页](https://github.com/delltom2000/goodAPP/releases/tag/crypto-pulse-v1.0.0)

支持 Android 8.0 及以上（minSdk 26），已用 v2 + v3 方案签名，大小 1.2 MB。

1. 把 APK 传到手机点击安装，首次安装按系统提示允许该来源安装应用。
2. 打开「币市脉搏」，首次加载会拉一次全量行情，约 2 秒出表。
3. 行情接口在部分网络环境下需要代理；连不上时页面保留上次数据并标注离线时间，不会白屏。

安装包使用本项目测试签名。仓库不包含签名密钥（`*.jks` 已忽略），自行构建会生成新密钥，覆盖安装前需先卸载旧版。

### 自己跑一份网页版

静态站点，任意静态服务器都能跑：

```bash
python -m http.server 8420 --bind 127.0.0.1
```

也可以直接双击 `start.bat`（Windows），会自动开浏览器。因为要读行情 API，必须走 HTTP 而不是 `file://` 打开。支持 PWA，桌面浏览器可「安装」成独立窗口。

线上那份由 `tools/stage-web.sh` 把纯网页资源（`index.html`、`newcoins.html`、`css/`、`js/`、`icons/`、`manifest.webmanifest`、`sw.js`）同步到仓库根的 `web-dist/` 后发布，不含安卓工程与 APK。改完前端重新执行一次脚本再发布即可。

## 使用说明

- **市场脉搏**：搜索框输代码或全名；点表头排序；行右侧 `☆` 收藏；点整行弹出详情，含 24h 高低、成交额、区间位置。
- **新币雷达**：左侧标签切换 `全部 / 关注 / 自选`；点项目名打开评分详情，逐条列出交易所背书、官方风险信号、流动性、交易持续性、跨所一致性、价格稳定性、资金关注度、价格动量、市值空间、上线新鲜度、赛道叙事、回撤位置。
- 评级口径：综合分 = 可靠性 × 0.55 + 潜力 × 0.45；A ≥ 68 且可靠性 ≥ 55，B ≥ 55 且可靠性 ≥ 42，C ≥ 42，其余 D。数据缺失的因子给中性分并标注「缺数据」，不会因为缺一项就把项目判死。

## 数据来源

| 来源 | 用途 |
| --- | --- |
| Binance（`api.binance.com` / `data-api.binance.vision` / `api1`～`api4`） | 行情主源、WebSocket、官方标签与流通量 |
| OKX / Bybit / Gate / Bitget | 行情交叉校验、新币池并集、跨所一致性 |
| CoinGecko | 市值、历史高点等元数据，本地缓存 6 小时 |

只读公开接口，不带 key，不做任何写操作。行情、评分均为信息展示，不构成投资建议。

评分模型版本见 `js/score.js` 里的 `MODEL_VERSION`，当前 `v1.0.2026-11`。

## 源码与构建

```text
crypto-pulse/
├── index.html / newcoins.html     # 两个页面
├── css/ js/                       # 样式与逻辑（config / datafeed / render / score / newfeed / i18n / snap / quote）
├── icons/                         # PWA 图标
├── manifest.webmanifest · sw.js   # PWA 与离线缓存
├── start.bat                      # Windows 一键起本地服务
├── tools/stage-web.sh             # 同步纯网页资源到 web-dist/ 用于线上发布
├── android/                       # 安卓壳工程
│   ├── build.sh                   # 构建脚本（不依赖 Gradle）
│   ├── emulator-run.sh            # 模拟器一键装包截图
│   ├── tools/gen_bundle.py        # 把网页资源编进 dex
│   ├── jvmtest/                   # 资源解包与路径映射的 JVM 测试
│   └── app/src/main/              # 清单、Java、资源
└── dist/                          # APK 与 SHA-256
```

安卓端是一个 WebView 壳，但有两点和常见做法不同：

- **不通过 Gradle 构建**：`aapt2 compile → link → javac → d8 → zipalign → apksigner` 全流程在 `android/build.sh` 里，只需要 JDK 17 和 Android SDK（platform 34 + build-tools 34.0.0）。
- **网页资源编进 dex**：部分机型（实测 HONOR Android 16）的 `AssetManager` 挂不上本 APK 的 assets 路径，`getAssets().open()` 直接 `FileNotFoundException`，真机白屏。`tools/gen_bundle.py` 把 21 个文本资源打包成 `count + [nameLen,name,dataLen,data]`，gzip 后 base64 切块写进 `WebBundle.java`，由 `shouldInterceptRequest` 直接从内存返回，彻底绕开 AssetManager。

构建：

```bash
# 工具链位置可用 TC / JAVA_HOME / ANDROID_SDK_ROOT 覆盖
TC=/path/to/toolchain bash android/build.sh
```

产物落在 `dist/CryptoPulse-1.0.0.apk`，脚本末尾会自己验签并检查 `MainActivity`、`WebBundle` 是否真的进了 dex。

### 已验证

- 构建可复现：21 个文本资源打包后逐个 MD5 比对一致，dex 137 KB，APK 1.2 MB。
- 签名：apksigner 校验通过，v2 + v3。
- 竖屏 390px：表格 5 列对齐、无横向溢出、`EN` 吸附右上角。
- 断网：主站 120 行 / 新币 50 项保留，显示「离线数据 · HH:MM」，控制台零错误。
- 资源解包与路径映射：JVM 下 20ms 解出 21 个文件，逐文件 MD5 与源目录一致；路径映射 11 个用例全部正确（含去 query、去 hash、拦截 `..` 穿越）。

### 已知限制

- 行情和官方标签接口在部分网络环境需代理；离线时会一直停留在最后一次成功的时间点。
- 评分说明的整句文案未做英文翻译，切到 EN 后这部分仍是中文。
- 安卓端未在真机完成长稳测试；模拟器需宿主开启 VT-x，本次未跑通。
- 新币池来自各所公开接口的并集，交易所下架的极早期项目可能漏掉。

## 授权

本项目采用仓库统一的 [goodAPP 非商业免费及商业另行授权许可证](LICENSE)。个人非商业使用免费；出售、广告变现、商业产品集成、企业内部生产经营使用须另行取得付费商业授权。具体以 [LICENSE](LICENSE) 为准。

[返回 App 列表](../../README.md)
