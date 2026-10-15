"""Run on the deployed service after PUBLIC_URL is set. Never prints the token."""
from app.config import Config
from app.bot import Telegram,TelegramAPIError
if __name__=='__main__':
    try:
        config=Config.env()
        Telegram(config).setup()
    except TelegramAPIError as e:
        raise SystemExit('Telegram setup failed, API status '+str(e.code))
    print('Webhook, menu button and commands configured. Set Main Mini App URL in BotFather as described in README.')
