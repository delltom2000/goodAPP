package org.dailyfree.quietqr;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputFilter;
import android.text.TextWatcher;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import com.google.zxing.common.BitMatrix;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int PICK_IMAGE=40, SAVE_IMAGE=41;
    private static final int INK=0xff233c2d, MUTED=0xff72796f, PAPER=0xfff4f2ec, LIME=0xffd7f08c, LINE=0xffdedfd5;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private int page=0, kind=0, generation=0;
    private String input="", ssid="", password="", encoded="", result="", message="";
    private boolean open=false, hidden=false, busy=false;
    private Bitmap qrBitmap;
    private byte[] qrPng, pendingExport;
    private ImageView preview;
    private TextView placeholder;
    private Button saveButton, shareButton, generateButton;
    private LinearLayout body;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) {
            page=state.getInt("page"); kind=state.getInt("kind");
            input=state.getString("input", ""); ssid=state.getString("ssid", "");
            password=state.getString("password", ""); open=state.getBoolean("open"); hidden=state.getBoolean("hidden");
            result=state.getString("result", ""); encoded=state.getString("encoded", "");
            pendingExport=state.getByteArray("pendingExport");
            if (!encoded.isEmpty()) {
                try { qrBitmap=bitmap(encoded); qrPng=png(qrBitmap); }
                catch(Exception e) { encoded=""; }
            }
        }
        // Generated shares are temporary; remove only this app's old QR cache entries.
        File directory=new File(getCacheDir(), "shared-qr");
        File[] entries=directory.listFiles();
        if(entries!=null) for(File file:entries)
            if(file.getName().matches("qr-[0-9]+\\.png") && System.currentTimeMillis()-file.lastModified()>86400000L) file.delete();
        render();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putInt("page",page); state.putInt("kind",kind);
        state.putString("input",input); state.putString("ssid",ssid); state.putString("password",password);
        state.putBoolean("open",open); state.putBoolean("hidden",hidden);
        state.putString("result",result); state.putString("encoded",encoded);
        state.putByteArray("pendingExport",pendingExport);
    }

    @Override protected void onDestroy() {
        generation++;
        worker.shutdownNow();
        super.onDestroy();
    }

    private int dp(float value) { return (int)(value*getResources().getDisplayMetrics().density+.5f); }
    private GradientDrawable shape(int color, int radius, boolean border) {
        GradientDrawable d=new GradientDrawable(); d.setColor(color); d.setCornerRadius(dp(radius));
        if(border)d.setStroke(dp(1),LINE);
        return d;
    }
    private TextView text(String value, int size, int color, boolean bold) {
        TextView v=new TextView(this); v.setText(value); v.setTextSize(size); v.setTextColor(color);
        v.setFontFeatureSettings("kern"); v.setLineSpacing(dp(3),1f);
        if(bold)v.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));
        return v;
    }
    private void gap(LinearLayout parent, int height) { View v=new View(this); parent.addView(v,new LinearLayout.LayoutParams(1,dp(height))); }
    private LinearLayout column() { LinearLayout l=new LinearLayout(this); l.setOrientation(LinearLayout.VERTICAL); return l; }
    private Button button(String label, boolean primary) {
        Button b=new Button(this); b.setText(label); b.setAllCaps(false); b.setTextSize(15);
        b.setTypeface(Typeface.create("sans-serif-medium",0)); b.setTextColor(primary?Color.WHITE:INK);
        b.setBackground(shape(primary?INK:Color.WHITE,16,!primary)); b.setMinHeight(dp(50));
        b.setPadding(dp(12),dp(8),dp(12),dp(8)); b.setStateListAnimator(null);
        return b;
    }
    private LinearLayout row() { LinearLayout r=new LinearLayout(this); r.setGravity(Gravity.CENTER_VERTICAL); return r; }
    private void weighted(LinearLayout row,View child,int left) {
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,dp(50),1); p.leftMargin=dp(left); row.addView(child,p);
    }
    private LinearLayout card() {
        LinearLayout c=column(); c.setPadding(dp(20),dp(20),dp(20),dp(20)); c.setBackground(shape(Color.WHITE,24,true)); return c;
    }
    private void render() {
        ScrollView scroll=new ScrollView(this); scroll.setFillViewport(true); scroll.setBackgroundColor(PAPER);
        scroll.setClipToPadding(false);
        FrameLayout frame=new FrameLayout(this);
        body=column(); body.setPadding(dp(22),dp(16),dp(22),dp(24));
        int screenWidth=getResources().getDisplayMetrics().widthPixels;
        FrameLayout.LayoutParams bodyParams=new FrameLayout.LayoutParams(Math.min(screenWidth,dp(560)),FrameLayout.LayoutParams.WRAP_CONTENT,Gravity.TOP|Gravity.CENTER_HORIZONTAL);
        frame.addView(body,bodyParams); scroll.addView(frame);
        scroll.setOnApplyWindowInsetsListener((v,insets)->{
            int top=insets.getSystemWindowInsetTop(), bottom=insets.getSystemWindowInsetBottom();
            if(Build.VERSION.SDK_INT>=30){
                android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.ime());
                top=bars.top; bottom=bars.bottom;
            }
            v.setPadding(0,top,0,bottom); return insets;
        });
        setContentView(scroll);
        scroll.requestApplyInsets();

        LinearLayout header=row();
        ImageView logo=new ImageView(this); logo.setImageResource(R.drawable.ic_app); logo.setContentDescription("轻码图标");
        header.addView(logo,new LinearLayout.LayoutParams(dp(42),dp(42)));
        LinearLayout brand=column(); brand.setPadding(dp(11),0,0,0);
        brand.addView(text("轻码",20,INK,true)); brand.addView(text("QUIET QR",10,MUTED,true));
        header.addView(brand,new LinearLayout.LayoutParams(0,-2,1));
        TextView pill=text("● 本地处理",11,INK,true); pill.setPadding(dp(12),dp(8),dp(12),dp(8)); pill.setBackground(shape(LIME,20,false));
        header.addView(pill); body.addView(header); gap(body,28);

        body.addView(text(page==0?"小小方块。\n装下你的分享。":"读懂方块，\n再决定下一步。",30,INK,true));
        gap(body,8);
        body.addView(text(page==0?"链接、文字、Wi-Fi，随手变成二维码。":"选一张图片，内容留在你的设备里。",13,MUTED,false));
        gap(body,22);
        LinearLayout tabs=row(); tabs.setBackground(shape(0xffe8e9e1,18,false)); tabs.setPadding(dp(4),dp(4),dp(4),dp(4));
        for(int i=0;i<2;i++) {
            final int next=i; Button b=button(i==0?"生成二维码":"识别图片",false);
            b.setBackground(shape(page==i?Color.WHITE:Color.TRANSPARENT,14,false));
            b.setTextColor(page==i?INK:MUTED); b.setEnabled(!busy);
            b.setOnClickListener(v->{page=next;message="";hideKeyboard();render();}); weighted(tabs,b,i==0?0:4);
        }
        body.addView(tabs); gap(body,18);
        if(page==0) renderCreate(); else renderRead();
        gap(body,20);
        TextView footer=text("免费使用  ·  无广告  ·  无需账号",12,MUTED,false); footer.setGravity(Gravity.CENTER); body.addView(footer);
        TextView about=text("关于轻码  ↗",12,INK,true); about.setGravity(Gravity.CENTER); about.setPadding(0,dp(14),0,dp(12));
        about.setOnClickListener(v->new AlertDialog.Builder(this).setTitle("轻码 · Quiet QR 0.1.0")
            .setMessage("二维码内容在设备上生成和识别，本应用不申请联网、相机或整个相册权限。\n\n选择图片和保存文件使用系统文件选择器。分享时会生成本地临时图片；第三方接收应用如何处理数据，由该应用决定。\n\n本版支持二维码图片识别，不含实时相机扫描。识别后不会自动打开链接。\n\n二维码引擎：ZXing 3.5.3 · Apache License 2.0。\n\n一个免费开源的小工具。")
            .setPositiveButton("知道了",null).show()); body.addView(about);
    }

    private EditText field(LinearLayout parent, String title, String hint, String value, int inputType, String key) {
        parent.addView(text(title,12,MUTED,true)); gap(parent,8);
        EditText edit=new EditText(this); edit.setTextSize(15); edit.setTextColor(INK); edit.setHintTextColor(0xffa0a69d);
        edit.setHint(hint); edit.setInputType(inputType); edit.setText(value); edit.setPadding(dp(14),dp(13),dp(14),dp(13));
        edit.setBackground(shape(0xfff7f8f3,12,true)); edit.setFilters(new InputFilter[]{new InputFilter.LengthFilter(1600)});
        edit.setEnabled(!busy); edit.setSaveEnabled(false);
        if(key.equals("input"))edit.setMinLines(kind==1?3:1);
        parent.addView(edit,new LinearLayout.LayoutParams(-1,-2));
        edit.addTextChangedListener(new TextWatcher(){
            public void beforeTextChanged(CharSequence s,int start,int count,int after){}
            public void onTextChanged(CharSequence s,int start,int before,int count){
                if(key.equals("input"))input=s.toString(); else if(key.equals("ssid"))ssid=s.toString(); else password=s.toString();
                invalidateQr();
            }
            public void afterTextChanged(Editable e){}
        });
        return edit;
    }

    private void renderCreate() {
        LinearLayout form=card();
        LinearLayout kinds=row();
        String[] names={"链接","文字","Wi-Fi"};
        for(int i=0;i<3;i++){
            final int next=i; Button b=button(names[i],false);
            b.setBackground(shape(kind==i?LIME:0xfff4f5ef,12,false)); b.setEnabled(!busy);
            b.setOnClickListener(v->{kind=next;invalidateQr();message="";render();}); weighted(kinds,b,i==0?0:7);
        }
        form.addView(kinds); gap(form,18);
        if(kind==2) {
            field(form,"网络名称","输入 Wi-Fi 名称",ssid,InputType.TYPE_CLASS_TEXT,"ssid"); gap(form,14);
            if(!open) field(form,"网络密码","输入密码",password,InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD,"password");
            LinearLayout options=row();
            CheckBox openCheck=new CheckBox(this); openCheck.setText("开放网络"); openCheck.setTextSize(12); openCheck.setChecked(open); openCheck.setEnabled(!busy);
            openCheck.setOnCheckedChangeListener((v,checked)->{open=checked;invalidateQr();render();});
            options.addView(openCheck,new LinearLayout.LayoutParams(0,-2,1));
            CheckBox hiddenCheck=new CheckBox(this); hiddenCheck.setText("隐藏网络"); hiddenCheck.setTextSize(12); hiddenCheck.setChecked(hidden); hiddenCheck.setEnabled(!busy);
            hiddenCheck.setOnCheckedChangeListener((v,checked)->{hidden=checked;invalidateQr();}); options.addView(hiddenCheck); form.addView(options);
            gap(form,8); form.addView(text("生成的二维码包含网络凭据，请只分享给信任的人。",11,MUTED,false));
        } else {
            field(form,kind==0?"网页链接":"文字内容",kind==0?"https://example.com":"写一句话，或者一段想分享的内容…",input,
                kind==0?InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI:InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE,"input");
        }
        gap(form,16);
        generateButton=button(busy?"正在生成…":"生成二维码  →",true); generateButton.setEnabled(!busy); generateButton.setOnClickListener(v->generate());
        form.addView(generateButton,new LinearLayout.LayoutParams(-1,dp(52)));
        if(!message.isEmpty()){gap(form,12); form.addView(text(message,12,0xffa24d32,false));}
        body.addView(form); gap(body,16);
        LinearLayout previewCard=card(); previewCard.setGravity(Gravity.CENTER_HORIZONTAL);
        TextView label=text("YOUR QR CODE",10,MUTED,true); label.setLetterSpacing(.16f); previewCard.addView(label);gap(previewCard,14);
        preview=new ImageView(this); preview.setContentDescription("生成的二维码"); preview.setScaleType(ImageView.ScaleType.FIT_CENTER);
        int size=Math.min(224, (int)(getResources().getDisplayMetrics().widthPixels/getResources().getDisplayMetrics().density)-90);
        previewCard.addView(preview,new LinearLayout.LayoutParams(dp(size),dp(size)));
        placeholder=text("▦\n\n填好内容，生成你的\n第一张二维码",16,0xff8b9487,false); placeholder.setGravity(Gravity.CENTER);
        placeholder.setBackground(shape(0xfff6f7f1,18,false)); previewCard.addView(placeholder,new LinearLayout.LayoutParams(dp(size),dp(size)));
        if(qrBitmap!=null){preview.setImageBitmap(qrBitmap);placeholder.setVisibility(View.GONE);}else{preview.setVisibility(View.GONE);}
        gap(previewCard,16);
        LinearLayout exports=row(); saveButton=button("保存 PNG",false); shareButton=button("分享",false);
        saveButton.setOnClickListener(v->save()); shareButton.setOnClickListener(v->share());
        saveButton.setEnabled(qrPng!=null&&!busy); shareButton.setEnabled(qrPng!=null&&!busy);
        saveButton.setAlpha(saveButton.isEnabled()?1f:.4f);shareButton.setAlpha(shareButton.isEnabled()?1f:.4f);
        weighted(exports,saveButton,0);weighted(exports,shareButton,10);previewCard.addView(exports,new LinearLayout.LayoutParams(-1,-2));
        body.addView(previewCard);
    }

    private void invalidateQr() {
        encoded=""; qrBitmap=null;qrPng=null;
        if(preview!=null) {preview.setImageDrawable(null);preview.setVisibility(View.GONE);}
        if(placeholder!=null)placeholder.setVisibility(View.VISIBLE);
        if(saveButton!=null){saveButton.setEnabled(false);saveButton.setAlpha(.4f);}
        if(shareButton!=null){shareButton.setEnabled(false);shareButton.setAlpha(.4f);}
    }

    private void generate() {
        final String payload;
        try {payload=kind==2?QrContent.wifi(ssid,password,open,hidden):kind==0?QrContent.url(input):QrContent.text(input);}
        catch(IllegalArgumentException e){message=e.getMessage();render();return;}
        hideKeyboard();busy=true;message="";render(); final int token=++generation;
        worker.execute(()->{
            try{
                Bitmap image=bitmap(payload);byte[] bytes=png(image);
                runOnUiThread(()->{if(isDestroyed()||token!=generation)return;qrBitmap=image;qrPng=bytes;encoded=payload;busy=false;render();});
            }catch(Exception e){runOnUiThread(()->{if(isDestroyed()||token!=generation)return;busy=false;invalidateQr();message="内容无法生成二维码，请缩短内容后重试。";render();});}
        });
    }

    private static Bitmap bitmap(String payload) throws Exception {
        BitMatrix matrix=QrCodec.encode(payload,768);int w=matrix.getWidth(),h=matrix.getHeight();int[] pixels=new int[w*h];
        for(int y=0;y<h;y++)for(int x=0;x<w;x++)pixels[y*w+x]=matrix.get(x,y)?Color.BLACK:Color.WHITE;
        return Bitmap.createBitmap(pixels,w,h,Bitmap.Config.ARGB_8888);
    }
    private static byte[] png(Bitmap image) {
        ByteArrayOutputStream out=new ByteArrayOutputStream(); image.compress(Bitmap.CompressFormat.PNG,100,out);return out.toByteArray();
    }

    private void save() {
        if(qrPng==null)return; pendingExport=qrPng.clone();
        Intent request=new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("image/png").addCategory(Intent.CATEGORY_OPENABLE)
            .putExtra(Intent.EXTRA_TITLE,"quiet-qr.png");
        try {startActivityForResult(request,SAVE_IMAGE);}catch(Exception e){pendingExport=null;toast("没有可用的文件保存程序");}
    }

    private void share() {
        if(qrPng==null)return;
        try {
            File dir=new File(getCacheDir(),"shared-qr");if(!dir.exists()&&!dir.mkdirs())throw new java.io.IOException();
            String name="qr-"+System.currentTimeMillis()+".png";File file=new File(dir,name);
            try(FileOutputStream output=new FileOutputStream(file)){output.write(qrPng);}
            Uri uri=Uri.parse("content://org.dailyfree.quietqr.images/"+name);
            Intent send=new Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM,uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            send.setClipData(ClipData.newRawUri("二维码",uri));
            startActivity(Intent.createChooser(send,"分享二维码"));
        }catch(Exception e){toast("暂时无法分享，请尝试保存 PNG");}
    }

    private void renderRead() {
        LinearLayout card=card();
        TextView symbol=text("↳",48,INK,true); symbol.setGravity(Gravity.CENTER);card.addView(symbol);
        TextView title=text("从图片读取二维码",19,INK,true);title.setGravity(Gravity.CENTER);card.addView(title);gap(card,9);
        TextView subtitle=text("截图或相册图片都可以。\n一次识别一个二维码，不会自动打开链接。",12,MUTED,false);subtitle.setGravity(Gravity.CENTER);card.addView(subtitle);gap(card,20);
        Button pick=button(busy?"正在识别…":"选择图片  +",true);pick.setEnabled(!busy);
        pick.setOnClickListener(v->{
            Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);
            try{startActivityForResult(intent,PICK_IMAGE);}catch(Exception e){toast("没有可用的图片选择程序");}
        });card.addView(pick,new LinearLayout.LayoutParams(-1,dp(52)));
        if(!message.isEmpty()){gap(card,14);card.addView(text(message,13,0xffa24d32,false));}
        body.addView(card);gap(body,16);
        LinearLayout output=card();output.addView(text("识别结果",12,MUTED,true));gap(output,12);
        TextView value=text(result.isEmpty()?"选择图片后，内容会显示在这里。":result,15,result.isEmpty()?MUTED:INK,false);
        value.setTextIsSelectable(true);output.addView(value);
        if(!result.isEmpty()){
            gap(output,16);LinearLayout actions=row();Button copy=button("复制内容",false);
            copy.setOnClickListener(v->{((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("二维码内容",result));toast("已复制");});weighted(actions,copy,0);
            if(QrContent.isWebUrl(result)){
                Button link=button("打开链接",false);link.setOnClickListener(v->new AlertDialog.Builder(this).setTitle("打开这个链接？")
                    .setMessage(result).setNegativeButton("取消",null).setPositiveButton("打开",(dialog,which)->{
                        try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(result)));}catch(Exception e){toast("没有可用的浏览器");}
                    }).show());weighted(actions,link,10);
            }
            output.addView(actions);
            TextView clear=text("清空结果",12,MUTED,false);clear.setPadding(0,dp(15),0,0);clear.setOnClickListener(v->{result="";message="";render();});output.addView(clear);
        }
        body.addView(output);
    }

    @Override protected void onActivityResult(int request,int code,Intent data) {
        super.onActivityResult(request,code,data);
        if(request==SAVE_IMAGE){
            final byte[] bytes=pendingExport;pendingExport=null;
            if(code!=RESULT_OK||data==null||data.getData()==null)return;
            if(bytes==null){toast("二维码已失效，请重新生成");return;}
            final Uri uri=data.getData();worker.execute(()->{
                try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){
                    if(out==null)throw new java.io.IOException();out.write(bytes);
                    runOnUiThread(()->{if(!isDestroyed())toast("PNG 已保存");});
                }catch(Exception e){runOnUiThread(()->{if(!isDestroyed())toast("保存失败，请检查目标位置");});}
            });
        }else if(request==PICK_IMAGE && code==RESULT_OK && data!=null && data.getData()!=null){
            final Uri uri=data.getData();page=1;busy=true;result="";message="";render();final int token=++generation;
            worker.execute(()->{
                Bitmap image=null;
                try{
                    BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;
                    try(InputStream stream=getContentResolver().openInputStream(uri)){BitmapFactory.decodeStream(stream,null,options);}
                    if(options.outWidth<=0||options.outHeight<=0)throw new java.io.IOException("Unreadable image");
                    options.inSampleSize=1;
                    while(options.outWidth/options.inSampleSize>2048||options.outHeight/options.inSampleSize>2048)options.inSampleSize*=2;
                    options.inJustDecodeBounds=false;options.inPreferredConfig=Bitmap.Config.ARGB_8888;
                    try(InputStream stream=getContentResolver().openInputStream(uri)){image=BitmapFactory.decodeStream(stream,null,options);}
                    if(image==null)throw new java.io.IOException("Decode failed");
                    int w=image.getWidth(),h=image.getHeight();int[] pixels=new int[w*h];image.getPixels(pixels,0,w,0,0,w,h);
                    final String found=QrCodec.decode(w,h,pixels);
                    runOnUiThread(()->{if(isDestroyed()||token!=generation)return;busy=false;result=found;render();});
                }catch(Exception|OutOfMemoryError e){
                    runOnUiThread(()->{if(isDestroyed()||token!=generation)return;busy=false;message="没有读到清晰的二维码。请裁剪到二维码附近，或换一张更清楚的图片。";render();});
                }finally{if(image!=null)image.recycle();}
            });
        }
    }

    private void hideKeyboard(){View focused=getCurrentFocus();if(focused!=null)((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(focused.getWindowToken(),0);}
    private void toast(String value){Toast.makeText(this,value,Toast.LENGTH_SHORT).show();}
}
