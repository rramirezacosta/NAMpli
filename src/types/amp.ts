export interface AmpSettings {
  inputVolume: number;     // 0-10 (input trim)
  gate: number;            // 0-10 (noise-gate threshold; 0 = off)
  bass: number;            // 0-10
  middle: number;          // 0-10
  treble: number;          // 0-10
  outputVolume: number;     // 0-10
  powerOn: boolean;        // true = on, false = standby
}

export const DEFAULT_SETTINGS: AmpSettings = {
  // Unity input trim; 0 = -12 dB, 10 = +12 dB.
  inputVolume: 5,
  // Gate off by default.
  gate: 0,
  // Neutral by default: the NAM captures already have the amp's B8/M4/T7 tone
  // stack baked in, so the panel EQ is extra shaping on top of that.
  bass: 5,
  middle: 5,
  treble: 5,
  outputVolume: 5,
  powerOn: false,
};
