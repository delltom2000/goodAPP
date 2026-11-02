import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Ellipse2D;
import java.awt.image.BufferedImage;
import java.io.File;

/** 把一张源图缩放成 Android 各密度启动图标 */
public class ScaleIcon {
  public static void main(String[] args) throws Exception {
    File srcFile = new File(args[0]);
    File resDir = new File(args[1]);
    BufferedImage src = ImageIO.read(srcFile);
    System.out.println("源图 " + src.getWidth() + "x" + src.getHeight());

    Object[][] targets = {
      {48, "mipmap-mdpi"},
      {72, "mipmap-hdpi"},
      {96, "mipmap-xhdpi"},
      {144, "mipmap-xxhdpi"},
      {192, "mipmap-xxxhdpi"},
    };

    for (Object[] t : targets) {
      int n = (Integer) t[0];
      String dirName = (String) t[1];
      File dir = new File(resDir, dirName);
      if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("无法创建 " + dir);

      BufferedImage square = scale(src, n);
      ImageIO.write(square, "png", new File(dir, "ic_launcher.png"));

      BufferedImage round = new BufferedImage(n, n, BufferedImage.TYPE_INT_ARGB);
      Graphics2D g = round.createGraphics();
      g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      g.setClip(new Ellipse2D.Float(0, 0, n, n));
      g.drawImage(square, 0, 0, null);
      g.dispose();
      ImageIO.write(round, "png", new File(dir, "ic_launcher_round.png"));

      System.out.println(dirName + " -> " + n + "px");
    }

    // 自适应图标前景层：108dp 画布，内容圆形裁剪后缩到 66%，落在安全区内
    Object[][] fgs = {
      {108, "mipmap-mdpi"},
      {162, "mipmap-hdpi"},
      {216, "mipmap-xhdpi"},
      {324, "mipmap-xxhdpi"},
      {432, "mipmap-xxxhdpi"},
    };
    for (Object[] f : fgs) {
      int n = (Integer) f[0];
      String dirName = (String) f[1];
      int inner = Math.round(n * 0.66f);
      BufferedImage circle = new BufferedImage(inner, inner, BufferedImage.TYPE_INT_ARGB);
      Graphics2D cg = circle.createGraphics();
      cg.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      cg.setClip(new Ellipse2D.Float(0, 0, inner, inner));
      cg.setRenderingHint(RenderingHints.KEY_INTERPOLATION,
          RenderingHints.VALUE_INTERPOLATION_BICUBIC);
      cg.drawImage(src, 0, 0, inner, inner, null);
      cg.dispose();

      BufferedImage canvas = new BufferedImage(n, n, BufferedImage.TYPE_INT_ARGB);
      Graphics2D g = canvas.createGraphics();
      g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      int off = (n - inner) / 2;
      g.drawImage(circle, off, off, null);
      g.dispose();

      File dir = new File(resDir, dirName);
      ImageIO.write(canvas, "png", new File(dir, "ic_launcher_foreground.png"));
      System.out.println(dirName + " foreground -> " + n + "px (内容 " + inner + ")");
    }
  }

  private static BufferedImage scale(BufferedImage src, int n) {
    BufferedImage dst = new BufferedImage(n, n, BufferedImage.TYPE_INT_ARGB);
    Graphics2D g = dst.createGraphics();
    g.setRenderingHint(RenderingHints.KEY_INTERPOLATION,
        RenderingHints.VALUE_INTERPOLATION_BICUBIC);
    g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
    g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    g.drawImage(src, 0, 0, n, n, null);
    g.dispose();
    return dst;
  }
}
