#!/bin/sh
set -eu

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")"
ollama=${OLLAMA_BIN:-ollama}
export OLLAMA_PORT="${OLLAMA_PORT:-11434}"
export OLLAMA_HOST="127.0.0.1:$OLLAMA_PORT"
export OLLAMA_NO_CLOUD=1

if ! command -v npm >/dev/null || [ ! -x node_modules/.bin/vite ]; then
  printf '%s\n' 'Install Node.js and run npm ci in this directory first.' >&2
  exit 1
fi

ollama_ready() {
  curl --noproxy '*' --fail --silent --max-time 1 "http://$OLLAMA_HOST/api/tags"
}

if ! ollama_ready >/dev/null; then
  if ! command -v "$ollama" >/dev/null; then
    printf '%s\n' 'Ollama is unavailable. Install it, start the Ollama app, or set OLLAMA_BIN to the CLI path.' >&2
    exit 1
  fi
  "$ollama" serve > ollama.log 2>&1 &
  ollama_pid=$!
  trap 'kill "$ollama_pid" 2>/dev/null || true' 0
  attempt=0
  while [ "$attempt" -lt 20 ] && ! ollama_ready >/dev/null; do
    sleep 1
    attempt=$((attempt + 1))
  done
fi

if ! ollama_ready >/dev/null; then
  printf '%s\n' 'Ollama did not start. See ollama.log for details.' >&2
  exit 1
fi

if curl --noproxy '*' --fail --silent --max-time 1 http://127.0.0.1:5173/ |
    grep -Fq '<title>Flexible Visual Recommendation</title>'; then
  printf '%s\n' 'The app is already running. Open http://127.0.0.1:5173/.'
  if [ -n "${ollama_pid:-}" ]; then
    printf '%s\n' 'Keep this window open while using Ollama.'
    wait "$ollama_pid"
  fi
  exit 0
fi

npm run dev -- --port 5173 --strictPort
