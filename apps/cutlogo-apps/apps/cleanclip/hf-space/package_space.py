"""Package only web runtime files, with truthful cloud UI and per-tab auth."""
import argparse
from pathlib import Path
import shutil

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, default=ROOT/'build/hf-space')
args = parser.parse_args()
stage = args.output.resolve()
stage.mkdir(parents=True, exist_ok=True)
for name in ['Dockerfile', 'README.md', 'requirements.txt', 'hosted.py']:
    shutil.copyfile(HERE/name, stage/name)
for name in ['server.py', 'core.py', 'download_model.py']:
    shutil.copyfile(ROOT/name, stage/name)
for name in ['LaMa-LICENSE', 'OpenCV-LICENSE', 'simple-lama-LICENSE']:
    (stage/'licenses').mkdir(exist_ok=True)
    shutil.copyfile(ROOT/'licenses'/name, stage/'licenses'/name)
shutil.copyfile(ROOT.parents[1]/'LICENSE', stage/'LICENSE')
(stage/'web').mkdir(exist_ok=True)
html = (ROOT/'web/index.html').read_text(encoding='utf8')
for before, after in [
    ('仅本机连接', '云端临时处理'),
    ('本地修复', '云端修复'),
    ('你的文件，始终在你的电脑。', '素材上传至此 Space，处理后请及时下载。'),
    ('使用本机 GPU 处理，不上传素材。', '由 Space CPU 处理，素材临时上传；会话隔离，闲置约一小时后清理。'),
    ('本地运行 · 原片不覆盖 · 预览版 0.2', 'Hugging Face · 会话隔离 · 网页版 0.4'),
    ('或者选择已导入的测试样片', '支持 MP4 等常见视频格式'),
]:
    html = html.replace(before, after)
(stage/'web/index.html').write_text(html, encoding='utf8')
js = (ROOT/'web/app.js').read_text(encoding='utf8')
session = """let sessionToken=sessionStorage.getItem('cleanclip-session')||'';
async function ensureSession(){
 if(sessionToken){const check=await fetch('/api/jobs',{headers:{'X-Cleanclip-Session':sessionToken}});if(check.ok)return;}
 const r=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 const data=await r.json();if(!r.ok)throw Error(data.error||'会话创建失败');
 sessionToken=data.session;sessionStorage.setItem('cleanclip-session',sessionToken);
}
"""
js = session + js
js = js.replace('const media=(name)=>`/api/jobs/${job.id}/${name}`;', 'const media=(name)=>`/api/jobs/${job.id}/${name}?session=${encodeURIComponent(sessionToken)}`;')
js = js.replace('fetch(path,options)', "fetch(path,{...options,headers:{...(options.headers||{}),'X-Cleanclip-Session':sessionToken}})")
js = js.replace('async function connect(){', 'async function connect(){await ensureSession();')
js = js.replace("+'?time='", "+'&time='").replace("+'?v='", "+'&v='").replace("+'?download=1'", "+'&download=1'")
js = js.replace("if($('extraEnabled').checked&&!extraRect)throw Error('请先框选角标，再点击设为固定角标');", '')
js = js.replace("extra_rects:$('extraEnabled').checked?[extraRect]:[]", "extra_rects:$('extraEnabled').checked&&extraRect?[extraRect]:[]")
(stage/'web/app.js').write_text(js, encoding='utf8')
shutil.copyfile(ROOT/'web/style.css', stage/'web/style.css')
print('Packaged web runtime into '+str(stage))
