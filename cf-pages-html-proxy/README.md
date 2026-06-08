# Cloudflare Pages HTML Reverse Proxy

## 파일 구조

```
public/_routes.json
public/index.html
functions/[[path]].js
wrangler.toml
package.json
```

## 배포

```bash
npm install
npx wrangler login
npx wrangler pages project create cf-pages-html-proxy
npm run deploy -- --project-name cf-pages-html-proxy
```

또는 Cloudflare Pages에서 GitHub 저장소를 연결하세요.

## 환경 변수

Cloudflare Pages > Settings > Environment variables:

- `TARGET_URL`
  - 기본값: `https://gemini.google.com/share/dbf04c4d0c13`
- `INJECTED_SCRIPT`
  - 가져온 HTML 안에서 실행할 JS 문자열
- `ALLOW_ANY_HTTPS`
  - `false` 권장
  - `true`는 모든 HTTP/HTTPS URL을 프록시하므로 운영 배포에서는 권장하지 않습니다.

## 주의

- Cloudflare Pages Function은 브라우저가 아니므로 서버에서 JS 실행 후 DOM 결과를 렌더링할 수 없습니다.
- 주입 문자열은 브라우저에서 실행됩니다.
- WebSocket/WebRTC/일부 보안 검사가 강한 사이트는 완전 프록시가 어렵습니다.
- 본인 소유 페이지 또는 공개적으로 접근 가능한 페이지에만 사용하세요.
