# 悬浮时钟 · Android

原生 Java Android 应用，支持 Android 8.0 及以上。无需账号、联网或无障碍权限。

## 授权与商业使用

本项目采用自定义的 [goodAPP 非商业免费及商业另行授权许可证](LICENSE)。这是源码可见项目，并非标准开源许可证授权的项目。

- 个人非商业使用、学习、修改及非商业分享免费，分发时须保留许可证和相关声明。
- 出售、广告变现、商业产品集成、有偿客户交付，以及企业内部生产、经营或办公使用，须提前另行取得付费商业授权。
- 商业授权请通过本仓库 Issues 联系维护者；若未启用 Issues，请使用维护者公开的联系方式。范围、价格及期限以书面商业协议为准，捐赠或赞助不等于商业授权。
- 第三方内容及先前合法取得的许可权利按其原有条款处理。

上述说明仅为摘要，具体以 [LICENSE](LICENSE) 为准。

## 下载

[下载悬浮时钟 1.2 APK](https://github.com/delltom2000/goodAPP/raw/refs/heads/main/apps/floating-clock/dist/FloatingClock-1.2.apk)

[返回 App 列表](../../README.md)

## 安装和使用

1. 把 `dist/FloatingClock-1.2.apk` 传到安卓手机，点击安装。首次安装时，按系统提示允许该文件来源安装应用。
2. 打开「悬浮时钟」，点击「开启悬浮时钟」。首次使用需开启「显示在其他应用上层」权限，随后返回应用。
3. Android 13 及以上会请求通知权限，用于展示运行状态和关闭入口；拒绝通知权限也可以使用悬浮窗。
4. 时钟开启后回到桌面，可打开微信或其他应用。拖动时间移动位置，轻点时间展开或收起工具栏。
5. 「设置」调整字号、文字与背景不透明度、数字颜色、毫秒显示，设置即时生效。位置和外观自动保存。
6. 在工具栏、通知或设置页点击「关闭」，停止悬浮窗和后台服务并移除应用任务。按 Home 或返回键仅离开设置页面，已开启的时钟继续运行。

### 1.2 自动跟随重力方向

- 时间始终以 `HH:mm:ss`（或 `HH:mm:ss.SSS`）一行显示，删除 1.1 的分行显示和「横/纵」按钮；旧版的分行设置不再生效。
- 手机竖持、左横持、右横持或倒置时，数字、背景、工具栏整体转正，保留相同布局。
- 使用方向传感器判断握持方向，并扣除系统已完成的屏幕旋转。桌面锁定竖屏时仍可独立转正，不强制改变其他应用的方向。
- 方向稳定 250ms 后切换，倾斜交界处保留当前方向；平放、传感器方向未知时保持当前方向。没有方向传感器时跟随系统屏幕。
- 旋转后同步更新窗口尺寸与触摸区域，并约束到屏幕内；息屏暂停方向监听，退出时释放监听。
- 与旧版签名一致，可覆盖安装保留字号、颜色等设置。

默认样式为金色数字、半透明灰色背景。界面只实现参考图的悬浮时钟和外观设置，不包含广告、会员、购物计时和倒计时。

## 说明

- 显示手机系统的本地时间；校准时间请到手机系统的日期和时间设置。毫秒模式约每 32ms 刷新，并非网络精密授时。
- 息屏暂停刷新，亮屏恢复；不获取唤醒锁，不保持屏幕常亮，不开机自启动，不在关闭后自动重启。
- 系统权限页面、锁屏及主动屏蔽悬浮窗的应用可能不会显示时钟。部分手机的省电策略可能终止服务，可按需要允许后台运行。
- 安装包使用本地测试签名，适合直接安装验证；正式上架需自己的签名及对应商店的前台服务声明审核。

## 源码与构建

本项目位于 `apps/floating-clock/`。所有构建命令均在该目录下执行。

Android Studio 可打开本目录，使用 JDK 17、Android SDK 35、AGP 8.7.3。未提交 Gradle wrapper；可通过 Android Studio 的 Gradle 配置或已安装的 Gradle 8.9 构建 `:app:assembleDebug`。

也提供不依赖 Gradle 和第三方库的 Windows 构建脚本：

```powershell
python scripts/download_sdk.py
powershell -ExecutionPolicy Bypass -File scripts/build.ps1 -JavaHome "你的 JDK 17 目录"
```

脚本使用 Android 官方 SDK 的 aapt2、D8、zipalign、apksigner，生成并验证 `dist/FloatingClock.apk`。构建工具下载到 `.tools`，不修改全局环境；测试签名保存在 `.tools/debug.jks`，保留它可以覆盖安装后续版本。

若平台 SDK 下载缓慢，可运行 `python scripts/download_platform.py` 分段下载 Android 35 平台包。

## 本次构建验证

已通过方向角单元测试（16 种传感器/屏幕方向组合、锁定竖屏、左右横持、方向交界和未知角度）、Java 编译、D8 转换、资源打包、zipalign，以及 APK v2/v3 签名验证；已检查包名、启动入口、最低系统版本及权限声明。本机没有连接安卓设备，尚未完成真机安装和悬浮交互验证。

## 真机验收

- 首次拒绝/授予悬浮权限、通知权限后，分别检查启动流程。
- 开启后切换至其他应用，观察秒跳动；拖动至屏幕四角，切换横竖屏。
- 分别在系统自动旋转开启、关闭，以及锁定竖屏的桌面中测试竖持、左横持、右横持和倒置；检查单行时间、工具栏、拖动、点击和屏幕边缘。再测试毫秒、平放、息屏后恢复。
- 调整所有外观参数、收起和展开工具栏，重开后确认保存。
- 息屏后再亮屏，确认时间恢复同步。
- 分别从工具栏、通知、设置页关闭，确认悬浮窗消失、通知撤销、服务停止。

Android API 参考：[悬浮窗口](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#TYPE_APPLICATION_OVERLAY)、[前台服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types)。

方向传感器依据：[Android OrientationEventListener](https://developer.android.com/reference/android/view/OrientationEventListener)。
