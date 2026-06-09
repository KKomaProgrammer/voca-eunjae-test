// functions/[[path]].js

const DEFAULT_TARGET_URL = "https://gemini.google.com/share/dbf04c4d0c13";

const DEFAULT_INJECTED_SCRIPT = `
(() => {
  function forceVisible() {
    try {
      document.documentElement.style.background = "#fff";

      if (document.body) {
        document.body.style.background = "#fff";
        document.body.style.color = "#111";
      }

      document.documentElement.style.setProperty(
        "--bard-sidenav-open-closed-width-diff",
        "0px"
      );
    } catch (_) {}
  }

  function cleanGeminiUI() {
    forceVisible();

    try { document.querySelector("top-bar-actions")?.remove(); } catch (_) {}
    try { document.querySelector(".footer")?.remove(); } catch (_) {}

    /*
      주의:
      bard-app, chat-window, main, [role="main"], mat-sidenav-container 같은
      핵심 요소는 remove() 하면 검은 화면/빈 화면이 됩니다.
    */
  }

  function showDebugIfBlank() {
    try {
      const text = (document.body && document.body.innerText || "").trim();

      const hasMain =
        document.querySelector("bard-app") ||
        document.querySelector("chat-window") ||
        document.querySelector("main") ||
        document.querySelector("[role='main']");

      if (!text && !hasMain && !document.querySelector("#__proxy_blank_debug")) {
        const box = document.createElement("div");

        box.id = "__proxy_blank_debug";
        box.style.cssText =
          "position:fixed;inset:0;z-index:2147483647;background:white;color:#111;padding:20px;font:14px/1.6 system-ui,sans-serif;overflow:auto;";

        box.innerHTML =
          "<h2>Gemini 화면이 로드되지 않았습니다</h2>" +
          "<p>HTML은 도착했지만 Gemini 앱 JavaScript 초기화가 실패했을 가능성이 큽니다.</p>" +
          "<p>개발자도구 Console/Network에서 <b>Blocked host</b>, <b>403</b>, <b>404</b>, <b>CORS</b>, <b>module script</b> 오류를 확인하세요.</p>" +
          "<p>사용자 주입 코드가 main, bard-app, chat-window 같은 핵심 요소를 지우면 화면이 비게 됩니다.</p>";

        document.body.appendChild(box);
      }
    } catch (_) {}
  }

  forceVisible();
  cleanGeminiUI();

  try {
    new MutationObserver(cleanGeminiUI).observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  } catch (_) {}

  setTimeout(showDebugIfBlank, 5000);
})();
`;

const DEFAULT_ALLOW_ANY_HTTPS = false;

const DEFAULT_ALLOWED_HOST_SUFFIXES = [
  "gemini.google.com",
  "accounts.google.com",

  "google.com",
  "www.google.com",
  "apis.google.com",
  "ogs.google.com",
  "clients1.google.com",
  "clients2.google.com",
  "clients3.google.com",
  "clients4.google.com",
  "clients5.google.com",
  "clients6.google.com",

  "gstatic.com",
  "www.gstatic.com",
  "ssl.gstatic.com",
  "fonts.gstatic.com",

  "googleusercontent.com",
  "lh3.googleusercontent.com",
  "lh4.googleusercontent.com",
  "lh5.googleusercontent.com",
  "lh6.googleusercontent.com",

  "googleapis.com",
  "fonts.googleapis.com",
  "storage.googleapis.com",
  "www.googleapis.com",

  "ggpht.com",

  "youtube.com",
  "www.youtube.com",
  "ytimg.com",
  "i.ytimg.com",

  "googletagmanager.com",
  "www.googletagmanager.com",

  "google-analytics.com",
  "www.google-analytics.com",
  "analytics.google.com",

  "doubleclick.net",
  "stats.g.doubleclick.net",

  "googleadservices.com",
  "googlesyndication.com"
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
  "document-policy",
  "require-document-policy",
  "origin-trial",

  "clear-site-data",

  "content-length",
  "content-encoding",
  "transfer-encoding",
  "alt-svc",

  "report-to",
  "reporting-endpoints",
  "nel"
];

const STRIP_REQUEST_HEADERS = [
  "host",
  "origin",
  "referer",
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
  const value = env && typeof env[key] === "string" ? env[key] : "";
  return value.trim() ? value : fallback;
}

function envBool(env, key, fallback) {
  const value = envText(env, key, String(fallback));
  return /^(1|true|yes|y|on)$/i.test(value);
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

function toAbsoluteUrl(raw, baseUrl) {
  if (!raw || isSkippableUrl(raw)) return null;

  try {
    return new URL(raw, baseUrl).href;
  } catch (_) {
    return null;
  }
}

function isSameOrigin(absUrl, origin) {
  try {
    return new URL(absUrl).origin === origin;
  } catch (_) {
    return false;
  }
}

function getHostSuffixes(primaryTargetUrl) {
  const set = new Set(DEFAULT_ALLOWED_HOST_SUFFIXES);

  try {
    const host = new URL(primaryTargetUrl).hostname.toLowerCase();
    set.add(host);
  } catch (_) {}

  return Array.from(set);
}

function isAllowedTarget(absUrl, allowAnyHttps, hostSuffixes) {
  let parsed;

  try {
    parsed = new URL(absUrl);
  } catch (_) {
    return false;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return false;
  if (allowAnyHttps) return true;

  const host = parsed.hostname.toLowerCase();

  return hostSuffixes.some((suffix) => {
    const s = suffix.toLowerCase();
    return host === s || host.endsWith("." + s);
  });
}

function proxifyUrl(raw, baseUrl, appOrigin, allowAnyHttps, hostSuffixes) {
  if (isSkippableUrl(raw)) return raw;

  const abs = toAbsoluteUrl(raw, baseUrl);
  if (!abs) return raw;

  if (isSameOrigin(abs, appOrigin)) return abs;

  if (!isAllowedTarget(abs, allowAnyHttps, hostSuffixes)) return raw;

  return `${appOrigin}/__proxy?url=${encodeURIComponent(abs)}`;
}

function rewriteSrcset(value, baseUrl, appOrigin, allowAnyHttps, hostSuffixes) {
  if (!value) return value;
  if (/^\s*data:/i.test(value)) return value;

  return String(value)
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;

      const match = trimmed.match(/^(\S+)(\s+.*)?$/);
      if (!match) return trimmed;

      const nextUrl = proxifyUrl(
        match[1],
        baseUrl,
        appOrigin,
        allowAnyHttps,
        hostSuffixes
      );

      return nextUrl + (match[2] || "");
    })
    .join(", ");
}

function rewriteCssUrls(cssText, baseUrl, appOrigin, allowAnyHttps, hostSuffixes) {
  if (!cssText) return cssText;

  let out = String(cssText);

  out = out.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_full, _quote, raw) => {
    const next = proxifyUrl(
      raw.trim(),
      baseUrl,
      appOrigin,
      allowAnyHttps,
      hostSuffixes
    );

    return `url("${next}")`;
  });

  out = out.replace(
    /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?/gi,
    (_full, _quote, raw) => {
      const next = proxifyUrl(
        raw.trim(),
        baseUrl,
        appOrigin,
        allowAnyHttps,
        hostSuffixes
      );

      return `@import "${next}"`;
    }
  );

  return out;
}

function splitSetCookieHeader(value) {
  if (!value) return [];

  return String(value)
    .split(/,(?=\s*[^;,=\s]+=[^;,]*)/g)
    .map((v) => v.trim())
    .filter(Boolean);
}

function getSetCookieArray(headers) {
  try {
    if (typeof headers.getSetCookie === "function") {
      return headers.getSetCookie();
    }
  } catch (_) {}

  const one = headers.get("set-cookie");
  return splitSetCookieHeader(one);
}

function rewriteSetCookie(setCookieValue) {
  if (!setCookieValue) return "";

  const parts = String(setCookieValue)
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean);

  if (!parts.length) return "";

  const first = parts[0];
  const attrs = [];

  for (let i = 1; i < parts.length; i++) {
    const attr = parts[i];
    const key = attr.split("=")[0].trim().toLowerCase();

    if (key === "domain") continue;
    if (key === "path") continue;
    if (key === "samesite") continue;
    if (key === "partitioned") continue;

    attrs.push(attr);
  }

  const hasSecure = attrs.some((v) => v.toLowerCase() === "secure");

  attrs.push("Path=/");
  attrs.push("SameSite=Lax");

  if (!hasSecure) {
    attrs.push("Secure");
  }

  return [first, ...attrs].join("; ");
}

function cleanResponseHeaders(upstreamHeaders, contentType) {
  const headers = new Headers();

  for (const [key, value] of upstreamHeaders.entries()) {
    const lower = key.toLowerCase();

    if (lower === "set-cookie") continue;
    if (STRIP_RESPONSE_HEADERS.includes(lower)) continue;

    headers.set(key, value);
  }

  const setCookies = getSetCookieArray(upstreamHeaders);

  for (const cookie of setCookies) {
    const rewritten = rewriteSetCookie(cookie);

    if (rewritten) {
      headers.append("set-cookie", rewritten);
    }
  }

  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "*");
  headers.set("access-control-expose-headers", "*");
  headers.set("referrer-policy", "no-referrer");
  headers.set("cache-control", "no-store");

  if (contentType) {
    headers.set("content-type", contentType);
  }

  return headers;
}

function buildUpstreamHeaders(request, targetUrl) {
  const headers = new Headers();

  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase();

    if (STRIP_REQUEST_HEADERS.includes(lower)) continue;
    if (lower.startsWith("cf-")) continue;

    headers.set(key, value);
  }

  const target = new URL(targetUrl);

  headers.set("origin", target.origin);
  headers.set("referer", target.href);
  headers.set(
    "accept-language",
    request.headers.get("accept-language") ||
      "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
  );
  headers.set(
    "user-agent",
    request.headers.get("user-agent") ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36"
  );

  return headers;
}

function isDocumentNavigationRequest(request) {
  const dest = request.headers.get("sec-fetch-dest") || "";
  const mode = request.headers.get("sec-fetch-mode") || "";
  const accept = request.headers.get("accept") || "";

  return (
    dest === "document" ||
    dest === "iframe" ||
    mode === "navigate" ||
    accept.includes("text/html")
  );
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function makeHtmlOnlyBlockPage(_targetUrl, appOrigin) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>HTML Only</title>
  <script>
    setTimeout(() => {
      location.replace(${JSON.stringify(appOrigin + "/")});
    }, 50);
  </script>
</head>
<body style="margin:0;background:#fff;font-family:system-ui,sans-serif"></body>
</html>`;
}

function makeRootNonHtmlErrorPage(targetUrl) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Invalid TARGET_URL</title>
</head>
<body style="font-family:system-ui,sans-serif;padding:24px;line-height:1.6">
  <h2>TARGET_URL이 HTML 페이지가 아닙니다.</h2>
  <p>현재 TARGET_URL이 HTML 문서가 아니라 JS/CSS/이미지 같은 리소스를 반환하고 있습니다.</p>
  <pre style="white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:8px">${escapeHtml(targetUrl)}</pre>
  <p>TARGET_URL은 반드시 아래처럼 HTML 페이지 주소여야 합니다.</p>
  <pre style="white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:8px">https://gemini.google.com/share/dbf04c4d0c13</pre>
</body>
</html>`;
}

function makeClientPatchScript(originalUrl, injectedScript) {
  return `
<script>
(() => {
  "use strict";

  if (window.__CF_PAGES_PROXY_PATCHED__) return;
  window.__CF_PAGES_PROXY_PATCHED__ = true;

  const ORIGINAL_URL = ${JSON.stringify(originalUrl)};
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

      try {
        if (new URL(abs).origin === location.origin) return abs;
      } catch (_) {}

      return location.origin + PROXY_PATH + encodeURIComponent(abs);
    } catch (_) {
      return value;
    }
  }

  function rewriteSrcset(value) {
    try {
      if (!value || /^\\s*data:/i.test(value)) return value;

      return String(value)
        .split(",")
        .map((part) => {
          const trimmed = part.trim();
          if (!trimmed) return trimmed;

          const match = trimmed.match(/^(\\S+)(\\s+.*)?$/);
          if (!match) return trimmed;

          return proxify(match[1]) + (match[2] || "");
        })
        .join(", ");
    } catch (_) {
      return value;
    }
  }

  function rewriteCssText(css) {
    try {
      return String(css)
        .replace(
          /url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/gi,
          (_full, _quote, raw) => 'url("' + proxify(raw.trim()) + '")'
        )
        .replace(
          /@import\\s+(?:url\\(\\s*)?(['"])([^'"]+)\\1\\s*\\)?/gi,
          (_full, _quote, raw) => '@import "' + proxify(raw.trim()) + '"'
        );
    } catch (_) {
      return css;
    }
  }

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

  if (window.XMLHttpRequest && XMLHttpRequest.prototype.open) {
    const nativeOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      return nativeOpen.call(this, method, proxify(url), ...rest);
    };
  }

  if (navigator.sendBeacon) {
    const nativeBeacon = navigator.sendBeacon.bind(navigator);

    navigator.sendBeacon = function(url, data) {
      return nativeBeacon(proxify(url), data);
    };
  }

  if (window.EventSource) {
    const NativeEventSource = window.EventSource;

    window.EventSource = function(url, config) {
      return new NativeEventSource(proxify(url), config);
    };

    window.EventSource.prototype = NativeEventSource.prototype;
  }

  if (window.open) {
    const nativeOpen = window.open.bind(window);

    window.open = function(url, target, features) {
      return nativeOpen(proxify(url), target || "_self", features);
    };
  }

  const URL_ATTRS = new Set([
    "src",
    "href",
    "action",
    "poster",
    "data",
    "formaction",
    "xlink:href"
  ]);

  const SRCSET_ATTRS = new Set([
    "srcset",
    "imagesrcset"
  ]);

  function patchElement(el) {
    if (!el || el.nodeType !== 1) return;

    try {
      for (const attr of URL_ATTRS) {
        if (el.hasAttribute && el.hasAttribute(attr)) {
          const oldValue = el.getAttribute(attr);
          const newValue = proxify(oldValue);

          if (newValue !== oldValue) {
            el.setAttribute(attr, newValue);
          }
        }
      }

      for (const attr of SRCSET_ATTRS) {
        if (el.hasAttribute && el.hasAttribute(attr)) {
          const oldValue = el.getAttribute(attr);
          const newValue = rewriteSrcset(oldValue);

          if (newValue !== oldValue) {
            el.setAttribute(attr, newValue);
          }
        }
      }

      if (el.hasAttribute && el.hasAttribute("style")) {
        const oldValue = el.getAttribute("style");
        const newValue = rewriteCssText(oldValue);

        if (newValue !== oldValue) {
          el.setAttribute("style", newValue);
        }
      }

      if (el.tagName === "A" && el.getAttribute("target")) {
        el.setAttribute("target", "_self");
      }

      if (
        (el.tagName === "SCRIPT" || el.tagName === "LINK") &&
        el.hasAttribute("integrity")
      ) {
        el.removeAttribute("integrity");
      }
    } catch (_) {}
  }

  if (window.Element && Element.prototype.setAttribute) {
    const nativeSetAttribute = Element.prototype.setAttribute;

    Element.prototype.setAttribute = function(name, value) {
      const n = String(name).toLowerCase();

      if (URL_ATTRS.has(n)) {
        value = proxify(value);
      } else if (SRCSET_ATTRS.has(n)) {
        value = rewriteSrcset(value);
      } else if (n === "style") {
        value = rewriteCssText(value);
      }

      return nativeSetAttribute.call(this, name, value);
    };
  }

  function patchProp(proto, prop, rewriter) {
    try {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);

      if (!desc || !desc.set || !desc.get) return;

      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get() {
          return desc.get.call(this);
        },
        set(v) {
          return desc.set.call(this, rewriter(v));
        }
      });
    } catch (_) {}
  }

  try { patchProp(HTMLImageElement.prototype, "src", proxify); } catch (_) {}
  try { patchProp(HTMLScriptElement.prototype, "src", proxify); } catch (_) {}
  try { patchProp(HTMLIFrameElement.prototype, "src", proxify); } catch (_) {}
  try { patchProp(HTMLLinkElement.prototype, "href", proxify); } catch (_) {}
  try { patchProp(HTMLAnchorElement.prototype, "href", proxify); } catch (_) {}
  try { patchProp(HTMLSourceElement.prototype, "src", proxify); } catch (_) {}
  try { patchProp(HTMLSourceElement.prototype, "srcset", rewriteSrcset); } catch (_) {}
  try { patchProp(HTMLVideoElement.prototype, "src", proxify); } catch (_) {}
  try { patchProp(HTMLVideoElement.prototype, "poster", proxify); } catch (_) {}
  try { patchProp(HTMLAudioElement.prototype, "src", proxify); } catch (_) {}
  try { patchProp(HTMLFormElement.prototype, "action", proxify); } catch (_) {}

  if (window.CSSStyleSheet && CSSStyleSheet.prototype.insertRule) {
    const nativeInsertRule = CSSStyleSheet.prototype.insertRule;

    CSSStyleSheet.prototype.insertRule = function(rule, index) {
      return nativeInsertRule.call(this, rewriteCssText(rule), index);
    };
  }

  function patchTree(root) {
    try {
      if (!root) return;

      if (root.nodeType === 1) {
        patchElement(root);
      }

      const all = root.querySelectorAll ? root.querySelectorAll("*") : [];

      for (const el of all) {
        patchElement(el);
      }
    } catch (_) {}
  }

  patchTree(document.documentElement);

  try {
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          patchElement(record.target);
        }

        for (const node of record.addedNodes || []) {
          patchTree(node);
        }
      }
    }).observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "src",
        "href",
        "action",
        "poster",
        "data",
        "formaction",
        "xlink:href",
        "srcset",
        "imagesrcset",
        "style",
        "integrity",
        "target"
      ]
    });
  } catch (_) {}

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
  constructor(baseUrl, appOrigin, allowAnyHttps, hostSuffixes) {
    this.baseUrl = baseUrl;
    this.appOrigin = appOrigin;
    this.allowAnyHttps = allowAnyHttps;
    this.hostSuffixes = hostSuffixes;
  }

  element(element) {
    const tag = element.tagName ? element.tagName.toLowerCase() : "";

    for (const attr of URL_ATTRS) {
      const value = element.getAttribute(attr);

      if (value) {
        element.setAttribute(
          attr,
          proxifyUrl(
            value,
            this.baseUrl,
            this.appOrigin,
            this.allowAnyHttps,
            this.hostSuffixes
          )
        );
      }
    }

    for (const attr of SRCSET_ATTRS) {
      const value = element.getAttribute(attr);

      if (value) {
        element.setAttribute(
          attr,
          rewriteSrcset(
            value,
            this.baseUrl,
            this.appOrigin,
            this.allowAnyHttps,
            this.hostSuffixes
          )
        );
      }
    }

    const style = element.getAttribute("style");

    if (style) {
      element.setAttribute(
        "style",
        rewriteCssUrls(
          style,
          this.baseUrl,
          this.appOrigin,
          this.allowAnyHttps,
          this.hostSuffixes
        )
      );
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
    element.prepend(makeClientPatchScript(this.baseUrl, this.injectedScript), {
      html: true
    });
  }
}

class HtmlFallbackInjector {
  constructor(baseUrl, injectedScript) {
    this.baseUrl = baseUrl;
    this.injectedScript = injectedScript;
    this.done = false;
  }

  element(element) {
    if (this.done) return;

    element.prepend(makeClientPatchScript(this.baseUrl, this.injectedScript), {
      html: true
    });

    this.done = true;
  }
}

async function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: cleanResponseHeaders(new Headers(), null)
  });
}

async function fetchUpstreamOnce(request, targetUrl) {
  const method = request.method.toUpperCase();

  const init = {
    method,
    headers: buildUpstreamHeaders(request, targetUrl),
    redirect: "manual"
  };

  if (!["GET", "HEAD"].includes(method)) {
    init.body = request.body;
  }

  return fetch(targetUrl, init);
}

async function proxyRequest(context, targetUrl) {
  const { request, env } = context;
  const requestUrl = new URL(request.url);
  const appOrigin = requestUrl.origin;

  if (!targetUrl) {
    return new Response("Missing target url", {
      status: 400,
      headers: {
        "content-type": "text/plain; charset=utf-8"
      }
    });
  }

  let normalizedTarget;

  try {
    normalizedTarget = new URL(targetUrl).href;
  } catch (_) {
    return new Response("Invalid target url", {
      status: 400,
      headers: {
        "content-type": "text/plain; charset=utf-8"
      }
    });
  }

  if (isSameOrigin(normalizedTarget, appOrigin)) {
    return new Response(
      [
        "TARGET_URL이 현재 Pages 주소와 같습니다.",
        "",
        "TARGET_URL에는 프록시 사이트 주소가 아니라 원본 주소를 넣어야 합니다.",
        "",
        `현재 Pages 주소: ${appOrigin}`,
        `현재 TARGET_URL: ${normalizedTarget}`,
        "",
        "올바른 예:",
        "TARGET_URL=https://gemini.google.com/share/dbf04c4d0c13"
      ].join("\n"),
      {
        status: 508,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store"
        }
      }
    );
  }

  const primaryTarget = envText(env, "TARGET_URL", DEFAULT_TARGET_URL);
  const allowAnyHttps = envBool(env, "ALLOW_ANY_HTTPS", DEFAULT_ALLOW_ANY_HTTPS);
  const injectedScript = envText(env, "INJECTED_SCRIPT", DEFAULT_INJECTED_SCRIPT);
  const hostSuffixes = getHostSuffixes(primaryTarget);

  if (!isAllowedTarget(normalizedTarget, allowAnyHttps, hostSuffixes)) {
    return new Response(
      [
        "Blocked host.",
        "",
        "허용되지 않은 호스트입니다.",
        "필요하면 DEFAULT_ALLOWED_HOST_SUFFIXES에 도메인을 추가하세요.",
        "",
        `URL: ${normalizedTarget}`
      ].join("\n"),
      {
        status: 403,
        headers: {
          "content-type": "text/plain; charset=utf-8"
        }
      }
    );
  }

  let upstream;

  try {
    upstream = await fetchUpstreamOnce(request, normalizedTarget);
  } catch (e) {
    return new Response(
      "Upstream fetch failed: " + (e && e.message ? e.message : String(e)),
      {
        status: 502,
        headers: {
          "content-type": "text/plain; charset=utf-8"
        }
      }
    );
  }

  const location = upstream.headers.get("location");

  if (
    upstream.status >= 300 &&
    upstream.status < 400 &&
    location
  ) {
    const absoluteLocation = toAbsoluteUrl(location, normalizedTarget);

    const proxiedLocation = proxifyUrl(
      absoluteLocation || location,
      normalizedTarget,
      appOrigin,
      allowAnyHttps,
      hostSuffixes
    );

    const headers = cleanResponseHeaders(upstream.headers, null);

    headers.set("location", proxiedLocation || absoluteLocation || location);

    return new Response(null, {
      status: upstream.status,
      headers
    });
  }

  const contentType = upstream.headers.get("content-type") || "";
  const headers = cleanResponseHeaders(upstream.headers, contentType || null);

  const isHtmlResponse = /text\/html|application\/xhtml\+xml/i.test(contentType);
  const isCssResponse = /text\/css/i.test(contentType);
  const isDocumentRequest = isDocumentNavigationRequest(request);

  if (isDocumentRequest && !isHtmlResponse) {
    if (requestUrl.pathname === "/__proxy") {
      return new Response(makeHtmlOnlyBlockPage(normalizedTarget, appOrigin), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store"
        }
      });
    }

    return new Response(makeRootNonHtmlErrorPage(normalizedTarget), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }

  if (isHtmlResponse) {
    const response = new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });

    return new HTMLRewriter()
      .on("head", new HeadInjector(normalizedTarget, injectedScript))
      .on("html", new HtmlFallbackInjector(normalizedTarget, injectedScript))
      .on("*", new UrlAttributeRewriter(
        normalizedTarget,
        appOrigin,
        allowAnyHttps,
        hostSuffixes
      ))
      .transform(response);
  }

  if (isCssResponse) {
    const css = await upstream.text();

    const rewritten = rewriteCssUrls(
      css,
      normalizedTarget,
      appOrigin,
      allowAnyHttps,
      hostSuffixes
    );

    headers.set("content-type", "text/css; charset=utf-8");

    return new Response(rewritten, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  if (url.pathname === "/favicon.ico") {
    return new Response(null, {
      status: 204
    });
  }

  if (url.pathname === "/__ping") {
    return Response.json({
      ok: true,
      target: envText(env, "TARGET_URL", DEFAULT_TARGET_URL),
      origin: url.origin
    });
  }

  if (url.pathname === "/__proxy") {
    const target = url.searchParams.get("url") || url.searchParams.get("u");
    return proxyRequest(context, target);
  }

  const target = envText(env, "TARGET_URL", DEFAULT_TARGET_URL);
  return proxyRequest(context, target);
        }
