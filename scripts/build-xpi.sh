#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=$(node -p "require('$project_dir/manifest.json').version")
output_dir="$project_dir/dist"
output_file="$output_dir/thunderbird-ios-imap-notes-$version.xpi"

mkdir -p "$output_dir"
rm -f "$output_file"

cd "$project_dir"
zip -q -r "$output_file" \
  manifest.json \
  background.html \
  background.js \
  LICENSE \
  _locales \
  experiments \
  images \
  message-display \
  options \
  scripts/apple-note.mjs \
  scripts/i18n.js \
  scripts/rfc822.mjs

printf '%s\n' "$output_file"
