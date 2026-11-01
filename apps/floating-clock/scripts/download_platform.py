import urllib.request,pathlib,concurrent.futures,zipfile,time
url='https://dl.google.com/android/repository/platform-35_r02.zip'
size=64273788;chunk=4*1024*1024
folder=pathlib.Path('.tools/parts');folder.mkdir(exist_ok=True)
def get(i):
 start=i*chunk;end=min(size-1,start+chunk-1);p=folder/str(i)
 for retry in range(4):
  try:
   req=urllib.request.Request(url,headers={'Range':f'bytes={start}-{end}'})
   with urllib.request.urlopen(req,timeout=20) as r, p.open('wb') as f:
    if r.status!=206:raise ValueError('Expected range')
    while True:
     b=r.read(65536)
     if not b:break
     f.write(b)
   if p.stat().st_size != end-start+1:raise ValueError('size')
   print('part',i,'ready',flush=True);return
  except Exception as e:print('retry',i,str(e),flush=True)
 raise RuntimeError(i)
n=(size+chunk-1)//chunk
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:list(ex.map(get,range(n)))
with open('.tools/platform-complete.zip','wb') as f:
 for i in range(n):f.write((folder/str(i)).read_bytes())
with zipfile.ZipFile('.tools/platform-complete.zip') as z:z.extractall('.tools/sdk/platform')
print('Platform ready',flush=True)
