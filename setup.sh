#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

echo "=== Agentic Workflow Setup ==="
echo ""

# --- Skills ---
echo "Installing skills..."
mkdir -p "$CLAUDE_DIR/skills"

for skill in review postReview addressReview enhancePrompt; do
  target="$CLAUDE_DIR/skills/$skill"
  source="$SCRIPT_DIR/skills/$skill"

  if [ -L "$target" ]; then
    echo "  $skill: symlink exists, skipping"
  elif [ -d "$target" ]; then
    echo "  $skill: directory exists (not a symlink). Back it up? (y/n)"
    read -r answer
    if [ "$answer" = "y" ]; then
      mv "$target" "$target.bak.$(date +%s)"
      ln -s "$source" "$target"
      echo "  $skill: backed up and linked"
    else
      echo "  $skill: skipped"
    fi
  else
    ln -s "$source" "$target"
    echo "  $skill: linked"
  fi
done

# --- Settings ---
echo ""
echo "Installing settings..."

SETTINGS_FILE="$CLAUDE_DIR/settings.json"
if [ -f "$SETTINGS_FILE" ]; then
  echo "  settings.json already exists."
  echo "  Current file will NOT be overwritten."
  echo "  Compare manually: diff $SETTINGS_FILE $SCRIPT_DIR/config/settings.json"
else
  cp "$SCRIPT_DIR/config/settings.json" "$SETTINGS_FILE"
  echo "  settings.json: copied"
fi

# --- MCP Config ---
echo ""
echo "Installing MCP config..."

MCP_FILE="$CLAUDE_DIR/mcp.json"
if [ -f "$MCP_FILE" ]; then
  echo "  mcp.json already exists."
  echo "  Current file will NOT be overwritten."
  echo "  Compare manually: diff $MCP_FILE $SCRIPT_DIR/config/mcp.json"
else
  cp "$SCRIPT_DIR/config/mcp.json" "$MCP_FILE"
  echo "  mcp.json: copied"
fi

# --- Bootstrap Skill ---
echo ""
echo "Installing bootstrap skill..."

BOOTSTRAP_TARGET="$CLAUDE_DIR/skills/bootstrap"
BOOTSTRAP_SOURCE="$SCRIPT_DIR/bootstrap"

if [ -L "$BOOTSTRAP_TARGET" ]; then
  echo "  bootstrap: symlink exists, skipping"
elif [ -d "$BOOTSTRAP_TARGET" ]; then
  echo "  bootstrap: directory exists, skipping (remove manually to re-link)"
else
  ln -s "$BOOTSTRAP_SOURCE" "$BOOTSTRAP_TARGET"
  echo "  bootstrap: linked"
fi

# --- MCP Bridge: Install, Build, Register ---
echo ""
echo "Installing MCP bridge..."

BRIDGE_DIR="$SCRIPT_DIR/mcp-bridge"

if [ -f "$BRIDGE_DIR/package.json" ]; then
  (cd "$BRIDGE_DIR" && npm install && npm run build)
  echo "  MCP bridge: built successfully"
else
  echo "  MCP bridge: package.json not found, skipping"
fi

# Register with Claude Code
echo ""
echo "Registering MCP bridge with Claude Code..."
if command -v claude &>/dev/null; then
  if claude mcp list 2>&1 | grep -q "agentic-bridge"; then
    echo "  agentic-bridge: already registered in Claude Code"
  else
    claude mcp add agentic-bridge -- node "$BRIDGE_DIR/dist/mcp.js"
    echo "  agentic-bridge: registered in Claude Code"
  fi
else
  echo "  claude CLI not found, skipping Claude Code registration"
fi

# Register with Codex
echo ""
echo "Registering MCP bridge with Codex..."
if command -v codex &>/dev/null; then
  if codex mcp list 2>&1 | grep -q "agentic-bridge"; then
    echo "  agentic-bridge: already registered in Codex"
  else
    codex mcp add agentic-bridge -- node "$BRIDGE_DIR/dist/mcp.js"
    echo "  agentic-bridge: registered in Codex"
  fi
else
  echo "  codex CLI not found, skipping Codex registration"
fi

# --- Claude Code Plugins ---
echo ""
echo "Installing Claude Code plugins..."

if command -v claude &>/dev/null; then
  # Marketplaces
  MARKETPLACES=(
    "anthropics/claude-plugins-official"
    "VoltAgent/awesome-claude-code-subagents"
    "EveryInc/compound-engineering-plugin"
  )

  for repo in "${MARKETPLACES[@]}"; do
    name=$(basename "$repo")
    if claude plugins marketplace list 2>&1 | grep -q "$name"; then
      echo "  marketplace $name: already added"
    else
      claude plugins marketplace add "github:$repo" 2>&1 && \
        echo "  marketplace $name: added" || \
        echo "  marketplace $name: failed to add (non-fatal)"
    fi
  done

  # Plugins
  PLUGINS=(
    "github@claude-plugins-official"
    "superpowers@claude-plugins-official"
    "compound-engineering@compound-engineering-plugin"
    "playwright@claude-plugins-official"
  )

  for plugin in "${PLUGINS[@]}"; do
    if claude plugins list 2>&1 | grep -q "$plugin"; then
      echo "  plugin $plugin: already installed"
    else
      claude plugins install "$plugin" 2>&1 && \
        echo "  plugin $plugin: installed" || \
        echo "  plugin $plugin: failed to install (non-fatal)"
    fi
  done
else
  echo "  claude CLI not found, skipping plugin installation"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Skills installed:   review, postReview, addressReview, enhancePrompt, bootstrap"
echo "Config location:    $CLAUDE_DIR/"
echo "MCP bridge:         $BRIDGE_DIR/"
echo "MCP registered:     Claude Code + Codex (agentic-bridge)"
echo "Plugins:            github, superpowers, compound-engineering, playwright"
