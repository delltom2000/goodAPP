package com.niulai.crypto;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 在 JVM 上直接跑 App 里真实的解包代码（WebBundle）+ 路径映射（AssetMap）。
 * 不模拟 Android，只把 android.util.Base64 / Log 换成等行为替身。
 *
 * 用法: java -cp out com.niulai.crypto.BundleTest <www 目录>
 */
public class BundleTest {

  private static int fail = 0;

  public static void main(String[] args) throws Exception {
    Path www = Paths.get(args.length > 0 ? args[0]
        : "android/app/src/main/assets/www");

    System.out.println("== 1. 解包（真实代码路径：Base64 -> GZIP -> Map）==");
    long t0 = System.nanoTime();
    Map<String, byte[]> files = WebBundle.files();
    long ms = (System.nanoTime() - t0) / 1_000_000;
    System.out.println("   耗时 " + ms + " ms / 解出 " + files.size() + " 个 / 声明 "
        + WebBundle.FILE_COUNT + " 个");
    check(files.size() == WebBundle.FILE_COUNT, "文件数与声明一致");

    System.out.println("\n== 2. 逐文件与源目录比对 ==");
    List<String> keys = new ArrayList<>(files.keySet());
    Collections.sort(keys);
    long total = 0;
    for (String k : keys) {
      byte[] d = files.get(k);
      total += d.length;
      Path p = www.resolve(k);
      if (!Files.exists(p)) { System.out.println("   源缺失 " + k); fail++; continue; }
      boolean same = Arrays.equals(md5(d), md5(Files.readAllBytes(p)));
      if (!same) { System.out.println("   不一致 " + k); fail++; }
      System.out.printf("   %-26s %7d B  %s%n", k, d.length, same ? "OK" : "DIFF");
    }
    System.out.println("   合计 " + total + " B");

    System.out.println("\n== 3. 关键文件内容抽查 ==");
    String home = new String(files.get("index.html"), StandardCharsets.UTF_8);
    String nc = new String(files.get("newcoins.html"), StandardCharsets.UTF_8);
    String i18n = files.containsKey("js/i18n.js")
        ? new String(files.get("js/i18n.js"), StandardCharsets.UTF_8) : "";
    check(home.contains("<title>"), "index.html 有 title");
    check(home.contains("js/i18n.js"), "index.html 引用了 i18n");
    check(home.contains("data-lang-toggle"), "index.html 有语言切换按钮");
    check(nc.contains("data-lang-toggle"), "newcoins.html 有语言切换按钮");
    check(i18n.contains("'自选股'"), "i18n 字典含关键条目");
    check(home.getBytes(StandardCharsets.UTF_8).length == files.get("index.html").length,
        "首屏字节数与 UTF-8 长度吻合（无编码损坏）");

    System.out.println("\n== 4. URL 路径映射 ==");
    Object[][] cases = {
      {"/", "index.html"},
      {null, "index.html"},
      {"", "index.html"},
      {"/index.html", "index.html"},
      {"/js/app.js?v=20261103h", "js/app.js"},
      {"/css/style.css?v=20261103h", "css/style.css"},
      {"/js/app.js#x", "js/app.js"},
      {"//js/watch.js", "js/watch.js"},
      {"/icons/icon-192.png", "icons/icon-192.png"},
      {"/../etc/passwd", null},
      {"/js/../../secret", null},
    };
    for (Object[] c : cases) {
      String got = AssetMap.keyOf((String) c[0]);
      boolean ok = Objects.equals(got, c[1]);
      System.out.printf("   keyOf(%-26s) -> %-18s %s%n",
          String.valueOf(c[0]), String.valueOf(got), ok ? "" : "<- 期望 " + c[1]);
      if (!ok) fail++;
    }

    System.out.println("\n== 5. 每个资源都能被 keyOf 命中的自洽性 ==");
    int selfOk = 0;
    for (String k : keys) {
      if (k.equals(AssetMap.keyOf("/" + k))) selfOk++;
      else System.out.println("   无法自命中 " + k);
    }
    check(selfOk == keys.size(), "全部 " + keys.size() + " 个资源可自命中");

    System.out.println("\n结果: " + (fail == 0 ? "全部通过" : fail + " 项失败"));
    if (fail != 0) System.exit(1);
  }

  private static void check(boolean ok, String what) {
    System.out.println("   " + (ok ? "OK  " : "FAIL") + " " + what);
    if (!ok) fail++;
  }

  private static byte[] md5(byte[] b) throws Exception {
    return MessageDigest.getInstance("MD5").digest(b);
  }
}
