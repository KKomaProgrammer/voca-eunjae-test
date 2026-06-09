// functions/[[path]].js

const DEFAULT_TARGET_URL = "https://gemini.google.com/share/dbf04c4d0c13";

// 사용자가 말한 실행 코드.
// 마지막 document.querySelector("ch... 부분은 메시지에서 잘려 있어 넣지 않았습니다.
const DEFAULT_INJECTED_SCRIPT = `
(() => {
  function cleanGeminiUI() {
    try { document.querySelector("top-bar-actions")?.remove(); } catch (_) {}
    try { document.querySelector(".footer")?.remove(); } catch (_) {}
    try {
      document.documentElement.style.setProperty(
        "--bard-sidenav-open-closed-width-diff",
        "0px"
      );
    } catch (_) {}
  }

  cleanGeminiUI();

  try {
    new MutationObserver(cleanGeminiUI).observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  } catch (_) {}
})();
`;

const DEFAULT_ALLOW_ANY_HTTPS = false;

const DEFAULT_ALLOWED_HOST_SUFFIXES = [
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

function getHostSuffixes(primaryTargetUrl) {
  const set = new Set(DEFAULT_ALLOWED_HOST_SUFFIXES);

  try {
    const host = new URL(primaryTargetUrl).hostname.toLowerCase();
    set.add(host);
  } catch (_) {}

  return Array.from(set);
}

function isSameOrigin(absUrl, origin) {
  try {
    return new URL(absUrl).origin === origin;
  } catch (_) {
    return false;
  }
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

  // 핵심 수정:
  // 자기 자신의 Pages 주소를 다시 /__proxy로 감싸면 무한 리디렉션/무한 프록시가 발생합니다.
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

function cleanResponseHeaders(upstreamHeaders, contentType) {
  const headers = new Headers(upstreamHeaders);

  for (const name of STRIP_RESPONSE_HEADERS) {
    headers.delete(name);
  }

  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "*");
  headers.set("access-control-expose-headers", "*");
  headers.set("referrer-policy", "no-referrer");

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

      // 핵심 수정:
      // 현재 Pages 자기 자신의 URL은 다시 프록시하지 않음.
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

async function fetchUpstreamWithRedirectLimit(request, targetUrl, maxRedirects) {
  let currentUrl = targetUrl;
  let method = request.method.toUpperCase();
  let redirected = 0;

  while (true) {
    const headers = buildUpstreamHeaders(request, currentUrl);

    const init = {
      method,
      headers,
      redirect: "manual"
    };

    if (!["GET", "HEAD"].includes(method)) {
      init.body = request.body;
    }

    const response = await fetch(currentUrl, init);

    const location = response.headers.get("location");

    if (
      response.status >= 300 &&
      response.status < 400 &&
      location &&
      ["GET", "HEAD"].includes(method)
    ) {
      redirected++;

      if (redirected > maxRedirects) {
        return {
          response: new Response(
            "Too many upstream redirects. TARGET_URL 또는 원본 사이트의 리다이렉트가 반복되고 있습니다.",
            {
              status: 508,
              headers: {
                "content-type": "text/plain; charset=utf-8"
              }
            }
          ),
          finalUrl: currentUrl
        };
      }

      const nextUrl = toAbsoluteUrl(location, currentUrl);

      if (!nextUrl) {
        return {
          response,
          finalUrl: currentUrl
        };
      }

      currentUrl = nextUrl;
      continue;
    }

    return {
      response,
      finalUrl: currentUrl
    };
  }
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

  // 핵심 수정:
  // TARGET_URL이 자기 자신의 Pages 주소면 절대 프록시하지 않음.
  if (isSameOrigin(normalizedTarget, appOrigin)) {
    return new Response(
      [
        "TARGET_URL이 현재 Pages 주소와 같습니다.",
        "",
        "이러면 Cloudflare가 자기 자신을 계속 fetch해서 ERR_TOO_MANY_REDIRECTS가 납니다.",
        "",
        `현재 Pages 주소: ${appOrigin}`,
        `현재 TARGET_URL: ${normalizedTarget}`,
        "",
        "Cloudflare Pages 환경변수 TARGET_URL을 원본 주소로 바꾸세요.",
        "예: https://gemini.google.com/share/dbf04c4d0c13"
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
        "ALLOW_ANY_HTTPS=true로 열 수도 있지만, 오픈 프록시가 되므로 권장하지 않습니다.",
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
  let finalUrl;

  try {
    const result = await fetchUpstreamWithRedirectLimit(request, normalizedTarget, 8);
    upstream = result.response;
    finalUrl = result.finalUrl;
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
    const absoluteLocation = toAbsoluteUrl(location, finalUrl);
    const proxiedLocation = proxifyUrl(
      absoluteLocation,
      finalUrl,
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

  if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    const response = new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });

    return new HTMLRewriter()
      .on("head", new HeadInjector(finalUrl, injectedScript))
      .on("html", new HtmlFallbackInjector(finalUrl, injectedScript))
      .on("*", new UrlAttributeRewriter(finalUrl, appOrigin, allowAnyHttps, hostSuffixes))
      .transform(response);
  }

  if (/text\/css/i.test(contentType)) {
    const css = await upstream.text();

    const rewritten = rewriteCssUrls(
      css,
      finalUrl,
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
