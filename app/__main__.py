import os
import uvicorn
from .config import Config
from .main import create_app
from .setup import create_setup_app,missing_configuration

setup_allowed=os.getenv('SETUP_MODE','false').lower()=='true'
is_demo=os.getenv('DEMO_MODE','false').lower()=='true'
application=create_setup_app() if setup_allowed and not is_demo and missing_configuration() else create_app(Config.env())
uvicorn.run(application,host=os.getenv('HOST','0.0.0.0'),port=int(os.getenv('PORT','8000')),log_level='info',access_log=False)
