package org.dailyfree.quietqr;

import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.EncodeHintType;
import com.google.zxing.NotFoundException;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import java.util.EnumMap;
import java.util.Map;

public final class QrCodec {
    private QrCodec() {}

    public static BitMatrix encode(String value, int size) throws Exception {
        Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
        hints.put(EncodeHintType.CHARACTER_SET, "UTF-8");
        hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M);
        hints.put(EncodeHintType.MARGIN, 4);
        return new QRCodeWriter().encode(QrContent.text(value), BarcodeFormat.QR_CODE, size, size, hints);
    }

    public static String decode(int width, int height, int[] pixels) throws Exception {
        RGBLuminanceSource source = new RGBLuminanceSource(width, height, pixels);
        Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        hints.put(DecodeHintType.CHARACTER_SET, "UTF-8");
        try {
            Result result = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source)), hints);
            return result.getText();
        } catch (NotFoundException missing) {
            return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source.invert())), hints).getText();
        }
    }
}
