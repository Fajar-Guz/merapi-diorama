#!/usr/bin/env bash
# Builds out/merapi-diorama.mp4 from frames/ (1710 JPEGs) and out/audio_raw.wav.
# Requires ffmpeg with libx264. Target size is about 22 MB for 57 s.
set -euo pipefail
mkdir -p out
ffmpeg -y -loglevel error -i out/audio_raw.wav -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 48000 out/audio.wav
ffmpeg -y -loglevel error -framerate 30 -i frames/f%05d.jpg -c:v libx264 -preset slow -b:v 2900k \
  -pass 1 -passlogfile out/x264 -pix_fmt yuv420p -an -f mp4 /dev/null
ffmpeg -y -loglevel error -framerate 30 -i frames/f%05d.jpg -i out/audio.wav -c:v libx264 -preset slow \
  -b:v 2900k -maxrate 4500k -bufsize 6000k -pass 2 -passlogfile out/x264 -pix_fmt yuv420p -profile:v high \
  -c:a aac -b:a 160k -ar 48000 -shortest -movflags +faststart out/merapi-diorama.mp4
ls -l out/merapi-diorama.mp4
