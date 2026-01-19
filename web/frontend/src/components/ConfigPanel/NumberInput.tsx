import { useState, useEffect } from 'react';

interface NumberInputProps {
  id: string;
  value: number | undefined;
  onChange: (val: number | undefined) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
}

/**
 * A number input that allows free typing and only commits on blur or Enter.
 * This avoids the frustrating behavior of controlled inputs that reformat
 * while you're still typing.
 */
export function NumberInput({
  id,
  value,
  onChange,
  placeholder,
  min,
  max,
  integer = false,
}: NumberInputProps) {
  const [localValue, setLocalValue] = useState(value?.toString() ?? '');

  // Sync from store when value changes externally
  useEffect(() => {
    setLocalValue(value?.toString() ?? '');
  }, [value]);

  const handleBlur = () => {
    const parsed = integer ? parseInt(localValue, 10) : parseFloat(localValue);
    if (!isNaN(parsed)) {
      // Clamp to min/max if specified
      let clamped = parsed;
      if (min !== undefined) clamped = Math.max(min, clamped);
      if (max !== undefined) clamped = Math.min(max, clamped);
      onChange(clamped);
      setLocalValue(clamped.toString());
    } else if (localValue === '') {
      onChange(undefined);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBlur();
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <input
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      id={id}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
    />
  );
}
