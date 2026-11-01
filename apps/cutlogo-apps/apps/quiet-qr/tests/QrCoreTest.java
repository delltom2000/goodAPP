package org.dailyfree.quietqr;

import com.google.zxing.common.BitMatrix;
import com.google.zxing.Result;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.client.result.ResultParser;
import com.google.zxing.client.result.WifiParsedResult;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import java.io.File;

public final class QrCoreTest {
    private static int checks=0;
    static void check(boolean condition,String message){checks++;if(!condition)throw new AssertionError(message);}
    static void rejects(Runnable action,String message){checks++;try{action.run();throw new AssertionError(message);}catch(IllegalArgumentException expected){}}
    static String roundtrip(String value,boolean invert) throws Exception {
        BitMatrix matrix=QrCodec.encode(value,768);int w=matrix.getWidth();int h=matrix.getHeight();int[] pixels=new int[w*h];
        for(int y=0;y<h;y++)for(int x=0;x<w;x++)pixels[y*w+x]=(matrix.get(x,y)^invert)?0xff000000:0xffffffff;
        return QrCodec.decode(w,h,pixels);
    }
    public static void main(String[] args) throws Exception {
        check(QrContent.url("  https://example.com/path?q=1  ").equals("https://example.com/path?q=1"),"URL trim");
        check(QrContent.isWebUrl("http://example.com"),"http");
        check(QrContent.isWebUrl("HTTPS://example.com"),"case insensitive scheme");
        check(!QrContent.isWebUrl("javascript:alert(1)"),"javascript");
        check(!QrContent.isWebUrl("https://user:pass@example.com"),"embedded credentials");
        check(!QrContent.isWebUrl("file:///etc/passwd"),"file");
        check(!QrContent.isWebUrl("https://"),"empty host");
        check(!QrContent.isWebUrl("https://exa mple.com"),"space in host");
        rejects(()->QrContent.url("example.com"),"missing scheme");
        rejects(()->QrContent.text("  \n"),"blank");
        rejects(()->QrContent.text(new String(new char[1501]).replace('\0','a')),"byte limit");
        rejects(()->QrContent.wifi("","",true,false),"empty ssid");
        rejects(()->QrContent.wifi("Home","",false,false),"missing password");
        rejects(()->QrContent.wifi(new String(new char[33]).replace('\0','a'),"",true,false),"ssid limit");
        String unicode="你好，程序员！\nOffline QR / emoji 😀";
        check(roundtrip(unicode,false).equals(unicode),"unicode round trip");
        check(roundtrip("https://example.com/?hello=world",true).equals("https://example.com/?hello=world"),"inverted image");
        String ssid="咖啡;WiFi\\Lab",password="p:a;s,s\\word\"";
        String wifi=QrContent.wifi(ssid,password,false,true);
        check(roundtrip(wifi,false).equals(wifi),"WiFi round trip");
        WifiParsedResult parsed=(WifiParsedResult)ResultParser.parseResult(new Result(wifi,null,null,BarcodeFormat.QR_CODE));
        check(parsed.getSsid().equals(ssid),"WiFi SSID escaped");
        check(parsed.getPassword().equals(password),"WiFi password escaped");
        check(parsed.isHidden(),"hidden WiFi");
        String open=QrContent.wifi("Cafe","ignored",true,false);
        WifiParsedResult openParsed=(WifiParsedResult)ResultParser.parseResult(new Result(open,null,null,BarcodeFormat.QR_CODE));
        check(openParsed.getNetworkEncryption().equals("nopass"),"open network");
        check(openParsed.getPassword()==null || openParsed.getPassword().isEmpty(),"open network no password leak");
        int[] white=new int[10000];java.util.Arrays.fill(white,0xffffffff);
        checks++;try{QrCodec.decode(100,100,white);throw new AssertionError("blank image accepted");}catch(com.google.zxing.NotFoundException expected){}
        BitMatrix fixture=QrCodec.encode("https://example.com/quiet-qr-test",768);
        BufferedImage image=new BufferedImage(768,768,BufferedImage.TYPE_INT_RGB);
        for(int y=0;y<768;y++)for(int x=0;x<768;x++)image.setRGB(x,y,fixture.get(x,y)?0:0xffffff);
        File directory=new File(args[0]);directory.mkdirs();ImageIO.write(image,"png",new File(directory,"scan-fixture.png"));
        System.out.println("PASS: "+checks+" core checks (input validation, Unicode, WiFi escaping, QR round trip, inverted and blank images)");
    }
}
