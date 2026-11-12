#!/usr/bin/env bash
# KOTE 감정 분류 모델을 내려받아 ONNX 로 변환하고 8비트로 양자화한다.
# 결과는 extension/models/kote/ 에 만들어지며, 저장소에는 포함하지 않는다 (약 620MB).
# 필요: uv (https://docs.astral.sh/uv/)
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=models/kote

if [ -f "$OUT/onnx/model_quantized.onnx" ]; then
  echo "이미 준비되어 있습니다: $OUT/onnx/model_quantized.onnx"
  exit 0
fi

rm -rf "$OUT"
mkdir -p models

# 라이브러리 버전 조합에 따라 변환이 실패하므로 버전을 고정한다.
uvx --python 3.12 \
  --from "optimum[onnxruntime]==1.24.0" \
  --with "torch==2.5.1" --with "transformers==4.48.3" --with "numpy<2.3" \
  optimum-cli export onnx \
  --model searle-j/kote_for_easygoing_people \
  --task text-classification "$OUT"

mkdir -p "$OUT/onnx"
mv "$OUT/model.onnx" "$OUT/onnx/model.onnx"

uvx --python 3.12 --from "onnxruntime==1.20.1" --with onnx --with "numpy<2.3" python -c "
from onnxruntime.quantization import quantize_dynamic, QuantType
quantize_dynamic('$OUT/onnx/model.onnx', '$OUT/onnx/model_quantized.onnx', weight_type=QuantType.QUInt8)
"

echo "완료: $OUT/onnx/model_quantized.onnx"
