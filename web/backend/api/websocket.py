"""WebSocket handler for real-time optimization updates."""

import asyncio
import json
from typing import Dict, Any, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from models.schemas import OptimizationConfig
from services.optimization import run_optimization_with_progress

router = APIRouter()


class OptimizationSession:
    """Manages a single optimization session."""

    def __init__(self, websocket: WebSocket, loop: asyncio.AbstractEventLoop):
        self.websocket = websocket
        self.loop = loop  # Store reference to the event loop
        self.stop_event: Optional[asyncio.Event] = None
        self.is_running = False
        self.generations: list = []  # Store all generations for playback

    async def send_message(self, data: Dict[str, Any]):
        """Send JSON message to client."""
        try:
            from starlette.websockets import WebSocketState

            if self.websocket.client_state != WebSocketState.CONNECTED:
                return

            await self.websocket.send_json(data)
        except Exception:
            pass  # Connection may have closed

    def progress_callback(self, data: Dict[str, Any]):
        """
        Callback for progress updates during optimization.
        Note: This is called from a thread, so we need to schedule the send.
        """
        # Store generation data for playback
        self.generations.append(data.copy())

        # Schedule the async send using the stored event loop
        try:
            asyncio.run_coroutine_threadsafe(
                self.send_message(data),
                self.loop
            )
        except Exception:
            pass

    async def run_optimization(self, config: OptimizationConfig):
        """Run the optimization with progress updates."""
        self.is_running = True
        self.stop_event = asyncio.Event()
        self.generations = []

        try:
            # Send start confirmation
            await self.send_message({
                "type": "started",
                "message": f"Starting {config.algorithm} optimization...",
            })

            # Run optimization
            result = await run_optimization_with_progress(
                config=config,
                progress_callback=self.progress_callback,
                stop_event=self.stop_event,
            )

            # Send completion
            await self.send_message(result)

            # Also send full history for playback
            await self.send_message({
                "type": "history",
                "generations": self.generations,
            })

        except Exception as e:
            await self.send_message({
                "type": "error",
                "message": str(e),
            })
        finally:
            self.is_running = False

    def stop(self):
        """Signal the optimization to stop."""
        if self.stop_event:
            self.stop_event.set()


@router.websocket("/ws/optimize")
async def websocket_optimize(websocket: WebSocket):
    """
    WebSocket endpoint for optimization with real-time updates.

    Protocol:
    - Client sends: {"action": "start", "config": {...}}
    - Server sends: {"type": "started", "message": "..."}
    - Server sends: {"type": "progress", ...} (per generation)
    - Server sends: {"type": "complete", "result": {...}}
    - Server sends: {"type": "history", "generations": [...]}
    - Client can send: {"action": "stop"} to cancel
    """
    await websocket.accept()

    # Get the current event loop and pass it to the session
    loop = asyncio.get_running_loop()
    session = OptimizationSession(websocket, loop)

    try:
        while True:
            # Wait for messages from client
            data = await websocket.receive_text()
            message = json.loads(data)

            action = message.get("action")

            if action == "start":
                if session.is_running:
                    await session.send_message({
                        "type": "error",
                        "message": "Optimization already running",
                    })
                    continue

                # Parse config
                try:
                    config = OptimizationConfig(**message.get("config", {}))
                except Exception as e:
                    await session.send_message({
                        "type": "error",
                        "message": f"Invalid config: {e}",
                    })
                    continue

                # Start optimization as background task
                asyncio.create_task(session.run_optimization(config))

            elif action == "stop":
                if session.is_running:
                    session.stop()
                    await session.send_message({
                        "type": "stopped",
                        "message": "Optimization stopped by user",
                    })
                else:
                    await session.send_message({
                        "type": "info",
                        "message": "No optimization running",
                    })

            elif action == "ping":
                await session.send_message({"type": "pong"})

            else:
                await session.send_message({
                    "type": "error",
                    "message": f"Unknown action: {action}",
                })

    except WebSocketDisconnect:
        # Client disconnected - stop any running optimization
        session.stop()
    except Exception as e:
        # Unexpected error
        try:
            await session.send_message({
                "type": "error",
                "message": f"WebSocket error: {e}",
            })
        except Exception:
            pass
        session.stop()
