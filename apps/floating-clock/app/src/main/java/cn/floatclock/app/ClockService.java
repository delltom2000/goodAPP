package cn.floatclock.app;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.*;
import android.hardware.display.DisplayManager;
import android.graphics.drawable.GradientDrawable;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;

public class ClockService extends Service implements SharedPreferences.OnSharedPreferenceChangeListener {
    static volatile boolean running;
    private WindowManager manager;
    private WindowManager.LayoutParams params;
    private LinearLayout root, toolbar;
    private TextView clock;
    private RotatingLayout overlay;
    private OrientationEventListener orientationListener;
    private DisplayManager displays;
    private int sensorQuarter, pendingQuarter=-1;
    private final Runnable commitOrientation=()->{sensorQuarter=pendingQuarter; pendingQuarter=-1; applyStyle();};
    private final DisplayManager.DisplayListener displayListener=new DisplayManager.DisplayListener(){
        public void onDisplayAdded(int id){} public void onDisplayRemoved(int id){}
        public void onDisplayChanged(int id){if(id==manager.getDefaultDisplay().getDisplayId())applyStyle();}
    };
    private final Handler handler=new Handler(Looper.getMainLooper());
    private boolean screenOn=true;
    private int screenOrientation;
    private final Runnable tick=new Runnable(){public void run(){if(clock==null || !screenOn)return; boolean ms=ClockSettings.prefs(ClockService.this).getBoolean("millis",false); clock.setText(ClockSettings.displayTime(ClockService.this)); handler.postDelayed(this,ms?32:1000-System.currentTimeMillis()%1000);}};
    private final BroadcastReceiver screenReceiver=new BroadcastReceiver(){public void onReceive(Context c,Intent i){screenOn=!Intent.ACTION_SCREEN_OFF.equals(i.getAction()); handler.removeCallbacks(tick); if(screenOn){handler.post(tick);if(orientationListener!=null && orientationListener.canDetectOrientation())orientationListener.enable();applyStyle();}else{if(orientationListener!=null)orientationListener.disable();handler.removeCallbacks(commitOrientation);pendingQuarter=-1;}}};
    int dp(float n){return Math.round(n*getResources().getDisplayMetrics().density);}
    @Override public void onCreate(){super.onCreate(); manager=(WindowManager)getSystemService(WINDOW_SERVICE); screenOrientation=getResources().getConfiguration().orientation; ClockSettings.prefs(this).registerOnSharedPreferenceChangeListener(this); IntentFilter f=new IntentFilter(Intent.ACTION_SCREEN_ON); f.addAction(Intent.ACTION_SCREEN_OFF); registerReceiver(screenReceiver,f);}
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if(intent!=null && "STOP".equals(intent.getAction())){close();return START_NOT_STICKY;}
        if(!Settings.canDrawOverlays(this)){stopSelf();return START_NOT_STICKY;}
        Notification n=notification();
        if(Build.VERSION.SDK_INT>=34)startForeground(7,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);else startForeground(7,n);
        if(root==null) { try {createOverlay(); running=true;}catch(RuntimeException e){Toast.makeText(this,tr(R.string.overlay_failed),Toast.LENGTH_LONG).show();stopSelf();} }
        return START_NOT_STICKY;
    }
    private String tr(int resource){return AppLanguage.text(this,resource);}
    private Notification notification(){
        NotificationManager nm=getSystemService(NotificationManager.class); nm.createNotificationChannel(new NotificationChannel("clock",tr(R.string.notification_channel),NotificationManager.IMPORTANCE_LOW));
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,ClockService.class).setAction("STOP"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this,"clock").setContentTitle(tr(R.string.notification_title)).setContentText(tr(R.string.notification_body)).setSmallIcon(cn.floatclock.app.R.drawable.ic_clock).setContentIntent(open).addAction(new Notification.Action.Builder(null,tr(R.string.exit),stop).build()).setOngoing(true).build();
    }
    private void refreshToolbarLanguage(){
        if(toolbar==null)return;
        int[] labels={R.string.settings,R.string.millis,R.string.hide,R.string.close};
        for(int i=0;i<labels.length;i++){TextView button=(TextView)toolbar.getChildAt(i);button.setText(tr(labels[i]));button.setContentDescription(tr(labels[i]));}
    }
    private void createOverlay(){
        root=new LinearLayout(this);root.setOrientation(1);
        overlay=new RotatingLayout(this);overlay.addView(root,new android.view.ViewGroup.LayoutParams(-2,-2));

        clock=new TextView(this);clock.setGravity(Gravity.CENTER);clock.setTypeface(Typeface.MONOSPACE,Typeface.BOLD);clock.setSingleLine(true);clock.setPadding(dp(16),dp(15),dp(16),dp(15)); root.addView(clock,new LinearLayout.LayoutParams(-1,-2));
        toolbar=new LinearLayout(this);toolbar.setPadding(dp(4),dp(4),dp(4),dp(4)); GradientDrawable bar=new GradientDrawable();bar.setColor(0xee222528);bar.setCornerRadius(dp(12));toolbar.setBackground(bar); LinearLayout.LayoutParams tlp=new LinearLayout.LayoutParams(-1,dp(48));tlp.topMargin=dp(6);root.addView(toolbar,tlp);
        action(R.string.settings,()->startActivity(new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
        action(R.string.millis,()->{SharedPreferences p=ClockSettings.prefs(this);p.edit().putBoolean("millis",!p.getBoolean("millis",false)).apply();});

        action(R.string.hide,()->{toolbar.setVisibility(View.GONE);applyStyle();});action(R.string.close,this::close);
        params=new WindowManager.LayoutParams(-2,-2,WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,PixelFormat.TRANSLUCENT);
        params.gravity=Gravity.TOP|Gravity.LEFT;restorePosition();
        clock.setOnTouchListener(new View.OnTouchListener(){float sx,sy;int px,py;boolean moved;public boolean onTouch(View v,android.view.MotionEvent e){switch(e.getActionMasked()){
            case MotionEvent.ACTION_DOWN:sx=e.getRawX();sy=e.getRawY();px=params.x;py=params.y;moved=false;return true;
            case MotionEvent.ACTION_MOVE:float dx=e.getRawX()-sx,dy=e.getRawY()-sy;if(Math.hypot(dx,dy)>ViewConfiguration.get(ClockService.this).getScaledTouchSlop())moved=true;if(moved){params.x=px+(int)dx;params.y=py+(int)dy;clamp();update();}return true;
            case MotionEvent.ACTION_UP:if(!moved){v.performClick();toolbar.setVisibility(toolbar.getVisibility()==View.VISIBLE?View.GONE:View.VISIBLE);applyStyle();}savePosition();return true;
            case MotionEvent.ACTION_CANCEL:savePosition();return true;
        }return false;}});
        sensorQuarter=(360-manager.getDefaultDisplay().getRotation()*90)%360;
        applyStyle();manager.addView(overlay,params);handler.post(tick);
        orientationListener=new OrientationEventListener(this){public void onOrientationChanged(int degrees){
            if(degrees==ORIENTATION_UNKNOWN){handler.removeCallbacks(commitOrientation);pendingQuarter=-1;return;}
            int candidate=RotationMath.stableQuarter(degrees,sensorQuarter);
            if(candidate==sensorQuarter){handler.removeCallbacks(commitOrientation);pendingQuarter=-1;return;}
            if(candidate!=pendingQuarter){pendingQuarter=candidate;handler.removeCallbacks(commitOrientation);handler.postDelayed(commitOrientation,250);}
        }};
        if(orientationListener.canDetectOrientation())orientationListener.enable();
        else Toast.makeText(this,tr(R.string.no_sensor),Toast.LENGTH_LONG).show();
        displays=getSystemService(DisplayManager.class);displays.registerDisplayListener(displayListener,handler);
    }
    private void action(int resource,Runnable r){String label=tr(resource);TextView b=new TextView(this);b.setText(label);b.setTextColor(Color.WHITE);b.setTextSize(13);b.setGravity(Gravity.CENTER);b.setContentDescription(label);toolbar.addView(b,new LinearLayout.LayoutParams(0,-1,1));b.setOnClickListener(v->r.run());}
    private Point screenSize(){Point size=new Point();manager.getDefaultDisplay().getSize(size);return size;}
    private void applyStyle(){
        if(clock==null || root==null)return;
        SharedPreferences p=ClockSettings.prefs(this);
        boolean ms=p.getBoolean("millis",false);
        int displayDegrees=manager.getDefaultDisplay().getRotation()*90;
        int rotation=orientationListener!=null && !orientationListener.canDetectOrientation()?0:RotationMath.contentRotation(sensorQuarter,displayDegrees);
        overlay.setAngle(rotation);
        Point screen=screenSize();
        float scale=getResources().getDisplayMetrics().scaledDensity;
        int availableWidth=overlay.swapsAxes()?screen.y-dp(48):screen.x;
        int availableHeight=overlay.swapsAxes()?screen.x:screen.y-dp(48);
        float width=Math.max(dp(48),availableWidth-dp(40));
        float height=Math.max(dp(24),availableHeight-dp(30+54));
        float requested=p.getInt("size",40);
        float fitted=Math.min(requested,Math.min(width/((ms?12:8)*0.61f*scale),height/(1.4f*scale)));
        clock.setSingleLine(true);
        clock.setMaxLines(1);
        clock.setTextSize(Math.max(8,fitted));
        root.setMinimumWidth(Math.min(dp(260),availableWidth-dp(8)));
        int rgb=ClockSettings.color(this);
        clock.setTextColor((Math.round(p.getInt("textAlpha",100)*2.55f)<<24)|(rgb&0xffffff));
        GradientDrawable d=new GradientDrawable();
        d.setColor((Math.round(p.getInt("bgAlpha",48)*2.55f)<<24)|0x444444);d.setCornerRadius(dp(14));
        clock.setBackground(d);clock.setText(ClockSettings.displayTime(this));
        clamp();update();
    }
    private void clamp(){
        if(root==null || params==null)return;
        Point size=screenSize();
        overlay.measure(View.MeasureSpec.makeMeasureSpec(size.x,View.MeasureSpec.AT_MOST),View.MeasureSpec.makeMeasureSpec(Math.max(1,size.y-dp(48)),View.MeasureSpec.AT_MOST));
        params.width=overlay.getMeasuredWidth();params.height=overlay.getMeasuredHeight();
        params.x=Math.max(0,Math.min(params.x,Math.max(0,size.x-overlay.getMeasuredWidth())));
        params.y=Math.max(0,Math.min(params.y,Math.max(0,size.y-overlay.getMeasuredHeight()-dp(48))));
    }
    private void update(){if(overlay!=null && overlay.isAttachedToWindow())try{manager.updateViewLayout(overlay,params);}catch(IllegalArgumentException ignored){}}
    private String positionKey(String axis){return axis+"_"+screenOrientation;}
    private void restorePosition(){SharedPreferences p=ClockSettings.prefs(this);params.x=p.getInt(positionKey("x"),p.getInt("x",dp(20)));params.y=p.getInt(positionKey("y"),p.getInt("y",dp(220)));}
    private void savePosition(){if(params!=null)ClockSettings.prefs(this).edit().putInt(positionKey("x"),params.x).putInt(positionKey("y"),params.y).apply();}
    @Override public void onSharedPreferenceChanged(SharedPreferences p,String key){if(key==null || key.equals("x") || key.equals("y") || key.startsWith("x_") || key.startsWith("y_"))return;if("language".equals(key)){refreshToolbarLanguage();if(running)getSystemService(NotificationManager.class).notify(7,notification());}applyStyle();handler.removeCallbacks(tick);if(screenOn)handler.post(tick);}
    @Override public void onConfigurationChanged(Configuration c){super.onConfigurationChanged(c);if(params==null)return;savePosition();screenOrientation=c.orientation;restorePosition();applyStyle();}
    private void close(){for(ActivityManager.AppTask task: getSystemService(ActivityManager.class).getAppTasks())task.finishAndRemoveTask();stopSelf();}
    @Override public void onDestroy(){running=false;if(orientationListener!=null)orientationListener.disable();if(displays!=null)displays.unregisterDisplayListener(displayListener);handler.removeCallbacksAndMessages(null);ClockSettings.prefs(this).unregisterOnSharedPreferenceChangeListener(this);unregisterReceiver(screenReceiver);if(overlay!=null && overlay.isAttachedToWindow())manager.removeView(overlay);root=null;overlay=null;stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
    @Override public IBinder onBind(Intent i){return null;}
}
