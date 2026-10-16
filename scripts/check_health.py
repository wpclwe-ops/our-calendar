"""External monitor: fail on stopped workers, failed translation or stale backups."""
import argparse
import json
import urllib.request

def main():
    p=argparse.ArgumentParser();p.add_argument('url');a=p.parse_args()
    try:
        with urllib.request.urlopen(a.url.rstrip('/')+'/health',timeout=30) as response:result=json.load(response)
        if not result.get('ready') or result.get('degraded') or result.get('demo'):raise ValueError()
        print('Calendar worker, translation and backup checks passed.')
    except Exception:raise SystemExit('Service health check failed. Inspect /health and Railway; no user data was requested.')
if __name__=='__main__':main()
