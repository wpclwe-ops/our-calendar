import os
import uvicorn
from .main import create_app
uvicorn.run(create_app(),host=os.getenv('HOST','0.0.0.0'),port=int(os.getenv('PORT','8000')),log_level='info',access_log=False)
