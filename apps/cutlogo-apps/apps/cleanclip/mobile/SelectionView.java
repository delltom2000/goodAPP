package org.dailyfree.cleanclip;
import android.content.Context;
import android.graphics.*;
import android.view.*;
import org.opencv.core.Rect;

public class SelectionView extends View {
    public Bitmap bitmap;public Rect selected,extra;Paint paint=new Paint(3);float sx,sy;boolean drawing=false;public Runnable changed;
    public SelectionView(Context c){super(c);setContentDescription("视频画面：拖动画框选择要消除的 Logo");setFocusable(true);}
    public void image(Bitmap b){bitmap=b;requestLayout();invalidate();}
    @Override protected void onMeasure(int w,int h){int width=MeasureSpec.getSize(w);int height=bitmap==null?width*9/16:Math.round(width*(float)bitmap.getHeight()/bitmap.getWidth());setMeasuredDimension(width,height);}
    void box(Canvas c,Rect r,int color){if(r==null||bitmap==null)return;float scale=getWidth()/(float)bitmap.getWidth();paint.setColor(color);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(3);c.drawRect(r.x*scale,r.y*scale,(r.x+r.width)*scale,(r.y+r.height)*scale,paint);paint.setStyle(Paint.Style.FILL);}
    @Override protected void onDraw(Canvas c){c.drawColor(Color.rgb(20,38,29));if(bitmap!=null){c.drawBitmap(bitmap,null,new RectF(0,0,getWidth(),getHeight()),paint);box(c,selected,Color.rgb(214,246,137));box(c,extra,Color.rgb(104,184,255));}else{paint.setColor(Color.rgb(200,214,190));paint.setTextSize(16*getResources().getDisplayMetrics().scaledDensity);c.drawText("导入视频后，在这里框选 Logo",20,getHeight()/2f,paint);}}
    @Override public boolean onTouchEvent(MotionEvent e){if(bitmap==null||!isEnabled())return false;float x=Math.max(0,Math.min(bitmap.getWidth()-1,e.getX()*bitmap.getWidth()/getWidth())),y=Math.max(0,Math.min(bitmap.getHeight()-1,e.getY()*bitmap.getHeight()/getHeight()));
        if(e.getAction()==MotionEvent.ACTION_DOWN){getParent().requestDisallowInterceptTouchEvent(true);sx=x;sy=y;drawing=true;return true;}
        if(drawing&&(e.getAction()==MotionEvent.ACTION_MOVE||e.getAction()==MotionEvent.ACTION_UP)){selected=new Rect((int)Math.min(sx,x),(int)Math.min(sy,y),(int)Math.abs(sx-x),(int)Math.abs(sy-y));invalidate();if(e.getAction()==MotionEvent.ACTION_UP){drawing=false;getParent().requestDisallowInterceptTouchEvent(false);performClick();if(changed!=null)changed.run();}return true;}
        if(e.getAction()==MotionEvent.ACTION_CANCEL){drawing=false;getParent().requestDisallowInterceptTouchEvent(false);}return true;
    }
    @Override public boolean performClick(){super.performClick();return true;}
}
