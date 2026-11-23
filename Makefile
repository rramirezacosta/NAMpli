.PHONY: all clean install dev build lint preview rust-check rust-fmt rust-clippy tauri-dev tauri-build tauri-build-debug

NODE := npm
CARGO := cargo
TAURI := npx tauri
# JACK headers live in /usr/lib64/pkgconfig on Fedora; keep them discoverable.
export PKG_CONFIG_PATH := /usr/lib64/pkgconfig:$(PKG_CONFIG_PATH)

# Default target: install deps, check Rust, and build frontend
all: install rust-check build

# Install all dependencies (Node + Rust)
install:
	$(NODE) install

# Clean all build artifacts
clean:
	rm -rf dist release
	cd src-tauri && $(CARGO) clean

# Development: Tauri dev mode with Vite hot-reload (JACK host enabled)
# Use the Tauri CLI directly: `npm run ... --features jack` lets npm swallow
# `--features`, so the JACK feature never reaches Cargo.
dev:
	$(TAURI) dev --features jack

# Build the React frontend only (Vite + TypeScript)
build:
	$(NODE) run build

# Linting (TypeScript + Oxlint)
lint:
	$(NODE) run lint

# Preview the built frontend in a browser
preview:
	$(NODE) run preview

# Rust: type check only (fast)
rust-check:
	cd src-tauri && $(CARGO) check --features jack

# Rust: format check
rust-fmt:
	cd src-tauri && $(CARGO) fmt --check

# Rust: clippy lints
rust-clippy:
	cd src-tauri && $(CARGO) clippy --features jack -- -D warnings

# Tauri: development mode (Rust + Vite HMR)
# Tauri: development mode (Rust + Vite HMR, JACK host enabled)
tauri-dev: dev

# Tauri: production build (JACK host enabled)
tauri-build:
	$(TAURI) build --features jack

# Tauri: debug build (faster, for testing, JACK host enabled)
tauri-build-debug:
	$(TAURI) build --debug --features jack
