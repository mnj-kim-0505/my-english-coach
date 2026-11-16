# My English Coach

토익스피킹 + 일상 회화 AI 말하기 코치 (Claude + Gemini)

구조: 녹음 → Gemini(받아쓰기 + 발음 메모) → Claude(대화·출제·채점) / 음성 출력은 브라우저 내장 TTS

## 배포 (Vercel)

1. 이 폴더를 GitHub 저장소에 올리고 Vercel에서 Import (Framework: Other, 설정 변경 없이 Deploy)
   - 또는 PC에서 폴더 안에서 `npx vercel --prod`
2. Vercel → Project → Settings → Environment Variables 에 추가 후 Redeploy

| 이름 | 필수 | 설명 |
|---|---|---|
| ANTHROPIC_API_KEY | ✅ | Claude API 키 |
| GEMINI_API_KEY | ✅ | Google AI Studio에서 발급한 Gemini 키 |
| APP_PASSWORD | ✅ | 앱 접속 비밀번호 (내 API 크레딧 보호용, 아무거나 길게) |
| CLAUDE_MODEL_FAST | | 회화용 모델 (기본 claude-haiku-5-5) |
| CLAUDE_MODEL_SMART | | 출제·채점용 모델 (기본 claude-sonnet-5-5) |
| GEMINI_MODEL | | 받아쓰기 모델 (기본 gemini-3.8-flash, 더 싸고 빠르게는 gemini-3.5-flash-lite) |

3. 배포된 주소를 폰/PC 브라우저로 열고 APP_PASSWORD 입력 → 마이크 허용

## 참고
- 마이크는 HTTPS에서만 동작해요 (Vercel 주소는 기본 HTTPS).
- 아이폰은 Safari에서 "홈 화면에 추가"하면 앱처럼 쓸 수 있어요.
- API 키는 서버(api/ 폴더)에만 있고 브라우저로 내려가지 않아요. 키를 index.html에 직접 넣지 마세요.
- 로컬 테스트: `npx vercel dev` (환경변수는 .env.local에 같은 이름으로)
