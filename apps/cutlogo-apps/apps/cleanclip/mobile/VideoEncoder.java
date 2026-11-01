package org.dailyfree.cleanclip;

import android.graphics.Bitmap;
import android.media.*;
import android.opengl.*;
import android.view.Surface;
import java.io.*;
import java.nio.*;

/** EGL -> device AVC encoder -> MP4, with the original supported audio track copied. */
final class VideoEncoder {
    MediaCodec codec;MediaMuxer mux;MediaExtractor audio;int audioTrack=-1,videoTrack=-1;boolean started=false,done=false;
    EGLDisplay display=EGL14.EGL_NO_DISPLAY;EGLContext context=EGL14.EGL_NO_CONTEXT;EGLSurface eglSurface=EGL14.EGL_NO_SURFACE;Surface surface;
    int program,texture;FloatBuffer vertices,uv;int width,height;long endUs;
    VideoEncoder(File output,String source,LocalEngine.Meta m,long end)throws Exception{
        width=m.width;height=m.height;endUs=end;
        try{mux=new MediaMuxer(output.getAbsolutePath(),MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);audio=new MediaExtractor();audio.setDataSource(source);
            for(int i=0;i<audio.getTrackCount();i++){MediaFormat f=audio.getTrackFormat(i);String mime=f.getString(MediaFormat.KEY_MIME);if(mime.startsWith("audio/")){
                if(!mime.equals("audio/mp4a-latm")&&!mime.equals("audio/mpeg"))throw new IOException("此视频音轨暂不支持保留，请先转为 AAC 音轨的 MP4");
                audioTrack=mux.addTrack(f);audio.selectTrack(i);break;}}
            MediaFormat f=MediaFormat.createVideoFormat("video/avc",width,height);f.setInteger(MediaFormat.KEY_COLOR_FORMAT,MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);f.setInteger(MediaFormat.KEY_BIT_RATE,Math.max(1500000,width*height*6));f.setInteger(MediaFormat.KEY_FRAME_RATE,m.fps);f.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL,1);
            codec=MediaCodec.createEncoderByType("video/avc");codec.configure(f,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE);surface=codec.createInputSurface();codec.start();initGL();
        }catch(Exception e){close();throw e;}
    }
    static FloatBuffer buffer(float[] a){FloatBuffer b=ByteBuffer.allocateDirect(a.length*4).order(ByteOrder.nativeOrder()).asFloatBuffer();b.put(a).position(0);return b;}
    int shader(int type,String source)throws IOException{int sh=GLES20.glCreateShader(type);GLES20.glShaderSource(sh,source);GLES20.glCompileShader(sh);int[] st=new int[1];GLES20.glGetShaderiv(sh,GLES20.GL_COMPILE_STATUS,st,0);if(st[0]==0)throw new IOException(GLES20.glGetShaderInfoLog(sh));return sh;}
    void initGL()throws Exception{
        display=EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);int[] version=new int[2];if(!EGL14.eglInitialize(display,version,0,version,1))throw new IOException("手机图形编码初始化失败");
        int[] attrs={EGL14.EGL_RED_SIZE,8,EGL14.EGL_GREEN_SIZE,8,EGL14.EGL_BLUE_SIZE,8,EGL14.EGL_ALPHA_SIZE,8,EGL14.EGL_RENDERABLE_TYPE,EGL14.EGL_OPENGL_ES2_BIT,0x3142,1,EGL14.EGL_NONE};EGLConfig[] configs=new EGLConfig[1];int[] n=new int[1];EGL14.eglChooseConfig(display,attrs,0,configs,0,1,n,0);if(n[0]==0)throw new IOException("设备不支持视频编码 surface");
        context=EGL14.eglCreateContext(display,configs[0],EGL14.EGL_NO_CONTEXT,new int[]{EGL14.EGL_CONTEXT_CLIENT_VERSION,2,EGL14.EGL_NONE},0);eglSurface=EGL14.eglCreateWindowSurface(display,configs[0],surface,new int[]{EGL14.EGL_NONE},0);if(!EGL14.eglMakeCurrent(display,eglSurface,eglSurface,context))throw new IOException("无法建立视频编码上下文");
        int vs=shader(GLES20.GL_VERTEX_SHADER,"attribute vec2 p;attribute vec2 uv;varying vec2 t;void main(){gl_Position=vec4(p,0.,1.);t=uv;}");int fs=shader(GLES20.GL_FRAGMENT_SHADER,"precision mediump float;uniform sampler2D image;varying vec2 t;void main(){gl_FragColor=texture2D(image,t);}");
        program=GLES20.glCreateProgram();GLES20.glAttachShader(program,vs);GLES20.glAttachShader(program,fs);GLES20.glLinkProgram(program);GLES20.glDeleteShader(vs);GLES20.glDeleteShader(fs);int[] linked=new int[1];GLES20.glGetProgramiv(program,GLES20.GL_LINK_STATUS,linked,0);if(linked[0]==0)throw new IOException("视频着色器连接失败");
        int[] ids=new int[1];GLES20.glGenTextures(1,ids,0);texture=ids[0];GLES20.glBindTexture(GLES20.GL_TEXTURE_2D,texture);GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D,GLES20.GL_TEXTURE_MIN_FILTER,GLES20.GL_LINEAR);GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D,GLES20.GL_TEXTURE_MAG_FILTER,GLES20.GL_LINEAR);GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D,GLES20.GL_TEXTURE_WRAP_S,GLES20.GL_CLAMP_TO_EDGE);GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D,GLES20.GL_TEXTURE_WRAP_T,GLES20.GL_CLAMP_TO_EDGE);
        vertices=buffer(new float[]{-1,-1,1,-1,-1,1,1,1});uv=buffer(new float[]{0,1,1,1,0,0,1,0});
    }
    void frame(Bitmap bitmap,long us)throws Exception{
        drain(false);GLES20.glViewport(0,0,width,height);GLES20.glUseProgram(program);GLES20.glActiveTexture(GLES20.GL_TEXTURE0);GLES20.glBindTexture(GLES20.GL_TEXTURE_2D,texture);GLUtils.texImage2D(GLES20.GL_TEXTURE_2D,0,bitmap,0);int p=GLES20.glGetAttribLocation(program,"p"),u=GLES20.glGetAttribLocation(program,"uv");GLES20.glEnableVertexAttribArray(p);GLES20.glEnableVertexAttribArray(u);GLES20.glVertexAttribPointer(p,2,GLES20.GL_FLOAT,false,0,vertices);GLES20.glVertexAttribPointer(u,2,GLES20.GL_FLOAT,false,0,uv);GLES20.glUniform1i(GLES20.glGetUniformLocation(program,"image"),0);GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP,0,4);EGLExt.eglPresentationTimeANDROID(display,eglSurface,us*1000);
        if(!EGL14.eglSwapBuffers(display,eglSurface))throw new IOException("视频编码提交失败");drain(false);
    }
    void drain(boolean ending)throws Exception{
        MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();long deadline=System.nanoTime()+30000000000L;
        while(true){int index=codec.dequeueOutputBuffer(info,ending?10000:0);
            if(index==MediaCodec.INFO_TRY_AGAIN_LATER){if(!ending)return;if(System.nanoTime()>deadline)throw new IOException("视频编码超时");continue;}
            if(index==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){if(started)throw new IOException("编码格式意外变化");videoTrack=mux.addTrack(codec.getOutputFormat());mux.start();started=true;continue;}
            if(index>=0){ByteBuffer b=codec.getOutputBuffer(index);if((info.flags&MediaCodec.BUFFER_FLAG_CODEC_CONFIG)!=0)info.size=0;if(info.size>0){if(!started)throw new IOException("编码器没有输出视频格式");b.position(info.offset);b.limit(info.offset+info.size);mux.writeSampleData(videoTrack,b,info);}boolean eos=(info.flags&MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0;codec.releaseOutputBuffer(index,false);if(eos)return;}
        }
    }
    void finish(LocalEngine.Progress cb)throws Exception{
        codec.signalEndOfInputStream();drain(true);
        if(audioTrack>=0){ByteBuffer b=ByteBuffer.allocateDirect(2*1024*1024);MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();while(true){if(cb.cancelled())throw new IOException("已取消");b.clear();long time=audio.getSampleTime();if(time<0||time>=endUs)break;int n=audio.readSampleData(b,0);if(n<0)break;info.set(0,n,time,(audio.getSampleFlags()&MediaExtractor.SAMPLE_FLAG_SYNC)!=0?MediaCodec.BUFFER_FLAG_KEY_FRAME:0);mux.writeSampleData(audioTrack,b,info);audio.advance();}}
        mux.stop();started=false;done=true;
    }
    void close(){
        if(display!=EGL14.EGL_NO_DISPLAY){EGL14.eglMakeCurrent(display,EGL14.EGL_NO_SURFACE,EGL14.EGL_NO_SURFACE,EGL14.EGL_NO_CONTEXT);if(eglSurface!=EGL14.EGL_NO_SURFACE)EGL14.eglDestroySurface(display,eglSurface);if(context!=EGL14.EGL_NO_CONTEXT)EGL14.eglDestroyContext(display,context);EGL14.eglTerminate(display);display=EGL14.EGL_NO_DISPLAY;}
        if(surface!=null){surface.release();surface=null;}if(codec!=null){try{codec.stop();}catch(Exception ignored){}codec.release();codec=null;}if(audio!=null){audio.release();audio=null;}if(mux!=null){if(started)try{mux.stop();}catch(Exception ignored){}mux.release();mux=null;}
    }
}
