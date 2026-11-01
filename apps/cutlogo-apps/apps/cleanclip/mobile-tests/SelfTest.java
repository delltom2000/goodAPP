package org.dailyfree.cleanclip;
import android.app.Instrumentation;
import android.os.Bundle;
import android.graphics.Bitmap;
import android.media.*;
import java.io.*;
import java.util.*;
import org.opencv.android.OpenCVLoader;
import org.opencv.core.Rect;
import org.json.*;

/** Test-only instrumentation; excluded from distributed APK. Runs the actual native engine. */
public class SelfTest extends Instrumentation {
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){Bundle result=new Bundle();File dir=getTargetContext().getFilesDir();
        try{if(!OpenCVLoader.initLocal())throw new Exception("OpenCV failed");File input=new File(dir,"native-test.mp4");LocalEngine.Meta meta=LocalEngine.inspect(input.getAbsolutePath());
            MediaMetadataRetriever r=new MediaMetadataRetriever();r.setDataSource(input.getAbsolutePath());Bitmap frame=LocalEngine.frame(r,1000000,meta);r.release();
            // Fixture is the supplied video resized to 640x360 and cut at 9 seconds.
            Rect box=new Rect(530,270,75,45);Bitmap tpl=Bitmap.createBitmap(frame,box.x,box.y,box.width,box.height);
            LocalEngine.Progress progress=new LocalEngine.Progress(){public boolean cancelled(){return false;}public void update(int p,String s){try(FileWriter w=new FileWriter(new File(dir,"test-progress.txt"))){w.write(p+" "+s);}catch(Exception ignored){}}};
            // No supplied rectangle or template: fixed AI label and moving brand must both be found.
            LocalEngine.Plan automatic=AutoLogoDetector.detect(input.getAbsolutePath(),meta,meta.durationUs,progress);
            if(automatic.targets.size()<2)throw new Exception("Automatic mode missed multiple overlays");
            List<org.opencv.core.Mat> templates=LocalEngine.templates(automatic);
            try{
                List<Rect> autoBoxes=LocalEngine.boxes(frame,automatic,templates,1000000,null);
                boolean fixed=false,brand=false;
                for(Rect b:autoBoxes){if(b.x<50&&b.y<30)fixed=true;if(b.x>500&&b.y>250)brand=true;}
                if(!fixed||!brand)throw new Exception("Automatic masks missed AI label or moving logo: "+autoBoxes);
                Bitmap repaired=LocalEngine.repair(frame,autoBoxes);
                if(repaired.getPixel(320,180)!=frame.getPixel(320,180))throw new Exception("Repair changed unselected subject");repaired.recycle();
                Bitmap blank=Bitmap.createBitmap(meta.width,meta.height,Bitmap.Config.ARGB_8888);blank.eraseColor(android.graphics.Color.rgb(90,110,130));
                if(!LocalEngine.boxes(blank,automatic,templates,0,null).isEmpty())throw new Exception("Blank scene falsely matched a logo");blank.recycle();
            }finally{for(org.opencv.core.Mat t:templates)t.release();}
            boolean cancelled=false;
            try{AutoLogoDetector.detect(input.getAbsolutePath(),meta,meta.durationUs,new LocalEngine.Progress(){public boolean cancelled(){return true;}public void update(int p,String s){}});}
            catch(IOException expected){cancelled=expected.getMessage().contains("取消");}
            if(!cancelled)throw new Exception("Automatic analysis ignored cancellation");
            LocalEngine.Plan plan=LocalEngine.analyse(input.getAbsolutePath(),meta,tpl,box,true,meta.durationUs,progress);
            if(plan.positions.size()<3)throw new Exception("Expected three logo locations, got "+plan.positions.size());
            File output=new File(dir,"native-test-output.mp4");LocalEngine.export(input.getAbsolutePath(),meta,automatic,null,output,progress);
            LocalEngine.Meta after=LocalEngine.inspect(output.getAbsolutePath());if(Math.abs(after.durationUs-meta.durationUs)>150000)throw new Exception("Duration mismatch");if(after.audioMime.isEmpty())throw new Exception("Audio lost");
            MediaMetadataRetriever check=new MediaMetadataRetriever();check.setDataSource(output.getAbsolutePath());Bitmap poster=LocalEngine.frame(check,1000000,after);check.release();try(FileOutputStream f=new FileOutputStream(new File(dir,"native-test-output.png"))){poster.compress(Bitmap.CompressFormat.PNG,100,f);}
            JSONObject report=new JSONObject();report.put("engine","OpenCV Android 4.12 / MediaCodec");report.put("locations",plan.positions.size());report.put("inputDurationUs",meta.durationUs);report.put("outputDurationUs",after.durationUs);report.put("width",after.width);report.put("height",after.height);report.put("fps",after.fps);report.put("audio",after.audioMime);report.put("bytes",output.length());
            try(FileWriter f=new FileWriter(new File(dir,"native-test-report.json"))){f.write(report.toString(2));}result.putString("result",report.toString());finish(-1,result);
        }catch(Throwable e){StringWriter s=new StringWriter();e.printStackTrace(new PrintWriter(s));result.putString("error",s.toString());try(FileWriter f=new FileWriter(new File(dir,"native-test-error.txt"))){f.write(s.toString());}catch(Exception ignored){}finish(0,result);}
    }
}
