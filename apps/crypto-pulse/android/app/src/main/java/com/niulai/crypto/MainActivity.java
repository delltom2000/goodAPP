package com.niulai.crypto;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * 币市脉搏 · 安卓外壳
 *
 * 本地页面通过虚拟域名 https://appassets.androidplatform.net/ 提供，
 * 由 shouldInterceptRequest 从 assets/www 读取。用 https 虚拟域名而不是 file://，
 * 是为了让页面拥有正常的同源策略 —— 否则 fetch 交易所接口会因 origin=null 被拦。
 * 交易所 API 请求不走拦截，正常走网络。
 */
public class MainActivity extends Activity {

  private static final String TAG = "NiuLai";
  private static final String HOST = "appassets.androidplatform.net";
  private static final String BASE = "https://" + HOST + "/";
  private static final String START_URL = BASE + "index.html";

  private WebView web;

  /** 检查是否有浮层打开；ESC 优先关浮层，否则返回上一页 */
  private static final String JS_OVERLAY_OPEN =
      "(function(){"
    + "function vis(e){if(!e)return false;if(e.hasAttribute('hidden'))return false;"
    + "var r=e.getBoundingClientRect();return r.width>1&&r.height>1;}"
    + "var ids=['drawer','methodDrawer','watchDrawer','watchPanel'];"
    + "for(var i=0;i<ids.length;i++){if(vis(document.getElementById(ids[i]))){"
    + "if(ids[i]==='watchPanel'){var s=getComputedStyle(document.getElementById(ids[i]));"
    + "if(s.position!=='fixed'&&s.position!=='absolute')continue;}"
    + "return 'open';}}"
    + "return 'none';})()";

  private static final String JS_ESC =
      "(function(){document.dispatchEvent(new KeyboardEvent('keydown',"
    + "{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true}));"
    + "var b=['dClose','drawerClose','methodClose','watchClose','watchPanelClose'];"
    + "for(var i=0;i<b.length;i++){var e=document.getElementById(b[i]);"
    + "if(e&&!e.hasAttribute('hidden')){var r=e.getBoundingClientRect();"
    + "if(r.width>1&&r.height>1){e.click();return;}}}})()";

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    getWindow().setStatusBarColor(0xFF0D1219);
    getWindow().setNavigationBarColor(0xFF0D1219);

    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(0xFF0D1219);

    web = new WebView(this);
    root.addView(web, new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    setContentView(root);

    configure(web);
    web.loadUrl(START_URL);
  }

  private void configure(WebView w) {
    WebSettings s = w.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setUseWideViewPort(true);
    s.setLoadWithOverviewMode(true);
    s.setSupportZoom(false);
    s.setBuiltInZoomControls(false);
    s.setDisplayZoomControls(false);
    s.setMediaPlaybackRequiresUserGesture(true);
    s.setAllowFileAccess(false);
    s.setAllowContentAccess(false);
    s.setJavaScriptCanOpenWindowsAutomatically(false);
    s.setCacheMode(WebSettings.LOAD_DEFAULT);
    s.setUserAgentString(s.getUserAgentString() + " NiuLaiCrypto/1.0");

    CookieManager.getInstance().setAcceptCookie(true);

    w.setBackgroundColor(0xFF0D1219);
    w.setOverScrollMode(View.OVER_SCROLL_NEVER);
    w.setVerticalScrollBarEnabled(false);

    w.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
        return handleUrl(req.getUrl());
      }

      @SuppressWarnings("deprecation")
      @Override
      public boolean shouldOverrideUrlLoading(WebView v, String url) {
        return handleUrl(Uri.parse(url));
      }

      @Override
      public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
        Uri u = req.getUrl();
        if (u == null || !HOST.equals(u.getHost())) return null;
        return serveAsset(u.getPath());
      }

      /* 部分定制内核（尤其国产 ROM 自带的 WebView）只回调这个已废弃的重载，
         两个都实现才能保证主文档一定被接管。 */
      @SuppressWarnings("deprecation")
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView v, String url) {
        if (url == null) return null;
        Uri u = Uri.parse(url);
        if (u == null || !HOST.equals(u.getHost())) return null;
        return serveAsset(u.getPath());
      }

      @Override
      public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
        if (req != null && req.isForMainFrame()) {
          Log.w(TAG, "主文档加载失败: code=" + err.getErrorCode()
              + " desc=" + err.getDescription() + " url=" + req.getUrl());
          String detail = "错误码 " + err.getErrorCode() + " · " + err.getDescription()
              + "\nURL: " + req.getUrl() + "\n\n" + diag();
          v.loadDataWithBaseURL(null, errorHtml("页面没能加载", detail), "text/html", "UTF-8", null);
        }
      }
    });

    w.setWebChromeClient(new WebChromeClient() {
      @Override
      public boolean onConsoleMessage(ConsoleMessage cm) {
        Log.d(TAG, "[web] " + cm.message() + " @" + cm.lineNumber());
        return true;
      }
    });
  }

  private boolean handleUrl(Uri u) {
    if (u == null) return false;
    if (HOST.equals(u.getHost())) return false;   // 本地页面，交给 WebView
    openExternal(u);
    return true;
  }

  private void openExternal(Uri u) {
    try {
      Intent i = new Intent(Intent.ACTION_VIEW, u);
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      startActivity(i);
    } catch (Exception e) {
      Log.w(TAG, "无法打开外部链接: " + u);
    }
  }

  /** 把 /xxx 映射到内置资源（优先级最高），取不到再退到 assets/www/xxx */
  private WebResourceResponse serveAsset(String path) {
    String key = AssetMap.keyOf(path);
    if (key == null) return plain(403, "Forbidden");

    // 主路径：dex 里内嵌的资源。不经过 AssetManager，任何设备都能读到。
    byte[] data = WebBundle.files().get(key);
    if (data != null) {
      return new WebResourceResponse(mimeOf(key), encodingOf(key), 200, "OK", headers(),
          new ByteArrayInputStream(data));
    }

    // 兜底：万一有文件没进 dex（比如新增了图片），再试 assets
    String rel = "www/" + key;
    try {
      InputStream in = getAssets().open(rel);
      return new WebResourceResponse(mimeOf(key), encodingOf(key), 200, "OK", headers(), in);
    } catch (IOException e) {
      Log.w(TAG, "资源缺失: " + key + " -> " + e);
      // 主文档缺失时给一页能看懂 + 能定位的提示，否则用户面对的是一片空白
      if (key.endsWith(".html")) {
        String detail = "读取失败: " + key + "\n" + e + "\n\n" + diag();
        byte[] body = errorHtml("页面没能加载", detail).getBytes(StandardCharsets.UTF_8);
        return new WebResourceResponse("text/html", "utf-8", 200, "OK", headers(),
            new ByteArrayInputStream(body));
      }
      return plain(404, "Not Found");
    }
  }

  private static Map<String, String> headers() {
    Map<String, String> h = new HashMap<>();
    h.put("Access-Control-Allow-Origin", "*");
    h.put("Cache-Control", "no-cache");
    return h;
  }

  private static WebResourceResponse plain(int code, String msg) {
    return new WebResourceResponse("text/plain", "utf-8", code, msg, headers(),
        new ByteArrayInputStream(new byte[0]));
  }

  private static String mimeOf(String p) {
    String s = p.toLowerCase();
    if (s.endsWith(".html") || s.endsWith(".htm")) return "text/html";
    if (s.endsWith(".css")) return "text/css";
    if (s.endsWith(".js") || s.endsWith(".mjs")) return "application/javascript";
    if (s.endsWith(".json")) return "application/json";
    if (s.endsWith(".webmanifest")) return "application/manifest+json";
    if (s.endsWith(".png")) return "image/png";
    if (s.endsWith(".jpg") || s.endsWith(".jpeg")) return "image/jpeg";
    if (s.endsWith(".webp")) return "image/webp";
    if (s.endsWith(".svg")) return "image/svg+xml";
    if (s.endsWith(".ico")) return "image/x-icon";
    if (s.endsWith(".woff2")) return "font/woff2";
    if (s.endsWith(".woff")) return "font/woff";
    if (s.endsWith(".txt") || s.endsWith(".md")) return "text/plain";
    return "application/octet-stream";
  }

  private static String encodingOf(String p) {
    String m = mimeOf(p);
    if (m.startsWith("text/") || m.contains("javascript") || m.contains("json")
        || m.contains("manifest") || m.contains("svg")) {
      return "utf-8";
    }
    return null;
  }

  @Override
  public boolean onKeyDown(int keyCode, KeyEvent event) {
    if (keyCode != KeyEvent.KEYCODE_BACK || web == null) {
      return super.onKeyDown(keyCode, event);
    }
    web.evaluateJavascript(JS_OVERLAY_OPEN, new ValueCallback<String>() {
      @Override
      public void onReceiveValue(String value) {
        if (value != null && value.contains("open")) {
          web.evaluateJavascript(JS_ESC, null);
        } else if (web.canGoBack()) {
          web.goBack();
        } else {
          finish();
        }
      }
    });
    return true;
  }

  @Override
  protected void onDestroy() {
    if (web != null) {
      web.setWebChromeClient(null);
      web.destroy();
      web = null;
    }
    super.onDestroy();
  }

  /** 出错时把现场信息一起显示出来，用户截个图就能定位，不用连 adb */
  private String errorHtml(String title, String detail) {
    String d = detail == null ? "" : detail
        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    return "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
      + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">"
      + "<style>"
      + "html,body{margin:0;min-height:100%;background:#0d1219;color:#e6ebf2;"
      + "font-family:-apple-system,'PingFang SC','Noto Sans CJK SC',sans-serif;}"
      + "body{display:flex;align-items:center;justify-content:center;padding:22px;box-sizing:border-box;}"
      + ".w{max-width:440px;width:100%}"
      + ".t{font-size:17px;font-weight:600;margin-bottom:12px}"
      + ".d{font-size:11px;line-height:1.75;color:#8b97a8;white-space:pre-wrap;"
      + "word-break:break-all;background:#141b25;border:1px solid #24303f;"
      + "border-radius:8px;padding:10px 12px;max-height:52vh;overflow:auto;"
      + "font-family:ui-monospace,Menlo,Consolas,monospace}"
      + "button{margin-top:18px;padding:11px 30px;border:0;border-radius:10px;"
      + "background:#f0b90b;color:#0d1219;font-size:14px;font-weight:600}"
      + "</style></head><body><div class=\"w\">"
      + "<div class=\"t\">" + title + "</div>"
      + "<div class=\"d\">" + d + "</div>"
      + "<button onclick=\"location.reload()\">重试</button>"
      + "</div></body></html>";
  }

  /** 现场诊断：内置资源是否解包成功、WebView 是哪个版本 */
  private String diag() {
    StringBuilder sb = new StringBuilder("— 诊断 —");
    sb.append("\n包: ").append(getPackageName());
    sb.append("\n设备: ").append(Build.BRAND).append(' ').append(Build.MODEL)
      .append(" / Android ").append(Build.VERSION.RELEASE);
    sb.append("\nWebView: ").append(webViewVersion());
    try {
      java.util.Map<String, byte[]> m = WebBundle.files();
      sb.append("\n内置资源: ").append(m.size()).append('/').append(WebBundle.FILE_COUNT).append(" 个");
      byte[] home = m.get("index.html");
      sb.append("\nindex.html: ").append(home == null ? "缺失" : home.length + " B");
    } catch (Throwable t) {
      sb.append("\n内置资源异常: ").append(t);
    }
    try {
      String[] www = getAssets().list("www");
      sb.append("\nassets/www: ").append(www == null ? "null" : www.length + " 项");
    } catch (Throwable t) {
      sb.append("\nassets 列目录异常: ").append(t);
    }
    return sb.toString();
  }

  private static String webViewVersion() {
    try {
      android.content.pm.PackageInfo pi = WebView.getCurrentWebViewPackage();
      return pi == null ? "未知" : pi.packageName + " " + pi.versionName;
    } catch (Throwable t) {
      return "未知";
    }
  }
}
