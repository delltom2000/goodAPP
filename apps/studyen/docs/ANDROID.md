# 安卓构建与分发

## 环境

提供的自动脚本面向 Windows x64，需 Python 3.10+、PowerShell 5.1+ 和网络连接。应用工程使用 Java 17 语言级别，当前验证工具组合：JDK 21、Gradle 8.9、Android Gradle Plugin 8.7.3、Android SDK 35 / Build Tools 35.0.0、Command-line Tools 23.0。

应用标识为 `com.jianjin.ielts`；版本名 `0.2.1`，版本号 `3`；minSdk 26，targetSdk 35。

## 首次构建

在 `apps/studyen` 目录中执行：

```powershell
python -X utf8 scripts/setup-android.py
```

脚本自动取得 JDK 下载元数据，对下载文件校验摘要，并将 JDK、Gradle 和安卓命令行工具保存在 `.toolchain/`。不需要 Google 登录，不将工具加入系统全局 PATH。工具下载仍适用各自许可；JDK 元数据使用当前 21 系列更新版，不承诺二进制逐字节复现。

阅读 [Android SDK 许可](https://developer.android.com/studio/terms)，同意后运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1 -AcceptAndroidSdkLicense
```

参数明确表示构建者接受 SDK 许可。脚本保留本机确认记录，再安装所需 SDK；不登录 Google，不上传项目。后续构建：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1
```

构建自动复制 `dist/` 到安卓 assets，排除 `downloads/`，避免把 APK 再打进 APK。成功后执行签名校验，再更新 `dist/downloads/jianjin-ielts-debug.apk` 与下载状态。提交更新包前需重新计算 `SHA256.txt`。

## 签名与升级

测试私钥位于 `.toolchain/debug.keystore`，不会提交。仓库 APK 使用维护者本机的该密钥。保留同一私钥并递增 `versionCode` 才能正常覆盖更新；换密钥构建的包不能覆盖旧签名安装。请自行安全备份签名材料，不要上传仓库。

此包不是应用商店正式发布包。正式上架需独立的发行签名、商店元数据、隐私说明与真机测试。

## 离线实现

- `MainActivity.java` 将 APK 内 assets 映射到固定 HTTPS 虚拟域，WebView 不开放本地文件读取。
- 原生桥接只提供 TTS 可用性检查、播放与停止；外部 HTTPS 参考链接由系统浏览器处理。
- Manifest 不请求网络、麦克风、相机或文件存储权限。离线英语朗读取决于设备已安装的语音包。
- 安卓返回键在作答时返回训练列表，保留本次会话的练习；用户可继续查看其他模块。

## 已验证与待验证

已验证：Gradle 编译、APK v2 签名、应用包名与最低版本、内置题库数量、网页文件与 APK assets 一致。

待验证：真机安装、升级后数据保留、安卓返回手势、系统英语语音、不同屏幕与 WebView 版本。首次下载构建依赖可能较慢；若存在网络代理问题，仅调整自己的构建环境，不在仓库保存访问令牌。
