package android.util;

/** JVM 测试替身 */
public class Log {
  public static int v(String t, String m) { return 0; }
  public static int d(String t, String m) { return 0; }
  public static int i(String t, String m) { return 0; }
  public static int w(String t, String m) { System.err.println("[W] " + m); return 0; }
  public static int e(String t, String m) { System.err.println("[E] " + m); return 0; }
  public static int e(String t, String m, Throwable tr) { System.err.println("[E] " + m + " / " + tr); return 0; }
}
