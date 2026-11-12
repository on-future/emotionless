# 제출 순서

1. https://chrome.google.com/webstore/devconsole 에 Google 계정으로 로그인합니다. 처음이면 개발자 등록비(1회 5달러)를 내고, 계정에 2단계 인증을 켭니다.
2. 개인정보처리방침은 `docs/privacy.html` 로 GitHub Pages 에 공개되어 있습니다.
3. 대시보드에서 "새 항목"을 누르고 `emotionless-1.0.0.zip` 을 올립니다.
4. `listing.md` 의 내용을 각 탭에 붙여 넣고, 아이콘·스크린샷·프로모션 이미지를 올립니다.
5. 개인 정보 보호 탭에 2번의 주소를 입력합니다.
6. "검토를 위해 제출"을 누릅니다.

모든 사이트에서 동작하는 확장은 심사가 더 오래 걸릴 수 있습니다.

## 새 버전을 올릴 때

`static/manifest.json` 과 `package.json` 의 버전을 올린 뒤 `npm run package` 를 실행하면 `store/` 에 새 압축 파일이 만들어집니다.
