"""Read-only local design preview using actual public API responses."""
import http.server,urllib.request,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[3]/'apps/web'
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  if self.path in ['/', '/app.js', '/walkthrough.js', '/style.css']:
   name='index.html' if self.path=='/' else self.path[1:]
   body=(ROOT/name).read_bytes();self.send_response(200);self.send_header('Content-Type',{'index.html':'text/html','app.js':'text/javascript','walkthrough.js':'text/javascript','style.css':'text/css'}[name]);self.end_headers();self.wfile.write(body)
  elif self.path in ['/tasks','/runs','/healthz'] or self.path.startswith('/runs/'):
   try:
    with urllib.request.urlopen('https://patchproof.andrewmohawk.xyz'+self.path,timeout=30) as response:
     body=response.read();self.send_response(response.status);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)
   except Exception: self.send_error(502)
  elif self.path=='/favicon.ico':self.send_response(204);self.end_headers()
  else:self.send_error(404)
 def log_message(self,*args):pass
http.server.ThreadingHTTPServer(('127.0.0.1',43179),Handler).serve_forever()
