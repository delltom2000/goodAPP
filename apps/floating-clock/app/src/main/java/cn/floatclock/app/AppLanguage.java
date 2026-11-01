package cn.floatclock.app;

import android.content.Context;
import android.content.res.Configuration;
import java.util.Locale;

final class AppLanguage {
    static String code(Context context) {
        return "en".equals(ClockSettings.prefs(context).getString("language", "zh")) ? "en" : "zh";
    }
    static Context wrap(Context context) {
        Configuration configuration=new Configuration(context.getResources().getConfiguration());
        configuration.setLocale(new Locale(code(context)));
        return context.createConfigurationContext(configuration);
    }
    static String text(Context context,int resource) { return wrap(context).getString(resource); }
}
