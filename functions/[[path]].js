// Cloudflare Pages Functions catch-all proxy
// 파일 위치: functions/[[path]].js
//
// 용도:
// 1) 서버 변수 TARGET_URL에 저장된 페이지를 서버가 가져와 그대로 표시
// 2) HTML/CSS 안의 리소스 URL을 /__proxy?url=... 로 재작성
// 3) 페이지 안 fetch/XHR/iframe/img/script/link/video/audio/source/form 등을 주입 스크립트로 가로채기
// 4) 추가 서버 변수 INJECTED_SCRIPT 문자열을 가져온 HTML 안에서 실행
//
// 주의:
// - Cloudflare Pages Function은 브라우저가 아니므로 서버에서 JS 실행 후 DOM 결과를 렌더링할 수 없습니다.
// - 그래서 INJECTED_SCRIPT는 "브라우저에서 주입 실행"됩니다.
// - WebSocket, WebRTC, 일부 Google 내부 보안/무결성 검사는 완전 프록시가 어려울 수 있습니다.

const DEFAULT_TARGET_URL = "https://gemini.google.com/share/dbf04c4d0c13";

// HTML 안에서 실행할 추가 JS 문자열.
// Cloudflare Pages 환경변수 INJECTED_SCRIPT 로 덮어쓸 수 있습니다.
const DEFAULT_INJECTED_SCRIPT = `
document.querySelector("top-bar-actions").remove();document.querySelector(".footer").remove();document.documentElement.style.setProperty('--bard-sidenav-open-closed-width-diff', '0px');document.querySelector("ch
`;

// true면 모든 https/http URL을 프록시합니다.
// 실제 운영은 false + ALLOWED_HOST_SUFFIXES 제한 권장.
const DEFAULT_ALLOW_ANY_HTTPS = false;

// false일 때 허용할 도메인/상위 도메인.
// Gemini 공유 페이지 기준으로 넉넉히 잡은 예시입니다.
const ALLOWED_HOST_SUFFIXES = [
  "gemini.google.com",
  "google.com",
  "gstatic.com",
  "googleusercontent.com",
  "googleapis.com",
  "ggpht.com",
  "youtube.com",
  "ytimg.com"
];

const URL_ATTRS = [
  "href",
  "src",
  "action",
  "poster",
  "data",
  "formaction",
  "xlink:href"
];

const SRCSET_ATTRS = [
  "srcset",
  "imagesrcset"
];

const STRIP_RESPONSE_HEADERS = [
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "frame-options",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "permissions-policy",
  "clear-site-data",
  "set-cookie",
  "set-cookie2",
  "content-length"
];

const STRIP_REQUEST_HEADERS = [
  "host",
  "origin",
  "referer",
  "cookie",
  "authorization",
  "proxy-authorization",
  "connection",
  "upgrade",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-real-ip",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest"
];

function envText(env, key, fallback) {
  const v = env && typeof env[key] === "string" ? env[key] : undefined;
  return v == null || v === "" ? fallback : v;
}

function envBool(env, key, fallback) {
  const v = envText(env, key, String(fallback));
  return /^(1|true|yes|y|on)$/i.test(v);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function isSkippableUrl(value) {
  const v = String(value || "").trim();
  return (
    !v ||
    v.startsWith("#") ||
    /^javascript:/i.test(v) ||
    /^data:/i.test(v) ||
    /^blob:/i.test(v) ||
    /^mailto:/i.test(v) ||
    /^tel:/i.test(v) ||
    /^sms:/i.test(v) ||
    /^about:/i.test(v)
  );
}

function normalizeTarget(raw, baseUrl) {
  if (!raw || isSkippableUrl(raw)) return null;
  try {
    return new URL(raw, baseUrl).href;
  } catch {
    return null;
  }
}

function isAllowedTarget(absUrl, allowAnyHttps) {
  let u;
  try {
    u = new URL(absUrl);
  } catch {
    return false;
  }

  if (!["http:", "https:"].includes(u.protocol)) return false;
  if (allowAnyHttps) return true;

  const host = u.hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((suffix) => {
    const s = suffix.toLowerCase();
    return host === s || host.endsWith("." + s);
  });
}

function proxifyUrl(raw, baseUrl, appOrigin, allowAnyHttps) {
  if (isSkippableUrl(raw)) return raw;

  const abs = normalizeTarget(raw, baseUrl);
  if (!abs) return raw;
  if (!isAllowedTarget(abs, allowAnyHttps)) return raw;

  return `${appOrigin}/__proxy?url=${encodeURIComponent(abs)}`;
}

function rewriteSrcset(value, baseUrl, appOrigin, allowAnyHttps) {
  if (!value) return value;

  // srcset은 "url descriptor, url descriptor" 구조입니다.
  // data:image 처럼 콤마가 들어간 값은 그대로 두는 쪽이 안전합니다.
  if (/^\s*data:/i.test(value)) return value;

  return String(value)
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;
      const m = trimmed.match(/^(\S+)(\s+.*)?$/);
      if (!m) return trimmed;
      const nextUrl = proxifyUrl(m[1], baseUrl, appOrigin, allowAnyHttps);
      return nextUrl + (m[2] || "");
    })
    .join(", ");
}

function rewriteCssUrls(cssText, baseUrl, appOrigin, allowAnyHttps) {
  if (!cssText) return cssText;

  let out = String(cssText);

  out = out.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, quote, raw) => {
    const next = proxifyUrl(raw.trim(), baseUrl, appOrigin, allowAnyHttps);
    return `url("${next}")`;
  });

  out = out.replace(/@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?/gi, (full, quote, raw) => {
    const next = proxifyUrl(raw.trim(), baseUrl, appOrigin, allowAnyHttps);
    return `@import "${next}"`;
  });

  return out;
}

function cleanResponseHeaders(upstreamHeaders, contentType) {
  const headers = new Headers(upstreamHeaders);

  for (const h of STRIP_RESPONSE_HEADERS) headers.delete(h);

  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "*");
  headers.set("access-control-expose-headers", "*");
  headers.set("referrer-policy", "no-referrer");

  if (contentType) headers.set("content-type", contentType);

  return headers;
}

function buildUpstreamHeaders(request, targetUrl) {
  const incoming = request.headers;
  const headers = new Headers();

  for (const [k, v] of incoming.entries()) {
    const lower = k.toLowerCase();
    if (STRIP_REQUEST_HEADERS.includes(lower)) continue;
    if (lower.startsWith("cf-")) continue;
    headers.set(k, v);
  }

  const t = new URL(targetUrl);
  headers.set("origin", t.origin);
  headers.set("referer", targetUrl);
  headers.set("accept-language", incoming.get("accept-language") || "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7");
  headers.set("user-agent", incoming.get("user-agent") || "Mozilla/5.0");

  return headers;
}

function makeClientPatchScript(currentOriginalUrl, injectedScript) {
  return `
<script>
(() => {
  "use strict";

  if (window.__CF_PAGES_PROXY_PATCHED__) return;
  window.__CF_PAGES_PROXY_PATCHED__ = true;

  const ORIGINAL_URL = ${JSON.stringify(currentOriginalUrl)};
  const USER_SCRIPT = ${JSON.stringify(injectedScript || "")};
  const PROXY_PATH = "/__proxy?url=";

  window.__PROXY_ORIGINAL_URL__ = ORIGINAL_URL;

  function skipUrl(value) {
    const v = String(value || "").trim();
    return !v ||
      v[0] === "#" ||
      /^javascript:/i.test(v) ||
      /^data:/i.test(v) ||
      /^blob:/i.test(v) ||
      /^mailto:/i.test(v) ||
      /^tel:/i.test(v) ||
      /^sms:/i.test(v) ||
      /^about:/i.test(v);
  }

  function toAbsolute(value) {
    try {
      return new URL(String(value), ORIGINAL_URL).href;
    } catch (_) {
      return String(value);
    }
  }

  function proxify(value) {
    try {
      if (skipUrl(value)) return value;

      const str = String(value);
      if (str.includes(PROXY_PATH)) return value;

      const abs = toAbsolute(str);
      if (!/^https?:\\/\\//i.test(abs)) return value;

      return location.origin + PROXY_PATH + encodeURIComponent(abs);
    } catch (_) {
      return value;
    }
  }

  function rewriteSrcset(value) {
    try {
      if (!value || /^\\s*data:/i.test(value)) return value;
      return String(value).split(",").map((part) => {
        const t = part.trim();
        if (!t) return t;
        const m = t.match(/^(\\S+)(\\s+.*)?$/);
        if (!m) return t;
        return proxify(m[1]) + (m[2] || "");
      }).join(", ");
    } catch (_) {
      return value;
    }
  }

  function rewriteCssText(css) {
    try {
      return String(css)
        .replace(/url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/gi, (_, q, raw) => 'url("' + proxify(raw.trim()) + '")')
        .replace(/@import\\s+(?:url\\(\\s*)?(['"])([^'"]+)\\1\\s*\\)?/gi, (_, q, raw) => '@import "' + proxify(raw.trim()) + '"');
    } catch (_) {
      return css;
    }
  }

  // fetch 가로채기
  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (nativeFetch) {
    window.fetch = function(input, init) {
      try {
        if (input instanceof Request) {
          const req = new Request(proxify(input.url), input);
          return nativeFetch(req, init);
        }
        return nativeFetch(proxify(input), init);
      } catch (_) {
        return nativeFetch(input, init);
      }
    };
  }

  // XMLHttpRequest 가로채기
  if (window.XMLHttpRequest && XMLHttpRequest.prototype.open) {
    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      return nativeOpen.call(this, method, proxify(url), ...rest);
    };
  }

  // sendBeacon 가로채기
  if (navigator.sendBeacon) {
    const nativeBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      return nativeBeacon(proxify(url), data);
    };
  }

  // EventSource 가로채기
  if (window.EventSource) {
    const NativeEventSource = window.EventSource;
    window.EventSource = function(url, config) {
      return new NativeEventSource(proxify(url), config);
    };
    window.EventSource.prototype = NativeEventSource.prototype;
  }

  // WebSocket은 HTTP 프록시 엔드포인트만으로 완전 지원이 어렵습니다.
  // 필요 시 Cloudflare Worker WebSocket 프록시를 별도로 작성해야 합니다.

  const URL_ATTRS = new Set(["src", "href", "action", "poster", "data", "formaction", "xlink:href"]);
  const SRCSET_ATTRS = new Set(["srcset", "imagesrcset"]);

  function patchElement(el) {
    if (!el || el.nodeType !== 1) return;

    try {
      for (const attr of URL_ATTRS) {
        if (el.hasAttribute && el.hasAttribute(attr)) {
          const oldValue = el.getAttribute(attr);
          const newValue = proxify(oldValue);
          if (newValue !== oldValue) el.setAttribute(attr, newValue);
        }
      }

      for (const attr of SRCSET_ATTRS) {
        if (el.hasAttribute && el.hasAttribute(attr)) {
          const oldValue = el.getAttribute(attr);
          const newValue = rewriteSrcset(oldValue);
          if (newValue !== oldValue) el.setAttribute(attr, newValue);
        }
      }

      if (el.hasAttribute && el.hasAttribute("style")) {
        const oldValue = el.getAttribute("style");
        const newValue = rewriteCssText(oldValue);
        if (newValue !== oldValue) el.setAttribute("style", newValue);
      }

      if (el.tagName === "A" && el.getAttribute("target")) {
        el.setAttribute("target", "_self");
      }

      if ((el.tagName === "SCRIPT" || el.tagName === "LINK") && el.hasAttribute("integrity")) {
        el.removeAttribute("integrity");
      }
    } catch (_) {}
  }

  // setAttribute 가로채기
  if (window.Element && Element.prototype.setAttribute) {
    const nativeSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
      const n = String(name).toLowerCase();
      if (URL_ATTRS.has(n)) value = proxify(value);
      else if (SRCSET_ATTRS.has(n)) value = rewriteSrcset(value);
      else if (n === "style") value = rewriteCssText(value);
      return nativeSetAttribute.call(this, name, value);
    };
  }

  // property src/href 등 직접 대입 가로채기
  function patchProp(proto, prop, rewriter) {
    try {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc || !desc.set || !desc.get) return;
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get: function() { return desc.get.call(this); },
        set: function(v) { return desc.set.call(this, rewriter(v)); }
      });
    } catch (_) {}
  }

  const propTargets = [
    [HTMLImageElement && HTMLImageElement.prototype, "src", proxify],
    [HTMLScriptElement && HTMLScriptElement.prototype, "src", proxify],
    [HTMLIFrameElement && HTMLIFrameElement.prototype, "src", proxify],
    [HTMLLinkElement && HTMLLinkElement.prototype, "href", proxify],
    [HTMLAnchorElement && HTMLAnchorElement.prototype, "href", proxify],
    [HTMLSourceElement && HTMLSourceElement.prototype, "src", proxify],
    [HTMLSourceElement && HTMLSourceElement.prototype, "srcset", rewriteSrcset],
    [HTMLVideoElement && HTMLVideoElement.prototype, "src", proxify],
    [HTMLVideoElement && HTMLVideoElement.prototype, "poster", proxify],
    [HTMLAudioElement && HTMLAudioElement.prototype, "src", proxify],
    [HTMLFormElement && HTMLFormElement.prototype, "action", proxify]
  ].filter(Boolean);

  for (const [proto, prop, rewriter] of propTargets) patchProp(proto, prop, rewriter);

  // CSS insertRule 가로채기
  if (window.CSSStyleSheet && CSSStyleSheet.prototype.insertRule) {
    const nativeInsertRule = CSSStyleSheet.prototype.insertRule;
    CSSStyleSheet.prototype.insertRule = function(rule, index) {
      return nativeInsertRule.call(this, rewriteCssText(rule), index);
    };
  }

  // 초기 DOM 및 이후 동적 DOM 감시
  function patchTree(root) {
    try {
      if (!root) return;
      if (root.nodeType === 1) patchElement(root);
      const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
      for (const el of all) patchElement(el);
    } catch (_) {}
  }

  patchTree(document.documentElement);

  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") patchElement(r.target);
      for (const n of r.addedNodes || []) patchTree(n);
    }
  });

  try {
    mo.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "href", "action", "poster", "data", "formaction", "xlink:href", "srcset", "imagesrcset", "style", "integrity", "target"]
    });
  } catch (_) {}

  // 사용자가 서버 변수에 넣은 문자열 실행
  try {
    if (USER_SCRIPT && USER_SCRIPT.trim()) {
      new Function(USER_SCRIPT).call(window);
    }
  } catch (e) {
    console.error("[Proxy injected script error]", e);
  }
})();
</script>`;
}

class UrlAttributeRewriter {
  constructor(baseUrl, appOrigin, allowAnyHttps) {
    this.baseUrl = baseUrl;
    this.appOrigin = appOrigin;
    this.allowAnyHttps = allowAnyHttps;
  }

  element(element) {
    const tag = element.tagName ? element.tagName.toLowerCase() : "";

    for (const attr of URL_ATTRS) {
      const v = element.getAttribute(attr);
      if (v) {
        element.setAttribute(attr, proxifyUrl(v, this.baseUrl, this.appOrigin, this.allowAnyHttps));
      }
    }

    for (const attr of SRCSET_ATTRS) {
      const v = element.getAttribute(attr);
      if (v) {
        element.setAttribute(attr, rewriteSrcset(v, this.baseUrl, this.appOrigin, this.allowAnyHttps));
      }
    }

    const style = element.getAttribute("style");
    if (style) {
      element.setAttribute("style", rewriteCssUrls(style, this.baseUrl, this.appOrigin, this.allowAnyHttps));
    }

    if ((tag === "script" || tag === "link") && element.getAttribute("integrity")) {
      element.removeAttribute("integrity");
    }

    if (tag === "a" && element.getAttribute("target")) {
      element.setAttribute("target", "_self");
    }

    if (tag === "meta") {
      const equiv = element.getAttribute("http-equiv");
      if (equiv && equiv.toLowerCase() === "content-security-policy") {
        element.remove();
      }
    }
  }
}

class HeadInjector {
  constructor(baseUrl, injectedScript) {
    this.baseUrl = baseUrl;
    this.injectedScript = injectedScript;
  }

  element(element) {
    element.prepend(makeClientPatchScript(this.baseUrl, this.injectedScript), { html: true });
  }
}

class HtmlFallbackInjector {
  constructor(baseUrl, injectedScript) {
    this.baseUrl = baseUrl;
    this.injectedScript = injectedScript;
    this.injected = false;
  }

  element(element) {
    if (this.injected) return;
    if ((element.tagName || "").toLowerCase() === "html") {
      element.prepend(makeClientPatchScript(this.baseUrl, this.injectedScript), { html: true });
      this.injected = true;
    }
  }
}

async function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: cleanResponseHeaders(new Headers(), null)
  });
}

async function proxyRequest(context, targetUrl) {
  const { request, env } = context;
  const reqUrl = new URL(request.url);
  const appOrigin = reqUrl.origin;
  const allowAnyHttps = envBool(env, "ALLOW_ANY_HTTPS", DEFAULT_ALLOW_ANY_HTTPS);
  const injectedScript = envText(env, "INJECTED_SCRIPT", DEFAULT_INJECTED_SCRIPT);

  if (!targetUrl) {
    return new Response("Missing url", { status: 400 });
  }

  let normalized;
  try {
    normalized = new URL(targetUrl).href;
  } catch {
    return new Response("Invalid url", { status: 400 });
  }

  if (!isAllowedTarget(normalized, allowAnyHttps)) {
    return new Response(
      "Blocked host. Add the host to ALLOWED_HOST_SUFFIXES or set ALLOW_ANY_HTTPS=true.",
      { status: 403 }
    );
  }

  const upstreamHeaders = buildUpstreamHeaders(request, normalized);
  const method = request.method.toUpperCase();

  const init = {
    method,
    headers: upstreamHeaders,
    redirect: "manual"
  };

  if (!["GET", "HEAD"].includes(method)) {
    init.body = request.body;
  }

  let upstream;
  try {
    upstream = await fetch(normalized, init);
  } catch (e) {
    return new Response("Upstream fetch failed: " + (e && e.message ? e.message : String(e)), {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }

  // 리다이렉트도 프록시 안으로 유지
  if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get("location")) {
    const location = upstream.headers.get("location");
    const absLocation = normalizeTarget(location, normalized);
    const proxiedLocation = proxifyUrl(absLocation, normalized, appOrigin, allowAnyHttps);

    const headers = cleanResponseHeaders(upstream.headers, null);
    headers.set("location", proxiedLocation);
    return new Response(null, { status: upstream.status, headers });
  }

  const contentType = upstream.headers.get("content-type") || "";
  const headers = cleanResponseHeaders(upstream.headers, contentType || null);

  if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    const rewrittenResponse = new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });

    return new HTMLRewriter()
      .on("head", new HeadInjector(normalized, injectedScript))
      .on("html", new HtmlFallbackInjector(normalized, injectedScript))
      .on("*", new UrlAttributeRewriter(normalized, appOrigin, allowAnyHttps))
      .transform(rewrittenResponse);
  }

  if (/text\/css/i.test(contentType)) {
    const css = await upstream.text();
    const rewritten = rewriteCssUrls(css, normalized, appOrigin, allowAnyHttps);
    headers.set("content-type", "text/css; charset=utf-8");
    return new Response(rewritten, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });
  }

  // JS는 그대로 전달합니다. JS 문자열 내부 URL까지 강제로 치환하면 코드가 깨질 가능성이 큽니다.
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") return handleOptions();

  if (url.pathname === "/__ping") {
    return Response.json({
      ok: true,
      target: envText(env, "TARGET_URL", DEFAULT_TARGET_URL)
    });
  }

  if (url.pathname === "/favicon.ico") {
    return new Response(null, { status: 204 });
  }

  if (url.pathname === "/__proxy") {
    const target = url.searchParams.get("url") || url.searchParams.get("u");
    return proxyRequest(context, target);
  }

  // 사이트 루트 및 그 외 모든 경로는 서버 변수 TARGET_URL 페이지를 표시
  // 링크 클릭/iframe/src/fetch는 HTML/클라이언트 패치로 /__proxy 쪽으로 유지됩니다.
  const target = envText(env, "TARGET_URL", DEFAULT_TARGET_URL);
  return proxyRequest(context, target);
}
