# 제3자 구성 요소 고지

Emotionless 는 아래 오픈소스 구성 요소를 포함하거나 사용합니다.

| 구성 요소 | 용도 | 라이선스 | 출처 |
|---|---|---|---|
| KcELECTRA-small (`beomi/KcELECTRA-small-v2022`) | 감정·지울 부분 판정 모델의 출발점. 학습 후 ONNX 로 변환하고 8비트로 양자화해 포함 | MIT | https://huggingface.co/beomi/KcELECTRA-small-v2022 |
| KOTE 데이터셋 (`searle-j/kote`) | 감정 판정 학습 데이터 | MIT | https://huggingface.co/datasets/searle-j/kote |
| KOTE 감정 분류 모델 (`searle-j/kote_for_easygoing_people`) | 학습 때 감정 판정의 기준으로 사용 (포함하지 않음) | MIT | https://huggingface.co/searle-j/kote_for_easygoing_people |
| ONNX Runtime Web (`onnxruntime-web` 1.30.0) | 모델 실행 엔진 (WebAssembly) | MIT | https://github.com/microsoft/onnxruntime |
| Fluent Emoji (3D) | 감정 이모티콘 그림, 아이콘 | MIT | https://github.com/microsoft/fluentui-emoji |

각 라이선스 전문은 위 출처에서 확인할 수 있습니다.
