#!/usr/bin/env bash
# One-shot setup for people who don't want to think about venvs/pip.
#   ./setup.sh          installs everything into ./venv
#   ./setup.sh --run    installs, then launches the desktop app
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d venv ]; then
  echo "가상환경 생성 중..."
  python3 -m venv venv
fi

echo "필요한 패키지 설치 중 (처음 실행 시 임베딩/리랭커 모델도 함께 받아서 몇 분 걸릴 수 있어요)..."
./venv/bin/pip install --quiet --upgrade pip
./venv/bin/pip install --quiet -r requirements.txt

echo ""
echo "설치 완료. 실행하려면:"
echo "  ./venv/bin/python3 -m clipmind.app"
echo ""

if [ "${1:-}" = "--run" ]; then
  exec ./venv/bin/python3 -m clipmind.app
fi
