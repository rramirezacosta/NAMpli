//! Cabinet impulse-response loader and convolver.
//!
//! The bundled NAM captures are amp-only (`gear_type: amp`, no `includes_cab`),
//! so a raw amp model into a clean output sounds harsh and fizzy. This module
//! applies a mono cabinet IR with a short direct-form FIR, which is fast enough
//! to run next to the NAM model on the DSP thread.

use std::path::Path;

/// Longest IR we keep. Cabinet IRs put almost all of their energy in the first
/// few milliseconds; 2048 taps (42ms at 48kHz) is plenty and keeps the direct
/// convolution cheap. Longer files are truncated with a short fade-out.
const MAX_TAPS: usize = 2048;

/// Matching block size for `process_buffer`; must be >= the DSP block size.
const MAX_IR_BLOCK: usize = 1024;

pub struct CabinetIr {
    /// Reversed taps, so convolution is a forward dot product over a window.
    taps_rev: Vec<f32>,
    /// The last `taps.len() - 1` input samples.
    history: Vec<f32>,
    /// Scratch holding `history ++ current block`.
    scratch: Vec<f32>,
    /// Original (downmixed) taps and their sample rate, kept for resampling.
    raw: Vec<f32>,
    raw_rate: u32,
    prepared_rate: u32,
    file_name: String,
}

impl CabinetIr {
    pub fn from_file(path: &Path) -> Result<Self, String> {
        let mut reader = hound::WavReader::open(path)
            .map_err(|e| format!("Failed to open IR '{}': {}", path.display(), e))?;
        let spec = reader.spec();

        if spec.channels == 0 {
            return Err("IR file has no channels".into());
        }
        let channels = spec.channels as usize;

        let interleaved: Vec<f32> = match spec.sample_format {
            hound::SampleFormat::Float => reader
                .samples::<f32>()
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed to read IR: {}", e))?,
            hound::SampleFormat::Int => {
                let bits = spec.bits_per_sample.max(1);
                let scale = 1.0_f32 / (1_u64 << (bits - 1)) as f32;
                reader
                    .samples::<i32>()
                    .map(|s| s.map(|v| v as f32 * scale))
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| format!("Failed to read IR: {}", e))?
            }
        };

        if interleaved.is_empty() {
            return Err("IR file contains no samples".into());
        }

        // Downmix to mono; cab IRs are usually mono anyway.
        let frames = interleaved.len() / channels;
        let mut raw: Vec<f32> = (0..frames)
            .map(|f| {
                let mut acc = 0.0;
                for c in 0..channels {
                    acc += interleaved[f * channels + c];
                }
                acc / channels as f32
            })
            .collect();

        if raw.len() > MAX_TAPS {
            raw.truncate(MAX_TAPS);
            let fade = 64.min(raw.len());
            let start = raw.len() - fade;
            for i in 0..fade {
                raw[start + i] *= 1.0 - i as f32 / fade as f32;
            }
        }

        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("IR")
            .to_string();

        let mut ir = CabinetIr {
            taps_rev: Vec::new(),
            history: Vec::new(),
            scratch: Vec::new(),
            raw,
            raw_rate: spec.sample_rate,
            prepared_rate: 0,
            file_name,
        };
        // Start at the app's usual rate; `prepare` is called again at stream start.
        ir.prepare(48_000);
        Ok(ir)
    }

    pub fn file_name(&self) -> &str {
        &self.file_name
    }

    /// Resample (if needed) and reset the convolution history for `sample_rate`.
    pub fn prepare(&mut self, sample_rate: u32) {
        if self.prepared_rate == sample_rate && !self.taps_rev.is_empty() {
            return;
        }

        let mut taps = if self.raw_rate == sample_rate {
            self.raw.clone()
        } else {
            resample_linear(&self.raw, self.raw_rate, sample_rate)
        };

        // Peak-normalize so different IRs do not wildly change the output level.
        let peak = taps.iter().fold(0.0_f32, |m, s| m.max(s.abs()));
        if peak > 0.0 {
            let gain = 1.0 / peak;
            taps.iter_mut().for_each(|s| *s *= gain);
        }
        if taps.len() > MAX_TAPS {
            taps.truncate(MAX_TAPS);
        }

        self.taps_rev = taps.iter().rev().copied().collect();
        self.history = vec![0.0; taps.len().saturating_sub(1)];
        self.scratch = vec![0.0; taps.len() + MAX_IR_BLOCK];
        self.prepared_rate = sample_rate;
    }

    /// Convolve `buffer` with the IR in place, mixing from dry to wet by `mix`.
    pub fn process_buffer(&mut self, buffer: &mut [f32], mix: f32) {
        let taps = self.taps_rev.len();
        if taps == 0 {
            return;
        }
        let mix = mix.clamp(0.0, 1.0);
        if mix == 0.0 {
            return;
        }

        let history_len = taps - 1;

        for chunk in buffer.chunks_mut(MAX_IR_BLOCK) {
            let n = chunk.len();

            // z = [previous taps-1 samples][current block]
            self.scratch[..history_len].copy_from_slice(&self.history);
            self.scratch[history_len..history_len + n].copy_from_slice(chunk);

            for i in 0..n {
                let window = &self.scratch[i..i + taps];
                let mut acc = 0.0_f32;
                for (tap, sample) in self.taps_rev.iter().zip(window) {
                    acc += tap * sample;
                }
                let dry = chunk[i];
                chunk[i] = dry + (acc - dry) * mix;
            }

            if history_len > 0 {
                self.history
                    .copy_from_slice(&self.scratch[n..n + history_len]);
            }
        }
    }
}

fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = to as f64 / from as f64;
    let out_len = (input.len() as f64 * ratio).ceil() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let position = i as f64 / ratio;
        let index = position.floor() as usize;
        let frac = (position - index as f64) as f32;
        let a = input.get(index).copied().unwrap_or(0.0);
        let b = input.get(index + 1).copied().unwrap_or(0.0);
        out.push(a + (b - a) * frac);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resampling_preserves_length_ratio() {
        let input = vec![0.0_f32; 441];
        let out = resample_linear(&input, 44_100, 48_000);
        assert!(out.len() >= 480 && out.len() <= 481);
    }

    #[test]
    fn impulse_passes_through_after_normalization() {
        let dir = std::env::temp_dir().join("jcm800-ir-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("impulse.wav");
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 48_000,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        {
            let mut writer = hound::WavWriter::create(&path, spec).unwrap();
            writer.write_sample(1.0_f32).unwrap();
            for _ in 1..64 {
                writer.write_sample(0.0_f32).unwrap();
            }
            writer.finalize().unwrap();
        }

        let mut ir = CabinetIr::from_file(&path).unwrap();
        ir.prepare(48_000);
        let mut buffer = [0.0_f32; 8];
        buffer[0] = 1.0;
        ir.process_buffer(&mut buffer, 1.0);
        assert!((buffer[0] - 1.0).abs() < 1e-3);
        assert!(buffer[1..].iter().all(|s| s.abs() < 1e-6));
    }
}
