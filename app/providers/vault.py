"""Credential encryption isolated from archives and client-facing records."""
from cryptography.fernet import Fernet,InvalidToken
from .http import ProviderFailure
from ..service import dump,load

class CredentialVault:
    def __init__(self,key):self.cipher=Fernet(key.encode() if isinstance(key,str) else key)
    def encrypt(self,credentials):return self.cipher.encrypt(dump(credentials).encode()).decode()
    def decrypt(self,value):
        try:return load(self.cipher.decrypt(value.encode()))
        except (InvalidToken,ValueError,TypeError):raise ProviderFailure(401)
