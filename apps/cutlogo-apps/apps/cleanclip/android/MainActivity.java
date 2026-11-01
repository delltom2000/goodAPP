package org.dailyfree.cleanclip;

import android.app.*;
import android.os.*;
import android.content.*;
import android.net.Uri;
import android.graphics.Color;
import android.webkit.*;
import android.widget.*;
import android.view.*;
import java.io.*;
import java.net.*;

/** Thin Android client for the user's local repair service; no bundled AI model. */
public class MainActivity extends Activity {
    WebView web; LinearLayout root; String base="http://127.0.0.1:8765",pendingDownload=""; ValueCallback<Uri[]> chooser;
    final int PICK=10,SAVE=11;
    int dp(int n){return (int)(n*getResources().getDisplayMetrics().density);}
    void toast(String s){runOnUiThread(()->Toast.makeText(this,s,Toast.LENGTH_LONG).show());}
    @Override public void onCreate(Bundle b){super.onCreate(b);getWindow().setStatusBarColor(Color.rgb(244,243,237));getWindow().setNavigationBarColor(Color.rgb(244,243,237));getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);if(b!=null)pendingDownload=b.getString("pendingDownload","");showWeb(base+"/");}
    void setup(){
        if(chooser!=null){chooser.onReceiveValue(null);chooser=null;}
        if(web!=null){web.destroy();web=null;}
        LinearLayout p=new LinearLayout(this);p.setOrientation(1);p.setPadding(dp(28),dp(35),dp(28),dp(20));p.setBackgroundColor(Color.rgb(244,243,237));
        TextView title=new TextView(this);title.setText("◈ 净片\nCleanClip Studio");title.setTextSize(30);title.setTextColor(Color.rgb(32,61,50));p.addView(title);
        TextView intro=new TextView(this);intro.setText("视频修复工作台\n\n无需账号或连接码。手机负责导入、选区、预览和保存，电脑负责 AI 修复。\n\n首次使用\n1. 在电脑启动净片网站。\n2. 手机用 USB 连接电脑，开启 USB 调试并允许此电脑。\n3. 在电脑运行 connect-usb.ps1，再点击下方按钮。\n\n本版需要电脑服务开启，暂不支持手机独立处理。\n");intro.setTextSize(15);intro.setTextColor(Color.rgb(74,91,81));p.addView(intro);
        Button go=new Button(this);go.setText("打开工作台 / 重试 →");p.addView(go);go.setOnClickListener(v->showWeb(base+"/"));
        ScrollView scroll=new ScrollView(this);scroll.addView(p);setContentView(scroll);insets(scroll);
    }
    void insets(View view){view.setOnApplyWindowInsetsListener((v,i)->{v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i;});view.requestApplyInsets();}
    boolean sameOrigin(String s){try{Uri a=Uri.parse(s),b=Uri.parse(base);return a.getScheme().equals(b.getScheme())&&a.getHost().equals(b.getHost())&&a.getPort()==b.getPort();}catch(Exception e){return false;}}
    void showWeb(String url){
        if(web!=null){web.destroy();web=null;}
        root=new LinearLayout(this);root.setOrientation(1);root.setBackgroundColor(Color.WHITE);
        Button back=new Button(this);back.setText("◈ 净片    ·    使用帮助");back.setOnClickListener(v->setup());root.addView(back,new LinearLayout.LayoutParams(-1,dp(48)));
        web=new WebView(this);root.addView(web,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);insets(root);
        WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(true);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setMediaPlaybackRequiresUserGesture(true);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){if(!sameOrigin(r.getUrl().toString())){toast("只能在已连接的本地服务内打开页面");return true;}return false;}
            @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError e){if(r.isForMainFrame()){toast("请检查电脑服务和 USB 连接");v.post(()->{if(!isFinishing())setup();});}}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> cb,FileChooserParams params){
                if(chooser!=null)chooser.onReceiveValue(null);chooser=cb;
                try{Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);String[] types=params.getAcceptTypes();i.setType(types.length>0&&types[0].startsWith("image")?"image/*":"video/*");startActivityForResult(i,PICK);return true;}catch(Exception e){chooser.onReceiveValue(null);chooser=null;return false;}
            }
        });
        web.setDownloadListener((u,agent,disposition,mime,length)->{
            if(!sameOrigin(u)){toast("下载地址不属于当前服务");return;}pendingDownload=u;
            Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("video/mp4");i.putExtra(Intent.EXTRA_TITLE,"cleanclip.mp4");startActivityForResult(i,SAVE);
        });web.loadUrl(url);
    }
    @Override protected void onActivityResult(int req,int result,Intent data){super.onActivityResult(req,result,data);
        if(req==PICK&&chooser!=null){chooser.onReceiveValue(result==RESULT_OK&&data!=null?new Uri[]{data.getData()}:null);chooser=null;}
        if(req==SAVE&&result==RESULT_OK&&data!=null){final Uri target=data.getData();final String download=pendingDownload;toast("正在保存视频…");new Thread(()->{
            HttpURLConnection c=null;
            try{c=(HttpURLConnection)new URL(download).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(120000);if(c.getResponseCode()!=200)throw new IOException("下载失败，请重新连接服务");
                try(InputStream in=c.getInputStream();OutputStream out=getContentResolver().openOutputStream(target)){byte[] buf=new byte[65536];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);}toast("已保存到你选择的位置");
            }catch(Exception e){toast("保存失败："+e.getMessage());}finally{if(c!=null)c.disconnect();}
        }).start();}
    }
    @Override protected void onSaveInstanceState(Bundle b){super.onSaveInstanceState(b);b.putString("pendingDownload",pendingDownload);}
    @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else if(web!=null)setup();else super.onBackPressed();}
    @Override protected void onDestroy(){if(chooser!=null)chooser.onReceiveValue(null);if(web!=null)web.destroy();super.onDestroy();}
}
