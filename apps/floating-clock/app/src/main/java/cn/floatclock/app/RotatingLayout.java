package cn.floatclock.app;

import android.content.Context;
import android.view.View;
import android.view.ViewGroup;

/** Sizes the actual overlay window to the rotated content, including its touch area. */
final class RotatingLayout extends ViewGroup {
    private int angle;
    RotatingLayout(Context context) { super(context); }
    void setAngle(int value) { if (angle != value) { angle=value; requestLayout(); } }
    boolean swapsAxes() { return angle == 90 || angle == 270; }
    @Override protected void onMeasure(int widthSpec, int heightSpec) {
        View child=getChildAt(0);
        child.measure(swapsAxes()?heightSpec:widthSpec, swapsAxes()?widthSpec:heightSpec);
        setMeasuredDimension(swapsAxes()?child.getMeasuredHeight():child.getMeasuredWidth(),
                swapsAxes()?child.getMeasuredWidth():child.getMeasuredHeight());
    }
    @Override protected void onLayout(boolean changed,int l,int t,int r,int b) {
        View child=getChildAt(0);
        int w=child.getMeasuredWidth(), h=child.getMeasuredHeight();
        child.layout(0,0,w,h);
        child.setPivotX(0); child.setPivotY(0); child.setRotation(angle);
        child.setTranslationX(angle==90?h:angle==180?w:0);
        child.setTranslationY(angle==270?w:angle==180?h:0);
    }
}
