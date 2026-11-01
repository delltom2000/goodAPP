package cn.floatclock.app;

public final class RotationMathTest {
    private static void eq(int expected,int actual){if(expected!=actual)throw new AssertionError(expected+" != "+actual);}
    public static void main(String[] args){
        // Locked portrait: physically turning the phone clockwise requires counter-clockwise content.
        eq(0,RotationMath.contentRotation(0,0));
        eq(270,RotationMath.contentRotation(90,0));
        eq(90,RotationMath.contentRotation(270,0));
        eq(180,RotationMath.contentRotation(180,0));
        // The operating system has already rotated: no second rotation.
        eq(0,RotationMath.contentRotation(270,90));
        eq(0,RotationMath.contentRotation(90,270));
        eq(0,RotationMath.contentRotation(180,180));
        for(int sensor=0;sensor<360;sensor+=90)
            for(int display=0;display<360;display+=90)
                eq(0,(sensor+display+RotationMath.contentRotation(sensor,display))%360);
        // Dead band prevents flapping; flat/unknown preserves orientation.
        eq(0,RotationMath.stableQuarter(45,0));
        eq(90,RotationMath.stableQuarter(45,90));
        eq(90,RotationMath.stableQuarter(65,0));
        eq(0,RotationMath.stableQuarter(355,90));
        eq(270,RotationMath.stableQuarter(-1,270));
        System.out.println("Rotation math: locked/auto-rotated displays, 16 combinations, dead band and unknown orientation passed.");
    }
}
