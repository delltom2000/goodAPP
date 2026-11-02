package com.niulai.crypto;

/**
 * URL 路径 → 内置资源键 的映射。
 * 故意不依赖任何 android.* 类，便于在 JVM 上直接跑单元测试（android/jvmtest）。
 */
final class AssetMap {

  private AssetMap() {}

  /**
   * @return 资源键（如 "index.html"、"js/app.js"）；路径穿越等非法输入返回 null
   */
  static String keyOf(String path) {
    if (path == null || path.isEmpty() || "/".equals(path)) return "index.html";

    String k = path.charAt(0) == '/' ? path.substring(1) : path;

    int cut = k.indexOf('?');
    if (cut >= 0) k = k.substring(0, cut);
    cut = k.indexOf('#');
    if (cut >= 0) k = k.substring(0, cut);

    if (k.isEmpty()) return "index.html";
    if (k.indexOf("..") >= 0) return null;
    if (k.charAt(0) == '/') k = k.substring(1);
    return k;
  }
}
