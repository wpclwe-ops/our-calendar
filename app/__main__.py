import os
import uvicorn
from .config import Config
from .main import create_app
from .setup import create_setup_app,missing_configuration

setup_allowed=os.getenv('SETUP_MODE','false').lower()=='true'
is_demo=os.getenv('DEMO_MODE','false').lower()=='true'
if setup_allowed and not is_demo and missing_configuration():
    application=create_setup_app()
else:
    config=Config.env()
    if os.getenv('RELEASE_CHECKPOINT_REQUIRED','false').lower()=='true':
        from .release import release_checkpoint
        try:release_checkpoint(config)
        except Exception:raise SystemExit('Release checkpoint could not be verified; application startup stopped.')
        print('Release checkpoint verified before application startup.',flush=True)
    application=create_app(config)
uvicorn.run(application,host=os.getenv('HOST','0.0.0.0'),port=int(os.getenv('PORT','8000')),log_level='info',access_log=False)
