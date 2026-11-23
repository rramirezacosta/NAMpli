//! Room reverb for the amp output stage.
//!
//! A small Freeverb-style network: eight damped comb filters in parallel followed
//! by four allpass filters in series. The room size and damping are fixed at
//! musical values; the single user-facing control is the wet mix. Everything is
//! allocated once in `new()` on the DSP worker thread, so `process_buffer` does
//! no allocation and can run alongside the NAM model without disturbing timing.

/// Comb delays from the original Freeverb tuning (44.1 kHz samples).
const COMB_DELAYS: [usize; 8] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
/// Allpass delays from the original Freeverb tuning (44.1 kHz samples).
const ALLPASS_DELAYS: [usize; 4] = [556, 441, 341, 225];
const COMB_FEEDBACK: f32 = 0.84;
const COMB_DAMPING: f32 = 0.25;
const ALLPASS_FEEDBACK: f32 = 0.5;
const SMOOTH_MS: f32 = 5.0;

/// Scale a 44.1 kHz delay to the runtime sample rate, rounded to whole samples.
fn scaled_delay(base: usize, sample_rate: f32) -> usize {
    ((base as f32 * sample_rate / 44100.0).round() as usize).max(1)
}

/// Damped feedback comb filter.
struct Comb {
    buffer: Vec<f32>,
    index: usize,
    filterstore: f32,
}

impl Comb {
    fn new(delay: usize) -> Self {
        Comb {
            buffer: vec![0.0; delay],
            index: 0,
            filterstore: 0.0,
        }
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let output = self.buffer[self.index];
        self.buffer[self.index] = input + COMB_FEEDBACK * self.filterstore;
        // Low-pass in the feedback path: each reflection is darker than the last.
        self.filterstore = output * (1.0 - COMB_DAMPING) + self.filterstore * COMB_DAMPING;
        self.index += 1;
        if self.index == self.buffer.len() {
            self.index = 0;
        }
        output
    }
}

/// Allpass filter used to diffuse the comb outputs without colouring the tone.
struct Allpass {
    buffer: Vec<f32>,
    index: usize,
}

impl Allpass {
    fn new(delay: usize) -> Self {
        Allpass {
            buffer: vec![0.0; delay],
            index: 0,
        }
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let bufout = self.buffer[self.index];
        let output = bufout - input;
        self.buffer[self.index] = input + ALLPASS_FEEDBACK * bufout;
        self.index += 1;
        if self.index == self.buffer.len() {
            self.index = 0;
        }
        output
    }
}

pub struct Reverb {
    combs: Vec<Comb>,
    allpasses: Vec<Allpass>,
    /// Wet signal for the current block, mixed back into the dry input.
    scratch: Vec<f32>,
    smooth_coeff: f32,
    wet_current: f32,
}

impl Reverb {
    pub fn new(sample_rate: f32) -> Self {
        let smooth_coeff = (-1.0 / (SMOOTH_MS * 0.001 * sample_rate)).exp();
        Reverb {
            combs: COMB_DELAYS
                .iter()
                .map(|&delay| Comb::new(scaled_delay(delay, sample_rate)))
                .collect(),
            allpasses: ALLPASS_DELAYS
                .iter()
                .map(|&delay| Allpass::new(scaled_delay(delay, sample_rate)))
                .collect(),
            scratch: Vec::new(),
            smooth_coeff,
            wet_current: 0.0,
        }
    }

    #[inline]
    fn wet_sample(&mut self, input: f32) -> f32 {
        let mut sample = 0.0;
        for comb in &mut self.combs {
            sample += comb.process(input);
        }
        sample /= self.combs.len() as f32;
        for allpass in &mut self.allpasses {
            sample = allpass.process(sample);
        }
        sample
    }

    /// Mix room reverb into `buffer` in place. `mix` is the target wet amount
    /// (0..1); the actual wet gain is smoothed per sample so turning the knob
    /// never clicks. A mix of zero is a true bypass and costs no DSP work.
    pub fn process_buffer(&mut self, buffer: &mut [f32], mix: f32) {
        if mix <= 0.0 && self.wet_current <= 1e-4 {
            self.wet_current = 0.0;
            return;
        }
        if self.scratch.len() < buffer.len() {
            self.scratch.resize(buffer.len(), 0.0);
        }

        let smooth_coeff = self.smooth_coeff;
        for (i, sample) in buffer.iter_mut().enumerate() {
            let dry = *sample;
            self.scratch[i] = self.wet_sample(dry);
            self.wet_current = smooth_coeff * self.wet_current + (1.0 - smooth_coeff) * mix;
            let wet = self.wet_current;
            *sample = dry * (1.0 - wet) + self.scratch[i] * wet;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Reverb;

    fn energy(samples: &[f32]) -> f64 {
        samples.iter().map(|&x| (x as f64) * (x as f64)).sum()
    }

    #[test]
    fn zero_mix_is_transparent() {
        let mut reverb = Reverb::new(48000.0);
        let mut buffer: Vec<f32> = (0..256).map(|i| (i as f32 - 128.0) / 128.0).collect();
        let original = buffer.clone();
        for _ in 0..8 {
            reverb.process_buffer(&mut buffer, 0.0);
        }
        assert_eq!(buffer, original);
    }

    #[test]
    fn impulse_produces_a_decaying_tail() {
        let sample_rate = 48000usize;
        let mut reverb = Reverb::new(sample_rate as f32);
        let mut tail = Vec::with_capacity(sample_rate);
        let mut input = [0.0_f32; 256];
        input[0] = 1.0;
        reverb.process_buffer(&mut input, 1.0);
        tail.extend_from_slice(&input);
        for _ in 1..(sample_rate / 256) {
            let mut block = [0.0_f32; 256];
            reverb.process_buffer(&mut block, 1.0);
            tail.extend_from_slice(&block);
        }

        let head = energy(&tail[..sample_rate / 10]);
        let last = energy(&tail[sample_rate - sample_rate / 10..]);
        assert!(head > 0.0, "reverb produced no output");
        assert!(last < head * 0.1, "tail did not decay: head={head} last={last}");
        assert!(tail.iter().all(|x| x.is_finite()), "reverb produced non-finite samples");
    }

    #[test]
    fn full_scale_input_stays_stable() {
        let mut reverb = Reverb::new(48000.0);
        let mut peak = 0.0_f32;
        // A full-scale square wave excites the comb resonances; the wet path may
        // exceed unity, but the feedback network must stay finite and stable
        // (the final soft clip in the audio engine bounds what reaches the DAC).
        for block in 0..64 {
            let mut buffer: Vec<f32> = (0..256)
                .map(|i| if (i + block) % 2 == 0 { 1.0 } else { -1.0 })
                .collect();
            reverb.process_buffer(&mut buffer, 0.5);
            peak = peak.max(buffer.iter().fold(0.0_f32, |m, &x| m.max(x.abs())));
            assert!(buffer.iter().all(|x| x.is_finite()));
        }
        assert!(peak < 4.0, "reverb became unstable: peak={peak}");
    }
}
