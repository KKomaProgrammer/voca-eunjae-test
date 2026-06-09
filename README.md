# voca-study-simple-script-site

Cloudflare Pages에 그대로 업로드하면 되는 정적 사이트입니다.

## 포함 파일

- index.html
- _redirects
- _headers

## 동작

사이트 주소가 `https://voca-study-eunjae.pages.dev` 그대로 유지됩니다.
페이지가 열리면 아래 스크립트만 실행됩니다.

```js
document.querySelector("top-bar-actions")?.remove();
document.querySelector(".footer")?.remove();
document.documentElement.style.setProperty("--bard-sidenav-open-closed-width-diff", "0px");
```

사용자 메시지의 `document.querySelector("ch...` 부분은 잘려 있어서 넣지 않았습니다.
추가 코드가 있으면 `index.html`의 `runUserScript()` 안에 넣으세요.
