"""Entry point. Run:  .venv/bin/python run.py
Then open http://localhost:8000 in your browser."""
import uvicorn

from app import config

if __name__ == "__main__":
    print(f"Argus -> http://localhost:{config.PORT}  (camera source: {config.SOURCE})")
    uvicorn.run("app.server:app", host=config.HOST, port=config.PORT, reload=False)
