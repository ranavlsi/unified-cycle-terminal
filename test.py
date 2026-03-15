import urllib.request
import urllib.error
import ssl
import json

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

cookie = ""
crumb = ""

req1 = urllib.request.Request("https://fc.yahoo.com", headers={'User-Agent': 'Mozilla/5.0'})
try:
    res1 = urllib.request.urlopen(req1, context=ctx)
    cookie = res1.headers.get('Set-Cookie', '').split(';')[0]
except urllib.error.HTTPError as e:
    cookie = e.headers.get('Set-Cookie', '').split(';')[0]

if cookie:
    req2 = urllib.request.Request("https://query2.finance.yahoo.com/v1/test/getcrumb", headers={'User-Agent': 'Mozilla/5.0', 'Cookie': cookie})
    try:
        res2 = urllib.request.urlopen(req2, context=ctx)
        crumb = res2.read().decode('utf-8')
    except: pass

print(f"Auth: cookie={'ok' if cookie else 'no'}, crumb={'ok' if crumb else 'no'}")

# Fetch with extra modules to find better EPS YoY metric
url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/SOFI?modules=financialData,defaultKeyStatistics,earnings&crumb={crumb}"
req3 = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Cookie': cookie})
try:
    res3 = urllib.request.urlopen(req3, context=ctx)
    raw = res3.read().decode('utf-8')
    data = json.loads(raw)
    result = data['quoteSummary']['result'][0]
    fd = result.get('financialData', {})
    kd = result.get('defaultKeyStatistics', {})
    earnings = result.get('earnings', {})

    print("\n=== financialData FULL KEYS ===")
    for k, v in fd.items():
        print(f"  {k}: {v}")

    print("\n=== defaultKeyStatistics earnings-related ===")
    for k in ['earningsQuarterlyGrowth', 'trailingEps', 'forwardEps', 'pegRatio', 'priceToBook', 'netIncomeToCommon']:
        print(f"  {k}: {kd.get(k)}")

    print("\n=== earnings module ===")
    if earnings:
        print(json.dumps(earnings, indent=2)[:1500])
    else:
        print("  (empty)")

except Exception as e:
    print(f"Failed: {e}")
