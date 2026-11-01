"""Single-user LAN preview service. Pair code required for media and jobs."""
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from urllib.parse import urlparse,parse_qs
from pathlib import Path
import json, secrets, threading, socket, mimetypes, shutil, time, traceback
import cv2
from core import ROOT,probe,frame_at,analyse,process

RUNTIME=ROOT/'runtime';RUNTIME.mkdir(exist_ok=True)
jobs={};lock=threading.Lock();busy=threading.Lock()
MAX_UPLOAD=200*1024*1024

def update(job,**kwargs):
    with lock:job.update(kwargs)

def worker(job,action,options):
    if not busy.acquire(False):update(job,stage='error',message='已有任务正在处理，请等待完成后重试');return
    try:
        directory=RUNTIME/job['id'];video=directory/'input.mp4'
        if action=='analyse':
            update(job,stage='detecting',progress=0,message='准备识别')
            rect=options.get('rect');t=float(options.get('time',0));end=float(options.get('end') or job['meta']['duration'])
            if rect:
                x,y,w,h=[int(z) for z in rect];f=frame_at(video,t)
                if x<0 or y<0 or min(w,h)<8 or x+w>f.shape[1] or y+h>f.shape[0]:raise ValueError('选区超出画面')
                template=f[y:y+h,x:x+w];cv2.imwrite(str(directory/'template.png'),template)
            else:
                template=cv2.imread(str(directory/'template.png'))
                if template is None:raise ValueError('请先框选 Logo 或上传样图')
            if options.get('mode')=='fixed' and rect:
                report=dict(meta=job['meta'],end=min(end,job['meta']['duration']),samples=[dict(frame=0,time=0,x=x,y=y,w=w,h=h,score=1,uncertain=False)],locations=[[x,y]],uncertain=0,manual=True)
            else:report=analyse(video,template,end,lambda **kw:update(job,**kw))
            if not 0<report['end']<=min(120,job['meta']['duration']):raise ValueError('结束时间超出有效范围')
            report['template_path']=str(directory/'template.png')
            (directory/'analysis.json').write_text(json.dumps(report),encoding='utf8')
            update(job,stage='review',progress=100,message='识别完成，请检查位置变化',analysis=report)
        elif action=='process':
            report=json.loads((directory/'analysis.json').read_text(encoding='utf8'))
            extras=options.get('extra_rects',[])
            if not isinstance(extras,list) or len(extras)>8:raise ValueError('最多添加 8 个固定角标')
            validated=[]
            for r in extras:
                if not isinstance(r,list) or len(r)!=4:raise ValueError('角标选区格式错误')
                x,y,w,h=map(int,r)
                if x<0 or y<0 or min(w,h)<8 or x+w>report['meta']['width'] or y+h>report['meta']['height']:raise ValueError('角标选区超出画面')
                validated.append([x,y,w,h])
            report['extra_rects']=validated
            if options.get('segments'):
                segs=options['segments'];samples=[]
                for i in range(int(report['end']*report['meta']['fps'])+1):
                    t=i/report['meta']['fps'];seg=next((s for s in segs if float(s['start'])<=t<float(s['end'])),None)
                    if seg:
                        x,y,w,h=map(int,seg['rect'])
                        if x<0 or y<0 or min(w,h)<8 or x+w>report['meta']['width'] or y+h>report['meta']['height']:raise ValueError('修正选区超出画面')
                        samples.append(dict(frame=i,x=x,y=y,w=w,h=h))
                    else:samples.append(dict(frame=i,x=0,y=0,w=8,h=8,skip=True))
                report.update(samples=samples,manual=True)
            update(job,stage='processing',progress=0,message='载入修复模型',cancel=False)
            method=options.get('method','lama')
            if method not in ('lama','fast'):raise ValueError('未知处理方式')
            result=process(video,report,directory/'cleaned.mp4',method,lambda **kw:update(job,**kw),lambda:job.get('cancel',False))
            result['extra_rects']=validated
            (directory/'result.json').write_text(json.dumps(result),encoding='utf8')
            update(job,stage='done',progress=100,message='处理完成，可播放和保存',result=result)
    except Exception as e:
        traceback.print_exc();update(job,stage='error',message=str(e),progress=0)
    finally:busy.release()

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def reply(self,data,status=200):
        b=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(b)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(b)
    def authed(self):
        # No passwords for local use. Reject cross-origin websites and DNS rebinding.
        allowed={'127.0.0.1','localhost','::1'}
        host=urlparse('http://'+self.headers.get('Host','')).hostname
        origin=self.headers.get('Origin')
        return self.client_address[0] in allowed and host in allowed and (not origin or urlparse(origin).netloc==self.headers.get('Host'))
    def send_file(self,p):
        if not p.is_file():self.reply({'error':'文件不存在'},404);return
        size=p.stat().st_size;start=0;end=size-1;status=200
        ran=self.headers.get('Range')
        if ran:
            try:
                a,b=ran.removeprefix('bytes=').split('-');start=int(a);end=min(int(b) if b else end,end);status=206
                if start<0 or start>end:raise ValueError()
            except ValueError:self.send_error(416);return
        self.send_response(status);self.send_header('Content-Type',mimetypes.guess_type(str(p))[0] or 'application/octet-stream');self.send_header('Content-Length',str(end-start+1));self.send_header('Accept-Ranges','bytes');self.send_header('Cache-Control','no-store');self.send_header('Referrer-Policy','no-referrer')
        if status==206:self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
        if p.name=='cleaned.mp4' and 'download' in parse_qs(urlparse(self.path).query):self.send_header('Content-Disposition','attachment; filename="cleanclip.mp4"')
        self.end_headers()
        with p.open('rb') as f:
            f.seek(start);remain=end-start+1
            while remain>0:
                b=f.read(min(1024*1024,remain))
                if not b:break
                try:self.wfile.write(b)
                except (BrokenPipeError,ConnectionResetError):break
                remain-=len(b)
    def do_GET(self):
        u=urlparse(self.path);path=u.path
        if path in ('/','/app.js','/style.css'):
            self.send_file(ROOT/'web'/({'/':'index.html'}.get(path,path[1:])));return
        if path=='/health':self.reply({'ok':True,'name':'CleanClip','version':'0.1.0'});return
        if not self.authed():self.reply({'error':'仅允许本机同源访问'},401);return
        parts=path.strip('/').split('/')
        if path=='/api/jobs':self.reply([dict(id=j['id'],name=j['name'],stage=j['stage']) for j in jobs.values()]);return
        if len(parts)<3 or parts[0:2]!=['api','jobs'] or parts[2] not in jobs:self.reply({'error':'未找到任务'},404);return
        job=jobs[parts[2]];directory=RUNTIME/job['id']
        if len(parts)==3:
            with lock:self.reply(dict(job))
        elif parts[3]=='frame':
            try:
                t=float(parse_qs(u.query).get('time',['0'])[0]);f=frame_at(directory/'input.mp4',t);ok,b=cv2.imencode('.jpg',f)
                self.send_response(200);self.send_header('Content-Type','image/jpeg');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b.tobytes())
            except Exception as e:self.reply({'error':str(e)},400)
        elif parts[3] in ('input.mp4','cleaned.mp4','template.png'):self.send_file(directory/parts[3])
        else:self.reply({'error':'未找到'},404)
    def do_POST(self):
        if not self.authed():self.reply({'error':'仅允许本机同源访问'},401);return
        path=urlparse(self.path).path;length=int(self.headers.get('Content-Length','0'))
        if length<=0 or length>MAX_UPLOAD:self.reply({'error':'文件为空或超过 200 MB'},413);return
        if path=='/api/upload':
            jid=secrets.token_hex(6);directory=RUNTIME/jid;directory.mkdir();p=directory/'input.mp4'
            try:
                self.connection.settimeout(120)
                with p.open('wb') as f:
                    left=length
                    while left:
                        b=self.rfile.read(min(left,1024*1024))
                        if not b:raise ValueError('上传中断')
                        f.write(b);left-=len(b)
                meta=probe(p)
                if meta['duration']>120 or max(meta['width'],meta['height'])>1920:raise ValueError('预览版支持 120 秒以内、最长边不超过 1920 像素的视频')
                job=dict(id=jid,name='导入的视频',stage='uploaded',progress=0,meta=meta,message='请选择 Logo')
                jobs[jid]=job;self.reply(job)
            except Exception as e:self.reply({'error':str(e)},400)
            return
        parts=path.strip('/').split('/')
        if len(parts)!=4 or parts[:2]!=['api','jobs'] or parts[2] not in jobs:self.reply({'error':'任务不存在'},404);return
        job=jobs[parts[2]];action=parts[3]
        if job['stage'] in ('detecting','processing') and action!='cancel':self.reply({'error':'任务运行中'},409);return
        if action=='template':
            if length>5*1024*1024:self.reply({'error':'样图不能超过 5 MB'},413);return
            import numpy as np
            image=cv2.imdecode(np.frombuffer(self.rfile.read(length),np.uint8),cv2.IMREAD_COLOR)
            if image is None:self.reply({'error':'样图格式无效'},400);return
            cv2.imwrite(str(RUNTIME/job['id']/'template.png'),image);self.reply({'ok':True});return
        if length>1024*1024:self.reply({'error':'请求过大'},413);return
        try:options=json.loads(self.rfile.read(length))
        except Exception:self.reply({'error':'请求格式错误'},400);return
        if action=='cancel':update(job,cancel=True);self.reply({'ok':True});return
        if action not in ('analyse','process'):self.reply({'error':'未知操作'},404);return
        if action=='process' and not (RUNTIME/job['id']/'analysis.json').exists():self.reply({'error':'请先识别'},400);return
        update(job,stage='detecting' if action=='analyse' else 'processing',progress=0)
        threading.Thread(target=worker,args=(job,action,options),daemon=True).start();self.reply({'ok':True})

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8765);p.add_argument('--sample');p.add_argument('--host',default='127.0.0.1',choices=['127.0.0.1']);args=p.parse_args()
    if args.sample:
        d=RUNTIME/'sample';d.mkdir(exist_ok=True);shutil.copyfile(args.sample,d/'input.mp4')
        jobs['sample']=dict(id='sample',name='你的即梦测试视频',stage='uploaded',progress=0,meta=probe(d/'input.mp4'),message='测试样片已就绪')
    # Restore only app-owned jobs after a restart, never arbitrary filesystem paths.
    import re
    for d in RUNTIME.iterdir():
        if not d.is_dir() or not re.fullmatch(r'(sample|[0-9a-f]{12})',d.name) or not (d/'input.mp4').is_file():continue
        try:
            j=dict(id=d.name,name='你的即梦测试视频' if d.name=='sample' else '已导入的视频',stage='uploaded',progress=0,meta=probe(d/'input.mp4'),message='已恢复素材')
            if (d/'analysis.json').exists():
                a=json.loads((d/'analysis.json').read_text(encoding='utf8'));a['template_path']=str(d/'template.png')
                j.update(stage='review',analysis=a,progress=100,message='已恢复识别结果')
            if (d/'result.json').exists() and (d/'cleaned.mp4').exists():j.update(stage='done',result=json.loads((d/'result.json').read_text(encoding='utf8')),message='已恢复修补结果')
            jobs[d.name]=j
        except Exception:pass
    config=dict(local=f'http://127.0.0.1:{args.port}/',port=args.port,host=args.host)
    (ROOT/'connection.json').write_text(json.dumps(config,ensure_ascii=False,indent=2),encoding='utf8')
    print('Web: '+config['local'],flush=True)
    ThreadingHTTPServer((args.host,args.port),Handler).serve_forever()
