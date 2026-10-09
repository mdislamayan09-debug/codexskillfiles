#!/bin/sh
# quick probe: build, then one shot with an optional expression. usage: sh scripts/p.sh <shot> <out.png> ['<js expr>'] [WxH] [query]
npx vite build 2>&1 | grep -E "error|Error" 
node scripts/probe.mjs "http://127.0.0.1:4181/?${5:-capture&ss=1.5}" "$1" "${3:-null}" "$2" "${4:-1280x720}" 2>&1 | grep -v "GL_INVALID\|too many\|404 (File not found)\|^--- console errors ---$"
