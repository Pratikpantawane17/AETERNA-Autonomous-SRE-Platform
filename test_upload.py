import urllib.request, urllib.parse, json, os

boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
body = (
    '--' + boundary + '\r\n'
    'Content-Disposition: form-data; name="file"; filename="test.csv"\r\n'
    'Content-Type: text/csv\r\n\r\n'
    'alert_type,severity,service\nhigh_cpu,critical,checkout\r\n'
    '--' + boundary + '--\r\n'
)

req = urllib.request.Request(
    'http://localhost:8000/api/alerts/upload-csv', 
    data=body.encode('utf-8'),
    headers={
        'x-api-key': 'cummins-demo-key', 
        'Content-Type': 'multipart/form-data; boundary=' + boundary
    },
    method='POST'
)

try:
    with urllib.request.urlopen(req) as res:
        print(res.read().decode('utf-8'))
except Exception as e:
    print('Failed:', e)
