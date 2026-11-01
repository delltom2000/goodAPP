package org.dailyfree.cleanclip;

import android.graphics.Bitmap;
import android.media.*;
import java.io.*;
import java.util.*;
import org.opencv.android.Utils;
import org.opencv.core.*;
import org.opencv.imgproc.Imgproc;
import org.opencv.photo.Photo;

/** All decoding, matching and inpainting takes place in the Android process. */
public final class LocalEngine {
    public interface Progress {void update(int percent,String text);boolean cancelled();}
    public static class Meta {public int width,height,fps;public long durationUs;public String audioMime="";}
    public static class Sample {public long us;public Rect rect;public double score;Sample(long t,Rect r,double s){us=t;rect=r;score=s;}}
    public static class Plan {public List<Rect> positions=new ArrayList<>();public List<Sample> samples=new ArrayList<>();public List<Plan> targets=new ArrayList<>();public Bitmap template;public boolean moving,searchEverywhere;public double threshold=.24;public int uncertain;public long endUs;}
    public static Meta inspect(String path)throws Exception{
        MediaMetadataRetriever r=new MediaMetadataRetriever();Meta m=new Meta();
        try{r.setDataSource(path);m.durationUs=Long.parseLong(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION))*1000;
            Bitmap f=r.getFrameAtTime(0,MediaMetadataRetriever.OPTION_CLOSEST);if(f==null)throw new IOException("视频无法解码");
            double scale=Math.min(1,1280.0/Math.max(f.getWidth(),f.getHeight()));m.width=Math.max(2,((int)(f.getWidth()*scale)/2)*2);m.height=Math.max(2,((int)(f.getHeight()*scale)/2)*2);f.recycle();
        }finally{r.release();}
        MediaExtractor e=new MediaExtractor();try{e.setDataSource(path);m.fps=24;for(int i=0;i<e.getTrackCount();i++){MediaFormat f=e.getTrackFormat(i);String mime=f.getString(MediaFormat.KEY_MIME);if(mime.startsWith("video/")&&f.containsKey(MediaFormat.KEY_FRAME_RATE))m.fps=Math.max(1,Math.min(30,f.getInteger(MediaFormat.KEY_FRAME_RATE)));if(mime.startsWith("audio/"))m.audioMime=mime;}}finally{e.release();}
        if(m.durationUs<=0||m.durationUs>120000000L)throw new IOException("独立版暂支持 2 分钟以内的视频");return m;
    }
    public static Bitmap frame(MediaMetadataRetriever r,long us,Meta m)throws IOException{
        Bitmap b;
        if(android.os.Build.VERSION.SDK_INT>=27)b=r.getScaledFrameAtTime(us,MediaMetadataRetriever.OPTION_CLOSEST,m.width,m.height);
        else b=r.getFrameAtTime(us,MediaMetadataRetriever.OPTION_CLOSEST);
        if(b==null)throw new IOException("无法读取视频画面："+(us/1000000.0)+" 秒");
        if(b.getWidth()!=m.width||b.getHeight()!=m.height){Bitmap scaled=Bitmap.createScaledBitmap(b,m.width,m.height,true);b.recycle();b=scaled;}
        if(b.getConfig()!=Bitmap.Config.ARGB_8888){Bitmap copy=b.copy(Bitmap.Config.ARGB_8888,false);b.recycle();b=copy;}return b;
    }
    public static Mat edge(Bitmap b){Mat rgba=new Mat(),gray=new Mat(),out=new Mat();try{Utils.bitmapToMat(b,rgba);Imgproc.cvtColor(rgba,gray,Imgproc.COLOR_RGBA2GRAY);Imgproc.Canny(gray,out,100,200);return out;}finally{rgba.release();gray.release();}}
    public static Rect bounded(Rect r,Meta m)throws IOException{if(r==null||r.x<0||r.y<0||r.width<8||r.height<8||r.x+r.width>m.width||r.y+r.height>m.height)throw new IOException("请在视频画面内框选完整 Logo，选区至少 8 × 8 像素");return r;}
    public static Plan analyse(String path,Meta m,Bitmap template,Rect initial,boolean moving,long endUs,Progress cb)throws Exception{
        if(endUs<=0||endUs>m.durationUs)throw new IOException("结束时间必须在视频时长内");bounded(initial,m);
        Plan p=new Plan();p.template=template;p.moving=moving;p.endUs=endUs;
        if(!moving){p.positions.add(initial);p.samples.add(new Sample(0,initial,1));return p;}
        Mat te=edge(template);MediaMetadataRetriever r=new MediaMetadataRetriever();
        try{if(Core.countNonZero(te)<12)throw new IOException("选区轮廓不足，请选择更清晰的 Logo");r.setDataSource(path);
            List<List<Sample>> clusters=new ArrayList<>();
            for(long us=0;us<endUs;us+=250000){if(cb.cancelled())throw new IOException("已取消");Bitmap b=frame(r,us,m);Mat e=edge(b),scores=new Mat();b.recycle();
                try{Imgproc.matchTemplate(e,te,scores,Imgproc.TM_CCORR_NORMED);Core.MinMaxLocResult mm=Core.minMaxLoc(scores);Rect box=new Rect((int)mm.maxLoc.x,(int)mm.maxLoc.y,template.getWidth(),template.getHeight());Sample s=new Sample(us,box,mm.maxVal);p.samples.add(s);
                    if(mm.maxVal>=.30){List<Sample> group=null;for(List<Sample> c:clusters){Rect q=c.get(0).rect;if(Math.abs(q.x-box.x)<12&&Math.abs(q.y-box.y)<12){group=c;break;}}if(group==null){group=new ArrayList<>();clusters.add(group);}group.add(s);}
                }finally{scores.release();e.release();}cb.update((int)(us*100/endUs),"识别位置 "+String.format(Locale.US,"%.1f",us/1e6)+" 秒");
            }
            for(List<Sample> c:clusters)if(c.size()>=2){int[] xs=new int[c.size()],ys=new int[c.size()];for(int i=0;i<c.size();i++){xs[i]=c.get(i).rect.x;ys[i]=c.get(i).rect.y;}Arrays.sort(xs);Arrays.sort(ys);p.positions.add(new Rect(xs[xs.length/2],ys[ys.length/2],template.getWidth(),template.getHeight()));}
            if(p.positions.isEmpty())throw new IOException("未找到稳定的移动 Logo。请重新框选，或关闭自动跟随使用固定选区。");
            // Re-score stable locations, so scene texture cannot pull a low-confidence box away.
            for(Sample s:p.samples){if(cb.cancelled())throw new IOException("已取消");Bitmap b=frame(r,s.us,m);Sample match=locate(b,p,te,s.us);b.recycle();s.rect=match.rect;s.score=match.score;if(s.score<.24)p.uncertain++;}
            return p;
        }finally{te.release();r.release();}
    }
    public static Sample locate(Bitmap bitmap,Plan p,Mat te,long us){
        if(!p.moving)return new Sample(us,p.positions.get(0),1);
        Mat e=edge(bitmap);double best=-1;Rect found=p.positions.get(0);
        try{
        if(p.searchEverywhere){Mat scores=new Mat();try{Imgproc.matchTemplate(e,te,scores,Imgproc.TM_CCORR_NORMED);Core.MinMaxLocResult mm=Core.minMaxLoc(scores);if(mm.maxVal>=.55)return new Sample(us,new Rect((int)mm.maxLoc.x,(int)mm.maxLoc.y,te.cols(),te.rows()),mm.maxVal);}finally{scores.release();}}
        for(Rect r:p.positions){int x=Math.max(0,r.x-4),y=Math.max(0,r.y-4);Rect area=new Rect(x,y,Math.min(e.cols()-x,r.width+9),Math.min(e.rows()-y,r.height+9));Mat roi=e.submat(area),scores=new Mat();
            try{if(roi.cols()<te.cols()||roi.rows()<te.rows())continue;Imgproc.matchTemplate(roi,te,scores,Imgproc.TM_CCORR_NORMED);Core.MinMaxLocResult mm=Core.minMaxLoc(scores);if(mm.maxVal>best){best=mm.maxVal;found=new Rect(x+(int)mm.maxLoc.x,y+(int)mm.maxLoc.y,r.width,r.height);}}finally{roi.release();scores.release();}
        }return new Sample(us,found,best);}finally{e.release();}
    }
    /** Shared by preview and export so both repair exactly the same confident targets. */
    public static List<Rect> boxes(Bitmap bitmap,Plan plan,List<Mat> templates,long us,Rect extra){
        List<Rect> boxes=new ArrayList<>();List<Plan> targets=plan.targets.isEmpty()?Collections.singletonList(plan):plan.targets;
        for(int i=0;i<targets.size();i++){Plan p=targets.get(i);Sample s=locate(bitmap,p,templates.get(i),us);
            if(!p.moving||s.score>=p.threshold){boolean duplicate=false;for(Rect r:boxes)if(AutoLogoDetector.overlaps(r,s.rect))duplicate=true;if(!duplicate)boxes.add(s.rect);}}
        if(extra!=null)boxes.add(extra);return boxes;
    }
    public static List<Mat> templates(Plan plan){List<Mat> out=new ArrayList<>();for(Plan p:plan.targets.isEmpty()?Collections.singletonList(plan):plan.targets)out.add(edge(p.template));return out;}
    public static Bitmap repair(Bitmap bitmap,List<Rect> boxes){
        Mat rgba=new Mat(),rgb=new Mat(),mask=new Mat(bitmap.getHeight(),bitmap.getWidth(),CvType.CV_8UC1,new Scalar(0)),out=new Mat();
        try{Utils.bitmapToMat(bitmap,rgba);Imgproc.cvtColor(rgba,rgb,Imgproc.COLOR_RGBA2RGB);
            for(Rect r:boxes){int x=Math.max(0,r.x-3),y=Math.max(0,r.y-3),right=Math.min(bitmap.getWidth()-1,r.x+r.width+3),bottom=Math.min(bitmap.getHeight()-1,r.y+r.height+3);Imgproc.rectangle(mask,new Point(x,y),new Point(right,bottom),new Scalar(255),-1);}
            Photo.inpaint(rgb,mask,out,3,Photo.INPAINT_TELEA);Bitmap result=Bitmap.createBitmap(bitmap.getWidth(),bitmap.getHeight(),Bitmap.Config.ARGB_8888);Utils.matToBitmap(out,result);return result;
        }finally{rgba.release();rgb.release();mask.release();out.release();}
    }
    public static File export(String path,Meta m,Plan plan,Rect extra,File target,Progress cb)throws Exception{
        MediaMetadataRetriever r=new MediaMetadataRetriever();List<Mat> templates=templates(plan);VideoEncoder enc=null;boolean ok=false;
        try{r.setDataSource(path);enc=new VideoEncoder(target,path,m,plan.endUs);long frames=(long)Math.ceil(plan.endUs*m.fps/1000000.0);int repairedFrames=0;
            for(int i=0;i<frames;i++){if(cb.cancelled())throw new IOException("已取消，原视频未改动");long us=i*1000000L/m.fps;Bitmap b=frame(r,us,m);Bitmap repaired=null;
                try{List<Rect> boxes=boxes(b,plan,templates,us,extra);
                    if(!boxes.isEmpty()){repaired=repair(b,boxes);repairedFrames++;}enc.frame(repaired==null?b:repaired,us);cb.update((int)((i+1)*100/frames),"手机本地修复 "+(i+1)+" / "+frames+" 帧");
                }finally{b.recycle();if(repaired!=null)repaired.recycle();}
            }if(repairedFrames==0)throw new IOException("未找到可可靠修补的 Logo，请展开手动设置补选后重试");enc.finish(cb);ok=true;return target;
        }finally{for(Mat te:templates)te.release();r.release();if(enc!=null)enc.close();if(!ok)target.delete();}
    }
}
