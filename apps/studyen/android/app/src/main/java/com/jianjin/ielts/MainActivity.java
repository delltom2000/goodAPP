package com.jianjin.ielts;

import android.app.Activity;
import android.os.Bundle;
import android.net.Uri;
import android.content.Intent;
import android.speech.tts.TextToSpeech;
import android.webkit.*;
import android.view.View;
import java.io.ByteArrayInputStream;
import java.util.Locale;

/** Offline first: only bundled assets can execute JS or access the TTS bridge. */
public final class MainActivity extends Activity {
    private WebView web;
    private TextToSpeech speech;
    private volatile boolean speechReady;
    private static final String HOST="appassets.androidplatform.net";
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        web=new WebView(this);
        web.setBackgroundColor(0xfff6f7f2);
        web.setOnApplyWindowInsetsListener((v,insets)-> {
            v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(web);
        WebSettings settings=web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();
                if (!"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost())) return blocked();
                String path=uri.getPath();
                if (path==null || !path.startsWith("/assets/") || path.contains("..")) return blocked();
                path=path.substring(8);
                String mime=path.endsWith(".html")?"text/html":path.endsWith(".js")?"application/javascript":path.endsWith(".json")?"application/json":path.endsWith(".css")?"text/css":path.endsWith(".svg")?"image/svg+xml":"application/octet-stream";
                try{return new WebResourceResponse(mime,"UTF-8",getAssets().open(path));}catch(Exception e){return blocked();}
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();
                if ("https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPath()!=null && uri.getPath().startsWith("/assets/")) return false;
                if (request.isForMainFrame() && "https".equals(uri.getScheme())) {
                    try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}
                }
                return true;
            }
        });
        speech=new TextToSpeech(this,status->{
            if(status==TextToSpeech.SUCCESS){int result=speech.setLanguage(Locale.UK);speechReady=result!=TextToSpeech.LANG_MISSING_DATA&&result!=TextToSpeech.LANG_NOT_SUPPORTED;speech.setSpeechRate(.9f);}
        });
        web.addJavascriptInterface(new SpeechBridge(),"AndroidSpeech");
        web.loadUrl("https://"+HOST+"/assets/index.html");
    }
    private WebResourceResponse blocked(){return new WebResourceResponse("text/plain","UTF-8",404,"Not found",null,new ByteArrayInputStream(new byte[0]));}
    public final class SpeechBridge {
        @JavascriptInterface public boolean available(){return speechReady;}
        @JavascriptInterface public void speak(String text){if(text!=null&&text.length()<=15000)runOnUiThread(()->{if(speechReady)speech.speak(text,TextToSpeech.QUEUE_FLUSH,null,"ielts-listening");});}
        @JavascriptInterface public void stop(){runOnUiThread(()->{if(speech!=null)speech.stop();});}
    }
    @Override public void onBackPressed(){web.evaluateJavascript("window.handleAndroidBack ? window.handleAndroidBack() : false",value->{if(!"true".equals(value))finish();});}
    @Override protected void onPause(){if(speech!=null)speech.stop();super.onPause();}
    @Override protected void onDestroy(){if(speech!=null)speech.shutdown();web.removeJavascriptInterface("AndroidSpeech");web.destroy();super.onDestroy();}
}
