#!/bin/bash
# Starts the EEG simulator and opens it in your browser (http://localhost:5173).
# The macOS version of run-eeg-explorer.bat: double-click it in Finder.
# Close this Terminal window, or press Ctrl+C in it, to stop the simulator.
#
# First time only, if Finder says it cannot be opened: right-click it and choose Open,
# or run  chmod +x run-eeg-explorer.command  in Terminal from this folder.

cd "$(dirname "$0")" || exit 1

# Finder starts a bare shell: put the usual Node install locations on PATH
# (Homebrew on Apple silicon and Intel, nvm, Volta, Corepack's pnpm).
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/Library/pnpm:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm was not found. Install Node.js (https://nodejs.org), then run:  npm install -g pnpm"
  read -r -p "Press Return to close."
  exit 1
fi

# Already running? Then just open it.
if lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "The simulator is already running. Opening it in your browser."
  open "http://localhost:5173/"
  exit 0
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies, first run only..."
  if ! pnpm install; then
    read -r -p "Press Return to close."
    exit 1
  fi
fi

pnpm run dev
read -r -p "Press Return to close."
