# Multi-Modal Bar Tuning Web Interface

A web-based interface for optimizing xylophone/marimba bar tuning with real-time 3D visualization.

## Features

- **Material Selection**: Choose from various woods (Rosewood, Padauk, Maple, etc.) and metals (Aluminum, Brass, Steel, etc.)
- **Bar Dimensions**: Configure length, width, height, and minimum cut height
- **Tuning Presets**: Standard marimba (1:4:10), vibraphone (1:4:9), xylophone (1:3:6), and custom ratios
- **Optimization Algorithms**:
  - Evolutionary Algorithm (EA) with configurable population size, generations, mutation strength
  - Surrogate/RBF optimization for faster convergence
- **Analysis Modes**:
  - 2D Timoshenko beam (fast)
  - 3D FEM solid elements (accurate)
- **Real-time Visualization**:
  - 3D bar preview with Three.js
  - Live updates during optimization
  - Evolution playback with generation slider
- **Results**:
  - Frequency comparison charts
  - Error display in cents
  - Export to JSON

## Setup

### Backend

```bash
cd web/backend

# Create virtual environment (optional but recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the server
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd web/frontend

# Install dependencies
npm install

# Run development server
npm run dev
```

The frontend runs on http://localhost:5173 and proxies API requests to the backend on port 8000.

## Architecture

```
web/
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── api/
│   │   ├── routes.py        # REST endpoints
│   │   └── websocket.py     # WebSocket handler for optimization
│   ├── models/
│   │   └── schemas.py       # Pydantic models for API
│   ├── services/
│   │   ├── mesh.py          # Mesh generation for Three.js
│   │   └── optimization.py  # Wrapper around optimization functions
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── App.tsx          # Main application component
    │   ├── components/
    │   │   ├── ConfigPanel/ # Configuration UI
    │   │   ├── ProgressPanel/# Progress display
    │   │   ├── Viewer3D/    # Three.js visualization
    │   │   └── Results/     # Results summary
    │   ├── hooks/
    │   │   ├── useOptimization.ts  # WebSocket management
    │   │   └── usePlayback.ts      # Evolution playback
    │   ├── stores/
    │   │   └── optimizationStore.ts # Zustand state
    │   └── types/
    │       └── index.ts     # TypeScript types
    └── package.json

```

## API Endpoints

### REST

- `GET /api/materials` - List all materials grouped by category
- `GET /api/material-keys` - List material keys
- `GET /api/presets` - List all tuning presets
- `POST /api/mesh` - Generate mesh for Three.js
- `POST /api/validate-config` - Validate optimization config

### WebSocket

- `WS /ws/optimize` - Real-time optimization with progress updates

#### WebSocket Protocol

```json
// Client -> Server: Start optimization
{ "action": "start", "config": { ... } }

// Server -> Client: Progress update (per generation)
{
  "type": "progress",
  "generation": 42,
  "best_fitness": 0.0023,
  "computed_frequencies": [440.5, 1759.2, 4401.1],
  "errors_cents": [1.97, -0.79, 17.89],
  "best_genes": [0.045, 0.012, 0.032, 0.008],
  "mesh": { ... }
}

// Server -> Client: Optimization complete
{
  "type": "complete",
  "result": { ... },
  "final_mesh": { ... }
}

// Client -> Server: Stop optimization
{ "action": "stop" }
```

## Technology Stack

- **Backend**: FastAPI, WebSockets, Pydantic
- **Frontend**: React 18, TypeScript, Vite
- **3D Visualization**: Three.js via react-three-fiber
- **State Management**: Zustand
- **Charts**: Recharts
