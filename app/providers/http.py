"""Bounded HTTPS transport with sanitized errors and no credential redirects."""
from dataclasses import dataclass
import json
import urllib.request
import urllib.error
from urllib.parse import urlparse

@dataclass
class ProviderFailure(Exception):
    code:int
    retry_after:int=0
    reason:str=''

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

class HTTPS:
    def __init__(self,allowed_host):
        self.allowed_host=allowed_host
        self.opener=urllib.request.build_opener(NoRedirect)
    def request(self,method,url,headers=None,body=None):
        parsed=urlparse(url)
        if parsed.scheme!='https' or parsed.username or parsed.password or parsed.port not in (None,443) or not self.allowed_host(parsed.hostname or ''):
            raise ProviderFailure(400)
        req=urllib.request.Request(url,data=body,headers=headers or {},method=method)
        try:
            with self.opener.open(req,timeout=15) as response:
                data=response.read(8*1024*1024+1)
                if len(data)>8*1024*1024:raise ProviderFailure(413)
                return response.status,dict(response.headers),data
        except urllib.error.HTTPError as exc:
            retry=exc.headers.get('Retry-After','0')
            reason=''
            if parsed.hostname=='oauth2.googleapis.com' and parsed.path=='/token':
                try:
                    error=json.loads(exc.read(4096)).get('error')
                    if error in ('invalid_client','invalid_grant','invalid_scope','unauthorized_client','invalid_request'):
                        reason=error
                except (ValueError,TypeError,AttributeError,OSError):pass
            raise ProviderFailure(exc.code,int(retry) if retry.isdigit() else 0,reason)
        except (OSError,TimeoutError):raise ProviderFailure(503)
    def json(self,method,url,headers=None,data=None):
        headers=dict(headers or {})
        if data is not None:
            headers['Content-Type']='application/json';body=json.dumps(data).encode()
        else:body=None
        _,_,body=self.request(method,url,headers,body)
        try:return json.loads(body)
        except (ValueError,TypeError):raise ProviderFailure(502)
