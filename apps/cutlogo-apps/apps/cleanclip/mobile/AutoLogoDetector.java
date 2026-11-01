package org.dailyfree.cleanclip;

import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import java.io.IOException;
import java.util.*;
import org.opencv.core.*;
import org.opencv.imgproc.Imgproc;
import org.opencv.android.Utils;

/** Conservative multi-frame corner-overlay proposals; no model or network required. */
public final class AutoLogoDetector {
    static final class Candidate {
        Rect rect; int frame; double score;
        Candidate(Rect r,int f,double s){rect=r;frame=f;score=s;}
    }
    static boolean overlaps(Rect a,Rect b){
        int w=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
        int h=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
        return w*h>.35*Math.min(a.area(),b.area());
    }
    public static LocalEngine.Plan detect(String path,LocalEngine.Meta meta,long endUs,LocalEngine.Progress cb)throws Exception{
        if(endUs<=0||endUs>meta.durationUs)throw new IOException("结束时间必须在视频时长内");
        MediaMetadataRetriever reader=new MediaMetadataRetriever();
        List<Mat> edges=new ArrayList<>(),grays=new ArrayList<>();
        Mat votes=new Mat(),persistent=new Mat(),joined=new Mat(),kernel=new Mat();
        LocalEngine.Plan result=new LocalEngine.Plan();result.endUs=endUs;
        try{
            reader.setDataSource(path);
            int count=(int)Math.max(4,Math.min(24,Math.ceil(endUs/500000.0)));
            double scale=Math.min(1,640.0/meta.width);int w=(int)(meta.width*scale),h=(int)(meta.height*scale);
            votes=Mat.zeros(h,w,CvType.CV_32F);
            for(int i=0;i<count;i++){
                if(cb.cancelled())throw new IOException("已取消");
                Bitmap full=LocalEngine.frame(reader,i*(endUs-1)/count,meta);
                Bitmap small=Bitmap.createScaledBitmap(full,w,h,true);if(small!=full)full.recycle();
                Mat rgba=new Mat(),gray=new Mat(),edge=new Mat(),floatEdge=new Mat();
                try{Utils.bitmapToMat(small,rgba);Imgproc.cvtColor(rgba,gray,Imgproc.COLOR_RGBA2GRAY);
                    Imgproc.Canny(gray,edge,70,160);edge.convertTo(floatEdge,CvType.CV_32F,1.0/255);Core.add(votes,floatEdge,votes);
                    edges.add(edge);grays.add(gray);
                }finally{rgba.release();floatEdge.release();small.recycle();}
                cb.update(i*35/count,"自动查找 Logo：采样 "+(i+1)+" / "+count);
            }
            Core.compare(votes,new Scalar(Math.max(3,Math.ceil(count*.25))),persistent,Core.CMP_GE);
            // Join glyphs into labels, while keeping separate corner labels separate.
            kernel=Imgproc.getStructuringElement(Imgproc.MORPH_RECT,new Size(9,3));
            Imgproc.morphologyEx(persistent,joined,Imgproc.MORPH_CLOSE,kernel);
            List<MatOfPoint> contours=new ArrayList<>();Mat hierarchy=new Mat();
            try{Imgproc.findContours(joined,contours,hierarchy,Imgproc.RETR_EXTERNAL,Imgproc.CHAIN_APPROX_SIMPLE);
                List<Candidate> candidates=new ArrayList<>();
                for(MatOfPoint contour:contours){
                    Rect r=Imgproc.boundingRect(contour);
                    if(r.width<12||r.height<6||r.width>w*.28||r.height>h*.16)continue;
                    // Corner overlays only. Central titles and subtitles require manual selection.
                    if(!(r.x+r.width<w*.38||r.x>w*.62)||!(r.y+r.height<h*.30||r.y>h*.70))continue;
                    Mat stable=persistent.submat(r);double density=Core.countNonZero(stable)/r.area();stable.release();
                    if(density<.045||density>.55)continue;
                    int bestFrame=0,hits=0;double best=-1;
                    // Stable edges must recur on a changing background, not just a still scene.
                    Rect ring=new Rect(Math.max(0,r.x-10),Math.max(0,r.y-10),0,0);
                    ring.width=Math.min(w, r.x+r.width+10)-ring.x;ring.height=Math.min(h,r.y+r.height+10)-ring.y;
                    double motion=0;Mat delta=new Mat();
                    try{for(int i=1;i<count;i++){Mat a=grays.get(i-1).submat(ring),b=grays.get(i).submat(ring);
                        Core.absdiff(a,b,delta);motion+=Core.mean(delta).val[0];a.release();b.release();}}
                    finally{delta.release();}
                    if(motion/(count-1)<7)continue;
                    for(int i=0;i<count;i++){Mat e=edges.get(i).submat(r),s=persistent.submat(r),both=new Mat();
                        try{Core.bitwise_and(e,s,both);double support=Core.countNonZero(both)/(density*r.area());
                            if(support>=.65)hits++;if(support>best){best=support;bestFrame=i;}}
                        finally{e.release();s.release();both.release();}}
                    if(hits<Math.max(3,(int)Math.ceil(count*.25)))continue;
                    int x=Math.max(0,(int)((r.x-3)/scale)),y=Math.max(0,(int)((r.y-3)/scale));
                    Rect box=new Rect(x,y,Math.min(meta.width-x,(int)Math.ceil((r.width+6)/scale)),Math.min(meta.height-y,(int)Math.ceil((r.height+6)/scale)));
                    candidates.add(new Candidate(box,bestFrame,hits* density));
                }
                candidates.sort((a,b)->Double.compare(b.score,a.score));
                for(Candidate c:candidates){
                    if(cb.cancelled())throw new IOException("已取消");
                    boolean duplicate=false;for(LocalEngine.Plan p:result.targets)for(Rect r:p.positions)if(overlaps(r,c.rect))duplicate=true;
                    if(duplicate)continue;
                    Bitmap b=LocalEngine.frame(reader,c.frame*(endUs-1)/count,meta);
                    Bitmap tpl=Bitmap.createBitmap(b,c.rect.x,c.rect.y,c.rect.width,c.rect.height);if(tpl!=b)b.recycle();
                    LocalEngine.Plan p=new LocalEngine.Plan();p.template=tpl;p.moving=true;p.endUs=endUs;p.threshold=.38;p.searchEverywhere=true;
                    // Search the whole frame at export time: the detected logo may jump corners.
                    p.positions.add(c.rect);result.targets.add(p);result.positions.add(c.rect);
                    if(result.targets.size()>=6)break;
                }
            }finally{for(MatOfPoint c:contours)c.release();hierarchy.release();}
            if(result.targets.isEmpty())throw new IOException("未识别到可靠的角落 Logo。可展开手动设置，框选一次后再处理。");
            cb.update(100,"自动识别到 "+result.targets.size()+" 个 Logo / 角标");return result;
        }finally{reader.release();for(Mat e:edges)e.release();for(Mat g:grays)g.release();votes.release();persistent.release();joined.release();kernel.release();}
    }
}
