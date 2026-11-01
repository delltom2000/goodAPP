package org.dailyfree.quietqr;

import java.net.URI;
import java.nio.charset.StandardCharsets;

/** Plain Java input rules; shared by the app and offline round-trip tests. */
public final class QrContent {
    private QrContent() {}

    public static String text(String input) {
        if (input == null || input.trim().isEmpty()) throw new IllegalArgumentException("请输入二维码内容");
        if (input.getBytes(StandardCharsets.UTF_8).length > 1500)
            throw new IllegalArgumentException("内容较长，请缩短到 1500 字节以内（中文通常占 3 字节）");
        return input;
    }

    public static String url(String input) {
        String value = input == null ? "" : input.trim();
        if (!isWebUrl(value)) throw new IllegalArgumentException("请输入完整的 http:// 或 https:// 链接");
        return text(value);
    }

    public static boolean isWebUrl(String value) {
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme();
            return ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                && uri.getHost() != null && !uri.getHost().isEmpty()
                && uri.getUserInfo() == null;
        } catch (Exception ignored) { return false; }
    }

    public static String wifi(String ssid, String password, boolean open, boolean hidden) {
        if (ssid == null || ssid.trim().isEmpty()) throw new IllegalArgumentException("请输入 Wi-Fi 名称");
        if (ssid.getBytes(StandardCharsets.UTF_8).length > 32) throw new IllegalArgumentException("Wi-Fi 名称不能超过 32 字节");
        if (!open && (password == null || password.isEmpty())) throw new IllegalArgumentException("请输入 Wi-Fi 密码，或选择开放网络");
        String value = "WIFI:T:" + (open ? "nopass" : "WPA") + ";S:" + escape(ssid)
            + ";P:" + (open ? "" : escape(password)) + ";H:" + hidden + ";;";
        return text(value);
    }

    private static String escape(String value) {
        StringBuilder out = new StringBuilder();
        for (char c : value.toCharArray()) {
            if (c == '\\' || c == ';' || c == ',' || c == ':' || c == '"') out.append('\\');
            out.append(c);
        }
        return out.toString();
    }
}
