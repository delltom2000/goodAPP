"""Hugging Face entry point with isolated, short-lived browser sessions."""
import hashlib
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import threading
import time
from urllib.parse import parse_qs, urlparse

import server

sessions = {}
session_lock = threading.RLock()
TTL = 3600
PUBLIC_HOST = os.environ.get('CLEANCLIP_PUBLIC_HOST', 'dellweb3-cutlogo.hf.space')

def prune():
    now = time.time()
    with session_lock:
        expired = {key for key, last in sessions.items() if now-last > TTL}
        for key in expired:
            sessions.pop(key, None)
        for jid, job in list(server.jobs.items()):
            if job.get('owner') in sessions or job['stage'] in ('processing', 'detecting'):
                continue
            directory = server.RUNTIME/jid
            if re.fullmatch('[0-9a-f]{12}', jid) and directory.resolve().parent == server.RUNTIME.resolve():
                shutil.rmtree(directory, ignore_errors=True)
            server.jobs.pop(jid, None)
        # Failed/incomplete uploads have no job entry.
        for directory in server.RUNTIME.iterdir():
            if directory.is_dir() and re.fullmatch('[0-9a-f]{12}', directory.name) and directory.name not in server.jobs and now-directory.stat().st_mtime > TTL:
                shutil.rmtree(directory, ignore_errors=True)

class HostedHandler(server.Handler):
    def session(self):
        token = self.headers.get('X-Cleanclip-Session') or parse_qs(urlparse(self.path).query).get('session', [''])[0]
        key = hashlib.sha256(token.encode()).hexdigest() if token else ''
        with session_lock:
            if key not in sessions or time.time()-sessions[key] > TTL:
                return None
            sessions[key] = time.time()
            return key

    def origin_allowed(self):
        origin = self.headers.get('Origin')
        return not origin or urlparse(origin).netloc in (self.headers.get('Host'), PUBLIC_HOST)

    def authed(self):
        return self.origin_allowed() and bool(self.session())

    def owns_path(self):
        parts = urlparse(self.path).path.strip('/').split('/')
        if len(parts) >= 3 and parts[:2] == ['api', 'jobs']:
            job = server.jobs.get(parts[2])
            return bool(job and job.get('owner') == self.session())
        return True

    def reply(self, data, status=200):
        if isinstance(data, dict):
            if urlparse(self.path).path == '/api/upload' and data.get('id') in server.jobs:
                with session_lock:
                    server.jobs[data['id']]['owner'] = self.session()
            data = {k:v for k,v in data.items() if k != 'owner'}
        super().reply(data, status)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/health':
            self.reply({'ok':True, 'name':'CleanClip', 'version':'0.4.0-cloud', 'hosting':'Hugging Face'})
            return
        if path == '/api/jobs':
            if not self.authed():
                self.reply({'error':'会话已过期，请刷新页面'}, 401)
                return
            owner = self.session()
            with session_lock:
                jobs = [dict(id=j['id'], name=j['name'], stage=j['stage']) for j in server.jobs.values() if j.get('owner') == owner]
            self.reply(jobs)
            return
        if path.startswith('/api/') and (not self.authed() or not self.owns_path()):
            self.reply({'error':'文件不存在或不属于当前会话'}, 404)
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == '/api/session':
            if not self.origin_allowed():
                self.reply({'error':'不允许跨站请求'}, 403)
                return
            length = int(self.headers.get('Content-Length', '0'))
            if length < 0 or length > 1024:
                self.reply({'error':'请求过大'}, 413)
                return
            self.rfile.read(length)
            prune()
            with session_lock:
                if len(sessions) >= 256:
                    self.reply({'error':'服务繁忙，请稍后重试'}, 503)
                    return
                token = secrets.token_urlsafe(32)
                sessions[hashlib.sha256(token.encode()).hexdigest()] = time.time()
            self.reply({'session':token})
            return
        if not self.authed() or not self.owns_path():
            self.reply({'error':'会话无效或任务不属于当前会话'}, 403)
            return
        if path == '/api/upload':
            prune()
            with session_lock:
                owner = self.session()
                count = sum(j.get('owner') == owner for j in server.jobs.values())
                used = sum(p.stat().st_size for p in server.RUNTIME.rglob('*') if p.is_file())
            if count >= 3 or used + int(self.headers.get('Content-Length', '0')) > 1024**3:
                self.reply({'error':'临时存储已满；每个会话最多 3 段视频，请稍后重试'}, 429)
                return
        super().do_POST()

if __name__ == '__main__':
    # Never restore local sample jobs or previous visitors' files after a restart.
    def maintenance():
        while True:
            time.sleep(300)
            prune()
    threading.Thread(target=maintenance, daemon=True).start()
    port = int(os.environ.get('PORT', '7860'))
    print('CleanClip cloud service ready on port '+str(port), flush=True)
    ThreadingHTTPServer(('0.0.0.0', port), HostedHandler).serve_forever()
