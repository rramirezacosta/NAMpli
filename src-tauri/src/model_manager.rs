use nam_rs::{Model, NamModel};
use std::collections::HashMap;

/// Loaded NAM model with metadata
pub struct LoadedModel {
    pub model: Model,
    pub filename: String,
    pub expected_sample_rate: u32,
    pub loudness: f32,
}

/// Equal-power crossfade state for model switches.
///
/// Switching gain on a NAM capture replaces the whole recurrent model state, so
/// a hard swap produces an audible transient. During a fade the DSP thread runs
/// both models and mixes them with sin/cos weights, which keeps the perceived
/// loudness constant across the transition.
#[derive(Debug, Clone)]
pub struct FadeState {
    pub from: String,
    pub remaining: usize,
    pub total: usize,
}

/// Manages loading and processing NAM models loaded via drag-and-drop.
/// Starts empty (bypass mode); models are added at runtime from bytes.
pub struct ModelManager {
    models: HashMap<String, LoadedModel>,
    current_key: Option<String>,
    fade: Option<FadeState>,
    /// Model requested while a fade is still running. Applied when the current
    /// fade finishes so rapid drops never stack crossfades.
    pending: Option<(String, usize)>,
}

impl ModelManager {
    pub fn new() -> Self {
        ModelManager {
            models: HashMap::new(),
            current_key: None,
            fade: None,
            pending: None,
        }
    }

    /// Get the expected sample rate of the current model, or 48000 if none loaded.
    pub fn current_expected_sample_rate(&self) -> u32 {
        self.current_key
            .as_ref()
            .and_then(|k| self.models.get(k))
            .map(|m| m.expected_sample_rate)
            .unwrap_or(48000)
    }

    /// Process a buffer through the active model, or pass it through unchanged
    /// in bypass mode (no model loaded). Returns the loudness (dB) for normalization.
    pub fn process(&mut self, buffer: &mut [f32], scratch: &mut [f32]) -> f32 {
        let n = buffer.len().min(scratch.len());

        // Bypass mode: no model loaded, pass through unchanged
        let Some(current) = self.current_key.clone() else {
            return -20.0; // default loudness for bypass
        };

        let Some(fade) = self.fade.clone() else {
            let loaded = self
                .models
                .get_mut(&current)
                .expect("Current model not found");
            loaded.model.process_buffer(&mut buffer[..n]);
            return loaded.loudness;
        };

        // A fade from the same key (or a missing model) is meaningless.
        if fade.from == current || !self.models.contains_key(&fade.from) {
            self.fade = None;
            let loaded = self
                .models
                .get_mut(&current)
                .expect("Current model not found");
            loaded.model.process_buffer(&mut buffer[..n]);
            return loaded.loudness;
        }

        let [Some(from), Some(to)] = self
            .models
            .get_disjoint_mut([&fade.from, &current])
        else {
            self.fade = None;
            let loaded = self
                .models
                .get_mut(&current)
                .expect("Current model not found");
            loaded.model.process_buffer(&mut buffer[..n]);
            return loaded.loudness;
        };

        // New model writes into `buffer`, outgoing model into `scratch`, then
        // mix with equal-power (sin/cos) weights sample by sample.
        to.model.process_buffer(&mut buffer[..n]);
        from.model.process_buffer(&mut scratch[..n]);

        let start = 1.0 - fade.remaining as f32 / fade.total as f32;
        let step = 1.0 / fade.total as f32;
        for i in 0..n {
            let p = (start + step * (i as f32 + 1.0)).clamp(0.0, 1.0);
            let angle = p * std::f32::consts::FRAC_PI_2;
            let gain_new = angle.sin();
            let gain_old = angle.cos();
            buffer[i] = buffer[i] * gain_new + scratch[i] * gain_old;
        }

        let consumed = n.min(fade.remaining);
        let new_remaining = fade.remaining - consumed;
        let end = 1.0 - new_remaining as f32 / fade.total as f32;
        let loudness = from.loudness + (to.loudness - from.loudness) * end;

        if new_remaining == 0 {
            self.fade = None;
            // Start the next queued switch, if the user dropped another file
            // while this fade was still running.
            if let Some((next_key, crossfade)) = self.pending.take() {
                if next_key != self.current_key.clone().unwrap_or_default() {
                    self.begin_switch(next_key, crossfade);
                }
            }
        } else {
            self.fade = Some(FadeState {
                remaining: new_remaining,
                ..fade.clone()
            });
        }

        loudness
    }

    /// Drop any in-progress crossfade. Called when the streams restart so the
    /// first block does not mix in a stale model.
    pub fn clear_fade(&mut self) {
        self.fade = None;
        self.pending = None;
    }

    /// Reset the target model and start the equal-power fade into it.
    fn begin_switch(&mut self, key: String, crossfade_samples: usize) {
        // `reset()` zeroes every internal buffer, so the new model starts from a
        // clean slate. The crossfade hides the resulting transient.
        if let Some(loaded) = self.models.get_mut(&key) {
            loaded.model.reset();
        }

        if crossfade_samples > 0 {
            self.fade = Some(FadeState {
                from: self.current_key.clone().unwrap_or_default(),
                remaining: crossfade_samples,
                total: crossfade_samples,
            });
        } else {
            self.fade = None;
        }

        self.current_key = Some(key);
    }

    /// Filename of the currently active model, or None if in bypass mode.
    pub fn current_model_name(&self) -> Option<String> {
        self.current_key.as_ref().and_then(|k| self.models.get(k)).map(|m| m.filename.clone())
    }

    /// Switch to a model by filename key.
    fn switch_to_key(&mut self, key: String, crossfade_samples: usize) {
        if self.current_key.as_ref() == Some(&key) {
            self.pending = None;
            return;
        }

        if !self.models.contains_key(&key) {
            log::warn!("Model not found for key: {}", key);
            return;
        }

        let filename = &self.models.get(&key).unwrap().filename;
        log::info!("Switching to model: {}", filename);

        if self.fade.is_some() {
            self.pending = Some((key, crossfade_samples));
            return;
        }

        self.begin_switch(key, crossfade_samples);
    }

    /// Switch to a model by filename (used for dropped NAM files).
    pub fn switch_model_by_key(&mut self, filename: &str, crossfade_samples: usize) {
        self.switch_to_key(filename.to_string(), crossfade_samples);
    }

    /// Load a NAM model from raw bytes and register it under the given filename.
    pub fn load_model_from_bytes(&mut self, filename: &str, bytes: Vec<u8>) -> Result<(), String> {
        let json = String::from_utf8(bytes)
            .map_err(|e| format!("NAM file is not valid UTF-8: {}", e))?;
        let nam = NamModel::from_json_str(&json)
            .map_err(|e| format!("Failed to parse NAM: {}", e))?;
        let model = Model::from_nam(&nam)
            .map_err(|e| format!("Failed to create model: {}", e))?;
        let expected_sample_rate = nam.expected_sample_rate() as u32;
        let loudness = nam.loudness().unwrap_or(-20.0);
        log::info!("Loaded NAM {} (sample_rate={}, loudness={:.1}dB)", filename, expected_sample_rate, loudness);
        self.models.insert(filename.to_string(), LoadedModel {
            model,
            filename: filename.to_string(),
            expected_sample_rate,
            loudness,
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_real_nam_and_processes_audio() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../nams/JCM800 Hi P6 B8 M4 T7 G2.nam");
        let bytes = std::fs::read(&path).expect("read NAM file");
        let mut mm = ModelManager::new();
        mm.load_model_from_bytes("test.nam", bytes).expect("parse NAM");
        assert!(mm.current_model_name().is_none());
        mm.switch_model_by_key("test.nam", 0);
        assert_eq!(mm.current_model_name().as_deref(), Some("test.nam"));
        let mut buffer = vec![0.1_f32; 64];
        let mut scratch = vec![0.0_f32; 64];
        let loudness = mm.process(&mut buffer, &mut scratch);
        assert!(loudness.is_finite());
        assert!(buffer.iter().any(|s| *s != 0.0));
    }
}
