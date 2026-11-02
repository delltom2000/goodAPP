package android.util;

/** JVM 测试替身：行为对齐 Android 的 Base64.DEFAULT（容忍换行/空白） */
public class Base64 {
  public static final int DEFAULT = 0;
  public static final int NO_WRAP = 2;

  public static byte[] decode(String s, int flags) {
    if (s == null || s.isEmpty()) return new byte[0];
    return java.util.Base64.getMimeDecoder().decode(s);
  }

  public static byte[] decode(byte[] s, int flags) {
    return decode(new String(s, java.nio.charset.StandardCharsets.US_ASCII), flags);
  }
}
