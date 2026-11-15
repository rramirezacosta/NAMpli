import { useState, useRef, useCallback, useEffect } from 'react';
import './Knob.css';

interface KnobProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  description?: string;
}

const MIN_ANGLE = -135;
const MAX_ANGLE = 135;
const MIN_VALUE = 0;
const MAX_VALUE = 10;
// Keep these in sync with `.knob-wrapper` in Knob.css.
const KNOB_SIZE = 100;
const TICK_RADIUS = 40;
const TICK_BOX = 16;

export default function Knob({ label, value, onChange, disabled = false, description }: KnobProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);
  const startValueRef = useRef(0);
  const knobRef = useRef<HTMLDivElement>(null);

  const angle = MIN_ANGLE + (value / (MAX_VALUE - MIN_VALUE)) * (MAX_ANGLE - MIN_ANGLE);

  const getValueFromPosition = useCallback((clientX: number, clientY: number): number => {
    if (!knobRef.current) return value;
    const rect = knobRef.current.parentElement?.getBoundingClientRect();
    if (!rect) return value;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    let angleDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    // Clamp angle to the valid range [-135, 135]
    if (angleDeg < MIN_ANGLE) angleDeg = MIN_ANGLE;
    if (angleDeg > MAX_ANGLE) angleDeg = MAX_ANGLE;
    const ratio = (angleDeg - MIN_ANGLE) / (MAX_ANGLE - MIN_ANGLE);
    return Math.round(Math.max(MIN_VALUE, Math.min(MAX_VALUE, ratio * (MAX_VALUE - MIN_VALUE))));
  }, [value]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    const newValue = getValueFromPosition(e.clientX, e.clientY);
    onChange(newValue);
    setIsDragging(true);
    startYRef.current = e.clientY;
    startValueRef.current = newValue;
  }, [disabled, getValueFromPosition, onChange]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled) return;
    e.preventDefault();
    const touch = e.touches[0];
    const newValue = getValueFromPosition(touch.clientX, touch.clientY);
    onChange(newValue);
    setIsDragging(true);
    startYRef.current = touch.clientY;
    startValueRef.current = newValue;
  }, [disabled, getValueFromPosition, onChange]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const deltaY = startYRef.current - e.clientY;
    const sensitivity = 0.02;
    let newValue = startValueRef.current + deltaY * sensitivity;
    newValue = Math.round(Math.max(MIN_VALUE, Math.min(MAX_VALUE, newValue)));
    if (newValue !== startValueRef.current) {
      startValueRef.current = newValue;
      onChange(newValue);
    }
  }, [isDragging, onChange]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging) return;
    const deltaY = startYRef.current - e.touches[0].clientY;
    const sensitivity = 0.02;
    let newValue = startValueRef.current + deltaY * sensitivity;
    newValue = Math.round(Math.max(MIN_VALUE, Math.min(MAX_VALUE, newValue)));
    if (newValue !== startValueRef.current) {
      startValueRef.current = newValue;
      onChange(newValue);
    }
  }, [isDragging, onChange]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp, handleTouchMove]);

  return (
    <div
      className={`knob ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
      title={description}
    >
      <div className="knob-wrapper">
        <div className="knob-scale">
          {Array.from({ length: 11 }, (_, i) => {
            const tickAngle = MIN_ANGLE + (i / (MAX_VALUE - MIN_VALUE)) * (MAX_ANGLE - MIN_ANGLE);
            const angleRad = (tickAngle * Math.PI) / 180;
            const radius = TICK_RADIUS;
            const x = KNOB_SIZE / 2 + radius * Math.sin(angleRad);
            const y = KNOB_SIZE / 2 - radius * Math.cos(angleRad);
            return (
              <span
                key={i}
                className={`knob-scale-tick ${i === value ? 'active' : ''}`}
                style={{ left: `${x - TICK_BOX / 2}px`, top: `${y - TICK_BOX / 2}px` }}
              >
                {i}
              </span>
            );
          })}
        </div>
        <div
          ref={knobRef}
          className="knob-body"
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          role="slider"
          aria-label={label}
          aria-valuemin={MIN_VALUE}
          aria-valuemax={MAX_VALUE}
          aria-valuenow={value}
          tabIndex={disabled ? -1 : 0}
        >
          <div
            className="knob-indicator"
            style={{ transform: `rotate(${angle}deg)` }}
          />
        </div>
      </div>
      <div className="knob-label-row">
        <span className="knob-label">{label}</span>
        <span className="knob-value">{value}</span>
      </div>
      {description && <div className="knob-description">{description}</div>}
    </div>
  );
}
