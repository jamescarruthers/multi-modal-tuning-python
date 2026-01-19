import { useCallback, useRef, useEffect } from 'react';
import { useOptimizationStore } from '../stores/optimizationStore';
import type { OptimizationConfig, WebSocketMessage, ProgressUpdate, CompleteMessage, HistoryMessage } from '../types';

export function useOptimization() {
  const wsRef = useRef<WebSocket | null>(null);

  // Clean up WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const connect = useCallback(() => {
    return new Promise<WebSocket>((resolve, reject) => {
      // In development, connect directly to backend to bypass Vite proxy
      // This helps debug WebSocket issues
      const wsHost = import.meta.env.DEV ? 'localhost:8000' : window.location.host;
      console.log('[WS] Connecting to:', `ws://${wsHost}/ws/optimize`);
      const ws = new WebSocket(`ws://${wsHost}/ws/optimize`);

      ws.onopen = () => {
        console.log('[WS] Connected');
        wsRef.current = ws;
        resolve(ws);
      };

      ws.onerror = (error) => {
        console.error('[WS] Error:', error);
        reject(error);
      };

      ws.onclose = () => {
        console.log('[WS] Closed');
        wsRef.current = null;
        useOptimizationStore.getState().setIsRunning(false);
      };

      ws.onmessage = (event) => {
        const message: WebSocketMessage = JSON.parse(event.data);
        console.log('[WS] Received:', message.type, message);

        // Get fresh store reference for each message
        const store = useOptimizationStore.getState();

        switch (message.type) {
          case 'started':
            store.reset();
            store.setIsRunning(true);
            break;

          case 'progress': {
            const progress = message as ProgressUpdate;
            console.log('[WS] Processing progress:', progress.generation, progress.best_fitness);
            store.updateProgress(progress);
            store.addGeneration(progress);
            console.log('[WS] Store updated, currentGeneration:', useOptimizationStore.getState().currentGeneration);
            break;
          }

          case 'complete': {
            const complete = message as CompleteMessage;
            // Pass mode_shapes from the complete message (available for 3D analysis)
            store.setResult(complete.result, complete.final_mesh, complete.mode_shapes);
            break;
          }

          case 'history': {
            const history = message as HistoryMessage;
            store.setGenerations(history.generations);
            break;
          }

          case 'stopped':
            store.setIsRunning(false);
            break;

          case 'error':
            console.error('Optimization error:', (message as { message: string }).message);
            store.setIsRunning(false);
            break;
        }
      };
    });
  }, []);

  const startOptimization = useCallback(async () => {
    const state = useOptimizationStore.getState();

    // Build config from store state
    const config: OptimizationConfig = {
      material: state.material,
      bar: state.barDimensions,
      preset: state.preset || undefined,
      custom_ratios: state.customRatios || undefined,
      fundamental_hz: state.fundamentalHz,
      num_cuts: state.numCuts,
      algorithm: state.algorithm,
      analysis_mode: state.analysisMode,
      ea_params: state.algorithm === 'evolutionary' ? state.eaParams : undefined,
      surrogate_params: state.algorithm === 'surrogate' ? state.surrogateParams : undefined,
      penalty: state.penaltyConfig.penalty_type !== 'none' ? state.penaltyConfig : undefined,
      length_adjust: (state.lengthAdjustConfig.max_trim > 0 || state.lengthAdjustConfig.max_extend > 0)
        ? state.lengthAdjustConfig
        : undefined,
      num_elements_y: state.numElementsY,
      num_elements_z: state.numElementsZ,
      mesh_update_interval: state.meshUpdateInterval,
    };

    console.log('[WS] Starting optimization with config:', config);

    try {
      // Always create a fresh connection to avoid stale WebSocket state
      if (wsRef.current) {
        console.log('[WS] Closing existing connection before starting new optimization');
        wsRef.current.close();
        wsRef.current = null;
      }

      const ws = await connect();

      // Send start message
      ws.send(JSON.stringify({
        action: 'start',
        config,
      }));
    } catch (error) {
      console.error('Failed to start optimization:', error);
      useOptimizationStore.getState().setIsRunning(false);
    }
  }, [connect]);

  const stopOptimization = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'stop' }));
    }
  }, []);

  return {
    startOptimization,
    stopOptimization,
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
  };
}
