"""FastAPI backend for multi-modal tuning web interface."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router as api_router
from api.websocket import router as ws_router

app = FastAPI(
    title="Multi-Modal Tuning API",
    description="Web interface for bar tuning optimization",
    version="1.0.0",
)

# CORS middleware for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(api_router, prefix="/api")
app.include_router(ws_router)


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "message": "Multi-Modal Tuning API"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
