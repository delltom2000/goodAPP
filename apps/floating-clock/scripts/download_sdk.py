import urllib.request,zipfile,pathlib,concurrent.futures,time
base=pathlib.Path('.tools/sdk');base.mkdir(exist_ok=True)
def get(item):
 name,url=item;p=base/(name+'.zip');t=time.time()
 with urllib.request.urlopen(url,timeout=30) as r, p.open('wb') as f:
  while True:
   b=r.read(1024*1024)
   if not b:break
   f.write(b)
 print(name,p.stat().st_size,round(time.time()-t),flush=True)
 with zipfile.ZipFile(p) as z:z.extractall(base/name)
 print('Extracted '+name,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:list(ex.map(get,[('platform','https://dl.google.com/android/repository/platform-35_r02.zip'),('build-tools','https://dl.google.com/android/repository/build-tools_r35_windows.zip')]))
