export interface AmpSettings {
  preampVolume: number;    // 0-10
  bass: number;            // 0-10
  middle: number;          // 0-10
  treble: number;          // 0-10
  presence: number;        // 0-10
  masterVolume: number;    // 0-10
  gainLevel: number;       // 0-10
  powerOn: boolean;        // true = on, false = standby
  inputSensitivity: 'high' | 'low';
}

export const DEFAULT_SETTINGS: AmpSettings = {
  // Unity input trim; 0 = -12 dB, 10 = +12 dB.
  preampVolume: 5,
  // Neutral by default: the NAM captures already have the amp's B8/M4/T7 tone
  // stack baked in, so the panel EQ is extra shaping on top of that.
  bass: 5,
  middle: 5,
  treble: 5,
  presence: 5,
  masterVolume: 5,
  gainLevel: 1,
  powerOn: false,
  inputSensitivity: 'high',
};
