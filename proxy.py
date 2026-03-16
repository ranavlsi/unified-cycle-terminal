import json
import urllib.request
import urllib.error
import ssl
import os
import mimetypes
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

PORT = 8000

# Global Yahoo Finance Tracking Variables
YAHOO_COOKIE = ""
YAHOO_CRUMB = ""

def _get_yahoo_crumb():
    global YAHOO_COOKIE, YAHOO_CRUMB
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    # 1. Get Set-Cookie
    req1 = urllib.request.Request("https://fc.yahoo.com", headers={'User-Agent': 'Mozilla/5.0'})
    try:
        res1 = urllib.request.urlopen(req1, context=ctx)
        YAHOO_COOKIE = res1.headers.get('Set-Cookie', '').split(';')[0]
    except urllib.error.HTTPError as e:
        YAHOO_COOKIE = e.headers.get('Set-Cookie', '').split(';')[0]
    except Exception:
        pass
        
    # 2. Extract Crumb
    if YAHOO_COOKIE:
        req2 = urllib.request.Request("https://query2.finance.yahoo.com/v1/test/getcrumb", headers={'User-Agent': 'Mozilla/5.0', 'Cookie': YAHOO_COOKIE})
        try:
            res2 = urllib.request.urlopen(req2, context=ctx)
            YAHOO_CRUMB = res2.read().decode('utf-8')
        except Exception:
            pass

class ProxyHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header("Access-Control-Allow-Headers", "X-Requested-With")
        self.send_header("Access-Control-Allow-Headers", "Content-type")
        self.end_headers()
        
    def do_GET(self):
        parsed_path = urlparse(self.path)
        
        # Ensure we have a valid cookie/crumb for Yahoo endpoints
        if not YAHOO_CRUMB:
             _get_yahoo_crumb()

        if parsed_path.path.startswith('/api/stock'):
            params = parse_qs(parsed_path.query)
            ticker = params.get('ticker', [''])[0].upper()
            if not ticker:
                self.send_response(400)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'{"error": "Missing ticker parameter"}')
                return
                
            # Updated to fetch 10 years of daily intervals for drawing full historical charts
            yf_url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=10y"
            req = urllib.request.Request(yf_url, headers={'User-Agent': 'Mozilla/5.0'})
            
            try:
                with urllib.request.urlopen(req) as response:
                    data = response.read()
                    self.send_response(200)
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    self.wfile.write(data)
            except urllib.error.URLError as e:
                self.send_response(500)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
                
        elif parsed_path.path.startswith('/api/fundamentals'):
            params = parse_qs(parsed_path.query)
            ticker = params.get('ticker', [''])[0].upper()
            if not ticker:
                self.send_response(400)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'{"error": "Missing ticker parameter"}')
                return
            
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
                
            yf_url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{ticker}?modules=financialData,defaultKeyStatistics,earnings&crumb={YAHOO_CRUMB}"
            req = urllib.request.Request(yf_url, headers={'User-Agent': 'Mozilla/5.0', 'Cookie': YAHOO_COOKIE})
            
            try:
                with urllib.request.urlopen(req, context=ctx) as response:
                    data = response.read()
                    self.send_response(200)
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    self.wfile.write(data)
            except urllib.error.URLError as e:
                self.send_response(500)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
                
        elif parsed_path.path.startswith('/api/news'):
            params = parse_qs(parsed_path.query)
            ticker = params.get('ticker', [''])[0].upper()
            if not ticker:
                self.send_response(400)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'{"error": "Missing ticker parameter"}')
                return
                
            news_url = f"https://news.google.com/rss/search?q={ticker}+stock&hl=en-US&gl=US&ceid=US:en"
            req = urllib.request.Request(news_url, headers={'User-Agent': 'Mozilla/5.0'})
            
            try:
                with urllib.request.urlopen(req) as response:
                    data = response.read()
                    self.send_response(200)
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Content-type', 'application/xml')
                    self.end_headers()
                    self.wfile.write(data)
            except urllib.error.URLError as e:
                self.send_response(500)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
        else:
            # Serve static files from the project directory
            # Map '/' to index.html
            file_path = parsed_path.path
            if file_path == '/' or file_path == '':
                file_path = '/index.html'
            local_path = os.path.join(SCRIPT_DIR, file_path.lstrip('/'))
            
            if os.path.isfile(local_path):
                mime_type, _ = mimetypes.guess_type(local_path)
                mime_type = mime_type or 'application/octet-stream'
                with open(local_path, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-type', mime_type)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(content)
            else:
                self.send_response(404)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b"Not Found")

if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', PORT), ProxyHandler)
    print(f"=================================================")
    print(f" Python Zero-Dependency Proxy Server Started!")
    print(f" Listening on http://localhost:{PORT}")
    print(f" App available at: http://localhost:{PORT}/")
    print(f"=================================================")
    server.serve_forever()
