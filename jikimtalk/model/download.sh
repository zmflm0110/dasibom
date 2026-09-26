#!/bin/sh
# 학습·검증용 공개 데이터 받기(저장소에는 넣지 않는다 — 각 데이터의 라이선스를 따르려고)
set -e
cd "$(dirname "$0")/data" 2>/dev/null || { mkdir -p "$(dirname "$0")/data"; cd "$(dirname "$0")/data"; }
R=https://raw.githubusercontent.com
curl -fsSLO $R/kocohub/korean-hate-speech/master/labeled/train.tsv
curl -fsSLO $R/kocohub/korean-hate-speech/master/labeled/dev.tsv
curl -fsSLO $R/2runo/Curse-detection-data/master/dataset.txt
curl -fsSLO $R/songys/Chatbot_data/master/ChatbotData.csv
curl -fsSLO $R/smilegate-ai/korean_unsmile_dataset/main/unsmile_valid_v1.0.tsv
echo "받음: $(ls | tr '\n' ' ')"
