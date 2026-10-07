#!/bin/sh
# Build, capture and lay each shot beside its reference frame, in one step.
# usage: sh scripts/snap.sh <out_dir> [shot,shot,...] [frames] [WxH] [query]
OUT=${1:?out dir}
SHOTS=${2:-snowvista,pines,snowride}
FRAMES=${3:-8}
SIZE=${4:-1280x720}
QUERY=${5:-capture&ss=1.5}
PY=${PY:-../.venv/bin/python}
mkdir -p "$OUT"
npx vite build >"$OUT/build.log" 2>&1 || { tail -20 "$OUT/build.log"; exit 1; }
CANVAS=1 OUT="$OUT" sh scripts/capture.sh "$QUERY" "$SHOTS" "$FRAMES" "$SIZE" 2>&1 | grep -v "GL_INVALID_OPERATION\|too many errors\|THREE.Clock\|404 (File not found)\|^--- console ---$"
"$PY" scripts/sbs.py "$OUT" references "$SHOTS"
