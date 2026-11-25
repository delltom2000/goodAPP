package app.qrcamera.scanner;

import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.LuminanceSource;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.ReaderException;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;

import java.util.Collections;

final class QrDecoder {
    static String preview(byte[] bytes, int width, int height) {
        LuminanceSource source = new PlanarYUVLuminanceSource(
                bytes, width, height, 0, 0, width, height, false);
        return decode(source);
    }

    static String photo(int[] pixels, int width, int height) {
        return decode(new RGBLuminanceSource(width, height, pixels));
    }

    private static String decode(LuminanceSource source) {
        BinaryBitmap normal = new BinaryBitmap(new HybridBinarizer(source));
        BinaryBitmap inverse = new BinaryBitmap(new HybridBinarizer(source.invert()));
        String value = read(normal, null);
        if (value == null) value = read(inverse, null);
        if (value == null) value = read(normal, DecodeHintType.TRY_HARDER);
        if (value == null) value = read(inverse, DecodeHintType.TRY_HARDER);
        if (value == null) value = read(normal, DecodeHintType.PURE_BARCODE);
        if (value == null) value = read(inverse, DecodeHintType.PURE_BARCODE);
        return value;
    }

    private static String read(BinaryBitmap bitmap, DecodeHintType hint) {
        try {
            return new QRCodeReader().decode(bitmap,
                    hint == null ? null : Collections.singletonMap(hint, Boolean.TRUE)).getText();
        } catch (ReaderException ignored) {
            return null;
        }
    }
}
