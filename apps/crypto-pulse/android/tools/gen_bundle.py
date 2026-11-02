# -*- coding: utf-8 -*-
"""把 www 下的文本资源打进 Java 常量，产出 WebBundle.java。

为什么不用 assets：部分设备（实测 HONOR Android 16）上 AssetManager 没有挂上
本 APK 的 assets 路径，getAssets().open("www/index.html") 直接 FileNotFoundException。
把内容编进 dex 就不依赖 AssetManager 了 —— 代码能跑，页面就一定在。

格式：gzip( count + [nameLen, name, dataLen, data]* ) -> base64 -> 按字符切块
"""
import base64
import gzip
import os
import struct
import sys

TEXT_EXT = ('.html', '.htm', '.css', '.js', '.webmanifest', '.json', '.txt')
CHUNK = 4000

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WWW = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'www')
OUT = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'niulai', 'crypto', 'WebBundle.java')


def collect():
    items = []
    for base, _dirs, files in os.walk(WWW):
        for fn in sorted(files):
            if not fn.lower().endswith(TEXT_EXT):
                continue
            full = os.path.join(base, fn)
            rel = os.path.relpath(full, WWW).replace('\\', '/')
            with open(full, 'rb') as f:
                items.append((rel, f.read()))
    items.sort(key=lambda x: x[0])
    return items


def build_blob(items):
    out = bytearray()
    out += struct.pack('>I', len(items))
    for name, data in items:
        nb = name.encode('utf-8')
        out += struct.pack('>I', len(nb)) + nb
        out += struct.pack('>I', len(data)) + data
    return bytes(out)


def main():
    items = collect()
    if not items:
        print('没有可打包的文件:', WWW)
        return 1

    raw = build_blob(items)
    gz = gzip.compress(raw, 9)
    b64 = base64.b64encode(gz).decode('ascii')
    chunks = [b64[i:i + CHUNK] for i in range(0, len(b64), CHUNK)]

    total = sum(len(d) for _n, d in items)
    print('打包 %d 个文本文件 / %d B' % (len(items), total))
    print('gzip %d B -> base64 %d B -> %d 块' % (len(gz), len(b64), len(chunks)))

    lines = []
    lines.append('package com.niulai.crypto;')
    lines.append('')
    lines.append('import java.io.ByteArrayInputStream;')
    lines.append('import java.io.DataInputStream;')
    lines.append('import java.util.HashMap;')
    lines.append('import java.util.Map;')
    lines.append('import java.util.zip.GZIPInputStream;')
    lines.append('')
    lines.append('/**')
    lines.append(' * 由 android/tools/gen_bundle.py 自动生成，请勿手改。')
    lines.append(' * 网页资源以 gzip+base64 形式内嵌在 dex 里，绕开 AssetManager。')
    lines.append(' */')
    lines.append('final class WebBundle {')
    lines.append('')
    lines.append('  static final int FILE_COUNT = %d;' % len(items))
    lines.append('')
    lines.append('  private static final String[] P = {')
    for c in chunks:
        lines.append('    "%s",' % c)
    lines.append('  };')
    lines.append('')
    lines.append('  private static volatile Map<String, byte[]> CACHE;')
    lines.append('')
    lines.append('  private WebBundle() {}')
    lines.append('')
    lines.append('  static Map<String, byte[]> files() {')
    lines.append('    Map<String, byte[]> m = CACHE;')
    lines.append('    if (m != null) return m;')
    lines.append('    synchronized (WebBundle.class) {')
    lines.append('      if (CACHE != null) return CACHE;')
    lines.append('      m = new HashMap<String, byte[]>();')
    lines.append('      try {')
    lines.append('        StringBuilder sb = new StringBuilder(%d);' % (len(b64) + 16))
    lines.append('        for (int i = 0; i < P.length; i++) sb.append(P[i]);')
    lines.append('        byte[] gz = android.util.Base64.decode(sb.toString(), android.util.Base64.DEFAULT);')
    lines.append('        DataInputStream in = new DataInputStream(')
    lines.append('            new GZIPInputStream(new ByteArrayInputStream(gz)));')
    lines.append('        int n = in.readInt();')
    lines.append('        for (int i = 0; i < n; i++) {')
    lines.append('          byte[] nb = new byte[in.readInt()];')
    lines.append('          in.readFully(nb);')
    lines.append('          byte[] db = new byte[in.readInt()];')
    lines.append('          in.readFully(db);')
    lines.append('          m.put(new String(nb, "UTF-8"), db);')
    lines.append('        }')
    lines.append('        in.close();')
    lines.append('      } catch (Throwable t) {')
    lines.append('        android.util.Log.e("NiuLai", "内置资源解包失败: " + t);')
    lines.append('      }')
    lines.append('      CACHE = m;')
    lines.append('      return m;')
    lines.append('    }')
    lines.append('  }')
    lines.append('}')
    lines.append('')

    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines))
    print('已生成', OUT)

    # 自校验：把生成的常量解回来，逐个比对 md5
    import hashlib
    src = open(OUT, encoding='utf-8').read()
    body = src[src.index('String[] P = {'):src.index('};', src.index('String[] P = {'))]
    joined = ''.join(l.strip().rstrip(',').strip('"') for l in body.splitlines() if l.strip().startswith('"'))
    back = gzip.decompress(base64.b64decode(joined))
    pos = 4
    n = struct.unpack('>I', back[:4])[0]
    ok = True
    for i in range(n):
        nl = struct.unpack('>I', back[pos:pos + 4])[0]; pos += 4
        name = back[pos:pos + nl].decode('utf-8'); pos += nl
        dl = struct.unpack('>I', back[pos:pos + 4])[0]; pos += 4
        data = back[pos:pos + dl]; pos += dl
        origin = dict(items)[name]
        same = hashlib.md5(data).hexdigest() == hashlib.md5(origin).hexdigest()
        ok = ok and same
        if not same:
            print('  不一致:', name)
    print('自校验: %s（%d 个文件）' % ('全部一致' if ok else '有不一致', n))
    return 0 if ok else 2


if __name__ == '__main__':
    sys.exit(main())
