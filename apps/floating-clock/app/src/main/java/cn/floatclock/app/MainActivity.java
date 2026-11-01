package cn.floatclock.app;

import android.app.*;
import android.os.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.provider.Settings;
import android.view.*;
import android.widget.*;

public class MainActivity extends Activity {
    private LinearLayout content;
    private TextView preview, status;
    private Button start;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean awaitingPermission;
    private final Runnable tick = new Runnable() { public void run() {
        if (preview != null) {
            preview.setSingleLine(true);
            preview.setText(ClockSettings.displayTime(MainActivity.this));
        }
        refreshStatus(); handler.postDelayed(this, 200);
    }};
    int dp(float n) { return Math.round(n * getResources().getDisplayMetrics().density); }
    GradientDrawable bg(int color, int radius) { GradientDrawable d = new GradientDrawable(); d.setColor(color); d.setCornerRadius(dp(radius)); return d; }
    TextView text(String s, int size, int color) { TextView t = new TextView(this); t.setText(s); t.setTextSize(size); t.setTextColor(color); t.setPadding(0,dp(10),0,dp(10)); return t; }
    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setBackgroundColor(0xfff6f5f1);
        content = new LinearLayout(this); content.setOrientation(1); content.setPadding(dp(24),dp(20),dp(24),dp(24)); scroll.addView(content);
        scroll.setOnApplyWindowInsetsListener((v,i) -> { v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom()); return i; });
        setContentView(scroll);
        content.addView(text("FLOATING CLOCK",12,0xff9b7943));
        TextView title = text("悬浮时钟",32,0xff23272d); title.setTypeface(null,Typeface.BOLD); content.addView(title);
        content.addView(text("时间，一眼可见。",15,0xff7c8085));
        LinearLayout card = new LinearLayout(this); card.setOrientation(1); card.setPadding(dp(20),dp(20),dp(20),dp(20)); card.setBackground(bg(0xff292d32,24));
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(-1,dp(170)); cp.setMargins(0,dp(18),0,dp(18)); content.addView(card,cp);
        card.addView(text("悬浮效果预览",12,0xffc1c4c8));
        preview = text("23:24:52",40,ClockSettings.color(this)); preview.setTypeface(Typeface.MONOSPACE,Typeface.BOLD); preview.setGravity(Gravity.CENTER); preview.setSingleLine(true); preview.setAutoSizeTextTypeUniformWithConfiguration(14,44,1,2); card.addView(preview,new LinearLayout.LayoutParams(-1,-1));
        status = text("",14,0xff737a80); content.addView(status);
        start = new Button(this); start.setText("开启悬浮时钟"); start.setTextSize(18); start.setTextColor(0xffffffff); start.setBackground(bg(0xff292d32,16)); content.addView(start,new LinearLayout.LayoutParams(-1,dp(58))); start.setOnClickListener(v -> begin());
        content.addView(text("切换到其他应用后继续显示。拖动时间移动位置，轻点时间展开或收起工具栏。",13,0xff7c8085));
        content.addView(text("外观设置",20,0xff23272d));
        content.addView(text("自动跟随握持方向",15,0xff454b52));
        content.addView(text("横持、竖持均保持一行时间，整个悬浮窗随重力转正。平放时保持当前方向。",12,0xff7c8085));
        slider("字号", "size", 22, 64, 40, " sp");
        slider("文字不透明度", "textAlpha", 20, 100, 100, "%");
        slider("背景不透明度", "bgAlpha", 0, 100, 48, "%");
        Switch ms = new Switch(this); ms.setText("显示毫秒"); ms.setPadding(0,dp(15),0,dp(15)); ms.setChecked(ClockSettings.prefs(this).getBoolean("millis",false)); content.addView(ms); ms.setOnCheckedChangeListener((v,checked)->{ ClockSettings.prefs(this).edit().putBoolean("millis",checked).apply(); });
        content.addView(text("数字颜色",15,0xff454b52));
        LinearLayout colors = new LinearLayout(this); content.addView(colors);
        int[] palette={0xffffcf65,0xffffffff,0xff69e0b1,0xff8ac8ff}; String[] names={"金色","白色","薄荷","天蓝"};
        for(int i=0;i<palette.length;i++) { final int c=palette[i]; Button b1=new Button(this); b1.setText(names[i]); b1.setTextColor(c); b1.setContentDescription(names[i]+"时钟文字"); b1.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xff353a40)); LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,dp(48),1); lp.setMargins(dp(3),0,dp(3),0); colors.addView(b1,lp); b1.setOnClickListener(v->{ClockSettings.prefs(this).edit().putInt("color",c).apply(); preview.setTextColor(c);}); }
        Button exit = new Button(this); exit.setText("关闭悬浮并退出"); LinearLayout.LayoutParams ep=new LinearLayout.LayoutParams(-1,dp(56)); ep.setMargins(0,dp(24),0,0); content.addView(exit,ep); exit.setOnClickListener(v->{stopService(new Intent(this,ClockService.class)); finishAndRemoveTask();});
        content.addView(text("使用手机系统时间 · 无需联网\n毫秒为系统时间显示，不代表网络授时精度。",12,0xff8a8e92));
    }
    private void slider(String label,String key,int min,int max,int def,String unit) {
        int value=ClockSettings.prefs(this).getInt(key,def); TextView caption=text(label+"  "+value+unit,15,0xff454b52); content.addView(caption);
        SeekBar seek=new SeekBar(this); seek.setMax(max-min); seek.setProgress(value-min); content.addView(seek,new LinearLayout.LayoutParams(-1,dp(40)));
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){ public void onProgressChanged(SeekBar s,int p,boolean user){ caption.setText(label+"  "+(p+min)+unit); if(user) ClockSettings.prefs(MainActivity.this).edit().putInt(key,p+min).apply(); } public void onStartTrackingTouch(SeekBar s){} public void onStopTrackingTouch(SeekBar s){} });
    }
    private void refreshStatus(){ if(status==null)return; status.setText(ClockService.running ? "● 悬浮时钟正在运行" : "○ 悬浮时钟未开启"); start.setText(ClockService.running?"已开启 · 返回桌面":"开启悬浮时钟"); }
    private void begin(){
        if(!Settings.canDrawOverlays(this)) { awaitingPermission=true; new AlertDialog.Builder(this).setTitle("允许显示在其他应用上层").setMessage("请在接下来的系统设置中允许“悬浮时钟”显示在其他应用上层，返回后自动开启。").setPositiveButton("前往设置",(d,w)->{try{startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+getPackageName())));}catch(ActivityNotFoundException e){awaitingPermission=false;Toast.makeText(this,"请在系统设置中手动开启悬浮窗权限",Toast.LENGTH_LONG).show();}}).setNegativeButton("取消",(d,w)->awaitingPermission=false).setOnCancelListener(d->awaitingPermission=false).show(); return; }
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){ requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},4); } else launch();
    }
    private void launch(){ try{ startForegroundService(new Intent(this,ClockService.class)); moveTaskToBack(true); }catch(RuntimeException e){Toast.makeText(this,"未能开启，请检查系统悬浮窗权限后重试",Toast.LENGTH_LONG).show();} }
    @Override public void onRequestPermissionsResult(int r,String[] p,int[] results){super.onRequestPermissionsResult(r,p,results); if(r==4)launch();}
    @Override protected void onResume(){super.onResume(); handler.removeCallbacks(tick); handler.post(tick); if(awaitingPermission && Settings.canDrawOverlays(this)){awaitingPermission=false; begin();}}
    @Override protected void onPause(){super.onPause();handler.removeCallbacks(tick);}
}
