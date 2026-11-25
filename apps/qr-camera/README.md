# 扫码相机

Android 6.0 及以上。支持后置相机实时扫码和相册图片识别。

[下载安装包](dist/QrCamera-1.0.apk)

## 用手机确认 Google 通行密钥

1. 在电脑保留 Google 登录页，显示一张新生成的通行密钥二维码。打开电脑和手机的蓝牙。
2. 在手机打开扫码相机，点「打开相机」并允许相机权限，扫电脑上的二维码。
3. 点「打开通行密钥验证」，按 Google Play 服务显示的提示操作。手机需要可用的 Google Play 服务，以及该账号的通行密钥。

普通网址和短信二维码会分别打开对应的应用。扫码识别在手机本地完成，通行密钥码和验证器密钥不会显示在结果里。

## 构建

Windows 下使用 JDK 17、Android SDK Platform 34、Build Tools 34.0.0、ZXing Core 3.5.3 和本机签名库。给当前 PowerShell 进程设置 `QRCAMERA_KEYSTORE_PASSWORD`，然后运行 `android/build.ps1`，传入 `JavaHome`、`BuildTools`、`AndroidJar`、`ZxingJar`、`Keystore` 和 `OutputApk`。签名别名为 `qr-camera`。

ZXing 的许可证随安装包分发，见 [Apache 2.0 许可](android/assets/licenses/ZXing-LICENSE.txt)。
