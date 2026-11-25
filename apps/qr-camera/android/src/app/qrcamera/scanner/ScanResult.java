package app.qrcamera.scanner;

import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class ScanResult {
    enum Type { WEB, SMS, PASSKEY, AUTHENTICATOR, TRANSFER, TEXT }

    private static final Pattern SMS = Pattern.compile(
            "^(?:smsto:(\\+?[0-9]{3,20}):([\\s\\S]*)|sms:(\\+?[0-9]{3,20})(?:\\?body=([\\s\\S]*))?)$",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern FIDO = Pattern.compile("FIDO:/[0-9]+", Pattern.CASE_INSENSITIVE);

    final Type type;
    final String data;
    final String display;
    final String message;

    private ScanResult(Type type, String data, String display, String message) {
        this.type = type;
        this.data = data;
        this.display = display;
        this.message = message;
    }

    static ScanResult from(String raw) {
        String value = raw.trim();
        String lower = value.toLowerCase(Locale.ROOT);
        if (FIDO.matcher(value).matches()) {
            return new ScanResult(Type.PASSKEY, "FIDO:/" + value.substring(6), null, null);
        }
        if (lower.startsWith("fido:")) {
            return new ScanResult(Type.TEXT, null, null, null);
        }
        if (lower.startsWith("otpauth:")) {
            return new ScanResult(Type.AUTHENTICATOR, "otpauth:" + value.substring(8), null, null);
        }
        if (lower.startsWith("otpauth-migration:")) {
            return new ScanResult(Type.TRANSFER, null, null, null);
        }
        Matcher sms = SMS.matcher(value);
        if (sms.matches()) {
            if (sms.group(1) != null) {
                return new ScanResult(Type.SMS, sms.group(1), sms.group(1), sms.group(2));
            }
            try {
                String body = sms.group(4);
                return new ScanResult(Type.SMS, sms.group(3), sms.group(3),
                        body == null ? "" : URLDecoder.decode(body, "UTF-8"));
            } catch (IllegalArgumentException | UnsupportedEncodingException ignored) {
                return new ScanResult(Type.TEXT, null, null, null);
            }
        }
        if (lower.startsWith("sms:") || lower.startsWith("smsto:")) {
            return new ScanResult(Type.TEXT, null, null, null);
        }
        if (lower.startsWith("https://") || lower.startsWith("http://")) {
            try {
                URI uri = new URI(value);
                if (uri.getHost() != null && uri.getRawUserInfo() == null) {
                    String address = uri.getScheme().toLowerCase(Locale.ROOT)
                            + value.substring(uri.getScheme().length());
                    return new ScanResult(Type.WEB, address, uri.getHost(), null);
                }
            } catch (URISyntaxException ignored) {
                // Leave malformed addresses as selectable text.
            }
        }
        return new ScanResult(Type.TEXT, null, raw, null);
    }
}
