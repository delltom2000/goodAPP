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
    @Override protected void attachBaseContext(Context base) { super.attachBaseContext(AppLanguage.wrap(base)); }
    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        if(b!=null)awaitingPermission=b.getBoolean("awaitingPermission",false);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setBackgroundColor(0xfff6f5f1);
        content = new LinearLayout(this); content.setOrientation(1); content.setPadding(dp(24),dp(20),dp(24),dp(24)); scroll.addView(content);
        scroll.setOnApplyWindowInsetsListener((v,i) -> { v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom()); return i; });
        setContentView(scroll);
        content.addView(text("FLOATING CLOCK",12,0xff9b7943));
        TextView title = text(getString(R.string.app_name),32,0xff23272d); title.setTypeface(null,Typeface.BOLD); content.addView(title);
        content.addView(text(getString(R.string.language),14,0xff454b52));
        Spinner language=new Spinner(this);
        ArrayAdapter<String> languages=new ArrayAdapter<>(this,android.R.layout.simple_spinner_item,new String[]{"中文","English"});
        languages.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        language.setAdapter(languages);language.setSelection("en".equals(AppLanguage.code(this))?1:0);
        content.addView(language,new LinearLayout.LayoutParams(-1,dp(48)));
        language.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){
            public void onItemSelected(android.widget.AdapterView<?> parent,View view,int position,long id){
                String code=position==1?"en":"zh";
                if(!code.equals(AppLanguage.code(MainActivity.this))){ClockSettings.prefs(MainActivity.this).edit().putString("language",code).apply();recreate();}
            }
            public void onNothingSelected(android.widget.AdapterView<?> parent){}
        });
        content.addView(text(getString(R.string.tagline),15,0xff7c8085));
        LinearLayout card = new LinearLayout(this); card.setOrientation(1); card.setPadding(dp(20),dp(20),dp(20),dp(20)); card.setBackground(bg(0xff292d32,24));
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(-1,dp(170)); cp.setMargins(0,dp(18),0,dp(18)); content.addView(card,cp);
        card.addView(text(getString(R.string.preview),12,0xffc1c4c8));
        preview = text("23:24:52",40,ClockSettings.color(this)); preview.setTypeface(Typeface.MONOSPACE,Typeface.BOLD); preview.setGravity(Gravity.CENTER); preview.setSingleLine(true); preview.setAutoSizeTextTypeUniformWithConfiguration(14,44,1,2); card.addView(preview,new LinearLayout.LayoutParams(-1,-1));
        status = text("",14,0xff737a80); content.addView(status);
        start = new Button(this); start.setText(getString(R.string.start)); start.setTextSize(18); start.setTextColor(0xffffffff); start.setBackground(bg(0xff292d32,16)); content.addView(start,new LinearLayout.LayoutParams(-1,dp(58))); start.setOnClickListener(v -> begin());
        content.addView(text(getString(R.string.usage),13,0xff7c8085));
        content.addView(text(getString(R.string.appearance),20,0xff23272d));
        content.addView(text(getString(R.string.orientation_title),15,0xff454b52));
        content.addView(text(getString(R.string.orientation_help),12,0xff7c8085));
        slider(getString(R.string.size), "size", 22, 64, 40, " sp");
        slider(getString(R.string.text_opacity), "textAlpha", 20, 100, 100, "%");
        slider(getString(R.string.background_opacity), "bgAlpha", 0, 100, 48, "%");
        Switch ms = new Switch(this); ms.setText(getString(R.string.show_millis)); ms.setPadding(0,dp(15),0,dp(15)); ms.setChecked(ClockSettings.prefs(this).getBoolean("millis",false)); content.addView(ms); ms.setOnCheckedChangeListener((v,checked)->{ ClockSettings.prefs(this).edit().putBoolean("millis",checked).apply(); });
        content.addView(text(getString(R.string.color),15,0xff454b52));
        LinearLayout colors = new LinearLayout(this); content.addView(colors);
        int[] palette={0xffffcf65,0xffffffff,0xff69e0b1,0xff8ac8ff}; String[] names={getString(R.string.gold),getString(R.string.white),getString(R.string.mint),getString(R.string.sky)};
        for(int i=0;i<palette.length;i++) { final int c=palette[i]; Button b1=new Button(this); b1.setText(names[i]); b1.setTextSize(13); b1.setTextColor(c); b1.setContentDescription(getString(R.string.color_description,names[i])); b1.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xff353a40)); LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,dp(48),1); lp.setMargins(dp(3),0,dp(3),0); colors.addView(b1,lp); b1.setOnClickListener(v->{ClockSettings.prefs(this).edit().putInt("color",c).apply(); preview.setTextColor(c);}); }
        Button exit = new Button(this); exit.setText(getString(R.string.exit)); LinearLayout.LayoutParams ep=new LinearLayout.LayoutParams(-1,dp(56)); ep.setMargins(0,dp(24),0,0); content.addView(exit,ep); exit.setOnClickListener(v->{stopService(new Intent(this,ClockService.class)); finishAndRemoveTask();});
        content.addView(text(getString(R.string.time_note),12,0xff8a8e92));
        content.addView(text(getString(R.string.license_summary),12,0xff7c8085));
        Button license=new Button(this);license.setText(R.string.license);content.addView(license,new LinearLayout.LayoutParams(-1,dp(52)));license.setOnClickListener(v->showLicense());
    }
    private void showLicense(){
        String licenseText;
        try(java.io.InputStream in=getAssets().open("license_"+AppLanguage.code(this)+".txt");java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream()){
            byte[] buffer=new byte[4096];int count;while((count=in.read(buffer))!=-1)out.write(buffer,0,count);
            licenseText=new String(out.toByteArray(),java.nio.charset.StandardCharsets.UTF_8);
        }catch(java.io.IOException e){licenseText=getString(R.string.license_error);}
        TextView body=text(licenseText,14,0xff23272d);body.setPadding(dp(20),dp(12),dp(20),dp(12));body.setTextIsSelectable(true);
        ScrollView scroll=new ScrollView(this);scroll.addView(body);
        new AlertDialog.Builder(this).setTitle(R.string.license_title).setView(scroll).setPositiveButton(R.string.close,null).show();
    }
    @Override protected void onSaveInstanceState(Bundle state){state.putBoolean("awaitingPermission",awaitingPermission);super.onSaveInstanceState(state);}
    private void slider(String label,String key,int min,int max,int def,String unit) {
        int value=ClockSettings.prefs(this).getInt(key,def); TextView caption=text(label+"  "+value+unit,15,0xff454b52); content.addView(caption);
        SeekBar seek=new SeekBar(this); seek.setMax(max-min); seek.setProgress(value-min); content.addView(seek,new LinearLayout.LayoutParams(-1,dp(40)));
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){ public void onProgressChanged(SeekBar s,int p,boolean user){ caption.setText(label+"  "+(p+min)+unit); if(user) ClockSettings.prefs(MainActivity.this).edit().putInt(key,p+min).apply(); } public void onStartTrackingTouch(SeekBar s){} public void onStopTrackingTouch(SeekBar s){} });
    }
    private void refreshStatus(){ if(status==null)return; status.setText(ClockService.running ? getString(R.string.running) : getString(R.string.stopped)); start.setText(ClockService.running?getString(R.string.running_home):getString(R.string.start)); }
    private void begin(){
        if(!Settings.canDrawOverlays(this)) { awaitingPermission=true; new AlertDialog.Builder(this).setTitle(getString(R.string.permission_title)).setMessage(getString(R.string.permission_help)).setPositiveButton(getString(R.string.open_settings),(d,w)->{try{startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+getPackageName())));}catch(ActivityNotFoundException e){awaitingPermission=false;Toast.makeText(this,getString(R.string.permission_manual),Toast.LENGTH_LONG).show();}}).setNegativeButton(getString(R.string.cancel),(d,w)->awaitingPermission=false).setOnCancelListener(d->awaitingPermission=false).show(); return; }
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){ requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},4); } else launch();
    }
    private void launch(){ try{ startForegroundService(new Intent(this,ClockService.class)); moveTaskToBack(true); }catch(RuntimeException e){Toast.makeText(this,getString(R.string.start_failed),Toast.LENGTH_LONG).show();} }
    @Override public void onRequestPermissionsResult(int r,String[] p,int[] results){super.onRequestPermissionsResult(r,p,results); if(r==4)launch();}
    @Override protected void onResume(){super.onResume(); handler.removeCallbacks(tick); handler.post(tick); if(awaitingPermission && Settings.canDrawOverlays(this)){awaitingPermission=false; begin();}}
    @Override protected void onPause(){super.onPause();handler.removeCallbacks(tick);}
}
