//! Read-only level metering for the raw input and the final output.
//!
//! The DSP worker accumulates one `(sum of squares, peak)` pair per block in the
//! loops it already runs, then hands the aggregates to `LevelMeter::push()`
//! *after* the output block has been published. Nothing here runs on a cpal
//! callback, allocates, or affects the audio path.

use serde::Serialize;

/// Bottom of the displayed scale. Matches the dB labels in the UI.
const DB_MIN: f32 = -60.0;
const DB_MAX: f32 = 0.0;
/// A sample at or above this amplitude lights the clip latch (~-0.1 dBFS).
const CLIP_AMPLITUDE: f32 = 0.9886;
const CLIP_HOLD_S: f32 = 1.0;
/// Peak-hold fall speed once its 1 s hold has expired.
const HOLD_DECAY_DB_PER_S: f32 = 20.0;
/// Fixed ring of per-block aggregates. `MAX_BLOCK` is 256, so 32 blocks cover
/// ~170 ms at 48 kHz — comfortably longer than the ~100 ms RMS window.
const RING_BLOCKS: usize = 32;

/// Latest reading for one meter.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterReading {
    /// Rolling RMS over `WINDOW_MS`, in dBFS.
    pub level_db: f32,
    /// Rolling peak over `WINDOW_MS`, in dBFS.
    pub peak_db: f32,
    /// Decaying peak marker, in dBFS.
    pub peak_hold_db: f32,
    /// Latched for a short time after a clipped sample.
    pub clipped: bool,
}

impl MeterReading {
    /// Idle/zero state used before audio starts and after it stops.
    pub fn idle() -> Self {
        Self {
            level_db: DB_MIN,
            peak_db: DB_MIN,
            peak_hold_db: DB_MIN,
            clipped: false,
        }
    }
}

/// Both meters in one snapshot, returned by the `get_meters` command.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterSnapshot {
    pub input: MeterReading,
    pub output: MeterReading,
}

impl MeterSnapshot {
    pub fn idle() -> Self {
        Self {
            input: MeterReading::idle(),
            output: MeterReading::idle(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct BlockLevel {
    sum_sq: f64,
    peak: f32,
    frames: usize,
}

/// One meter's rolling analysis state. Constructed once per audio run; a new
/// stream therefore starts with clean history without a reset command.
pub struct LevelMeter {
    blocks: Vec<BlockLevel>,
    next: usize,
    filled: usize,
    frames: usize,
    sum_sq: f64,
    peak_hold_db: f32,
    clip_left_frames: usize,
    sample_rate: f32,
}

impl LevelMeter {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            blocks: vec![BlockLevel::default(); RING_BLOCKS],
            next: 0,
            filled: 0,
            frames: 0,
            sum_sq: 0.0,
            peak_hold_db: DB_MIN,
            clip_left_frames: 0,
            sample_rate: sample_rate.max(1.0),
        }
    }

    /// Feed one block's aggregates and return the updated reading. All storage
    /// was preallocated in `new()`, so this never allocates.
    pub fn push(&mut self, sum_sq: f64, peak: f32, frames: usize) -> MeterReading {
        if frames == 0 {
            return self.reading();
        }

        let entry = BlockLevel {
            sum_sq,
            peak,
            frames,
        };
        if self.filled == RING_BLOCKS {
            let old = self.blocks[self.next];
            self.sum_sq -= old.sum_sq;
            self.frames = self.frames.saturating_sub(old.frames);
        } else {
            self.filled += 1;
        }
        self.blocks[self.next] = entry;
        self.next = (self.next + 1) % RING_BLOCKS;
        self.sum_sq += sum_sq;
        self.frames += frames;

        // Peak is cheap to rescan over the fixed-size ring; a separate heap
        // would cost more bookkeeping than these 32 comparisons.
        let block_peak = self
            .blocks
            .iter()
            .take(self.filled)
            .fold(0.0_f32, |m, b| m.max(b.peak));

        if peak >= CLIP_AMPLITUDE {
            self.clip_left_frames = (self.sample_rate * CLIP_HOLD_S) as usize;
        } else {
            self.clip_left_frames = self.clip_left_frames.saturating_sub(frames);
        }

        let peak_db = dbfs(block_peak);
        let seconds = frames as f32 / self.sample_rate;
        if peak_db > self.peak_hold_db {
            self.peak_hold_db = peak_db;
        } else {
            self.peak_hold_db = peak_db.max(
                self.peak_hold_db - HOLD_DECAY_DB_PER_S * seconds,
            );
        }

        self.reading()
    }

    fn reading(&self) -> MeterReading {
        let rms = if self.frames == 0 {
            0.0
        } else {
            (self.sum_sq / self.frames as f64).max(0.0).sqrt() as f32
        };
        let block_peak = self
            .blocks
            .iter()
            .take(self.filled)
            .fold(0.0_f32, |m, b| m.max(b.peak));
        MeterReading {
            level_db: dbfs(rms),
            peak_db: dbfs(block_peak),
            peak_hold_db: self.peak_hold_db,
            clipped: self.clip_left_frames > 0,
        }
    }
}

fn dbfs(amplitude: f32) -> f32 {
    if !amplitude.is_finite() || amplitude <= 1.0e-9 {
        DB_MIN
    } else {
        (20.0 * amplitude.log10()).clamp(DB_MIN, DB_MAX)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn push_silence(meter: &mut LevelMeter, frames: usize) -> MeterReading {
        meter.push(0.0, 0.0, frames)
    }

    #[test]
    fn silence_is_far_down_and_never_clips() {
        let mut meter = LevelMeter::new(48_000.0);
        let reading = push_silence(&mut meter, 256);
        assert_eq!(reading.level_db, DB_MIN);
        assert_eq!(reading.peak_db, DB_MIN);
        assert!(!reading.clipped);
        assert!(reading.level_db.is_finite());
    }

    #[test]
    fn sine_reports_expected_rms_and_peak() {
        let mut meter = LevelMeter::new(48_000.0);
        // A 0.5-amplitude sine has ~-6 dBFS peak and ~-9 dBFS RMS.
        let frames = 2048;
        let mut sum_sq = 0.0_f64;
        let mut peak = 0.0_f32;
        for i in 0..frames {
            let s = 0.5 * (2.0 * std::f32::consts::PI * i as f32 / 64.0).sin();
            sum_sq += s as f64 * s as f64;
            peak = peak.max(s.abs());
        }
        let reading = meter.push(sum_sq, peak, frames);
        assert!((reading.level_db + 9.0).abs() < 0.2, "{}", reading.level_db);
        assert!((reading.peak_db + 6.0).abs() < 0.2, "{}", reading.peak_db);
        assert_eq!(reading.peak_hold_db, reading.peak_db);
    }

    #[test]
    fn clip_latches_then_expires() {
        let mut meter = LevelMeter::new(48_000.0);
        let reading = meter.push(1.0, 1.2, 256);
        assert!(reading.clipped);
        assert_eq!(reading.peak_db, DB_MAX);
        // Half a second later the latch is still active.
        let reading = push_silence(&mut meter, 24_000);
        assert!(reading.clipped);
        // ...and after more than a second it has cleared.
        let reading = push_silence(&mut meter, 24_000);
        assert!(!reading.clipped);
    }

    #[test]
    fn peak_hold_falls_monotonically() {
        let mut meter = LevelMeter::new(48_000.0);
        let mut prev = meter.push(0.25, 0.5, 256).peak_hold_db;
        for _ in 0..16 {
            let next = push_silence(&mut meter, 4_800).peak_hold_db;
            assert!(next <= prev, "{} -> {}", prev, next);
            assert!(next >= DB_MIN);
            prev = next;
        }
        assert!(prev < -6.0);
    }

    #[test]
    fn rolling_window_evicts_old_blocks() {
        let mut meter = LevelMeter::new(48_000.0);
        meter.push(1.0, 1.0, 256); // loud block
        for _ in 0..RING_BLOCKS {
            push_silence(&mut meter, 256);
        }
        let reading = push_silence(&mut meter, 256);
        assert_eq!(reading.peak_db, DB_MIN);
        assert_eq!(reading.level_db, DB_MIN);
    }

    #[test]
    fn all_outputs_are_bounded() {
        let mut meter = LevelMeter::new(44_100.0);
        let reading = meter.push(f64::NAN, f32::NAN, 256);
        for value in [reading.level_db, reading.peak_db, reading.peak_hold_db] {
            assert!(value.is_finite());
            assert!((DB_MIN..=DB_MAX).contains(&value));
        }
    }
}
