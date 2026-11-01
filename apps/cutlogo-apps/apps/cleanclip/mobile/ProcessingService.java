package org.dailyfree.cleanclip;
import android.app.*;
import android.content.*;
import android.os.*;
import java.io.File;
import org.opencv.core.Rect;

public class ProcessingService extends Service {
    public static class Job {public String input;public LocalEngine.Meta meta;public LocalEngine.Plan plan;public Rect extra;public volatile boolean cancel=false,finished=false;public volatile int percent=0;public volatile String status="正在准备",error="";public File output;}
    public static volatile Job current;
    @Override public IBinder onBind(Intent i){return null;}
    Notification notification(String text,int pct){return new Notification.Builder(this,"repair").setSmallIcon(getApplicationInfo().icon).setContentTitle("净片 · 手机本地处理").setContentText(text).setOngoing(true).setProgress(100,pct,false).setContentIntent(PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE)).build();}
    @Override public int onStartCommand(Intent i,int flags,int id){final Job j=current;if(j==null||j.finished){stopSelf();return START_NOT_STICKY;}
        NotificationManager nm=getSystemService(NotificationManager.class);nm.createNotificationChannel(new NotificationChannel("repair","视频修复",NotificationManager.IMPORTANCE_LOW));startForeground(1,notification("正在准备",0));
        new Thread(()->{PowerManager.WakeLock wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"CleanClip:repair");wake.acquire(30*60*1000L);
            try{File pending=new File(getFilesDir(),"result-pending.mp4");LocalEngine.export(j.input,j.meta,j.plan,j.extra,pending,new LocalEngine.Progress(){long last=0;public boolean cancelled(){return j.cancel;}public void update(int p,String s){j.percent=p;j.status=s;if(System.currentTimeMillis()-last>1000){last=System.currentTimeMillis();nm.notify(1,notification(s,p));}}});
                File complete=new File(getFilesDir(),"result.mp4");java.nio.file.Files.move(pending.toPath(),complete.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);j.output=complete;j.status="完成 · 视频已保存在手机，可预览或另存";j.percent=100;
            }catch(Throwable e){j.error=e.getMessage()==null?e.getClass().getSimpleName():e.getMessage();j.status=j.error;}
            finally{j.finished=true;if(wake.isHeld())wake.release();stopForeground(true);stopSelf();}
        },"cleanclip-local-repair").start();return START_NOT_STICKY;
    }
}
