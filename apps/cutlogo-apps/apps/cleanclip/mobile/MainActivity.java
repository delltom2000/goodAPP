package org.dailyfree.cleanclip;
import android.app.*;
import android.os.*;
import android.content.*;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.opencv.android.OpenCVLoader;
import org.opencv.core.Rect;

public class MainActivity extends Activity {
    int ink=Color.rgb(26,62,48),paper=Color.rgb(245,247,240);LinearLayout column;SelectionView canvas;TextView state,metaText,selection,time,planText;ProgressBar progress;SeekBar seek;EditText end;
    Button importButton,templateButton,analyseButton,previewButton,exportButton,saveButton,playButton,cancelButton,extraButton,autoButton,advancedButton;List<View> advanced=new ArrayList<>();CheckBox moving,extraEnabled;
    LocalEngine.Meta meta;LocalEngine.Plan plan;Bitmap reference,template;Rect logo,extra;File input,result;long currentUs=0;boolean busy=false,showingPreview=false;volatile boolean cancelAnalysis=false;ExecutorService executor=Executors.newSingleThreadExecutor();Handler handler=new Handler();int frameGeneration=0;
    int dp(int x){return (int)(x*getResources().getDisplayMetrics().density);}
    TextView text(String s,int size){TextView t=new TextView(this);t.setText(s);t.setTextColor(ink);t.setTextSize(size);t.setPadding(0,dp(6),0,dp(6));return t;}
    Button button(String name){Button b=new Button(this);b.setText(name);b.setTextColor(ink);b.setAllCaps(false);column.addView(b,new LinearLayout.LayoutParams(-1,dp(50)));return b;}
    void status(String s){state.setText(s);}
    void error(Throwable e){runOnUiThread(()->{status(e.getMessage()==null?"处理失败，请换一个视频重试":e.getMessage());setBusy(false);});}
    @Override public void onCreate(Bundle b){super.onCreate(b);getWindow().setStatusBarColor(paper);getWindow().setNavigationBarColor(paper);getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        boolean loaded=OpenCVLoader.initLocal();ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);column=new LinearLayout(this);column.setOrientation(1);column.setPadding(dp(20),dp(18),dp(20),dp(28));column.setBackgroundColor(paper);scroll.addView(column);setContentView(scroll);scroll.setOnApplyWindowInsetsListener((v,i)->{v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i;});
        column.addView(text("◈ 净片",30));column.addView(text("手机自动版  /  ON-DEVICE",11));column.addView(text("导入视频，自动查找并消除 Logo。",19));column.addView(text("无需电脑、USB 或网络。视频只在手机上处理。",12));
        importButton=button("＋ 导入视频");importButton.setOnClickListener(v->choose(10,"video/*"));
        metaText=text("支持 2 分钟 / 200 MB 内的视频，导出最长边最高 1280 px、最高 30 fps。",11);column.addView(metaText);
        autoButton=button("自动查找 Logo 并消除");autoButton.setOnClickListener(v->automatic(true));
        advancedButton=button("手动设置（可选）");advancedButton.setOnClickListener(v->{boolean show=advanced.get(0).getVisibility()!=View.VISIBLE;for(View item:advanced)item.setVisibility(show?View.VISIBLE:View.GONE);advancedButton.setText(show?"收起手动设置":"手动设置（可选）");});
        int advancedStart=column.getChildCount();
        canvas=new SelectionView(this);column.addView(canvas,new LinearLayout.LayoutParams(-1,-2));canvas.changed=()->{if(!showingPreview){logo=canvas.selected;plan=null;template=null;selection.setText("已框选 Logo。点击定位，或拖动重新框选。");updateButtons();}};
        time=text("预览时间 0.00 秒",11);column.addView(time);seek=new SeekBar(this);seek.setMax(1000);column.addView(seek);seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){public void onProgressChanged(SeekBar s,int p,boolean user){if(meta!=null)time.setText(String.format(Locale.US,"预览时间 %.2f 秒",p*meta.durationUs/1e9));}public void onStartTrackingTouch(SeekBar s){}public void onStopTrackingTouch(SeekBar s){if(meta!=null)loadFrame(Math.min(meta.durationUs-50000,meta.durationUs*s.getProgress()/1000));}});
        selection=text("默认自动识别；需要补充时，可拖动画框或导入样图。",12);column.addView(selection);
        templateButton=button("或导入 Logo 样图");templateButton.setOnClickListener(v->choose(12,"image/*"));
        moving=new CheckBox(this);moving.setText("自动寻找 Logo 的位置变化");moving.setChecked(true);column.addView(moving);moving.setOnCheckedChangeListener((a,c)->{plan=null;updateButtons();});
        extraEnabled=new CheckBox(this);extraEnabled.setText("同时修补一个固定角标（蓝框）");column.addView(extraEnabled);extraEnabled.setOnCheckedChangeListener((a,c)->{canvas.extra=c?extra:null;canvas.invalidate();});
        extraButton=button("把当前画框设为固定角标");extraButton.setOnClickListener(v->{if(canvas.selected==null||canvas.selected.width<8){status("先框选角落的标识");return;}extra=new Rect(canvas.selected.x,canvas.selected.y,canvas.selected.width,canvas.selected.height);canvas.extra=extra;extraEnabled.setChecked(true);logo=null;template=null;plan=null;canvas.selected=null;canvas.invalidate();selection.setText("固定角标已添加。请再框选要跟随的主 Logo。");updateButtons();});
        column.addView(text("结束时间（秒）· 默认保留完整视频",12));end=new EditText(this);end.setInputType(8194);end.setSingleLine(true);column.addView(end);end.addTextChangedListener(new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int st,int count,int after){}public void onTextChanged(CharSequence s,int st,int before,int count){plan=null;updateButtons();}public void afterTextChanged(android.text.Editable e){}});
        analyseButton=button("查找 Logo / 更新手动选区");analyseButton.setOnClickListener(v->{if(logo==null&&template==null)automatic(false);else analyse();});planText=text("点击自动处理即可，无需框选、样图或固定角标设置。",12);column.addView(planText);
        previewButton=button("2  查看当前帧修补预览");previewButton.setOnClickListener(v->preview());
        for(int i=advancedStart;i<column.getChildCount();i++){View item=column.getChildAt(i);advanced.add(item);item.setVisibility(View.GONE);}
        exportButton=button("按当前识别结果重新导出");exportButton.setOnClickListener(v->export());
        progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(100);column.addView(progress);state=text("就绪 · 完全本地运行",13);column.addView(state);
        cancelButton=button("取消处理");cancelButton.setOnClickListener(v->{cancelAnalysis=true;if(ProcessingService.current!=null)ProcessingService.current.cancel=true;status("正在取消…");});
        playButton=button("播放修补结果");playButton.setOnClickListener(v->play());saveButton=button("保存 MP4 到手机");saveButton.setOnClickListener(v->{Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.setType("video/mp4");i.addCategory(Intent.CATEGORY_OPENABLE);i.putExtra(Intent.EXTRA_TITLE,"cleanclip-offline.mp4");startActivityForResult(i,11);});
        column.addView(text("自动识别适合反复出现的角落 Logo / 角标，可能漏检或误检；可在手动设置中预览、补选。",11));column.addView(text("离线快速修补通过周围像素重建背景，复杂纹理可能涂抹或闪烁；效果不同于电脑 LaMa 模型。原片不覆盖。",11));column.addView(text("OpenCV 4.12 · Apache 2.0\n原创代码 MIT · 无广告、无网络权限",10));
        input=new File(getFilesDir(),"input.mp4");result=new File(getFilesDir(),"result.mp4");if(!result.exists())result=null;
        if(!loaded){status("本地修复引擎加载失败，请确认设备架构支持此 APK");importButton.setEnabled(false);return;}
        ProcessingService.Job job=ProcessingService.current;if(job!=null&&!job.finished){busy=true;poll();}else if(input.exists())loadInput();updateButtons();
    }
    void choose(int req,String type){Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType(type);try{startActivityForResult(i,req);}catch(Exception e){error(e);}}
    void setBusy(boolean b){busy=b;canvas.setEnabled(!b);seek.setEnabled(!b);end.setEnabled(!b);moving.setEnabled(!b);extraEnabled.setEnabled(!b);if(b)getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);updateButtons();}
    void updateButtons(){if(importButton==null||saveButton==null)return;importButton.setEnabled(!busy);autoButton.setEnabled(!busy&&meta!=null);templateButton.setEnabled(!busy&&meta!=null);extraButton.setEnabled(!busy&&meta!=null);analyseButton.setEnabled(!busy&&meta!=null);previewButton.setEnabled(!busy&&plan!=null);exportButton.setEnabled(!busy&&plan!=null);saveButton.setEnabled(!busy&&result!=null&&result.exists());playButton.setEnabled(saveButton.isEnabled());cancelButton.setVisibility(busy?View.VISIBLE:View.GONE);}
    void loadInput(){setBusy(true);status("读取视频信息…");executor.execute(()->{try{LocalEngine.Meta m=LocalEngine.inspect(input.getAbsolutePath());runOnUiThread(()->{meta=m;logo=null;template=null;plan=null;extra=null;extraEnabled.setChecked(false);canvas.extra=null;canvas.selected=null;end.setText(String.format(Locale.US,"%.3f",m.durationUs/1e6));metaText.setText(String.format(Locale.US,"本地输出 %d × %d · %d fps · %.2f 秒",m.width,m.height,m.fps,m.durationUs/1e6));setBusy(false);loadFrame(Math.min(1000000,m.durationUs/2));});}catch(Exception e){error(e);}});}
    void loadFrame(long us){if(meta==null)return;final int token=++frameGeneration;final LocalEngine.Meta m=meta;setBusy(true);executor.execute(()->{MediaMetadataRetriever r=new MediaMetadataRetriever();try{r.setDataSource(input.getAbsolutePath());Bitmap b=LocalEngine.frame(r,us,m);runOnUiThread(()->{if(token!=frameGeneration){b.recycle();return;}currentUs=us;reference=b;showingPreview=false;canvas.image(b);canvas.selected=logo;time.setText(String.format(Locale.US,"预览时间 %.2f 秒",us/1e6));seek.setProgress((int)(us*1000/m.durationUs));previewButton.setText("2  查看当前帧修补预览");setBusy(false);status("已导入。点击自动查找 Logo 并消除即可。");});}catch(Exception e){error(e);}finally{try{r.release();}catch(Exception ignored){}}});}
    LocalEngine.Progress callback(){return new LocalEngine.Progress(){public boolean cancelled(){return cancelAnalysis;}public void update(int p,String s){runOnUiThread(()->{progress.setProgress(p);status(s);});}};}
    void analyse(){try{long finish=Math.min(meta.durationUs,(long)(Double.parseDouble(end.getText().toString())*1e6));if(finish<=0)throw new Exception("请输入有效结束时间");if(template==null){LocalEngine.bounded(logo,meta);template=Bitmap.createBitmap(reference,logo.x,logo.y,logo.width,logo.height);}if(logo==null)logo=new Rect(0,0,template.getWidth(),template.getHeight());final Bitmap tpl=template;final Rect initial=logo;final boolean follow=moving.isChecked();setBusy(true);cancelAnalysis=false;executor.execute(()->{try{LocalEngine.Plan p=LocalEngine.analyse(input.getAbsolutePath(),meta,tpl,initial,follow,finish,callback());runOnUiThread(()->{plan=p;setBusy(false);progress.setProgress(100);StringBuilder msg=new StringBuilder("找到 "+p.positions.size()+" 个稳定位置；"+p.uncertain+" 个低置信度采样。\n");for(Rect box:p.positions)msg.append("• ").append(box.x).append(", ").append(box.y).append("  ").append(box.width).append("×").append(box.height).append("\n");planText.setText(msg);status("定位完成。可先查看当前帧的真实修补效果。");});}catch(Exception e){error(e);}});}catch(Exception e){error(e);}}
    void automatic(boolean exportAfter){
        if(meta==null||busy)return;
        try{
            long finish=Math.min(meta.durationUs,(long)(Double.parseDouble(end.getText().toString())*1e6));
            if(finish<=0)throw new IOException("请输入有效结束时间");
            setBusy(true);cancelAnalysis=false;plan=null;status("正在自动查找 Logo 和固定角标…");
            executor.execute(()->{try{
                LocalEngine.Plan found=AutoLogoDetector.detect(input.getAbsolutePath(),meta,finish,callback());
                runOnUiThread(()->{plan=found;setBusy(false);planText.setText("自动找到 "+found.targets.size()+" 个候选 Logo / 角标。可展开手动设置查看修补预览。");
                    if(exportAfter)export();else status("自动识别完成，可预览或导出。");});
            }catch(Exception e){error(e);}});
        }catch(Exception e){error(e);}
    }
    void preview(){if(showingPreview){canvas.image(reference);showingPreview=false;canvas.setEnabled(true);previewButton.setText("2  查看当前帧修补预览");return;}setBusy(true);final Rect fixed=extraEnabled.isChecked()?extra:null;executor.execute(()->{List<org.opencv.core.Mat> templates=LocalEngine.templates(plan);try{List<Rect> boxes=LocalEngine.boxes(reference,plan,templates,currentUs,fixed);Bitmap b=LocalEngine.repair(reference,boxes);runOnUiThread(()->{canvas.image(b);canvas.selected=null;showingPreview=true;setBusy(false);canvas.setEnabled(false);previewButton.setText("返回原始画面");status("这是手机本地修补预览；确认效果后导出。");});}catch(Exception e){error(e);}finally{for(org.opencv.core.Mat te:templates)te.release();}});}
    void export(){ProcessingService.Job j=new ProcessingService.Job();j.input=input.getAbsolutePath();j.meta=meta;j.plan=plan;j.extra=extraEnabled.isChecked()?extra:null;ProcessingService.current=j;setBusy(true);startForegroundService(new Intent(this,ProcessingService.class));poll();}
    void poll(){ProcessingService.Job j=ProcessingService.current;if(j==null)return;progress.setProgress(j.percent);status(j.status);if(j.finished){if(j.output!=null)result=j.output;setBusy(false);return;}handler.postDelayed(this::poll,500);}
    void play(){if(result==null)return;VideoView video=new VideoView(this);video.setVideoPath(result.getAbsolutePath());MediaController c=new MediaController(this);c.setAnchorView(video);video.setMediaController(c);AlertDialog dialog=new AlertDialog.Builder(this).setTitle("修补结果 · 手机本地文件").setView(video).setPositiveButton("关闭",(d,w)->video.stopPlayback()).create();dialog.setOnDismissListener(d->video.stopPlayback());dialog.show();video.getLayoutParams().height=dp(260);video.requestLayout();video.start();}
    @Override protected void onActivityResult(int req,int code,Intent data){super.onActivityResult(req,code,data);if(code!=RESULT_OK||data==null||data.getData()==null)return;Uri uri=data.getData();
        if(req==10){setBusy(true);status("正在导入到手机…");executor.execute(()->{File pending=new File(getFilesDir(),"input-pending.mp4");try{try(InputStream in=getContentResolver().openInputStream(uri);OutputStream out=new FileOutputStream(pending)){byte[] buf=new byte[65536];int n;long total=0;while((n=in.read(buf))!=-1){total+=n;if(total>200L*1024*1024)throw new IOException("视频超过 200 MB");out.write(buf,0,n);}}LocalEngine.inspect(pending.getAbsolutePath());java.nio.file.Files.move(pending.toPath(),input.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);runOnUiThread(this::loadInput);}catch(Exception e){pending.delete();error(e);}});}
        if(req==11&&result!=null){final File source=result;setBusy(true);status("正在保存…");executor.execute(()->{try(InputStream in=new FileInputStream(source);OutputStream out=getContentResolver().openOutputStream(uri)){byte[] buf=new byte[65536];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);runOnUiThread(()->{setBusy(false);status("已保存到你选择的位置");});}catch(Exception e){error(e);}});}
        if(req==12){try(InputStream in=getContentResolver().openInputStream(uri)){Bitmap b=BitmapFactory.decodeStream(in);if(b==null)throw new IOException("样图无法读取");if(b.getWidth()>meta.width||b.getHeight()>meta.height)throw new IOException("样图应裁成 Logo 本身，尺寸需小于视频画面");template=b;logo=new Rect(0,0,b.getWidth(),b.getHeight());plan=null;selection.setText("已导入 Logo 样图；尺寸应与处理画面中的 Logo 接近。");updateButtons();}catch(Exception e){error(e);}}
    }
    @Override public void onBackPressed(){if(busy){new AlertDialog.Builder(this).setMessage("正在手机本地处理。可以回到桌面等待，或取消任务。").setPositiveButton("回到桌面",(d,w)->moveTaskToBack(true)).setNegativeButton("继续等待",null).show();}else super.onBackPressed();}
    @Override protected void onDestroy(){handler.removeCallbacksAndMessages(null);super.onDestroy();}
}
