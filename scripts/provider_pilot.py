"""Read-only integration pilot. Credentials are read from environment, never printed.

This is an engineering tool, not an end-user account connection or completed sync.
"""
import argparse
import os
from app.providers.google import GoogleCalendar
from app.providers.icloud import ICloudCalDAV
from app.providers.http import ProviderFailure

if __name__=='__main__':
    parser=argparse.ArgumentParser(description='Read-only provider pilot')
    parser.add_argument('provider',choices=['google','icloud']);args=parser.parse_args()
    try:
        if args.provider=='google':
            token=os.environ.get('GOOGLE_ACCESS_TOKEN')
            if not token:raise SystemExit('Set GOOGLE_ACCESS_TOKEN in the secure runtime environment')
            rows=GoogleCalendar(token).calendars()
            print('Readable calendars:',len(rows))
            for row in rows:print(row.get('id',''),row.get('summary',''))
        else:
            apple_id=os.environ.get('ICLOUD_APPLE_ID');password=os.environ.get('ICLOUD_APP_PASSWORD')
            if not apple_id or not password:raise SystemExit('Set ICLOUD_APPLE_ID and ICLOUD_APP_PASSWORD in the secure runtime environment')
            rows=ICloudCalDAV(apple_id,password).discover()
            print('Readable calendars:',len(rows))
            for row in rows:print(row['name'])
    except ProviderFailure as exc:raise SystemExit('Provider pilot failed, status '+str(exc.code))
