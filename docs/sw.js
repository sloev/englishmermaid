// Plainpath service worker. The cache version and precache list are filled in at build time.
const CACHE = "plainpath-mvfod4o0";
const PRECACHE = ["./","manifest.webmanifest","favicon.svg","icon-192.png","icon-512.png","assets/outfit-latin-400-normal-BGsTXAXT.woff2","assets/outfit-latin-500-normal-DKnIMDSk.woff2","assets/outfit-latin-700-normal-Cu9v6i1X.woff2","assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2","assets/outfit-latin-600-normal-B7SfZ07L.woff2","assets/ibm-plex-mono-latin-600-normal-BgSNZQsw.woff2","assets/ibm-plex-mono-latin-500-normal-DSY6xOcd.woff2","assets/index-BI-ilbIc.css","assets/dagre-GXQ25YYZ-DwHO_oSu.js","assets/mermaid.core-bfFDTIcR.js","assets/index-DAEd0s3o.js","assets/outfit-latin-400-normal-DMwTpYkH.woff","assets/outfit-latin-500-normal-ClnHRwRh.woff","assets/outfit-latin-600-normal-BEfTtDA7.woff","assets/outfit-latin-700-normal-D4itBLBr.woff","assets/ibm-plex-mono-latin-400-normal-CvHOgSBP.woff","assets/ibm-plex-mono-latin-500-normal-CB9ihrfo.woff","assets/ibm-plex-mono-latin-600-normal-DWFSQ4vo.woff","assets/layout-DuE-y5bc.js","assets/flowDiagram-HODETNUW-A9HbM8cQ.js","assets/chunk-5VM5RSS4-Dcqxob7C.js","assets/chunk-XXDRQBXY-D3xWrzEC.js","assets/chunk-POPQ4Y6H-D5st_OTX.js","assets/chunk-F27PBJKO-JG7ZCiQx.js","assets/channel-D7dZJYin.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  // Pages: network first so a new deploy shows up, cached copy when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("./", copy));
          return response;
        })
        .catch(() => caches.match("./")),
    );
    return;
  }

  // Everything else (hashed assets, lazily loaded Mermaid chunks): cache first.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
