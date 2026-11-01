"""Local template detection and masked video repair. Never modifies the input."""
from pathlib import Path
import json, math, subprocess, threading
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
MODEL_LOCK = threading.Lock()
_model = None

def probe(path):
    r = subprocess.run(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(path)],capture_output=True,check=True)
    data=json.loads(r.stdout); v=next(s for s in data['streams'] if s['codec_type']=='video')
    n,d=map(int,v['avg_frame_rate'].split('/')); fps=n/d if d else 24
    return dict(width=v['width'],height=v['height'],fps=fps,duration=float(data['format']['duration']),audio=any(s['codec_type']=='audio' for s in data['streams']))

def frame_at(path,seconds=0):
    cap=cv2.VideoCapture(str(path));cap.set(cv2.CAP_PROP_POS_MSEC,seconds*1000)
    ok,f=cap.read();cap.release()
    if not ok:raise ValueError('无法读取这一帧，请换一个时间点')
    return f

def edges(image):
    return cv2.Canny(cv2.cvtColor(image,cv2.COLOR_BGR2GRAY),100,200)

def analyse(path,template,end=None,progress=lambda **kw:None):
    meta=probe(path); end=min(float(end or meta['duration']),meta['duration'])
    if end<=0 or end>120:raise ValueError('预览版支持 0—120 秒视频；请设置有效结束时间')
    if max(meta['width'],meta['height'])>1920:raise ValueError('预览版支持最高 1920 像素长边，请先压缩视频')
    th,tw=template.shape[:2]
    if min(th,tw)<8 or th>=meta['height'] or tw>=meta['width']:raise ValueError('Logo 选框尺寸无效')
    te=edges(template)
    if np.count_nonzero(te)<12:raise ValueError('样图缺少可识别轮廓，请重新选择 Logo')
    cap=cv2.VideoCapture(str(path));step=max(1,round(meta['fps']/4));count=math.ceil(end*meta['fps'])
    samples=[]; i=0
    while i<count:
        ok,f=cap.read()
        if not ok:break
        if i%step==0:
            scores=cv2.matchTemplate(edges(f),te,cv2.TM_CCORR_NORMED)
            _,score,_,(x,y)=cv2.minMaxLoc(scores)
            samples.append(dict(frame=i,time=round(i/meta['fps'],3),x=x,y=y,w=tw,h=th,score=round(float(score),4)))
            progress(stage='detecting',progress=round(i/count*100),message='寻找 Logo 的位置变化')
        i+=1
    cap.release()
    if not samples:raise ValueError('没有可分析的画面')
    # Cluster repeated high-confidence locations; avoids one-frame matches on scene texture.
    clusters=[]
    for s in samples:
        if s['score']<.30:continue
        group=next((c for c in clusters if abs(c[0]['x']-s['x'])<12 and abs(c[0]['y']-s['y'])<12),None)
        if group is None:clusters.append([s])
        else:group.append(s)
    locations=[(round(float(np.median([s['x'] for s in c]))),round(float(np.median([s['y'] for s in c])))) for c in clusters if len(c)>=2]
    if not locations:raise ValueError('没有稳定匹配。请用更清晰、背景更少的 Logo 样图，或使用固定选区模式')
    # Re-score all samples at stable positions, preserving jumps rather than interpolating across the screen.
    cap=cv2.VideoCapture(str(path))
    for s in samples:
        cap.set(cv2.CAP_PROP_POS_FRAMES,s['frame']);ok,f=cap.read()
        if not ok:continue
        e=edges(f); best=(-1,0,0)
        for x,y in locations:
            x0=max(0,x-4);y0=max(0,y-4);roi=e[y0:min(e.shape[0],y+th+5),x0:min(e.shape[1],x+tw+5)]
            if roi.shape[0]<th or roi.shape[1]<tw:continue
            _,v,_,p=cv2.minMaxLoc(cv2.matchTemplate(roi,te,cv2.TM_CCORR_NORMED))
            if v>best[0]:best=(v,x0+p[0],y0+p[1])
        s.update(score=round(float(best[0]),4),x=best[1],y=best[2],uncertain=best[0]<.24)
    cap.release()
    return dict(meta=meta,end=end,samples=samples,locations=locations,uncertain=sum(s['uncertain'] for s in samples),template_size=[tw,th])

def load_model():
    global _model
    if _model is None:
        import torch
        p=ROOT/'models/big-lama.pt'
        if not p.exists():raise ValueError('缺少修复模型，请先运行 download_model.py')
        device='cuda' if torch.cuda.is_available() else 'cpu'
        torch.set_num_threads(4)
        _model=(torch.jit.load(str(p),map_location=device).eval(),device)
    return _model

def repair(frame,rect,method='lama'):
    x,y,w,h=map(int,rect);H,W=frame.shape[:2]
    x=max(0,x-4);y=max(0,y-4);w=min(w+8,W-x);h=min(h+8,H-y)
    # Include nearby scene context, but leave all pixels outside the repair mask intact.
    x0=max(0,x-96);y0=max(0,y-80);x1=min(W,x+w+96);y1=min(H,y+h+80)
    crop=frame[y0:y1,x0:x1].copy();mask=np.zeros(crop.shape[:2],np.uint8)
    mask[y-y0:y-y0+h,x-x0:x-x0+w]=255
    if method=='fast':out=cv2.inpaint(crop,mask,3,cv2.INPAINT_TELEA)
    else:
        import torch
        model,device=load_model();ch,cw=crop.shape[:2]
        padded=cv2.copyMakeBorder(crop,0,(-ch)%8,0,(-cw)%8,cv2.BORDER_REFLECT)
        pm=cv2.copyMakeBorder(mask,0,(-ch)%8,0,(-cw)%8,cv2.BORDER_CONSTANT)
        inp=torch.from_numpy(padded[:,:,::-1].copy()).permute(2,0,1).unsqueeze(0).float().div(255).to(device)
        mt=torch.from_numpy(pm).unsqueeze(0).unsqueeze(0).float().div(255).to(device)
        with torch.inference_mode():pred=model(inp,mt)
        out=(pred[0].permute(1,2,0).detach().cpu().numpy()*255).clip(0,255).astype(np.uint8)[:ch,:cw,::-1]
    # Feather only inward: unchanged scene pixels remain untouched.
    alpha=np.minimum(cv2.distanceTransform(mask,cv2.DIST_L2,3)/3,1)[:,:,None]
    result=frame.copy();result[y0:y1,x0:x1]=(out*alpha+crop*(1-alpha)).astype(np.uint8)
    return result

def process(path,analysis,output,method='lama',progress=lambda **kw:None,cancel=lambda:False):
    meta=analysis['meta'];fps=meta['fps'];W=meta['width'];H=meta['height'];end=analysis['end']
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    temp=output.with_suffix('.silent.mp4');samples=analysis['samples'];total=math.ceil(end*fps)
    cap=cv2.VideoCapture(str(path))
    cmd=['ffmpeg','-y','-hide_banner','-loglevel','error','-f','rawvideo','-pix_fmt','bgr24','-s',f'{W}x{H}','-r',str(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',str(temp)]
    log=output.with_suffix('.encode.log')
    n=0
    try:
        with log.open('wb') as err:
            encoder=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=err)
            try:
                for i in range(total):
                    if cancel():raise ValueError('已取消处理')
                    ok,f=cap.read()
                    if not ok:break
                    s=min(samples,key=lambda s:abs(s['frame']-i))
                    # Resolve jumps on actual frames, instead of moving a box through the scene.
                    if analysis.get('template_path') and not analysis.get('manual'):
                        if i==0:te=edges(cv2.imread(analysis['template_path']))
                        nearby=[z for z in samples if abs(z['frame']-i)<=round(fps/3)]
                        choices={(z['x']//12,z['y']//12):(z['x'],z['y']) for z in nearby}
                        if len(choices)>1:
                            best=(-1,s)
                            for x,y in choices.values():
                                th,tw=te.shape;roi=edges(f[max(0,y-5):min(H,y+th+6),max(0,x-5):min(W,x+tw+6)])
                                if roi.shape[0]<th or roi.shape[1]<tw:continue
                                _,v,_,pt=cv2.minMaxLoc(cv2.matchTemplate(roi,te,cv2.TM_CCORR_NORMED))
                                if v>best[0]:best=(v,{**s,'x':max(0,x-5)+pt[0],'y':max(0,y-5)+pt[1]})
                            s=best[1]
                    if not s.get('skip',False):f=repair(f,(s['x'],s['y'],s['w'],s['h']),method)
                    if not s.get('skip',False):
                        for extra in analysis.get('extra_rects',[]):f=repair(f,extra,method)
                    encoder.stdin.write(f.tobytes());n+=1
                    if i%6==0:progress(stage='processing',progress=round((i+1)/total*100),message=f'修复画面 {i+1} / {total}')
            finally:
                encoder.stdin.close();code=encoder.wait();cap.release()
            if code:raise ValueError('视频编码失败：'+log.read_text(errors='replace')[-500:])
        subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(temp),'-i',str(path),'-map','0:v:0','-map','1:a:0?','-c:v','copy','-c:a','aac','-t',str(end),'-movflags','+faststart',str(output)],check=True,capture_output=True)
        return dict(frames=n,output=probe(output),method=method)
    finally:
        if temp.exists():temp.unlink()

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('video');p.add_argument('--template',default='research/template.png');p.add_argument('--end',type=float);p.add_argument('--output',default='runtime/cleaned.mp4');p.add_argument('--method',default='lama');a=p.parse_args()
    report=analyse(a.video,cv2.imread(a.template),a.end)
    Path('runtime/analysis.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    def show(**kw):print(json.dumps(kw,ensure_ascii=False),flush=True)
    print(process(a.video,report,a.output,a.method,show))
