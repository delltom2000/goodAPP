package app.qrcamera.scanner;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.ImageFormat;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.SurfaceTexture;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.hardware.Camera;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@SuppressWarnings("deprecation")
public final class ScannerActivity extends Activity {
    private static final int CAMERA_REQUEST = 10;
    private static final int PHOTO_REQUEST = 11;
    private static final int BACKGROUND = 0xff101b1a;
    private static final int SURFACE = 0xff192e27;
    private static final int TEXT = 0xfff2fbf7;
    private static final int MUTED = 0xffb7cec6;
    private static final int MINT = 0xffaaf3c9;
    private static final String PLAY_SERVICES = "com.google.android.gms";
    private static final String AUTHENTICATOR = "com.google.android.apps.authenticator2";

    private final ExecutorService decoder = Executors.newSingleThreadExecutor();
    private Camera camera;
    private FrameLayout previewFrame;
    private TextureView preview;
    private TextView status;
    private TextView viewLabel;
    private Button cameraButton;
    private LinearLayout resultPanel;
    private TextView resultDetail;
    private TextView resultValue;
    private Button resultAction;
    private boolean wantsCamera;
    private boolean active;
    private int generation;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(BACKGROUND);
        getWindow().setNavigationBarColor(BACKGROUND);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        createScreen();
    }

    private void createScreen() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BACKGROUND);
        LinearLayout root = column();
        root.setPadding(dp(20), dp(16), dp(20), dp(20));
        scroll.addView(root);
        setContentView(scroll);

        TextView title = label("扫码相机", 32, TEXT);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        add(root, title, 0);
        add(root, label("用相机或相册识别二维码", 16, MUTED), 4);

        previewFrame = new FrameLayout(this);
        previewFrame.setBackground(shape(SURFACE, 20));
        previewFrame.setClipToOutline(true);
        LinearLayout.LayoutParams frameLayout = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(265));
        frameLayout.topMargin = dp(16);
        root.addView(previewFrame, frameLayout);

        preview = new TextureView(this);
        preview.setAlpha(0f);
        previewFrame.addView(preview, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
        previewFrame.addView(new Finder(), new FrameLayout.LayoutParams(-1, -1));
        viewLabel = label("将二维码对准取景框", 14, TEXT);
        viewLabel.setPadding(dp(10), dp(5), dp(10), dp(5));
        viewLabel.setBackground(shape(BACKGROUND, 20));
        FrameLayout.LayoutParams labelLayout = new FrameLayout.LayoutParams(
                -2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        labelLayout.bottomMargin = dp(14);
        previewFrame.addView(viewLabel, labelLayout);
        preview.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
            @Override public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) {
                openCameraIfReady();
            }
            @Override public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) { }
            @Override public void onSurfaceTextureUpdated(SurfaceTexture surface) { }
            @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) {
                releaseCamera();
                return true;
            }
        });

        LinearLayout actions = new LinearLayout(this);
        actions.setBaselineAligned(false);
        cameraButton = button("打开相机", true);
        cameraButton.setOnClickListener(view -> toggleCamera());
        Button gallery = button("从相册选图", false);
        gallery.setOnClickListener(view -> openGallery());
        actions.addView(cameraButton, new LinearLayout.LayoutParams(0, -2, 1));
        LinearLayout.LayoutParams galleryLayout = new LinearLayout.LayoutParams(0, -2, 1);
        galleryLayout.leftMargin = dp(8);
        actions.addView(gallery, galleryLayout);
        add(root, actions, 12);

        status = label("", 15, MUTED);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        add(root, status, 8);
        setStatus("");

        resultPanel = column();
        resultPanel.setPadding(dp(14), dp(13), dp(14), dp(14));
        resultPanel.setBackground(shape(SURFACE, 16));
        resultPanel.setVisibility(View.GONE);
        TextView resultTitle = label("扫码结果", 20, TEXT);
        resultTitle.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        add(resultPanel, resultTitle, 0);
        resultDetail = label("", 16, TEXT);
        add(resultPanel, resultDetail, 7);
        resultValue = label("", 15, MUTED);
        resultValue.setMaxLines(8);
        resultValue.setEllipsize(android.text.TextUtils.TruncateAt.END);
        resultValue.setTextIsSelectable(true);
        add(resultPanel, resultValue, 6);
        resultAction = button("", true);
        add(resultPanel, resultAction, 10);
        add(root, resultPanel, 8);
        add(root, label("相机画面和二维码均在手机上处理。", 14, MUTED), 14);
    }

    @Override protected void onResume() {
        super.onResume();
        active = true;
        openCameraIfReady();
    }

    @Override protected void onPause() {
        active = false;
        if (camera != null) stopCamera();
        super.onPause();
    }

    @Override protected void onDestroy() {
        generation++;
        releaseCamera();
        decoder.shutdownNow();
        super.onDestroy();
    }

    private void toggleCamera() {
        if (wantsCamera || camera != null) {
            stopCamera();
            return;
        }
        clearResult();
        generation++;
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.CAMERA }, CAMERA_REQUEST);
            return;
        }
        requestCamera();
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request != CAMERA_REQUEST) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            requestCamera();
        } else {
            setStatus("请在系统设置中允许相机权限，或从相册选图。");
        }
    }

    private void requestCamera() {
        wantsCamera = true;
        cameraButton.setText("关闭相机");
        setStatus("正在打开相机…");
        openCameraIfReady();
    }

    private void openCameraIfReady() {
        if (!active || !wantsCamera || camera != null || !preview.isAvailable()) return;
        try {
            int id = preferredCamera();
            Camera.CameraInfo info = new Camera.CameraInfo();
            Camera.getCameraInfo(id, info);
            camera = Camera.open(id);
            camera.setErrorCallback((error, source) -> {
                if (camera != source) return;
                stopCamera();
                setStatus("相机已断开，可以重试或从相册选图。");
            });
            Camera.Parameters parameters = camera.getParameters();
            parameters.setPreviewFormat(ImageFormat.NV21);
            Camera.Size size = choosePreviewSize(parameters.getSupportedPreviewSizes());
            if (size != null) parameters.setPreviewSize(size.width, size.height);
            List<String> modes = parameters.getSupportedFocusModes();
            if (modes != null && modes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)) {
                parameters.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
            } else if (modes != null && modes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO)) {
                parameters.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO);
            }
            camera.setParameters(parameters);
            Camera.Size actual = camera.getParameters().getPreviewSize();
            int orientation = orientation(info);
            camera.setDisplayOrientation(orientation);
            fitPreview(actual, orientation);
            camera.setPreviewTexture(preview.getSurfaceTexture());
            camera.startPreview();
            preview.setAlpha(1f);
            setStatus("");
            sample(camera, actual.width, actual.height, generation);
        } catch (RuntimeException | IOException ignored) {
            stopCamera();
            setStatus("相机暂时无法使用，可以从相册选图。");
        }
    }

    private int preferredCamera() {
        int count = Camera.getNumberOfCameras();
        if (count == 0) throw new IllegalStateException("No camera");
        Camera.CameraInfo info = new Camera.CameraInfo();
        for (int id = 0; id < count; id++) {
            Camera.getCameraInfo(id, info);
            if (info.facing == Camera.CameraInfo.CAMERA_FACING_BACK) return id;
        }
        return 0;
    }

    private Camera.Size choosePreviewSize(List<Camera.Size> sizes) {
        if (sizes == null) return null;
        Camera.Size nearest = null;
        int distance = Integer.MAX_VALUE;
        for (Camera.Size size : sizes) {
            int candidate = Math.abs(size.width - 1280) + Math.abs(size.height - 960);
            if (candidate < distance) {
                distance = candidate;
                nearest = size;
            }
        }
        return nearest;
    }

    private int orientation(Camera.CameraInfo info) {
        int rotation = getWindowManager().getDefaultDisplay().getRotation();
        int degrees = rotation == Surface.ROTATION_90 ? 90 : rotation == Surface.ROTATION_180 ? 180
                : rotation == Surface.ROTATION_270 ? 270 : 0;
        if (info.facing == Camera.CameraInfo.CAMERA_FACING_FRONT) {
            return (360 - (info.orientation + degrees) % 360) % 360;
        }
        return (info.orientation - degrees + 360) % 360;
    }

    private void fitPreview(Camera.Size size, int orientation) {
        boolean vertical = orientation % 180 != 0;
        int width = vertical ? size.height : size.width;
        int height = vertical ? size.width : size.height;
        float scale = Math.max(previewFrame.getWidth() / (float) width,
                previewFrame.getHeight() / (float) height);
        preview.setLayoutParams(new FrameLayout.LayoutParams(
                Math.round(width * scale), Math.round(height * scale), Gravity.CENTER));
    }

    private void sample(Camera owner, int width, int height, int ticket) {
        if (camera != owner || generation != ticket) return;
        owner.setOneShotPreviewCallback((bytes, source) -> {
            if (camera != source || generation != ticket) return;
            if (bytes == null || bytes.length < width * height) {
                preview.postDelayed(() -> sample(owner, width, height, ticket), 150);
                return;
            }
            decoder.execute(() -> {
                String value = QrDecoder.preview(bytes, width, height);
                runOnUiThread(() -> {
                    if (camera != owner || generation != ticket) return;
                    if (value != null && !value.isEmpty()) {
                        showResult(value);
                    } else {
                        preview.postDelayed(() -> sample(owner, width, height, ticket), 130);
                    }
                });
            });
        });
    }

    private void stopCamera() {
        generation++;
        wantsCamera = false;
        releaseCamera();
        cameraButton.setText("打开相机");
        viewLabel.setText("将二维码对准取景框");
        setStatus("");
    }

    private void releaseCamera() {
        if (camera == null) return;
        Camera closing = camera;
        camera = null;
        try {
            closing.setOneShotPreviewCallback(null);
            closing.stopPreview();
        } catch (RuntimeException ignored) {
            // A hardware disconnect can stop the preview first.
        } finally {
            closing.release();
            preview.setAlpha(0f);
        }
    }

    private void openGallery() {
        stopCamera();
        clearResult();
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
        try {
            startActivityForResult(picker, PHOTO_REQUEST);
        } catch (ActivityNotFoundException ignored) {
            setStatus("手机上没有可用的图片选择器。");
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent intent) {
        super.onActivityResult(request, result, intent);
        if (request != PHOTO_REQUEST || result != RESULT_OK || intent == null || intent.getData() == null) return;
        Uri photo = intent.getData();
        int ticket = ++generation;
        setStatus("正在识别图片…");
        decoder.execute(() -> {
            try {
                String value = readPhoto(photo);
                runOnUiThread(() -> {
                    if (ticket != generation) return;
                    if (value == null || value.isEmpty()) {
                        setStatus("图片里没识别到二维码，请试试清晰、完整的图片。");
                    } else {
                        showResult(value);
                    }
                });
            } catch (IOException | RuntimeException ignored) {
                runOnUiThread(() -> {
                    if (ticket == generation) setStatus("无法读取这张图片，请试试 PNG 或 JPG。");
                });
            }
        });
    }

    private String readPhoto(Uri uri) throws IOException {
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            BitmapFactory.decodeStream(input, null, options);
        }
        if (options.outWidth <= 0 || options.outHeight <= 0) throw new IOException("Invalid image");
        options.inSampleSize = 1;
        while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 2048) {
            options.inSampleSize *= 2;
        }
        options.inJustDecodeBounds = false;
        Bitmap bitmap;
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            bitmap = BitmapFactory.decodeStream(input, null, options);
        }
        if (bitmap == null) throw new IOException("Invalid image");
        try {
            int width = bitmap.getWidth();
            int height = bitmap.getHeight();
            int[] pixels = new int[width * height];
            bitmap.getPixels(pixels, 0, width, 0, 0, width, height);
            return QrDecoder.photo(pixels, width, height);
        } finally {
            bitmap.recycle();
        }
    }

    private void showResult(String raw) {
        stopCamera();
        viewLabel.setText("已识别二维码");
        ScanResult result = ScanResult.from(raw);
        resultValue.setVisibility(View.GONE);
        resultAction.setVisibility(View.VISIBLE);
        switch (result.type) {
            case WEB:
                resultDetail.setText("目标网站 " + result.display);
                action("打开链接", () -> launch(new Intent(Intent.ACTION_VIEW, Uri.parse(result.data))
                        .addCategory(Intent.CATEGORY_BROWSABLE), "未找到可打开链接的应用。"));
                break;
            case SMS:
                resultDetail.setText("短信收件人 " + result.display + "。请在短信应用里核对内容。");
                action("打开短信", () -> launch(new Intent(Intent.ACTION_SENDTO,
                        Uri.fromParts("smsto", result.data, null)).putExtra("sms_body", result.message),
                        "未找到短信应用。"));
                break;
            case PASSKEY:
                resultDetail.setText("Google 通行密钥。请打开蓝牙，然后按手机的验证提示操作。");
                action("打开通行密钥验证", () -> launch(new Intent(Intent.ACTION_VIEW, Uri.parse(result.data))
                        .setPackage(PLAY_SERVICES), "无法打开通行密钥验证。请检查 Google Play 服务，或回到登录页选择其他方式。"));
                break;
            case AUTHENTICATOR:
                resultDetail.setText("两步验证设置二维码，可交给 Google Authenticator。");
                action("打开 Google Authenticator", () -> {
                    Intent importCode = new Intent(Intent.ACTION_VIEW, Uri.parse(result.data)).setPackage(AUTHENTICATOR);
                    if (!tryLaunch(importCode)) openAuthenticator("请在 Authenticator 里选择「扫描二维码」。");
                });
                break;
            case TRANSFER:
                resultDetail.setText("这是验证器迁移二维码。请在 Authenticator 中选择「导入账号」后扫码。");
                action("打开 Google Authenticator", () -> openAuthenticator(""));
                break;
            case TEXT:
                resultAction.setVisibility(View.GONE);
                resultDetail.setText(result.display == null ? "无法打开这个二维码。" : "二维码内容");
                if (result.display != null) {
                    resultValue.setText(result.display);
                    resultValue.setVisibility(View.VISIBLE);
                }
                break;
        }
        resultPanel.setVisibility(View.VISIBLE);
        resultPanel.announceForAccessibility(resultDetail.getText());
        resultPanel.post(() -> resultPanel.requestRectangleOnScreen(
                new Rect(0, 0, resultPanel.getWidth(), resultPanel.getHeight()), false));
    }

    private void openAuthenticator(String hint) {
        Intent launcher = getPackageManager().getLaunchIntentForPackage(AUTHENTICATOR);
        if (launcher == null || !tryLaunch(launcher)) {
            setStatus("手机上未找到 Google Authenticator。");
        } else if (!hint.isEmpty()) {
            android.widget.Toast.makeText(this, hint, android.widget.Toast.LENGTH_LONG).show();
        }
    }

    private void action(String title, Runnable open) {
        resultAction.setText(title);
        resultAction.setOnClickListener(view -> open.run());
    }

    private void launch(Intent intent, String unavailable) {
        if (!tryLaunch(intent)) setStatus(unavailable);
    }

    private boolean tryLaunch(Intent intent) {
        try {
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException ignored) {
            return false;
        }
    }

    private void clearResult() {
        resultPanel.setVisibility(View.GONE);
        resultValue.setText("");
        resultAction.setOnClickListener(null);
        viewLabel.setText("将二维码对准取景框");
    }

    private void setStatus(String text) {
        status.setText(text);
        status.setVisibility(text.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private TextView label(String text, int size, int color) {
        TextView label = new TextView(this);
        label.setText(text);
        label.setTextSize(size);
        label.setTextColor(color);
        return label;
    }

    private Button button(String text, boolean primary) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextSize(16);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setMinHeight(dp(50));
        button.setTextColor(primary ? BACKGROUND : TEXT);
        button.setBackground(new RippleDrawable(ColorStateList.valueOf(0x306c9a87),
                shape(primary ? MINT : SURFACE, 12), null));
        button.setPadding(dp(12), dp(7), dp(12), dp(7));
        return button;
    }

    private GradientDrawable shape(int color, int radius) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(color);
        background.setCornerRadius(dp(radius));
        return background;
    }

    private LinearLayout column() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    private void add(LinearLayout parent, View view, int top) {
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, -2);
        layout.topMargin = dp(top);
        parent.addView(view, layout);
    }

    private int dp(float pixels) {
        return Math.round(pixels * getResources().getDisplayMetrics().density);
    }

    private final class Finder extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF frame = new RectF();

        Finder() {
            super(ScannerActivity.this);
            paint.setColor(MINT);
            paint.setStrokeWidth(dp(2));
            paint.setStyle(Paint.Style.STROKE);
            setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        }

        @Override protected void onDraw(Canvas canvas) {
            float half = Math.min(getWidth(), getHeight()) * .29f;
            float x = getWidth() / 2f;
            float y = getHeight() / 2f;
            frame.set(x - half, y - half, x + half, y + half);
            canvas.drawRoundRect(frame, dp(15), dp(15), paint);
        }
    }
}
