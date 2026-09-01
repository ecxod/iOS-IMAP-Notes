#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=$(node -p "require('$project_dir/manifest.json').version")
output_dir="$project_dir/dist"
variant=${1:-standard}

case "$variant" in
  standard)
    output_file="$output_dir/thunderbird-ios-imap-notes-$version.xpi"
    ;;
  header-controls)
    output_file="$output_dir/thunderbird-ios-imap-notes-$version-header-controls.xpi"
    ;;
  *)
    printf 'Unknown XPI variant: %s\n' "$variant" >&2
    exit 2
    ;;
esac

mkdir -p "$output_dir"
rm -f "$output_file"
stage_dir=$(mktemp -d "$output_dir/.xpi-build.XXXXXX")
trap 'rm -rf -- "$stage_dir"' EXIT HUP INT TERM

cd "$project_dir"
cp \
  manifest.json \
  background.html \
  background.js \
  LICENSE \
  "$stage_dir/"
cp -R \
  _locales \
  images \
  message-display \
  options \
  "$stage_dir/"
mkdir -p "$stage_dir/scripts"
cp \
  scripts/apple-note.mjs \
  scripts/header-controls.mjs \
  scripts/i18n.js \
  scripts/rfc822.mjs \
  "$stage_dir/scripts/"

if [ "$variant" = "header-controls" ]; then
  mkdir -p "$stage_dir/experiments/notesHeader"
  cp \
    experiments/notesHeader/implementation.js \
    experiments/notesHeader/schema.json \
    "$stage_dir/experiments/notesHeader/"
  cp experiments/notesHeader/client.mjs "$stage_dir/scripts/header-controls.mjs"
  node scripts/prepare-experiment-manifest.mjs \
    "$stage_dir/manifest.json" \
    experiments/notesHeader/manifest-fragment.json
fi

cd "$stage_dir"
zip -q -r "$output_file" .

printf '%s\n' "$output_file"
