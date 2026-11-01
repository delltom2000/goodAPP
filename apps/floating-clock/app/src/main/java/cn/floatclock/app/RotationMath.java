package cn.floatclock.app;

final class RotationMath {
    // Sensor angles describe the device, while View rotation describes the content.
    static int stableQuarter(int sensor, int previous) {
        if (sensor < 0) return previous;
        int nearest = ((sensor + 45) / 90 * 90) % 360;
        int distance = Math.abs(sensor - nearest);
        distance = Math.min(distance, 360 - distance);
        return distance <= 30 ? nearest : previous;
    }
    static int contentRotation(int sensorQuarter, int displayDegrees) {
        return ((-sensorQuarter - displayDegrees) % 360 + 360) % 360;
    }
}
