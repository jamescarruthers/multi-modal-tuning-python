import { useCallback, useEffect, useRef } from 'react';
import { useOptimizationStore } from '../stores/optimizationStore';

interface PlaybackOptions {
  speed?: number; // Playback speed multiplier (default: 1)
  interval?: number; // Base interval in ms (default: 100)
}

export function usePlayback(options: PlaybackOptions = {}) {
  const { speed = 1, interval = 100 } = options;
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const {
    generations,
    playbackIndex,
    isPlaying,
    isRunning,
    setPlaybackIndex,
    setIsPlaying,
    playNext,
  } = useOptimizationStore();

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // Playback timer
  useEffect(() => {
    if (isPlaying && !isRunning) {
      timerRef.current = setInterval(() => {
        playNext();
      }, interval / speed);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isPlaying, isRunning, speed, interval, playNext]);

  const play = useCallback(() => {
    if (generations.length > 0 && playbackIndex < generations.length - 1) {
      setIsPlaying(true);
    }
  }, [generations.length, playbackIndex, setIsPlaying]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, [setIsPlaying]);

  const toggle = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  const goToStart = useCallback(() => {
    setIsPlaying(false);
    setPlaybackIndex(0);
  }, [setIsPlaying, setPlaybackIndex]);

  const goToEnd = useCallback(() => {
    setIsPlaying(false);
    setPlaybackIndex(generations.length - 1);
  }, [generations.length, setIsPlaying, setPlaybackIndex]);

  const goTo = useCallback(
    (index: number) => {
      setIsPlaying(false);
      setPlaybackIndex(index);
    },
    [setIsPlaying, setPlaybackIndex]
  );

  return {
    play,
    pause,
    toggle,
    goToStart,
    goToEnd,
    goTo,
    isPlaying,
    canPlay: generations.length > 0 && playbackIndex < generations.length - 1,
    totalGenerations: generations.length,
    currentIndex: playbackIndex,
  };
}
