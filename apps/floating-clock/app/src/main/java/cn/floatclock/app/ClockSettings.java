package cn.floatclock.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

final class ClockSettings {
    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("clock", Context.MODE_PRIVATE); }
    static String time(boolean millis) { return new SimpleDateFormat(millis ? "HH:mm:ss.SSS" : "HH:mm:ss", Locale.US).format(new Date()); }
    static String displayTime(Context c) {
        String value = time(prefs(c).getBoolean("millis", false));
        return value;
    }
    static int color(Context c) { return prefs(c).getInt("color", 0xffffcf65); }
}
