"""Exercise real HTTP uploads and prove visitors cannot access one another's files."""
from pathlib import Path
import importlib
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import cv2
import numpy as np

STAGE = Path(sys.argv.pop(1)).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent.parent/'build/hf-space'
sys.path.insert(0, str(STAGE))
hosted = importlib.import_module('hosted')

class HostedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(dir=STAGE.parent)
        cls.directory = Path(cls.temp.name)
        hosted.server.RUNTIME = cls.directory/'runtime'
        hosted.server.RUNTIME.mkdir()
        hosted.server.jobs.clear()
        hosted.sessions.clear()
        cls.http = ThreadingHTTPServer(('127.0.0.1', 0), hosted.HostedHandler)
        cls.base = 'http://127.0.0.1:'+str(cls.http.server_port)
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()
        fixture = cls.directory/'fixture.mp4'
        writer = cv2.VideoWriter(str(fixture), cv2.VideoWriter_fourcc(*'mp4v'), 6, (320, 180))
        for i in range(12):
            frame = np.full((180,320,3), (30+i,70,100), np.uint8)
            cv2.putText(frame,'DEMO',(8,24),cv2.FONT_HERSHEY_SIMPLEX,.6,(255,255,255),1)
            writer.write(frame)
        writer.release()
        cls.video = fixture.read_bytes()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.temp.cleanup()

    def request(self,path,session=None,body=None,headers=None):
        headers = dict(headers or {})
        if session:
            headers['X-Cleanclip-Session'] = session
        if isinstance(body,dict):
            body=json.dumps(body).encode();headers['Content-Type']='application/json'
        req=urllib.request.Request(self.base+path,data=body,headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=15) as response:
                data=response.read()
                return response.status,json.loads(data) if response.headers.get_content_type()=='application/json' else data
        except urllib.error.HTTPError as error:
            return error.code,json.load(error)

    def test_sessions_uploads_and_media_are_isolated(self):
        _,a=self.request('/api/session',body={});_,b=self.request('/api/session',body={})
        token=a['session'];other=b['session']
        code,job=self.request('/api/upload',token,self.video)
        self.assertEqual(code,200)
        jid=job['id']
        self.assertNotIn('owner',job)
        self.assertEqual(self.request('/api/jobs',other)[1],[])
        self.assertEqual(self.request('/api/jobs/'+jid,other)[0],404)
        self.assertEqual(self.request('/api/jobs/'+jid+'/input.mp4?session='+other)[0],404)
        self.assertEqual(self.request('/api/jobs/'+jid+'/cancel',other,{})[0],403)
        code,data=self.request('/api/jobs/'+jid+'/input.mp4?session='+token,headers={'Range':'bytes=0-31'})
        self.assertEqual(code,206);self.assertEqual(data,self.video[:32])
        self.assertEqual(self.request('/api/jobs/'+jid,token)[0],200)
        self.assertEqual(self.request('/api/session',body={},headers={'Origin':'https://untrusted.example'})[0],403)
        self.assertEqual(self.request('/api/jobs')[0],401)
        key=hosted.hashlib.sha256(token.encode()).hexdigest()
        hosted.sessions[key]=0
        hosted.prune()
        self.assertNotIn(jid,hosted.server.jobs)
        self.assertFalse((hosted.server.RUNTIME/jid).exists())
        self.assertEqual(self.request('/api/jobs',token)[0],401)

if __name__=='__main__':
    unittest.main()
